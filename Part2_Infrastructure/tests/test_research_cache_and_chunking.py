"""Cache isolation, stale fallback, and parent-aware research chunks."""

from __future__ import annotations

import asyncio
from typing import Any

from modules import research_image
from modules.research_rag import EMBEDDING_DIMENSIONS, ResearchRag
from modules.research_rag.chunking import (
    CHUNK_META_KEY,
    plan_document,
    split_text,
)
from modules.research_rag.query_cache import CacheKey, RetrievalResultCache
from modules.schemas_research import ResearchRagSearchResponse


class _Reply:
    def __init__(
        self, status: int, payload: Any = None, headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status
        self._payload = payload
        self.headers = headers or {}

    def json(self) -> Any:
        return self._payload


def _row(ref: str, rank: int, *, metrics: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": f"id-{ref}", "kind": "backtest_run", "source_ref": ref,
        "symbol": "BTCUSDT", "strategy": "ma_cross",
        "occurred_at": "2026-08-28T00:00:00+00:00", "title": ref,
        "body": "shared quantitative evidence", "metrics": metrics or {},
        "similarity": 0.95 - rank / 100, "vector_rank": rank,
        "lexical_rank": None, "fused_score": 1.0 / (60 + rank),
    }


class _Corpus:
    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self.rows = rows or []
        self.fail = False
        self.hybrid_widths: list[int] = []
        self.embed_calls = 0
        self.malformed = False

    async def post(self, path: str, json: dict[str, Any]) -> _Reply:  # noqa: A002
        if path.endswith("embed-research"):
            self.embed_calls += 1
            return _Reply(200, {"embeddings": [[0.1] * EMBEDDING_DIMENSIONS]})
        if path.endswith("match_research_documents_hybrid"):
            width = int(json["match_count"])
            self.hybrid_widths.append(width)
            if self.fail:
                return _Reply(503, [])
            if self.malformed:
                return _Reply(200, None)
            desk = json.get("filter_desk_id")
            rows = [
                {**row, "source_ref": f"{desk}:{row['source_ref']}"}
                if desk and CHUNK_META_KEY not in row.get("metrics", {}) else row
                for row in self.rows[:width]
            ]
            return _Reply(200, rows)
        raise AssertionError(f"unexpected POST {path}")

    async def head(self, path: str, params: dict[str, str], headers: dict[str, str]) -> _Reply:
        return _Reply(200, headers={"content-range": f"0-0/{len(self.rows)}"})


def _rag(corpus: _Corpus, clock: list[float] | None = None) -> ResearchRag:
    rag = ResearchRag()
    rag.enabled = True
    rag._client = corpus
    if clock is not None:
        rag._retrieval_cache = RetrievalResultCache(
            maximum=4, ttl_s=1.0, stale_ttl_s=10.0, clock=lambda: clock[0],
        )
    return rag


def test_cache_key_is_desk_scoped_and_fresh_hits_skip_the_upstream(monkeypatch):
    monkeypatch.setattr(research_image, "IMAGE_MODEL_PATH", "")
    corpus = _Corpus([_row("run-1", 1)])
    rag = _rag(corpus)

    first = asyncio.run(rag.search("shared", desk_id="desk-a"))
    hit = asyncio.run(rag.search("shared", desk_id="desk-a"))
    other = asyncio.run(rag.search("shared", desk_id="desk-b"))

    assert first["cache"]["state"] == "miss" and hit["cache"]["state"] == "hit"
    assert first["matches"][0]["source_ref"].startswith("desk-a:")
    assert other["matches"][0]["source_ref"].startswith("desk-b:")
    assert corpus.embed_calls == 2, "the same desk should hit; another desk must retrieve anew"


def test_stale_is_served_only_inside_the_bounded_horizon_on_upstream_failure(monkeypatch):
    monkeypatch.setattr(research_image, "IMAGE_MODEL_PATH", "")
    clock = [0.0]
    corpus = _Corpus([_row("run-1", 1)])
    rag = _rag(corpus, clock)
    live = asyncio.run(rag.search("shared", desk_id="desk-a"))

    clock[0] = 2.0
    corpus.fail = True
    stale = asyncio.run(rag.search("shared", desk_id="desk-a"))
    assert stale["state"] == "ok" and stale["matches"] == live["matches"]
    assert stale["cache"]["state"] == "stale" and stale["cache"]["age_seconds"] == 2.0

    clock[0] = 11.0
    expired = asyncio.run(rag.search("shared", desk_id="desk-a"))
    assert expired["state"] == "unavailable" and expired["matches"] == []


def test_malformed_upstream_json_uses_stale_instead_of_raising(monkeypatch):
    monkeypatch.setattr(research_image, "IMAGE_MODEL_PATH", "")
    clock = [0.0]
    corpus = _Corpus([_row("run-1", 1)])
    rag = _rag(corpus, clock)
    live = asyncio.run(rag.search("shared"))

    clock[0] = 2.0
    corpus.malformed = True
    stale = asyncio.run(rag.search("shared"))

    assert stale["matches"] == live["matches"]
    assert stale["cache"]["state"] == "stale"
    assert "not an array of documents" in stale["cache"]["reason"]


def test_all_arm_outage_is_unavailable_but_a_real_empty_search_is_ok(monkeypatch):
    monkeypatch.setattr(research_image, "IMAGE_MODEL_PATH", "")
    failed_corpus = _Corpus()
    failed_corpus.fail = True
    failed = asyncio.run(_rag(failed_corpus).search("shared"))
    empty = asyncio.run(_rag(_Corpus()).search("shared"))

    assert failed["state"] == "unavailable" and failed["matches"] == []
    assert empty["state"] == "ok" and empty["matches"] == []


def test_cache_is_lru_bounded():
    cache = RetrievalResultCache(maximum=2, ttl_s=10, stale_ttl_s=20)
    for query in ("one", "two", "three"):
        cache.put(CacheKey(query, 3, None, "desk"), {"state": "ok", "matches": []})
    assert len(cache) == 2
    assert cache.lookup(CacheKey("one", 3, None, "desk")) is None


def test_successful_ingest_invalidates_cached_queries(monkeypatch):
    from modules.research_ingest_delivery import Delivered
    from modules.research_rag import writer as writer_module

    monkeypatch.setattr(research_image, "IMAGE_MODEL_PATH", "")
    corpus = _Corpus([_row("run-1", 1)])
    rag = _rag(corpus)
    asyncio.run(rag.search("shared"))
    asyncio.run(rag.search("shared"))
    assert corpus.embed_calls == 1

    original_embed = rag._embed

    async def embed(text: str) -> list[float] | None:
        if text == "new evidence":
            return [0.2] * EMBEDDING_DIMENSIONS
        return await original_embed(text)

    async def delivered(*_args: Any, **_kwargs: Any) -> Delivered:
        return Delivered(attempts=1, response=_Reply(201, []))

    async def no_sidecar(*_args: Any, **_kwargs: Any) -> int:
        return 0

    monkeypatch.setattr(rag, "_embed", embed)
    monkeypatch.setattr(writer_module, "deliver", delivered)
    monkeypatch.setattr(writer_module, "persist_edges", no_sidecar)
    monkeypatch.setattr(writer_module, "persist_chart_image", no_sidecar)
    asyncio.run(rag._index_one({
        "kind": "backtest_run", "source_ref": "run-2", "title": "New",
        "body": "new evidence", "metrics": {},
    }))

    asyncio.run(rag.search("shared"))
    assert corpus.embed_calls == 2


def test_chunk_planner_is_deterministic_bounded_and_parent_aware():
    body = "\n\n".join(
        f"Fold {i}: Sharpe {i / 10:.1f}; drawdown {-i / 100:.2%}; observations 250."
        for i in range(20)
    )
    document = {
        "kind": "backtest_run", "source_ref": "job-77", "title": "Long sweep",
        "body": body, "metrics": {"sharpe": 1.4}, "_retrieve_after": True,
    }
    planned = plan_document(document, max_chars=180, overlap_chars=30)

    assert planned == plan_document(document, max_chars=180, overlap_chars=30)
    assert len(planned) > 1 and all(len(row["body"]) <= 180 for row in planned)
    assert len({row["source_ref"] for row in planned}) == len(planned)
    assert [row["metrics"][CHUNK_META_KEY]["index"] for row in planned] == list(
        range(1, len(planned) + 1),
    )
    assert all(row["metrics"][CHUNK_META_KEY]["parent_source_ref"] == "job-77" for row in planned)
    assert all("_retrieve_after" not in row for row in planned[:-1])
    assert planned[-1]["_retrieve_after"] is True
    assert document["metrics"] == {"sharpe": 1.4}, "planning must not mutate the card"


def test_chart_identity_is_not_split_away_from_its_durable_image_id():
    chart = {"kind": "chart", "source_ref": "job-1:equity", "body": "x " * 500}
    assert plan_document(chart, max_chars=80, overlap_chars=10) == [chart]


def test_image_only_chart_hit_and_its_provenance_survive_the_wire_model():
    chart = {
        **_row("chart-1", 1), "kind": "chart", "similarity": None,
        "vector_rank": None, "lexical_rank": None, "bm25_rank": None,
        "image_rank": 1, "image_similarity": 0.31,
    }
    wire = ResearchRagSearchResponse(
        state="ok", matches=[chart], cache={"state": "miss", "age_seconds": 0.0},
    ).model_dump(mode="json")

    assert wire["matches"][0]["similarity"] is None
    assert wire["matches"][0]["image_rank"] == 1
    assert wire["matches"][0]["image_similarity"] == 0.31
    assert wire["cache"]["state"] == "miss"


def test_retrieval_widens_only_when_sibling_chunks_crowd_out_parents(monkeypatch):
    monkeypatch.setattr(research_image, "IMAGE_MODEL_PATH", "")
    planned = plan_document(
        {"kind": "backtest_run", "source_ref": "parent", "body": "x " * 200, "metrics": {}},
        max_chars=80, overlap_chars=10,
    )
    chunk_rows = [
        _row(row["source_ref"], index, metrics=row["metrics"])
        for index, row in enumerate(planned[:3], start=1)
    ]
    corpus = _Corpus(chunk_rows + [_row("other-1", 4), _row("other-2", 5)])
    result = asyncio.run(_rag(corpus).search("shared", match_count=3))

    assert corpus.hybrid_widths == [3, 12]
    assert [row["source_ref"] for row in result["matches"]] == [
        "parent", "other-1", "other-2",
    ]
    assert result["matches"][0]["metrics"][CHUNK_META_KEY]["chunk_source_ref"]


def test_dense_internal_match_also_widens_past_sibling_chunks():
    planned = plan_document(
        {"kind": "risk_incident", "source_ref": "parent", "body": "x " * 200, "metrics": {}},
        max_chars=80, overlap_chars=10,
    )
    rows = [
        _row(row["source_ref"], index, metrics=row["metrics"])
        for index, row in enumerate(planned[:3], start=1)
    ] + [_row("other-1", 4), _row("other-2", 5)]

    class DenseCorpus(_Corpus):
        async def post(self, path: str, json: dict[str, Any]) -> _Reply:  # noqa: A002
            if path.endswith("match_research_documents"):
                width = int(json["match_count"])
                self.hybrid_widths.append(width)
                return _Reply(200, self.rows[:width])
            return await super().post(path, json)

    corpus = DenseCorpus(rows)
    matches = asyncio.run(_rag(corpus)._match([0.1] * EMBEDDING_DIMENSIONS, match_count=3))

    assert corpus.hybrid_widths == [3, 12]
    assert [row["source_ref"] for row in matches] == ["parent", "other-1", "other-2"]


def test_writer_queues_one_logical_document_so_capacity_cannot_split_its_chunks(monkeypatch):
    import modules.research_rag.chunking as chunking

    monkeypatch.setattr(chunking, "CHUNK_MAX_CHARS", 80)
    monkeypatch.setattr(chunking, "CHUNK_OVERLAP_CHARS", 10)
    rag = ResearchRag()
    rag.enabled = True
    rag._submit({
        "kind": "backtest_run", "source_ref": "queued-parent",
        "body": "quant metric observation " * 30, "metrics": {},
    })
    queued = [rag._queue.get_nowait() for _ in range(rag._queue.qsize())]

    assert len(queued) == 1
    assert queued[0]["source_ref"] == "queued-parent"
    assert CHUNK_META_KEY not in queued[0]["metrics"]


def test_backfill_uses_the_same_chunk_identity_as_live_ingest(monkeypatch):
    import modules.research_rag.chunking as chunking
    from tools import backfill_research_rag as backfill

    monkeypatch.setattr(chunking, "CHUNK_MAX_CHARS", 80)
    monkeypatch.setattr(chunking, "CHUNK_OVERLAP_CHARS", 10)
    stored: list[dict[str, Any]] = []

    class Corpus:
        async def post(self, _path: str, json: dict[str, Any], headers: dict[str, str]) -> _Reply:
            stored.append(json)
            return _Reply(201, [])

    class Rag:
        _client = Corpus()

        async def _embed(self, _text: str) -> list[float]:
            return [0.1] * EMBEDDING_DIMENSIONS

    outcome = asyncio.run(backfill._store(Rag(), {
        "kind": "backtest_run", "source_ref": "historical-parent",
        "body": "quant metric observation " * 30, "metrics": {},
    }))

    assert outcome == "written" and len(stored) == 1
    rows = stored[0]["p_rows"]
    assert len(rows) > 1, "all chunks travel in one atomic RPC"
    assert all(row["metrics"][CHUNK_META_KEY]["parent_source_ref"] == "historical-parent" for row in rows)
    assert len({row["source_ref"] for row in rows}) == len(rows)


def test_backfill_failure_sends_one_complete_set_and_never_client_side_deletes(monkeypatch):
    import modules.research_rag.chunking as chunking
    from tools import backfill_research_rag as backfill

    monkeypatch.setattr(chunking, "CHUNK_MAX_CHARS", 80)
    monkeypatch.setattr(chunking, "CHUNK_OVERLAP_CHARS", 10)
    calls: list[tuple[str, dict[str, Any]]] = []

    class Corpus:
        async def post(self, path: str, json: dict[str, Any], headers: dict[str, str]) -> _Reply:
            calls.append((path, json))
            return _Reply(503, [])

    class Rag:
        _client = Corpus()

        async def _embed(self, _text: str) -> list[float]:
            return [0.1] * EMBEDDING_DIMENSIONS

    outcome = asyncio.run(backfill._store(Rag(), {
        "kind": "backtest_run", "source_ref": "failed-parent",
        "body": "quant metric observation " * 30, "metrics": {},
    }))

    assert outcome == "failed"
    assert len(calls) == 1 and calls[0][0].endswith("replace_research_document_chunks")
    assert len(calls[0][1]["p_rows"]) > 1
    assert all(method != "DELETE" for method, _payload in calls)


def test_split_text_never_exceeds_the_requested_bound():
    text = " ".join(f"metric-{i}=0.{i:03d}" for i in range(100))
    first = split_text(text, max_chars=90, overlap_chars=20)
    assert first == split_text(text, max_chars=90, overlap_chars=20)
    assert len(first) > 1 and all(0 < len(chunk) <= 90 for chunk in first)
