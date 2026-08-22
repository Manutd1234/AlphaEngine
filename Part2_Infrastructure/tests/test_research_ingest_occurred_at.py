"""``occurred_at`` is when the RUN finished, not when the corpus heard about it.

The live path stamped ``datetime.now()`` inside the renderer while the backfill
tool used the audit row's own timestamp, so the same sweep indexed twice carried
two different times and only one of them was true. The corpus orders, filters
and draws its timeline on this column: on a queue that has backed up, or for a
sweep replayed after a Supabase outage, "the run before the incident" quietly
became "the run indexed before the incident".
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

import modules.research_rag.writer as rag_module
from modules.research_rag import ResearchRag

FINISHED = datetime(2026, 8, 21, 14, 30, tzinfo=timezone.utc)

RESULT = SimpleNamespace(
    request=SimpleNamespace(symbol="BTCUSDT", interval="4h", strategy="ma_cross"),
    engine="numpy", combos_tested=74,
    best=SimpleNamespace(fast=20, slow=80, sharpe=0.24, total_return=0.026,
                         max_drawdown=-0.147, trades=30, exposure=0.45),
    deflated_sharpe_ratio=0.228, walk_forward_oos_sharpe=-0.02, pbo=0.61,
    data_hash="8e43f5f7", job_id="job-1",
    benchmark_buy_hold={"total_return": -0.407},
    walk_forward=[SimpleNamespace(oos_sharpe=0.4), SimpleNamespace(oos_sharpe=-0.2)],
)


class Stub:
    supabase_url = "https://example.supabase.co"
    supabase_service_role_key = "sb_secret_x"
    research_rag_enabled = True
    supabase_desk_id = "00000000-0000-0000-0000-000000000001"
    supabase_timeout_s = 5.0
    supabase_mirror_queue_max = 10


@pytest.fixture
def rag(monkeypatch):
    monkeypatch.setattr(rag_module, "settings", Stub())
    return ResearchRag()


def queued(rag: ResearchRag) -> list[dict]:
    return [rag._queue.get_nowait() for _ in range(rag._queue.qsize())]


def test_the_live_hook_stamps_the_job_s_finish_time(rag):
    rag.on_backtest_complete(
        SimpleNamespace(kind="backtest", result=RESULT, finished_at=FINISHED, job_id="job-1")
    )
    documents = queued(rag)
    assert documents, "the hook queued nothing"
    # Every chart shares the run's time: they describe figures the same run
    # computed, and dating them apart would put a sweep's own drawdown chart on
    # the wrong side of an incident it preceded.
    assert {d["occurred_at"] for d in documents} == {FINISHED.isoformat()}


def test_a_record_with_no_finish_time_says_which_time_the_corpus_will_hold(rag, caplog):
    with caplog.at_level(logging.WARNING, logger="alphaengine.rag"):
        rag.on_backtest_complete(
            SimpleNamespace(kind="backtest", result=RESULT, finished_at=None, job_id="job-9")
        )
    documents = queued(rag)
    assert documents, "a sweep that ran is indexed late rather than not at all"
    assert "carried no finish time" in caplog.text
    assert "job-9" in caplog.text
