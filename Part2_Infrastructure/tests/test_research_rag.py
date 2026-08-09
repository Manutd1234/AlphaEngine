"""The research index's honesty contract, verified offline."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from pathlib import Path

import modules.research_rag as rag_module
from modules.research_rag import (
    EMBEDDING_DIMENSIONS,
    ResearchRag,
    classify_anomaly,
    get_rag,
    render_backtest_card,
    render_incident_card,
    reset_rag,
)
from modules.schemas import CheckResult, Fill, OrderRequest, RiskDecision

MIGRATIONS = Path(__file__).resolve().parent.parent.parent / "supabase" / "migrations"


def make_decision(
    accepted: bool = True,
    slippage: float | None = 1.0,
    rejected: list[str] | None = None,
) -> RiskDecision:
    return RiskDecision(
        order_id="ord-9",
        client_order_id=None,
        accepted=accepted,
        symbol="BTCUSDT",
        side="BUY",
        quantity=0.1,
        notional=5000.0,
        checks=[CheckResult(name="kill_switch", passed=True, detail="disengaged")],
        rejected_by=rejected or [],
        latency_ms=0.2,
        timestamp=datetime(2026, 8, 8, tzinfo=timezone.utc),
        fill=Fill(
            venue="BINANCE", price=64000.0, quantity=0.078, notional=5000.0,
            fee_usd=2.0, slippage_bps=slippage,
        ) if accepted else None,
        status="FILLED" if accepted else "REJECTED",
    )


REQ = OrderRequest(symbol="BTCUSDT", side="BUY", notional=5000.0, strategy="ma_cross")


class TestCards:
    def test_backtest_card_is_deterministic_and_carries_provenance(self):
        row = {
            "symbol": "BTCUSDT", "interval": "4h", "strategy": "ma_cross",
            "best_fast": 20, "best_slow": 80, "engine": "numpy",
            "combos_tested": 74, "sharpe": 0.24, "total_return": 0.026,
            "max_drawdown": -0.147, "dsr": 0.228, "oos_sharpe": -0.02,
            "pbo": 0.61, "data_hash": "8e43f5f7", "job_id": "job-1",
        }
        title1, body1 = render_backtest_card(row)
        title2, body2 = render_backtest_card(row)
        assert (title1, body1) == (title2, body2), "the embedded text must be reproducible"
        assert "Deflated Sharpe (DSR): 0.228" in body1
        assert "Data hash: 8e43f5f7" in body1

    def test_missing_metrics_say_not_computed_rather_than_zero(self):
        row = {"symbol": "X", "interval": "1d", "strategy": "s", "best_fast": 1,
               "best_slow": 2, "dsr": None, "oos_sharpe": None, "pbo": None,
               "job_id": "j", "data_hash": None}
        _, body = render_backtest_card(row)
        assert "not computed" in body
        assert "Data hash: unrecorded" in body

    def test_incident_card_carries_the_measured_slippage(self):
        _, body = render_incident_card(
            "Execution anomaly", make_decision(slippage=91.4), REQ, "detail"
        )
        assert "Realised slippage bps: 91.4" in body


class TestAnomalyClassifier:
    def test_the_three_triggers_and_their_near_misses(self):
        from config import settings

        ceiling = settings.max_est_slippage_bps
        cases = [
            (make_decision(slippage=ceiling + 0.1), True),   # estimate was wrong
            (make_decision(slippage=ceiling), False),         # at the ceiling is fine
            (make_decision(slippage=None), False),            # unpriced fill: no claim
            (make_decision(accepted=False, rejected=["est_slippage"]), True),
            (make_decision(accepted=False, rejected=["daily_drawdown"]), True),
            (make_decision(accepted=False, rejected=["rate_limit"]), False),
            (make_decision(), False),                         # clean fill
        ]
        for decision, expected in cases:
            got = classify_anomaly(decision) is not None
            assert got is expected, (decision.accepted, decision.rejected_by)


class TestUnavailableIsAState:
    def test_search_reports_unavailable_not_empty(self):
        reset_rag()
        rag = get_rag()
        assert rag.enabled is False
        result = asyncio.run(rag.search("high slippage on BTCUSDT"))
        assert result["state"] == "unavailable", (
            '"could not search" must never be dressed as "found nothing"'
        )

    def test_hooks_are_no_ops_when_unconfigured(self):
        reset_rag()
        rag = get_rag()
        rag.on_decision(make_decision(slippage=999.0), REQ, "api")
        rag.on_backtest_complete(object())
        assert rag.status()["queued"] == 0

    def test_status_never_exposes_identity(self, monkeypatch):
        class Stub:
            supabase_url = "https://example.supabase.co"
            supabase_service_role_key = "sb_secret_x"
            research_rag_enabled = True
            supabase_desk_id = "00000000-0000-0000-0000-000000000001"
            supabase_timeout_s = 5.0
            supabase_mirror_queue_max = 10

        monkeypatch.setattr(rag_module, "settings", Stub())
        text = str(ResearchRag().status())
        assert "supabase.co" not in text and "sb_secret" not in text


class TestEmbedEndpoint:
    """The route the Oracle vector search calls to embed its query.

    Its absence is what made `/api/oracle/research` return `embed_failed` on
    every request: the Next.js route posted to `/api/research/rag/embed` and the
    gateway had only `/search` and `/status`. Nothing failed loudly — the search
    simply reported that it could not embed, forever, which is a state the UI
    renders honestly and therefore nobody investigated.
    """

    def test_embed_reports_unavailable_rather_than_raising(self):
        reset_rag()
        rag = get_rag()
        assert rag.enabled is False
        assert asyncio.run(rag.embed_many(["donchian drawdown"])) is None

    def test_embed_many_is_one_round_trip_not_one_per_text(self):
        """The write path used to send texts one at a time.

        `embed-research` accepts 32 per call, so a backfill of N documents cost
        N round trips to a function that could have taken them in batches.
        """
        sent: list[dict] = []

        class _Response:
            status_code = 200

            @staticmethod
            def json():
                return {"embeddings": [[0.1] * EMBEDDING_DIMENSIONS] * 3}

        class _Client:
            async def post(self, path, json):  # noqa: A002 — httpx's own kwarg name
                sent.append(json)
                return _Response()

        rag = ResearchRag()
        rag._client = _Client()
        vectors = asyncio.run(rag.embed_many(["a", "b", "c"]))

        assert vectors is not None and len(vectors) == 3
        assert len(sent) == 1, "three texts became three HTTP calls"
        assert sent[0]["texts"] == ["a", "b", "c"]

    def test_a_short_batch_is_refused_rather_than_misaligned(self):
        """Partial results are the dangerous case, not the error case.

        If the service returns two vectors for three texts, pairing them by
        index silently attaches the wrong vector to the third document. That
        does not raise and does not look wrong — it returns confident
        neighbours that mean nothing, which is the exact failure this module's
        never-write-a-zero-vector rule exists to prevent.
        """
        class _Response:
            status_code = 200

            @staticmethod
            def json():
                return {"embeddings": [[0.1] * EMBEDDING_DIMENSIONS] * 2}

        class _Client:
            async def post(self, path, json):  # noqa: A002
                return _Response()

        rag = ResearchRag()
        rag._client = _Client()
        assert asyncio.run(rag.embed_many(["a", "b", "c"])) is None

    def test_a_wrong_dimension_is_refused(self):
        """A 1536-dim query against a 384-dim index ranks nonsense, silently."""
        class _Response:
            status_code = 200

            @staticmethod
            def json():
                return {"embeddings": [[0.1] * 1536]}

        class _Client:
            async def post(self, path, json):  # noqa: A002
                return _Response()

        rag = ResearchRag()
        rag._client = _Client()
        assert asyncio.run(rag.embed_many(["a"])) is None


class TestSchemaAgreement:
    def test_vector_dimensions_match_the_migration(self):
        sql = (MIGRATIONS / "20260808120400_pgvector_research_documents.sql").read_text()
        match = re.search(r"vector\((\d+)\)", sql)
        assert match and int(match.group(1)) == EMBEDDING_DIMENSIONS

    def test_doc_kinds_match_the_enum(self):
        sql = (MIGRATIONS / "20260808120400_pgvector_research_documents.sql").read_text()
        body = sql[sql.index("create type public.research_doc_kind") :]
        declared = set(re.findall(r"'([a-z_]+)'", body[: body.index(";")]))
        assert declared == {"backtest_run", "execution_summary", "risk_incident"}

    def test_match_function_refuses_unembedded_documents(self):
        sql = (MIGRATIONS / "20260808120500_match_research_documents.sql").read_text()
        assert "embedding_status = 'ready'" in sql
        assert "embedding is not null" in sql

    def test_no_zero_vector_fallback_anywhere(self):
        source = (Path(__file__).resolve().parent.parent / "modules" / "research_rag.py").read_text()
        # The tempting shortcut is `[0.0] * 384` so a failed embed "still works".
        # A zero vector is equidistant from everything; pin the refusal.
        assert "[0.0]" not in source and "[0] *" not in source
