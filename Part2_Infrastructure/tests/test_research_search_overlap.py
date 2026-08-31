"""Critical-path concurrency for the independent RAG corpus denominator."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from modules.research_rag import EMBEDDING_DIMENSIONS, ResearchRag


class _Reply:
    def __init__(self, payload: Any = None, *, headers: dict[str, str] | None = None) -> None:
        self.status_code = 200
        self._payload = payload
        self.headers = headers or {}

    def json(self) -> Any:
        return self._payload


async def test_corpus_count_overlaps_the_independent_retrieval_rpc() -> None:
    """One independent Supabase RTT must not sit behind the ranking chain."""
    match_started = asyncio.Event()
    count_started = asyncio.Event()
    release_match = asyncio.Event()

    class _Client:
        async def post(self, path: str, json: dict[str, Any]) -> _Reply:  # noqa: A002
            if path.endswith("embed-research"):
                return _Reply({"embeddings": [[0.1] * EMBEDDING_DIMENSIONS]})
            if path.endswith("match_research_documents_hybrid"):
                match_started.set()
                await release_match.wait()
                return _Reply([])
            raise AssertionError(f"unexpected POST {path}")

        async def head(
            self, path: str, params: dict[str, str], headers: dict[str, str],
        ) -> _Reply:
            count_started.set()
            return _Reply(headers={"content-range": "0-0/412"})

    rag = ResearchRag()
    rag.enabled = True
    rag._client = _Client()
    search = asyncio.create_task(rag.search("BTCUSDT drawdown"))
    await asyncio.wait_for(match_started.wait(), timeout=0.2)
    overlapped = False
    try:
        await asyncio.wait_for(count_started.wait(), timeout=0.05)
        overlapped = True
    except TimeoutError:
        pass
    finally:
        release_match.set()
    result = await search

    assert overlapped, "the corpus-count RTT waited behind retrieval instead of overlapping it"
    assert result["state"] == "ok"
    assert result["matches"] == []
    assert result["corpus_size"] == 412


async def test_overlap_preserves_the_ranking_exception_and_cancels_the_count() -> None:
    """Concurrency must not wrap the route's existing exception contract."""
    count_started = asyncio.Event()
    count_cancelled = asyncio.Event()

    class _Client:
        async def post(self, path: str, json: dict[str, Any]) -> _Reply:  # noqa: A002
            if path.endswith("embed-research"):
                return _Reply({"embeddings": [[0.1] * EMBEDDING_DIMENSIONS]})
            if path.endswith("match_research_documents_hybrid"):
                await count_started.wait()
                raise LookupError("malformed ranking")
            raise AssertionError(f"unexpected POST {path}")

        async def head(
            self, path: str, params: dict[str, str], headers: dict[str, str],
        ) -> _Reply:
            count_started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                count_cancelled.set()
                raise
            raise AssertionError("the blocked count unexpectedly completed")

    rag = ResearchRag()
    rag.enabled = True
    rag._client = _Client()
    with pytest.raises(LookupError, match="malformed ranking"):
        await rag.search("BTCUSDT drawdown")
    assert count_cancelled.is_set(), "the failed search left its independent count request running"
