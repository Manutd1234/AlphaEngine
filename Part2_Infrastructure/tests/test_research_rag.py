"""The research index's honesty contract, verified offline."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

# `settings` is read in `writer.py` and nowhere else in the package. Patching
# `modules.research_rag` would bind a name the class never reads.
import modules.research_rag.writer as rag_module
from modules.research_rag import (
    EMBEDDING_DIMENSIONS,
    ResearchRag,
    classify_anomaly,
    get_rag,
    render_backtest_card,
    render_backtest_documents,
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
        # Every file of the package, not `research_rag.py` — that path no longer
        # exists, and a scan of one file would miss a fallback added in another.
        package = Path(__file__).resolve().parent.parent / "modules" / "research_rag"
        source = "\n".join(p.read_text() for p in sorted(package.rglob("*.py")))
        # The tempting shortcut is `[0.0] * 384` so a failed embed "still works".
        # A zero vector is equidistant from everything; pin the refusal.
        assert "[0.0]" not in source and "[0] *" not in source


# --------------------------------------------------------------------------- #
# one sweep, several documents
# --------------------------------------------------------------------------- #
#
# The charts a run draws were unreachable from the corpus: the corpus indexes
# text and a chart is a PNG. Every figure a vision model would have to read back
# off those pixels is a number the desk computed in order to draw them, so the
# charts are indexed by what they SAY.

BEST = SimpleNamespace(
    fast=20, slow=80, sharpe=0.24, total_return=0.026, max_drawdown=-0.147,
    trades=30, exposure=0.45,
)
RESULT = SimpleNamespace(
    request=SimpleNamespace(symbol="BTCUSDT", interval="4h", strategy="ma_cross"),
    engine="numpy", combos_tested=74, best=BEST,
    deflated_sharpe_ratio=0.228, walk_forward_oos_sharpe=-0.02, pbo=0.61,
    data_hash="8e43f5f7", job_id="job-1",
    benchmark_buy_hold={"total_return": -0.407},
    walk_forward=[
        SimpleNamespace(oos_sharpe=0.4),
        SimpleNamespace(oos_sharpe=-0.2),
        SimpleNamespace(oos_sharpe=0.9),
    ],
)


class TestBacktestDocuments:
    def test_the_run_card_comes_first_and_its_embedded_text_is_unchanged(self):
        """`body` IS the stored vector's meaning.

        Indexing the charts had to add documents, not lines to this one: an
        extra sentence here would change what every stored `backtest_run` vector
        was built from, silently, and no vector can be asked what it meant.
        """
        documents = render_backtest_documents(RESULT)
        _, expected = render_backtest_card({
            "symbol": "BTCUSDT", "interval": "4h", "strategy": "ma_cross",
            "engine": "numpy", "combos_tested": 74, "best_fast": 20, "best_slow": 80,
            "sharpe": 0.24, "total_return": 0.026, "max_drawdown": -0.147,
            "dsr": 0.228, "oos_sharpe": -0.02, "pbo": 0.61,
            "data_hash": "8e43f5f7", "job_id": "job-1",
        })
        assert documents[0]["body"] == expected
        assert documents[0]["source_ref"] == "job-1"

    def test_every_chart_the_run_drew_becomes_its_own_document(self):
        documents = render_backtest_documents(RESULT)
        refs = [d["source_ref"] for d in documents]
        assert refs == [
            "job-1", "job-1:equity_curve", "job-1:drawdown", "job-1:walk_forward",
        ], "a drawdown query should retrieve the drawdown, not a card mentioning one"

    def test_a_chart_document_carries_the_provenance_of_the_run_that_drew_it(self):
        chart = render_backtest_documents(RESULT)[1]
        run = render_backtest_documents(RESULT)[0]
        # Everything that says WHICH RUN drew it, which is what makes the chart
        # graph-reachable from the run and comparable against another run over
        # the same bars.
        for field in ("symbol", "interval", "strategy", "data_hash"):
            assert chart[field] == run[field], field

    def test_a_chart_is_not_filed_as_a_backtest_run(self):
        """`kind` was shared with the run and that made the FILTER dishonest.

        A sweep writes four documents. Filed as four `backtest_run`s,
        `corpus_size` reported four runs where the desk had done one, and
        `filter_kind='backtest_run'` returned three chart descriptions for
        every run it was asked for. The text was right either way; the kind was
        answering a question nobody asked.
        """
        documents = render_backtest_documents(RESULT)
        assert documents[0]["kind"] == "backtest_run"
        assert {d["kind"] for d in documents[1:]} == {"chart"}, (
            f"chart kinds: {[d['kind'] for d in documents[1:]]}"
        )

    def test_the_chart_body_is_the_text_that_will_be_embedded(self):
        chart = render_backtest_documents(RESULT)[1]
        assert chart["title"] == "Equity curve: BTCUSDT 4h ma_cross"
        assert chart["body"].startswith(chart["title"] + "\n"), (
            "the card leads with its own title, like every other kind"
        )
        # The figures the tear sheet was drawn from, not a recomputation.
        for figure in ("1.03x", "-14.7%", "0.24", "30 trades", "45.0%", "0.59x"):
            assert figure in chart["body"], figure

    def test_the_fold_table_is_indexed_by_the_count_a_reader_wants(self):
        folds = render_backtest_documents(RESULT)[3]
        assert "2 of 3 out-of-sample Sharpes are positive" in folds["body"]

    def test_a_chart_the_run_did_not_draw_is_not_described(self):
        # No pre-trade ladder on a sweep, so no gate-ladder document — the same
        # rule the rest of the corpus follows.
        bodies = " ".join(d["body"] for d in render_backtest_documents(RESULT))
        assert "gate ladder" not in bodies.lower()

    def test_a_result_that_cannot_be_read_yields_no_documents_rather_than_raising(self):
        assert render_backtest_documents(object()) == []

    def test_a_run_whose_charts_cannot_be_described_is_still_indexed_as_a_run(self):
        """Indexing must never be able to fail the thing it indexes."""
        unplottable = SimpleNamespace(**{**RESULT.__dict__, "walk_forward": None,
                                         "benchmark_buy_hold": None})
        documents = render_backtest_documents(unplottable)
        assert [d["source_ref"] for d in documents] == ["job-1"]

    def test_the_hook_queues_the_run_and_every_chart(self, monkeypatch):
        class Stub:
            supabase_url = "https://example.supabase.co"
            supabase_service_role_key = "sb_secret_x"
            research_rag_enabled = True
            supabase_desk_id = "00000000-0000-0000-0000-000000000001"
            supabase_timeout_s = 5.0
            supabase_mirror_queue_max = 10

        monkeypatch.setattr(rag_module, "settings", Stub())
        rag = ResearchRag()
        rag.on_backtest_complete(SimpleNamespace(kind="backtest", result=RESULT))
        assert rag.status()["queued"] == 4
