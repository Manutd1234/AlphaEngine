"""
Celery task definitions — the production job backend.
=====================================================

Activated automatically when ``CELERY_BROKER_URL`` (or ``REDIS_URL``) is set.
Without it, ``modules.jobs`` runs the identical callables in an in-process
thread pool, so this file is never imported and Celery/Redis are not required
to run or evaluate the system.

Start a worker with::

    REDIS_URL=redis://localhost:6379/0 python worker.py
    # or: celery -A celery_tasks.celery_app worker --loglevel=info --concurrency=4
"""

from __future__ import annotations

from typing import Any

from celery import Celery

from config import settings

celery_app = Celery(
    "alphaengine",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend or settings.celery_broker_url,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=900,          # a sweep that runs 15 min is a bug, not a sweep
    task_soft_time_limit=840,
    worker_prefetch_multiplier=1,  # long tasks: fair dispatch beats batching
    result_expires=86_400,
)


@celery_app.task(bind=True, name="alphaengine.backtest")
def backtest_task(self, req_dict: dict[str, Any]) -> dict[str, Any]:
    """Parameter sweep. Mirrors the in-process path exactly, including the
    progress callback contract that ``modules.jobs`` polls."""
    from modules.backtester import run_backtest

    def progress(pct: float, message: str = "") -> None:
        self.update_state(state="PROGRESS", meta={"progress": pct, "message": message})

    return run_backtest(req_dict, job_id=self.request.id, progress=progress)


# Consumed by modules.jobs to map a job "kind" onto a registered task.
TASK_MAP = {"backtest": backtest_task}
