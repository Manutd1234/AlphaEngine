"""Credential handling at the Celery process boundary."""

from __future__ import annotations

import sys
from dataclasses import replace
from types import SimpleNamespace

import worker
from modules import jobs


def test_transport_identity_never_returns_url_authority_or_path():
    url = "redis+socket://queue-user:top-secret@redis.internal:6379/private-vhost?token=also-secret"
    assert jobs.broker_transport_identity(url) == "redis"
    assert jobs.broker_transport_identity("not-a-url-with-a-secret") == "other"
    assert jobs.broker_transport_identity("redis://[malformed-secret") == "other"
    assert jobs.broker_transport_identity("") is None


def test_queue_stats_exposes_capability_not_broker_url(monkeypatch):
    url = "amqp://queue-user:top-secret@rabbit.internal:5672/private-vhost"
    monkeypatch.setattr(jobs, "settings", replace(jobs.settings, celery_broker_url=url))
    queue = object.__new__(jobs.JobQueue)
    queue.backend = "celery"
    queue.workers = 4
    queue._jobs = {}

    stats = queue.stats()
    assert stats == {
        "backend": "celery",
        "workers": 4,
        "broker_configured": True,
        "broker_transport": "amqp",
        "total": 0,
        "by_status": {},
    }
    assert "top-secret" not in str(stats)
    assert "rabbit.internal" not in str(stats)


def test_worker_banner_does_not_print_credentials(monkeypatch, capsys):
    url = "redis://queue-user:top-secret@redis.internal:6379/7"
    configured = replace(worker.settings, celery_broker_url=url, job_workers=3)
    monkeypatch.setattr(worker, "settings", configured)
    monkeypatch.setattr(jobs, "settings", configured)

    calls: list[list[str]] = []
    fake_app = SimpleNamespace(worker_main=lambda argv: calls.append(argv))
    monkeypatch.setitem(sys.modules, "celery_tasks", SimpleNamespace(celery_app=fake_app))

    assert worker.main() == 0
    output = capsys.readouterr().out
    assert "broker transport redis" in output
    assert "top-secret" not in output
    assert "redis.internal" not in output
    assert calls == [["worker", "--loglevel=info", "--concurrency=3"]]
