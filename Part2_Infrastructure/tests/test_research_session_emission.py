"""The WIRING: a real session rollover puts an ``execution_summary`` on the queue.

``tests/test_research_ingest_session.py`` already proves the producer — that the
card is built from rows the desk records and that a figure nobody measured is
rendered as "not recorded" rather than as zero. It proves it by calling the
producer. Nothing there says anything about whether a RUNNING desk ever reaches
it, and for the producer's whole first life nothing did: ``execution_summary``
was declared in the Postgres enum, in the API ``Literal`` and in
``research_graph``'s ``promoted_to`` rule, and the only caller in the tree was
``tools/backfill_research_rag.py``. A desk that read its own README and searched
for a session summary got sweeps back, ranked, looking exactly like an answer.

So this file asserts the seam and only the seam. Every test drives
``RiskGateway._roll_session_if_needed`` — the same method the monitor loop calls
at midnight and the same one ``submit`` calls under the lock — against a REAL
audit log on disk, and reads the corpus's own bounded queue. A test that called
``ResearchRag.on_session_closed`` directly would pass on a tree where the
rollover site never calls it, which is the exact defect being closed.

Three properties, in the order they matter:

* the document that lands names the session that CLOSED, at the instant it
  closed — not the one that just opened, and not "now";
* the rollover does not WAIT for it. The queue is still empty when the roll
  returns, because the roll runs inside the gateway's lock on two of its three
  call paths and a table scan there would be charged to whichever order happened
  to be the first of a new session;
* a corpus that fails — at the submit, or unreachable altogether — changes
  nothing about the rollover. A rollover is a trading-state transition; the
  corpus is an observer, exactly as the decision hooks are.

Offline throughout. ``ResearchRag.enabled`` is forced on rather than configured:
nothing here opens an HTTP client, ``start()`` is never called, and the queue is
the assertion surface precisely because it is the last point before the network.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from conftest import deep_book, stub_feed

import modules.research_rag.session as session_ingest
import modules.risk_proxy.monitor as monitor
from modules.audit import AuditLog
from modules.research_ingest_session import EXECUTION_SUMMARY
from modules.research_rag import get_rag, reset_rag
from modules.risk_proxy import PositionState, RiskGateway, TokenBucket
from modules.schemas import CheckResult, Fill, OrderRequest, RiskDecision
from modules.tca_engine import TCAEngine

#: The session that closes, the one that opens, and the instant between them.
#: Fixed rather than derived from ``now`` because the whole point of the
#: assertions below is that ``occurred_at`` is the CLOSE — a value computed the
#: same way the code computes it would agree by construction and prove nothing.
CLOSING = "2026-08-21"
OPENING = "2026-08-22"
ROLLED_AT = datetime(2026, 8, 22, 0, 0, 3, tzinfo=timezone.utc)

#: Realised P&L sitting on the book when the boundary arrives. Non-zero so that
#: "the rollover still completed" is a claim about money moving and not about a
#: default comparing equal to itself.
CLOSING_REALIZED = 450.0


@pytest.fixture
def audit(tmp_path):
    log = AuditLog(str(tmp_path / "emission.duckdb"))
    yield log
    log.close()


@pytest.fixture
def engine() -> TCAEngine:
    eng = TCAEngine(symbols=["BTCUSDT"], venues=[])
    eng.feeds = {"TEST": stub_feed("TEST", deep_book("BTCUSDT", mid=100.0))}
    return eng


@pytest.fixture
def rag(monkeypatch):
    """The process-wide corpus, switched on, with the settle wound to zero.

    ``SESSION_SUMMARY_SETTLE_S`` exists so that an audit row queued under the
    gateway's lock in the last instants of a session has landed before the
    summary reads the window. Five seconds of real waiting would make this file
    a slow test that still could not say *when* the document was filed, so the
    constant is patched and the scheduled task is awaited explicitly instead —
    the same trade ``snapshot_equity`` and ``sweep_working_orders`` make by
    being directly callable.
    """
    reset_rag()
    made = get_rag()
    made.enabled = True
    monkeypatch.setattr(session_ingest, "SESSION_SUMMARY_SETTLE_S", 0.0)
    yield made
    reset_rag()


@pytest.fixture
def desk(audit, engine, monkeypatch) -> RiskGateway:
    """A gateway holding a profitable, closable session, one tick before midnight.

    Only ``monitor``'s clock is patched, not every module that binds ``_utcnow``:
    these tests call ``_roll_session_if_needed`` directly and it is the sole
    reader of the clock on that path. ``test_session_rollover``'s fixture patches
    all of them because its restart tests replay rows keyed on the stamp the
    clock wrote.
    """
    monkeypatch.setattr(monitor, "_utcnow", lambda: ROLLED_AT)
    gw = RiskGateway(tca_engine=engine, audit=audit)
    gw.bucket = TokenBucket(1e6, 1_000_000)
    gw.session_date = CLOSING
    gw.positions["BTCUSDT"] = PositionState(symbol="BTCUSDT", realized_pnl=CLOSING_REALIZED)
    gw._sync_position_book()
    # A desk that spent the session in the warning band. Latched state that the
    # roll is supposed to clear, so "the rollover completed" is checkable beyond
    # the date string.
    gw._drawdown_warned = True
    return gw


def filled(
    audit: AuditLog,
    *,
    at: datetime,
    venue: str = "BINANCE",
    notional: float = 5_000.0,
    slippage: float | None = 1.5,
    strategy: str = "ma_cross",
) -> None:
    """One accepted, filled order in the audit log — the gateway's own writer."""
    decision = RiskDecision(
        order_id=f"ord-{at.isoformat()}-{venue}",
        client_order_id=None,
        accepted=True,
        symbol="BTCUSDT",
        side="BUY",
        quantity=0.1,
        notional=notional,
        checks=[CheckResult(name="kill_switch", passed=True, detail="disengaged")],
        rejected_by=[],
        latency_ms=0.4,
        timestamp=at,
        fill=Fill(
            venue=venue, price=64_000.0, quantity=0.078, notional=notional,
            fee_usd=2.0, slippage_bps=slippage,
        ),
        status="FILLED",
    )
    audit.record_order(decision, OrderRequest(
        symbol="BTCUSDT", side="BUY", notional=notional, strategy=strategy,
    ))


def marked(audit: AuditLog, session_date: str) -> None:
    """One equity snapshot, the closing mark the card reads for the book."""
    audit.record_equity_snapshot(SimpleNamespace(
        session_date=session_date, equity=100_450.0, start_of_day_equity=100_000.0,
        realized_pnl=CLOSING_REALIZED, unrealized_pnl=0.0, daily_pnl=CLOSING_REALIZED,
        gross_exposure=15_000.0, daily_drawdown_pct=0.0, positions={},
        kill_switch_active=False,
    ))


def traded(audit: AuditLog) -> None:
    """A traded, marked session on 2026-08-21 — two fills at two venues."""
    filled(audit, at=datetime(2026, 8, 21, 9, 0, tzinfo=timezone.utc))
    filled(audit, at=datetime(2026, 8, 21, 15, 30, tzinfo=timezone.utc),
           venue="OKX", notional=3_000.0, slippage=4.0)
    marked(audit, CLOSING)


async def settle(rag) -> None:
    """Run the summary task the roll scheduled, to completion.

    Asserting the task EXISTS is half the test: the emission is deferred onto
    the loop, so a rollover that quietly scheduled nothing would otherwise be
    indistinguishable here from one whose document had not arrived yet.
    """
    tasks = list(rag._session_tasks)
    assert tasks, "the rollover scheduled no execution-summary task"
    await asyncio.gather(*tasks)


def queued(rag) -> list[dict]:
    return [rag._queue.get_nowait() for _ in range(rag._queue.qsize())]


class TestAClosedSessionReachesTheCorpus:
    @pytest.mark.asyncio
    async def test_the_rollover_enqueues_the_session_it_closed(self, desk, audit, rag):
        traded(audit)

        desk._roll_session_if_needed()
        await settle(rag)

        documents = queued(rag)
        assert len(documents) == 1, "one closed session is one document"
        document = documents[0]
        assert document["kind"] == EXECUTION_SUMMARY
        # The ref the backfill would have used for the same session, so the two
        # producers collide on `unique (desk_id, kind, source_ref)` instead of
        # filing one session twice.
        assert document["source_ref"] == f"session:{CLOSING}"
        # The CLOSE, not the open and not the render. This is what makes a
        # summary sort after every decision it summarises.
        assert document["occurred_at"] == ROLLED_AT.isoformat()

    @pytest.mark.asyncio
    async def test_the_document_holds_the_closed_sessions_figures(self, desk, audit, rag):
        traded(audit)
        # An order on the far side of the boundary. If the window were taken
        # from the NEW session — or from "today" — this fill would be counted
        # and the notional below would be wrong by exactly its size.
        filled(audit, at=datetime(2026, 8, 22, 0, 0, 1, tzinfo=timezone.utc),
               notional=999_000.0)

        desk._roll_session_if_needed()
        await settle(rag)

        document = queued(rag)[0]
        assert document["metrics"]["fills"] == 2
        assert document["metrics"]["notional"] == pytest.approx(8_000.0)
        assert f"Execution summary {CLOSING}" in document["title"]
        assert "BINANCE" in document["body"] and "OKX" in document["body"]
        # Two strategies would be a mixed session and carry none. One strategy
        # traded all session is what makes `promoted_to` an honest edge.
        assert document["strategy"] == "ma_cross"

    @pytest.mark.asyncio
    async def test_the_rollover_does_not_wait_for_the_corpus(self, desk, audit, rag):
        traded(audit)

        desk._roll_session_if_needed()

        # The roll has returned and the book has already moved. Nothing has been
        # read from the audit log for the corpus yet: on two of this method's
        # three call paths it runs inside the gateway's lock, and four aggregate
        # queries over a day of `orders` there would be charged to one order's
        # measured latency.
        assert desk.session_date == OPENING
        assert rag._queue.qsize() == 0

        await settle(rag)
        assert rag._queue.qsize() == 1

    @pytest.mark.asyncio
    async def test_a_session_with_no_fills_is_still_filed_and_says_so(self, desk, audit, rag):
        # No orders, no snapshot. The desk was up and traded nothing, which is a
        # fact about the day and not an absence of one — and the card has to say
        # which, rather than reporting a flat book it never marked.
        desk._roll_session_if_needed()
        await settle(rag)

        document = queued(rag)[0]
        assert document["source_ref"] == f"session:{CLOSING}"
        assert "no equity snapshot recorded" in document["body"]
        assert "no fills recorded" in document["body"]
        assert document["metrics"]["daily_pnl"] is None  # never zero for "unknown"


class TestTheRolloverOutlivesTheCorpus:
    """The roll is a trading-state transition; the corpus is best-effort.

    Both halves of the write path get a failure here — the submit itself, and
    the corpus being unreachable before a document is ever built — because they
    are caught by two different guards, in two different files.
    """

    def _assert_rolled(self, desk: RiskGateway, audit: AuditLog) -> None:
        assert desk.session_date == OPENING
        assert desk.carried_realized_pnl == pytest.approx(CLOSING_REALIZED)
        assert desk.positions["BTCUSDT"].realized_pnl == 0.0
        assert desk._drawdown_warned is False
        rows = audit.query(
            "SELECT payload FROM risk_events WHERE event = 'session_rollover'"
        )
        assert len(rows) == 1, "the durable boundary is what a restart reads back"

    @pytest.mark.asyncio
    async def test_a_failing_corpus_write_leaves_the_rollover_untouched(
        self, desk, audit, rag, monkeypatch,
    ):
        traded(audit)

        def refuse(_document):
            raise RuntimeError("the corpus queue is on fire")

        monkeypatch.setattr(rag, "_submit", refuse)

        desk._roll_session_if_needed()
        self._assert_rolled(desk, audit)
        # And the failure is contained in the task, not raised into the caller
        # of the roll — `gather` would re-raise it here if it were not.
        await settle(rag)
        assert rag._queue.qsize() == 0

    @pytest.mark.asyncio
    async def test_an_unreachable_corpus_leaves_the_rollover_untouched(
        self, desk, audit, rag, monkeypatch,
    ):
        traded(audit)
        # Fails before any document exists: `_file_execution_summary` imports
        # `get_rag` at call time, so this is the guard in `monitor.py` rather
        # than the one in `research_rag/session.py`.
        import modules.research_rag as research_rag

        def unreachable():
            raise ImportError("the research plane is not installed in this image")

        monkeypatch.setattr(research_rag, "get_rag", unreachable)

        desk._roll_session_if_needed()
        self._assert_rolled(desk, audit)
        assert not rag._session_tasks, "nothing should have been scheduled"
        assert rag._queue.qsize() == 0

    def test_an_unconfigured_corpus_files_nothing_and_costs_nothing(
        self, desk, audit, rag,
    ):
        """The default on every desk without Supabase — and a synchronous call.

        Deliberately not an ``async`` test: this is the path a rollover takes
        with no event loop running at all (a tool, or the monitor's own roll
        under a synchronous harness), and the hook must return on its first
        line rather than reach for one.
        """
        traded(audit)
        rag.enabled = False

        desk._roll_session_if_needed()

        self._assert_rolled(desk, audit)
        assert not rag._session_tasks
        assert rag._queue.qsize() == 0
