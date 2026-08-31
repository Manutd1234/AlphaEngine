"""The image arm, pinned to the two real callers that must invoke it.

``tests/test_research_image.py`` proves the arm: the encoder seam, the four
states, the fusion arithmetic, and that every refusal returns today's ordering
untouched. None of that proves anything CALLS it — which is the defect this
repository has a documented scar about, and the reason
``tests/test_research_bm25_wiring.py`` exists in the shape it does: two modules
built in parallel that never met, both suites green because each mocked the
other, and a capability that shipped fully tested with no caller.

So nothing here substitutes the callers. Every assertion below drives the REAL
``ResearchRag`` — the real queue, the real drain, the real ``deliver``, the real
``render_backtest_documents`` — and asks whether the image arm is reached. The
only stand-ins are the HTTP client, because CI has no network, and the CLIP pair
at ``research_image._import_encoders``, because CI has no 0.6 GB of weights.

Two callers, and each has a property the other cannot check:

* WRITE. ``on_backtest_complete`` must hand the equity-curve document its PNG
  and the run card the parameter heatmap, and ``_index_one`` must put the
  resulting vector in the row it inserts. A vision model nothing feeds is
  decoration.
* READ. ``search`` must call the arm, on the FUSED rows, with the query string —
  and must report the arm's state on every branch it can return.

And one property that belongs to neither and to both: an UNCONFIGURED desk must
send byte-for-byte the row it sent before this arm existed. The three image
columns arrive with a migration, and a row naming a column the deployed schema
does not have is a 400 that dead-letters every document in the corpus.
"""

from __future__ import annotations

import asyncio
import inspect
from types import SimpleNamespace
from typing import Any

import pytest

from modules import research_image
from modules import research_image_ingest as ingest
from modules.research_rag import ResearchRag, query_cache, retrieval
from modules.research_rag import writer as rag_module
from modules.research_rag.replacement import REPLACE_PATH
from tests.test_research_image import PNG, VECTOR, FakeImageLib, _cold

EMBED_PATH = "/functions/v1/embed-research"
HYBRID_RPC = "/rest/v1/rpc/match_research_documents_hybrid"
IMAGE_RPC = "/rest/v1/rpc/match_research_document_images"
INSERT_PATH = "/rest/v1/research_documents"
TEXT_VECTOR = [0.01] * 384


class Stub:
    supabase_url = "https://example.supabase.co"
    supabase_service_role_key = "sb_secret_x"
    research_rag_enabled = True
    supabase_desk_id = "00000000-0000-0000-0000-000000000001"
    supabase_timeout_s = 5.0
    supabase_mirror_queue_max = 10


class Response:
    def __init__(self, status_code: int, payload: Any = None) -> None:
        self.status_code = status_code
        self._payload = payload
        self.headers: dict[str, str] = {}

    def json(self) -> Any:
        return self._payload


class Corpus:
    """A fake Supabase at the HTTP boundary. Records every call it is given."""

    def __init__(self, *, hybrid_rows=None, image_rows=None, image_status=200) -> None:
        self.hybrid_rows = hybrid_rows if hybrid_rows is not None else []
        self.image_rows = image_rows if image_rows is not None else []
        self.image_status = image_status
        self.calls: list[str] = []
        self.inserts: list[dict[str, Any]] = []
        self.image_payloads: list[dict[str, Any]] = []

    async def aclose(self) -> None:
        """`stop()` closes its client; the fake has to be closable too."""

    async def head(self, path: str, params=None, headers=None) -> Response:
        response = Response(200)
        response.headers = {"content-range": "0-0/7"}
        return response

    async def post(self, path, json=None, headers=None):  # noqa: A002 - httpx's kwarg
        self.calls.append(path)
        if path == EMBED_PATH:
            return Response(200, {"embeddings": [TEXT_VECTOR for _ in json["texts"]]})
        if path == HYBRID_RPC:
            return Response(200, list(self.hybrid_rows))
        if path == IMAGE_RPC:
            self.image_payloads.append(json)
            return Response(self.image_status, list(self.image_rows))
        if path == REPLACE_PATH:
            self.inserts.extend(dict(row) for row in (json or {}).get("p_rows", []))
            return Response(201, [])
        self.inserts.append(json)
        return Response(201, [])


def _configured(monkeypatch, *, image_lib=None) -> None:
    """A desk with the CLIP pair configured, and fakes standing in for it."""
    _cold(monkeypatch)
    monkeypatch.setattr(research_image, "IMAGE_MODEL_PATH", "/models/clip")

    class FakeEncoder:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

        def embed(self, items):
            return iter([VECTOR])

    monkeypatch.setattr(
        research_image, "_import_encoders",
        lambda: (FakeEncoder, FakeEncoder, image_lib or FakeImageLib(), None),
    )


@pytest.fixture
def rag(monkeypatch):
    monkeypatch.setattr(rag_module, "settings", Stub())
    return ResearchRag()


@pytest.fixture(autouse=True)
def _unconfigured_by_default(monkeypatch):
    _cold(monkeypatch)
    monkeypatch.setattr(research_image, "IMAGE_MODEL_PATH", "")
    monkeypatch.delenv("RESEARCH_IMAGE_MIN_SIMILARITY", raising=False)


def _hybrid_row(doc_id: str, rank: int) -> dict[str, Any]:
    return {
        "id": doc_id, "kind": "chart", "source_ref": f"job-1:{doc_id}", "title": doc_id,
        "body": doc_id, "similarity": 0.91, "vector_rank": rank, "lexical_rank": None,
        "fused_score": 1.0 / (60 + rank),
    }


def _image_row(doc_id: str, rank: int) -> dict[str, Any]:
    return {
        "id": doc_id, "kind": "chart", "source_ref": f"job-1:{doc_id}", "title": doc_id,
        "body": doc_id, "image_similarity": 0.30, "image_rank": rank,
    }


async def _drain_until(rag: ResearchRag, corpus: Corpus, documents, predicate) -> None:
    rag._client = corpus
    rag._loop = asyncio.get_running_loop()
    rag._task = asyncio.create_task(rag._drain(), name="research-image-test")
    try:
        for document in documents:
            rag._submit(document)
        loop = asyncio.get_running_loop()
        deadline = loop.time() + 2.0
        while not predicate():
            if loop.time() > deadline:
                raise AssertionError("the drain never caught up")
            await asyncio.sleep(0.005)
    finally:
        await rag.stop()


# --------------------------------------------------------------------------- #
# READ: `search` reaches the arm, on the fused rows, with the query
# --------------------------------------------------------------------------- #
class TestSearchActuallyCallsTheFourthArm:
    def test_the_call_is_in_the_source_of_search_and_not_only_in_a_test(self):
        """The scar this file exists for: a module wired only by its own suite."""
        entry = inspect.getsource(retrieval._RetrievalMixin.search)
        orchestration = inspect.getsource(query_cache._once) + inspect.getsource(
            query_cache.search_with_cache,
        )
        assert "image_arm" in entry and "image_search(" in orchestration
        assert "\"image\": image" in orchestration

    def test_a_search_hits_the_image_rpc_and_reports_the_arm(self, rag, monkeypatch):
        _configured(monkeypatch)
        corpus = Corpus(hybrid_rows=[_hybrid_row("a", 1)], image_rows=[_image_row("z", 1)])
        rag._client = corpus
        result = asyncio.run(rag.search("a curve that spikes then flattens"))

        assert IMAGE_RPC in corpus.calls, "the arm must be reached by the REAL search"
        assert result["state"] == "ok"
        assert result["image"]["ranked"] is True and result["image"]["added"] == 1
        # The recall the arm exists to buy, visible in the rows the route returns.
        assert [row["id"] for row in result["matches"]] == ["a", "z"]
        assert result["matches"][1]["similarity"] is None

    def test_the_image_query_is_a_clip_vector_and_not_the_gte_small_one(self, rag, monkeypatch):
        """The one substitution that would be silent, so it is pinned loudly.

        ``search`` is holding a 384-d gte-small vector for this exact string when
        it calls the arm. Sending THAT would return rows and rank by an accident
        of two unrelated geometries.
        """
        _configured(monkeypatch)
        corpus = Corpus(hybrid_rows=[_hybrid_row("a", 1)])
        rag._client = corpus
        asyncio.run(rag.search("a curve that spikes"))
        sent = corpus.image_payloads[0]["query_embedding"]
        assert len(sent) == research_image.IMAGE_DIMENSIONS == 512
        assert sent != TEXT_VECTOR and len(TEXT_VECTOR) == 384

    def test_an_unconfigured_desk_gets_the_three_arm_ordering_and_a_named_state(self, rag):
        corpus = Corpus(hybrid_rows=[_hybrid_row("a", 1), _hybrid_row("b", 2)])
        rag._client = corpus
        result = asyncio.run(rag.search("sharpe"))

        assert IMAGE_RPC not in corpus.calls, "an arm that is off must not cost a round trip"
        assert [row["id"] for row in result["matches"]] == ["a", "b"]
        assert result["image"]["ranked"] is False
        assert result["image"]["state"] == "unconfigured" and result["image"]["reason"]

    def test_every_refusal_branch_of_search_still_carries_the_arms_report(self, rag):
        """"An arm declined" and "the key is missing" must not look alike."""
        rag.enabled = False
        unavailable = asyncio.run(rag.search("sharpe"))
        assert unavailable["state"] == "unavailable"
        assert unavailable["image"]["ranked"] is False and unavailable["bm25"]["ranked"] is False

        rag.enabled = True
        rag._client = Corpus()
        rag._client.post = _failing_embed(rag._client)
        embed_failed = asyncio.run(rag.search("sharpe"))
        assert embed_failed["state"] == "embed_failed"
        assert embed_failed["image"]["ranked"] is False and embed_failed["image"]["reason"]


def _failing_embed(corpus: Corpus):
    async def post(path, json=None, headers=None):  # noqa: A002 - httpx's kwarg
        if path == EMBED_PATH:
            return Response(503)
        return Response(200, [])
    return post


# --------------------------------------------------------------------------- #
# WRITE: the PNG reaches the encoder, and the vector reaches the row
# --------------------------------------------------------------------------- #
def _result() -> SimpleNamespace:
    """A completed sweep, shaped the way ``render_backtest_documents`` reads it."""
    best = SimpleNamespace(
        fast=20, slow=100, sharpe=1.2, total_return=0.31, max_drawdown=-0.26,
        trades=30, exposure=0.45,
    )
    return SimpleNamespace(
        kind="backtest", job_id="job-1", engine="numpy", combos_tested=64, best=best,
        request=SimpleNamespace(symbol="BTCUSDT", interval="4h", strategy="ma_cross"),
        benchmark_buy_hold={"total_return": 0.05},
        deflated_sharpe_ratio=0.8, walk_forward_oos_sharpe=0.74, pbo=0.2,
        data_hash="abcd1234", walk_forward=[SimpleNamespace(oos_sharpe=0.7)],
        equity_curve_png=PNG, heatmap_png=PNG,
    )


class TestTheChartsPngReachesTheDocumentThatIsAboutIt:
    def test_the_equity_document_gets_the_curve_and_the_run_card_the_heatmap(self, monkeypatch):
        _configured(monkeypatch)
        from modules.research_cards import render_backtest_documents

        documents = ingest.attach_chart_pngs(
            render_backtest_documents(_result(), occurred_at="2026-08-21T00:00:00+00:00"),
            _result(),
        )
        carried = {
            doc["source_ref"]: doc.get(ingest.IMAGE_PNG_FIELD) for doc in documents
        }
        assert carried["job-1"] == PNG, "the run card's own picture is the parameter surface"
        assert carried["job-1:equity_curve"] == PNG
        # Deliberately nothing: the desk never rendered these as their own
        # images, and pointing them at somebody else's PNG would file a vector
        # under a document that is not what the vector is of.
        assert carried["job-1:drawdown"] is None
        assert carried["job-1:walk_forward"] is None

    def test_an_unconfigured_desk_attaches_nothing_at_all(self):
        from modules.research_cards import render_backtest_documents

        documents = ingest.attach_chart_pngs(render_backtest_documents(_result()), _result())
        assert all(ingest.IMAGE_PNG_FIELD not in doc for doc in documents)

    def test_the_hook_is_what_calls_it_rather_than_this_test(self, rag, monkeypatch):
        """`on_backtest_complete` is the seam; a helper nothing calls is decoration."""
        _configured(monkeypatch)
        assert "attach_chart_pngs(" in inspect.getsource(rag.on_backtest_complete)
        submitted: list[dict[str, Any]] = []
        monkeypatch.setattr(rag, "_submit", submitted.append)
        rag.on_backtest_complete(SimpleNamespace(
            kind="backtest", result=_result(), finished_at=None, job_id="job-1",
        ))
        assert any(doc.get(ingest.IMAGE_PNG_FIELD) == PNG for doc in submitted)


class TestTheRowThatIsInsertedCarriesTheImageColumns:
    def test_a_configured_desk_inserts_a_vector_its_model_and_a_ready_status(
        self, rag, monkeypatch,
    ):
        _configured(monkeypatch)
        corpus = Corpus()
        document = {
            "kind": "chart", "source_ref": "job-1:equity_curve", "symbol": "BTCUSDT",
            "interval": "4h", "strategy": "ma_cross", "title": "Equity curve",
            "occurred_at": "2026-08-21T00:00:00+00:00", "body": "The equity curve ends at 1.31x.",
            "metrics": {"chart": "equity_curve"}, "data_hash": None,
            ingest.IMAGE_PNG_FIELD: PNG,
        }
        asyncio.run(_drain_until(
            rag, corpus, [document], lambda: rag.status()["indexed"] == 1,
        ))
        row = corpus.inserts[0]
        assert row["image_embedding"] == VECTOR and len(row["image_embedding"]) == 512
        assert row["image_embedding_model"] == research_image.IMAGE_MODEL_VISION
        assert row["image_embedding_status"] == "ready"
        assert ingest.IMAGE_PNG_FIELD not in row, (
            "the instruction to the drain is not a column; PostgREST would 400 on it"
        )
        # The TEXT vector is untouched. The image arm adds a column; it does not
        # take over the one the other three arms rank.
        assert row["embedding"] == TEXT_VECTOR and row["embedding_status"] == "ready"

    def test_an_unconfigured_desk_names_no_image_column_whatsoever(self, rag):
        """The rollout property: this row must be valid before the migration runs."""
        corpus = Corpus()
        document = {
            "kind": "backtest_run", "source_ref": "job-2", "symbol": "BTCUSDT",
            "interval": "4h", "strategy": "ma_cross", "title": "Sweep",
            "occurred_at": "2026-08-21T00:00:00+00:00", "body": "Sweep",
            "metrics": {}, "data_hash": None,
        }
        asyncio.run(_drain_until(
            rag, corpus, [document], lambda: rag.status()["indexed"] == 1,
        ))
        row = corpus.inserts[0]
        assert not [key for key in row if key.startswith("image_")], (
            "explicit nulls would name three columns a pre-migration schema does "
            "not have, and every document would dead-letter"
        )

    def test_an_unembeddable_chart_is_still_indexed_by_its_text(self, rag, monkeypatch):
        """Indexing must never be able to fail the thing it indexes."""
        _configured(monkeypatch, image_lib=FakeImageLib(raises=OSError("not a PNG")))
        corpus = Corpus()
        document = {
            "kind": "chart", "source_ref": "job-3:equity_curve", "symbol": "BTCUSDT",
            "interval": "4h", "strategy": "ma_cross", "title": "Equity curve",
            "occurred_at": "2026-08-21T00:00:00+00:00", "body": "The equity curve ends at 1.31x.",
            "metrics": {"chart": "equity_curve"}, "data_hash": None,
            ingest.IMAGE_PNG_FIELD: PNG,
        }
        asyncio.run(_drain_until(
            rag, corpus, [document], lambda: rag.status()["indexed"] == 1,
        ))
        row = corpus.inserts[0]
        assert rag.status()["dead_lettered"] == 0 and rag.status()["failed"] == 0
        assert row["embedding"] == TEXT_VECTOR, "the text arm is unaffected"
        assert row["image_embedding"] is None, "never a zero vector, and never a guess"
        assert row["image_embedding_model"] is None
        assert row["image_embedding_status"] == "failed"
