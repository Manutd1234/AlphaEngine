"""The other two unwired seams: the tenant scope, and the poisoned embed body.

`tests/test_research_seam_wiring.py` states the argument this file continues and
holds the stubs both use. One file of all four seams crossed the 400-line
ceiling, so the split is by seam rather than by inventing a `conftest` that
would reach every other suite.

2. `desk_id` NEVER REACHED THE RPC. `supabase/migrations/20260822090000_research_tenant_scope.sql`
   added `filter_desk_id` to both retrieval functions, `modules/research_quota_scope.py`
   named the parameter and the route passed a desk — and
   `grep -c desk_id modules/research_rag/retrieval.py` returned 0. Every
   assertion below reads the payload the CLIENT was handed, because a scope that
   is computed and not sent looks identical to one that was never configured.
3. `embed_many` SWALLOWED ONLY `httpx.HTTPError`. A proxy answering 200 with an
   HTML error page makes `response.json()` raise `JSONDecodeError` — a
   `ValueError` — which went past every `except` in the package. The drain was
   hardened to survive it and must stay hardened; the outcome it produced was
   still wrong, because a dead letter needs a human and the document was never
   the thing that was broken.

Offline, like everything here: the network is stubbed at the client boundary and
nothing else is substituted — the real `_RetrievalMixin`, the real `_index_one`,
the real `research_quota_scope` probe, the real FastAPI app.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
import research_seam as seam
from fastapi.testclient import TestClient
from test_research_seam_wiring import (
    DESK,
    DOCUMENT_ID,
    EMBED_PATH,
    QUERY,
    Corpus,
    Reply,
    _Settings,
)

import main
import modules.research_quota_scope as scope_module
import modules.research_rag.writer as rag_module
from modules.research_rag import EMBEDDING_DIMENSIONS, ResearchRag, get_rag, reset_rag
from modules.research_rag import retrieval as retrieval_module


# The stubs come from the sibling file; the FIXTURES are redeclared here rather
# than imported. An imported fixture function is a module-level name pytest is
# happy with and ruff reads as a redefinition on every test that takes it as an
# argument — eight `noqa: F811` comments to save six lines, which is a worse
# trade than saying it twice.
@pytest.fixture
def corpus(monkeypatch):
    """A `ResearchRag` reachable through `get_rag()`, wired to a recording stub."""
    reset_rag()
    monkeypatch.setattr(rag_module, "settings", _Settings())
    stub = Corpus()
    get_rag()._client = stub
    yield stub
    reset_rag()


@pytest.fixture
def client():
    return TestClient(main.app)


# --------------------------------------------------------------------------- #
# 2. The tenant scope reaches the RPC
# --------------------------------------------------------------------------- #
class TestTheDeskScopeReachesTheRpc:
    def test_search_forwards_the_desk_to_the_hybrid_function(self, corpus):
        result = asyncio.run(get_rag().search(QUERY, desk_id=DESK))

        assert result["state"] == "ok"
        assert corpus.payload("match_research_documents_hybrid")["filter_desk_id"] == DESK

    def test_the_dense_fallback_carries_it_too(self, monkeypatch):
        """A predicate on one of two functions is a hole under the other.

        The 404 is the real rollout state the fallback exists for: a deployment
        that predates the hybrid migration still reads the same table.
        """
        reset_rag()
        monkeypatch.setattr(rag_module, "settings", _Settings())
        stub = Corpus(hybrid_status=404)
        rag = get_rag()
        rag._client = stub
        try:
            asyncio.run(rag.search(QUERY, desk_id=DESK))
            assert stub.payload("match_research_documents")["filter_desk_id"] == DESK
        finally:
            reset_rag()

    def test_the_second_door_into_the_same_rpcs_carries_it(self, corpus):
        """`_match` is the write path's retrieval and reads the same table."""
        asyncio.run(get_rag()._match([0.01] * EMBEDDING_DIMENSIONS, query_text=QUERY, desk_id=DESK))

        assert corpus.payload("match_research_documents_hybrid")["filter_desk_id"] == DESK

    def test_graph_traversal_carries_the_same_scope(self, corpus):
        result = asyncio.run(get_rag().connected(DOCUMENT_ID, desk_id=DESK))

        assert result["state"] == "ok"
        assert corpus.payload("traverse_research_graph")["filter_desk_id"] == DESK

    def test_the_denominator_is_scoped_with_the_search(self, corpus):
        """"1 of 412" under a predicate that hid 372 of them is a lie about the corpus."""
        asyncio.run(get_rag().search(QUERY, desk_id=DESK))

        assert corpus.head_params[-1]["desk_id"] == f"eq.{DESK}"

    def test_an_unscoped_search_sends_no_tenant_argument_at_all(self, corpus):
        """The rollout property: `None` is byte-for-byte today's payload.

        Not `filter_desk_id: null`, which is equivalent inside the function and
        fatal in front of it — PostgREST answers PGRST202 (a 404) for an RPC
        call naming an argument the deployed function does not declare, so a
        gateway that had learned the parameter before the migration ran would
        404 every search on a deployment that asked for no scoping.
        """
        result = asyncio.run(get_rag().search(QUERY))

        assert result["state"] == "ok"
        assert corpus.rpc, "no RPC was made, so this proves nothing"
        for name, body in corpus.rpc:
            assert "filter_desk_id" not in body, f"{name} was sent a tenant argument it was not given"
        assert all("desk_id" not in params for params in corpus.head_params)

    def test_an_unscoped_traversal_keeps_the_old_payload(self, corpus):
        result = asyncio.run(get_rag().connected(DOCUMENT_ID))

        assert result["state"] == "ok"
        assert "filter_desk_id" not in corpus.payload("traverse_research_graph")

    def test_the_probe_the_route_uses_now_accepts_this_signature(self, corpus):
        """The gate refuses rather than serving unscoped, so the probe IS the wiring.

        Until retrieval took the parameter this returned False, and a deployment
        with `RESEARCH_SCOPE_TO_DESK` on got a 503 on every search — correct, and
        not the point of the setting.
        """
        assert scope_module.SCOPE_PARAM == "desk_id"
        assert scope_module.scope_parameter_accepted(get_rag().search)
        assert scope_module.scope_parameter_accepted(get_rag()._match)
        assert scope_module.scope_parameter_accepted(get_rag().connected)

    def test_the_route_passes_the_configured_desk_all_the_way_down(self, client, corpus, monkeypatch):
        """End to end: setting on, route serves, and the wire carries the predicate."""
        monkeypatch.setattr(scope_module, "SCOPE_TO_DESK", True)
        monkeypatch.setattr(scope_module, "settings", SimpleNamespace(supabase_desk_id=DESK))

        response = client.post("/api/research/rag/search", json={"query": QUERY, "match_count": 3})

        assert response.status_code == 200, f"the scope gate refused: {response.json()}"
        assert corpus.rpc, "the route served without retrieving anything"
        assert all(body.get("filter_desk_id") == DESK for _, body in corpus.rpc)

    def test_the_graph_route_passes_the_configured_desk(self, client, corpus, monkeypatch):
        monkeypatch.setattr(scope_module, "SCOPE_TO_DESK", True)
        monkeypatch.setattr(scope_module, "settings", SimpleNamespace(supabase_desk_id=DESK))

        response = client.get(f"/api/research/graph/{DOCUMENT_ID}")

        assert response.status_code == 200, response.text
        assert corpus.payload("traverse_research_graph")["filter_desk_id"] == DESK

    def test_scope_enabled_without_a_desk_refuses_before_retrieval(self, client, corpus, monkeypatch):
        monkeypatch.setattr(scope_module, "SCOPE_TO_DESK", True)
        monkeypatch.setattr(scope_module, "settings", SimpleNamespace(supabase_desk_id="   "))

        response = client.post("/api/research/rag/search", json={"query": QUERY, "match_count": 3})

        assert response.status_code == 503
        assert response.json()["state"] == "scope_unavailable"
        assert "SUPABASE_DESK_ID is empty" in response.json()["reason"]
        assert corpus.rpc == []

    def test_one_scope_survives_the_answer_pipelines_rewrite(self):
        after = [seam.row(f"scoped-{index}") for index in range(3)]
        corpus = seam.Corpus([seam.NEAR, after])

        result = asyncio.run(seam.answer(corpus, query="crossover sweep", desk_id=DESK))

        assert result.retrievals == 2
        assert corpus.scopes == [DESK, DESK]

    def test_anomaly_neighbour_retrieval_uses_the_written_rows_scope(self, corpus, monkeypatch):
        """The writer's post-insert read is the third door into the same corpus."""
        rag = get_rag()
        seen: dict[str, str | None] = {}

        async def match(vector, match_count=3, **kwargs):
            seen["desk_id"] = kwargs.get("desk_id")
            return []

        monkeypatch.setattr(rag, "_match", match)
        document = {
            "kind": "risk_incident", "source_ref": "order-7", "symbol": "BTCUSDT",
            "occurred_at": "2026-08-31T00:00:00+00:00", "title": "Execution anomaly",
            "body": "realised slippage crossed the pre-trade ceiling", "metrics": {},
            "data_hash": None, "_retrieve_after": True,
        }

        asyncio.run(rag._index_one(document))

        assert seen["desk_id"] == DESK


# --------------------------------------------------------------------------- #
# 3. A 200 with an unparseable body is an embed failure, not a crash
# --------------------------------------------------------------------------- #
class TestAPoisonedBodyIsAnEmbedFailure:
    def _rag(self, monkeypatch, **kw) -> tuple[ResearchRag, Corpus]:
        monkeypatch.setattr(rag_module, "settings", _Settings())
        rag = ResearchRag()
        stub = Corpus(**kw)
        rag._client = stub
        return rag, stub

    def test_embed_many_returns_none_rather_than_raising(self, monkeypatch):
        rag, _ = self._rag(monkeypatch, embed_poisoned=True)

        assert asyncio.run(rag.embed_many(["one", "two"])) is None

    def test_a_body_that_parses_to_the_wrong_shape_is_also_a_failure(self, monkeypatch):
        """A JSON array is not an object carrying `embeddings`, and `.get` on it raises."""
        rag, stub = self._rag(monkeypatch)

        async def post(path, json=None, headers=None):  # noqa: A002 - httpx's kwarg
            return Reply(["<html>", "502"]) if path.endswith(EMBED_PATH) else await stub.post(path, json, headers)

        rag._client = SimpleNamespace(post=post, head=stub.head)
        assert asyncio.run(rag.embed_many(["one"])) is None

    def test_the_search_route_reports_embed_failed_rather_than_500(self, monkeypatch):
        rag, _ = self._rag(monkeypatch, embed_poisoned=True)
        result = asyncio.run(rag.search(QUERY))

        assert result["state"] == "embed_failed"
        assert result["matches"] == []
        assert result["bm25"]["ranked"] is False

    def test_the_document_becomes_pending_and_not_a_dead_letter(self, monkeypatch):
        """THE WIRING. A poisoned embedder must cost a retry, never a document.

        `embedding_status='pending'` is what the backfill tool re-embeds. A dead
        letter needs a human to notice and replay it, and the document was never
        the thing that was wrong — the proxy in front of `embed-research` was.
        """
        rag, stub = self._rag(monkeypatch, embed_poisoned=True)
        document = {
            "kind": "backtest_run", "source_ref": "job-1", "symbol": "BTCUSDT",
            "occurred_at": "2026-08-21T00:00:00+00:00", "title": "Sweep job-1",
            "body": "Sweep job-1\nSharpe: 0.2", "metrics": {}, "data_hash": None,
        }

        asyncio.run(rag._index_one(dict(document)))

        assert len(stub.inserts) == 1, "the document never reached the corpus at all"
        row = stub.inserts[0]
        assert row["embedding_status"] == "pending"
        assert row["embedding"] is None, "a failed embed must never be stored as a zero vector"
        assert row["embedding_model"] is None
        status = rag.status()
        assert status["pending_embeddings"] == 1
        assert status["dead_lettered"] == 0, "a retryable embed failure was dead-lettered"
        assert status["failed"] == 0

    def test_an_rpc_that_answers_200_with_rubbish_is_a_typed_refusal(self, monkeypatch):
        """The sibling handler. `search` may not return "found nothing" for this."""
        rag, _ = self._rag(monkeypatch, rpc_poisoned=True)
        result = asyncio.run(rag.search(QUERY))

        assert result["state"] == "unavailable"
        assert result["matches"] == []
        report = result["bm25"]
        assert report["ranked"] is False
        assert report["reason"] == retrieval_module.REASON_RETRIEVAL_UNAVAILABLE
        assert retrieval_module.REASON_UNPARSEABLE_BODY in report["detail"]
