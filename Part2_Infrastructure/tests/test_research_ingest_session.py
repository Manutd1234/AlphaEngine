"""``execution_summary``: the ghost kind, and the producer that ends it.

The kind is declared in the Postgres enum, in the API's ``Literal`` and in
``research_graph``'s ``promoted_to`` rule, and until this module existed nothing
in the tree wrote one — while the PRD, ARCHITECTURE.md and the README all list
session execution summaries as an ingested source.

Everything below runs against a REAL audit log on disk, seeded through the
gateway's own writers, because the claim being tested is that the card is built
from figures the desk already records. A fixture of hand-written dictionaries
would prove the renderer formats them and would say nothing about whether those
rows exist, which is the question this kind failed for its whole life.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from modules.audit import AuditLog
from modules.research_ingest_session import (
    closed_session_documents,
    execution_summary_document,
    render_execution_summary_card,
    scan_closed_sessions,
    session_figures,
)
from modules.schemas import CheckResult, Fill, OrderRequest, RiskDecision

OPENED = {
    "2026-08-20": datetime(2026, 8, 20, 0, 0, 1, tzinfo=timezone.utc),
    "2026-08-21": datetime(2026, 8, 21, 0, 0, 2, tzinfo=timezone.utc),
    "2026-08-22": datetime(2026, 8, 22, 0, 0, 3, tzinfo=timezone.utc),
}


@pytest.fixture
def audit(tmp_path):
    log = AuditLog(str(tmp_path / "audit.duckdb"))
    yield log
    log.close()


def roll(audit: AuditLog, session_date: str) -> None:
    audit.record_session_rollover(
        session_date,
        carried_realized_pnl=120.0,
        start_of_day_equity=100_000.0,
        unrealized_at_rollover=0.0,
        at=OPENED[session_date],
    )


def order(
    audit: AuditLog,
    *,
    at: datetime,
    accepted: bool = True,
    venue: str = "BINANCE",
    slippage: float | None = 1.5,
    strategy: str = "ma_cross",
    notional: float = 5_000.0,
) -> None:
    decision = RiskDecision(
        order_id=f"ord-{at.isoformat()}-{venue}",
        client_order_id=None,
        accepted=accepted,
        symbol="BTCUSDT",
        side="BUY",
        quantity=0.1,
        notional=notional,
        checks=[CheckResult(name="kill_switch", passed=True, detail="disengaged")],
        rejected_by=[] if accepted else ["daily_drawdown"],
        latency_ms=0.4,
        timestamp=at,
        fill=Fill(
            venue=venue, price=64_000.0, quantity=0.078, notional=notional,
            fee_usd=2.0, slippage_bps=slippage,
        ) if accepted else None,
        status="FILLED" if accepted else "REJECTED",
    )
    audit.record_order(decision, OrderRequest(
        symbol="BTCUSDT", side="BUY", notional=notional, strategy=strategy,
    ))


def equity(audit: AuditLog, session_date: str, **over) -> None:
    state = SimpleNamespace(
        session_date=session_date, equity=100_450.0, start_of_day_equity=100_000.0,
        realized_pnl=450.0, unrealized_pnl=0.0, daily_pnl=450.0,
        gross_exposure=15_000.0, daily_drawdown_pct=0.0125, positions={},
        kill_switch_active=False,
    )
    for key, value in over.items():
        setattr(state, key, value)
    audit.record_equity_snapshot(state)


def traded_session(audit: AuditLog) -> None:
    """Two closed sessions and one still open, with 2026-08-21 traded."""
    roll(audit, "2026-08-20")
    roll(audit, "2026-08-21")
    order(audit, at=datetime(2026, 8, 21, 9, 0, tzinfo=timezone.utc))
    order(audit, at=datetime(2026, 8, 21, 10, 0, tzinfo=timezone.utc), venue="OKX",
          notional=3_000.0, slippage=4.0)
    order(audit, at=datetime(2026, 8, 21, 11, 0, tzinfo=timezone.utc), accepted=False)
    equity(audit, "2026-08-21")
    roll(audit, "2026-08-22")


class TestWhichSessionsAreClosed:
    def test_only_sessions_the_desk_bracketed_are_summarised(self, audit):
        traded_session(audit)
        scan = scan_closed_sessions(audit)
        assert scan.scanned and scan.reason == "scanned"
        assert [s.session_date for s in scan.sessions] == ["2026-08-20", "2026-08-21"]
        # The close is the instant the NEXT session opened, not midnight by the
        # calendar: a desk that was down over a boundary rolls when it comes back.
        assert scan.sessions[1].closed_at == OPENED["2026-08-22"].replace(tzinfo=None)

    def test_the_current_session_is_never_summarised(self, audit):
        roll(audit, "2026-08-22")
        scan = scan_closed_sessions(audit)
        assert scan.scanned and scan.sessions == ()
        assert scan.reason == "no_closed_session"
        assert "still open" in scan.detail

    def test_a_desk_that_never_rolled_is_not_an_unreadable_one(self, audit):
        scan = scan_closed_sessions(audit)
        assert scan.scanned is True, "looked and found none is not could not look"
        assert scan.reason == "no_session_boundaries"

    def test_an_unreadable_audit_log_says_so_rather_than_reporting_no_sessions(self, audit):
        traded_session(audit)
        audit.close()
        scan = scan_closed_sessions(audit)
        assert scan.scanned is False and scan.reason == "audit_unavailable"
        assert scan.sessions == ()


class TestTheCardIsBuiltFromRowsThatAlreadyExist:
    def test_every_figure_comes_from_the_desk_s_own_record(self, audit):
        traded_session(audit)
        session = scan_closed_sessions(audit).sessions[1]
        figures = session_figures(audit, session)
        title, body = render_execution_summary_card(figures)

        assert title == "Execution summary 2026-08-21"
        assert body.startswith(title + "\n")
        assert "Decisions: 3 (2 accepted, 1 rejected)" in body
        assert "Fills: 2" in body
        assert "Filled notional USD: 8,000.00" in body
        assert "Fees paid USD: 4.00" in body
        # 5000 * 1.5bps + 3000 * 4bps = 0.75 + 1.20, in dollars.
        assert "Realised slippage cost USD: 1.95" in body
        assert "Session P&L: 450.00" in body
        assert "Kill switch at close: disengaged" in body
        assert "BINANCE 1 fills, 5,000.00 USD, 1.50 bps average slippage" in body
        assert "OKX 1 fills, 3,000.00 USD, 4.00 bps average slippage" in body
        assert "ma_cross (3 decisions)" in body

    def test_the_card_is_deterministic(self, audit):
        traded_session(audit)
        session = scan_closed_sessions(audit).sessions[1]
        first = render_execution_summary_card(session_figures(audit, session))
        second = render_execution_summary_card(session_figures(audit, session))
        assert first == second, "the embedded text must be reproducible"

    def test_an_unpriced_fill_makes_the_cost_a_lower_bound_not_a_zero(self, audit):
        roll(audit, "2026-08-20")
        order(audit, at=datetime(2026, 8, 20, 9, 0, tzinfo=timezone.utc), slippage=None)
        roll(audit, "2026-08-21")
        session = scan_closed_sessions(audit).sessions[0]
        _, body = render_execution_summary_card(session_figures(audit, session))
        assert "a lower bound: 1 fills were never priced" in body
        assert "(1 unpriced)" in body

    def test_a_session_with_no_equity_snapshot_says_so_rather_than_reporting_zero(self, audit):
        roll(audit, "2026-08-20")
        roll(audit, "2026-08-21")
        session = scan_closed_sessions(audit).sessions[0]
        _, body = render_execution_summary_card(session_figures(audit, session))
        assert "Book at close: no equity snapshot recorded" in body
        assert "Realised P&L" not in body, "a P&L nobody measured must not be printed"
        assert "Decisions: none recorded" in body
        assert "Venue mix: no fills recorded" in body

    def test_a_latency_the_desk_never_measured_is_not_zero(self, audit):
        roll(audit, "2026-08-20")
        roll(audit, "2026-08-21")
        session = scan_closed_sessions(audit).sessions[0]
        _, body = render_execution_summary_card(session_figures(audit, session))
        assert "Decision latency ms: mean not recorded, max not recorded" in body


class TestTheDocument:
    def test_it_is_filed_as_an_execution_summary_at_the_session_s_close(self, audit):
        traded_session(audit)
        session = scan_closed_sessions(audit).sessions[1]
        document = execution_summary_document(session_figures(audit, session))
        assert document["kind"] == "execution_summary"
        assert document["source_ref"] == "session:2026-08-21"
        assert document["occurred_at"] == "2026-08-22T00:00:03+00:00"
        assert document["metrics"]["fills"] == 2
        assert document["symbol"] is None, "a session is not one symbol"

    def test_a_single_strategy_session_carries_it_so_the_graph_can_promote_to_it(self, audit):
        traded_session(audit)
        session = scan_closed_sessions(audit).sessions[1]
        document = execution_summary_document(session_figures(audit, session))
        # `research_graph`'s promoted_to rule links a run to the summary sharing
        # its strategy. With no strategy on the document that edge is unreachable.
        assert document["strategy"] == "ma_cross"

    def test_a_mixed_session_claims_no_single_strategy(self, audit):
        roll(audit, "2026-08-20")
        order(audit, at=datetime(2026, 8, 20, 9, 0, tzinfo=timezone.utc), strategy="ma_cross")
        order(audit, at=datetime(2026, 8, 20, 10, 0, tzinfo=timezone.utc), strategy="donchian")
        roll(audit, "2026-08-21")
        session = scan_closed_sessions(audit).sessions[0]
        document = execution_summary_document(session_figures(audit, session))
        assert document["strategy"] is None
        assert "donchian" in document["body"] and "ma_cross" in document["body"]


class TestTheProducerHasARealCaller:
    """A module nobody calls is the scar this repository already carries.

    ``render_ml_card`` shipped fully tested with no production caller, so the
    ``ml_run`` kind could not be emitted by anything. The backfill tool is this
    producer's caller and this is the test that says so — it drives the tool's
    own function against a real audit log and a fake corpus.
    """

    def test_the_backfill_tool_renders_and_stores_one_document_per_closed_session(
        self, audit, monkeypatch
    ):
        from tools import backfill_research_rag as tool

        stored: list[dict] = []

        class FakeCorpus:
            async def post(self, path, json=None, headers=None):  # noqa: A002
                assert path.endswith("replace_research_document_chunks")
                stored.extend(dict(row) for row in json["p_rows"])
                return SimpleNamespace(status_code=201)

        class FakeRag:
            _client = FakeCorpus()

            async def _embed(self, text):
                return [0.01] * 384

        traded_session(audit)
        monkeypatch.setattr(tool, "get_audit", lambda: audit)
        written, pending = asyncio.run(tool._backfill_execution_summaries(FakeRag(), 60))

        assert (written, pending) == (2, 0)
        refs = [row["source_ref"] for row in stored]
        assert refs == ["session:2026-08-20", "session:2026-08-21"]
        assert {row["kind"] for row in stored} == {"execution_summary"}
        assert stored[1]["body"].startswith("Execution summary 2026-08-21\n")
        assert stored[1]["embedding_status"] == "ready"

    def test_an_unreadable_audit_log_indexes_nothing_and_says_which_nothing(
        self, audit, monkeypatch, capsys
    ):
        from tools import backfill_research_rag as tool

        traded_session(audit)
        audit.close()
        monkeypatch.setattr(tool, "get_audit", lambda: audit)
        written, pending = asyncio.run(tool._backfill_execution_summaries(object(), 60))
        assert (written, pending) == (0, 0)
        assert "audit log is closed" in capsys.readouterr().out


class TestScanAndDocumentsTravelTogether:
    def test_no_documents_still_carries_the_reason_there_are_none(self, audit):
        documents, scan = closed_session_documents(audit)
        assert documents == []
        assert scan.reason == "no_session_boundaries"
