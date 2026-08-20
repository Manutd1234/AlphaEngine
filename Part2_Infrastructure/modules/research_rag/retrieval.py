"""Embedding and retrieval: the read half of the research index.

Split out of ``modules/research_rag.py``. ``_RetrievalMixin`` carries every
method that only needs ``self._client`` — nothing here reads ``settings``, so
the whole configuration surface stays in ``writer.py`` and a test stubbing
settings has exactly one module to patch.

Two honesty rules live here and neither may be relaxed:

* an embed that fails returns ``None``, never a zero vector — a zero vector is
  equidistant from everything and would be returned as "similar" to any query;
* ``search`` and ``connected`` return a typed ``unavailable`` state, never an
  empty list. "Searched and found nothing" is a different fact from "could not
  search", and the workspace renders them differently.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

log = logging.getLogger("alphaengine.rag")

EMBEDDING_DIMENSIONS = 384
EMBEDDING_MODEL = "gte-small"

#: Cosine similarity below which a document is not offered as a match.
#:
#: `match_research_documents` has taken `min_similarity` since it was written and
#: defaulted it to 0.0, and no caller ever passed it. The Oracle query had no
#: floor at all. Both returned their N nearest rows however far away those were.
#:
#: 0.76 is MEASURED, not chosen. The first attempt used 0.35 on the reasoning
#: that cosine similarity runs 0-1 and a third is generous — and it filtered
#: nothing, because gte-small's absolute range is compressed near the top. Six
#: queries against the live index, one backtest card in the corpus:
#:
#:     moving average crossover BTCUSDT sharpe drawdown   0.898
#:     backtest sharpe ratio                              0.891
#:     trading strategy                                   0.792
#:     ---------------------------------------------- floor 0.76
#:     quantum entanglement in medieval poetry            0.744
#:     recipe for sourdough bread                         0.734
#:     the weather in Lisbon on Tuesday                   0.733
#:
#: Unrelated text lands at ~0.735 whatever it is about, so the useful signal is
#: the gap above that, not the absolute value. A generic but on-topic query
#: ("trading strategy") sits at 0.792 and must survive; nonsense must not.
#:
#: Six queries and one document is a thin basis and this number will move. That
#: is the eval harness's job — but a floor derived from three observed clusters
#: beats one derived from what the range looks like it ought to be.
RAG_MIN_SIMILARITY = 0.76


class _RetrievalMixin:
    """The read half of ``ResearchRag``; see ``writer.ResearchRag``."""

    _client: httpx.AsyncClient | None

    # -- embedding --------------------------------------------------------- #
    async def embed_many(self, texts: list[str]) -> list[list[float]] | None:
        """Vectors for every text in one call, or None if any of it is unusable.

        All-or-nothing on purpose. A partial result would leave the caller
        pairing vectors with the wrong texts unless it also tracked which
        positions failed, and a silently misaligned embedding is the failure
        mode this whole module is built to avoid: it returns confident
        neighbours that mean nothing.

        One round trip. `embed-research` accepts up to 32 texts and the write
        path used to send them one at a time, so a backfill of N documents cost
        N round trips to a function that could have taken them in batches.
        """
        if not self._client or not texts:
            return None
        try:
            response = await self._client.post(
                "/functions/v1/embed-research", json={"texts": texts}
            )
            if response.status_code >= 300:
                return None
            embeddings = response.json().get("embeddings") or []
            if len(embeddings) != len(texts):
                return None
            # A dimension mismatch means the corpus and this query were embedded
            # by different models. Refusing is the only safe answer: vectors are
            # comparable only within one model, and a 1536-dim query against a
            # 384-dim index does not error, it ranks nonsense.
            if any(not v or len(v) != EMBEDDING_DIMENSIONS for v in embeddings):
                return None
            return embeddings
        except httpx.HTTPError:
            return None

    async def _embed(self, text: str) -> list[float] | None:
        """One vector, or None — the caller records 'pending', never zeros."""
        vectors = await self.embed_many([text])
        return vectors[0] if vectors else None


    # -- retrieval --------------------------------------------------------- #
    async def _match(
        self,
        vector: list[float],
        match_count: int = 3,
        kind: str | None = None,
        query_text: str | None = None,
    ) -> list[dict[str, Any]]:
        """Hybrid when a query string is available, dense-only otherwise.

        The hybrid RPC fuses the vector ranking with a lexical one by Reciprocal
        Rank Fusion. It exists because this corpus is keyed by exactly the tokens
        a sentence embedder handles worst — ``BTCUSDT``, a job id, an eight-
        character ``data_hash``, a parameter pair like ``20/100``. gte-small maps
        those to whatever its subword tokeniser makes of them, so an exact job id
        can rank below three documents about job ids in general.

        NOT A FALLBACK CHAIN, EXCEPT WHERE THE MIGRATION HAS NOT RUN. A 404 from
        the hybrid RPC means the deployment predates the migration, which is a
        real state during a rollout and the only case where falling back to the
        dense function is right. Any other failure returns nothing rather than
        quietly serving worse results under the same label — the two functions
        answer different questions and a silent substitution hides that.
        """
        if not self._client:
            return []
        if query_text:
            try:
                response = await self._client.post(
                    "/rest/v1/rpc/match_research_documents_hybrid",
                    json={
                        "query_embedding": vector,
                        "query_text": query_text,
                        "match_count": match_count,
                        "filter_kind": kind,
                    },
                )
                if response.status_code < 300:
                    # The relevance floor is applied here rather than inside the
                    # function: a document surfaced by an exact lexical match is
                    # relevant even when its cosine similarity is unremarkable,
                    # which is the whole reason lexical retrieval was added.
                    rows = list(response.json())
                    return [
                        r for r in rows
                        if r.get("lexical_rank") is not None
                        or float(r.get("similarity") or 0) >= RAG_MIN_SIMILARITY
                    ]
                if response.status_code != 404:
                    return []
                log.info("hybrid RPC absent (404) — deployment predates the migration")
            except httpx.HTTPError:
                return []

        try:
            response = await self._client.post(
                "/rest/v1/rpc/match_research_documents",
                json={
                    "query_embedding": vector,
                    "match_count": match_count,
                    "min_similarity": RAG_MIN_SIMILARITY,
                    "filter_kind": kind,
                },
            )
            if response.status_code >= 300:
                return []
            return list(response.json())
        except httpx.HTTPError:
            return []

    async def search(
        self, query: str, match_count: int = 3, kind: str | None = None
    ) -> dict[str, Any]:
        """Typed result: `unavailable` is a state, never an empty list."""
        if not self.enabled or not self._client:
            return {"state": "unavailable", "matches": []}
        vector = await self._embed(query)
        if vector is None:
            return {"state": "embed_failed", "matches": []}
        return {
            "state": "ok",
            "matches": await self._match(
                vector, match_count=match_count, kind=kind, query_text=query,
            ),
            "corpus_size": await self._corpus_size(),
        }

    async def _corpus_size(self) -> int | None:
        """How many embedded documents the search could have matched.

        `None`, never 0, when the count cannot be taken — the denominator's
        whole job is to tell "one of one" apart from "one of four hundred", and
        a failed count reported as zero would say something worse than nothing.
        """
        if not self._client:
            return None
        try:
            response = await self._client.head(
                "/rest/v1/research_documents",
                params={"select": "id", "embedding_status": "eq.ready"},
                headers={"Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"},
            )
            if response.status_code >= 400:
                log.warning("research rag: corpus count HTTP %s", response.status_code)
                return None
            total = response.headers.get("content-range", "").split("/")[-1]
            return int(total) if total.isdigit() else None
        except Exception as exc:
            log.warning("research rag: corpus count failed (%s)", type(exc).__name__)
            return None

    async def connected(
        self, document_id: str, max_depth: int = 2, match_count: int = 10
    ) -> dict[str, Any]:
        """Documents reachable from one document over research_edges.

        The other question the corpus can be asked. ``search`` answers "what is
        similar to this"; this answers "what is CONNECTED to this" — every run
        that saw the same bars, the incident that followed a promotion. Those
        are relations, and a fused similarity ranking cannot express one.

        Typed like ``search``: ``unavailable`` is a state and never an empty
        list, because "this document is connected to nothing" and "I could not
        ask" are different facts and the panel renders them differently.

        A 404 from the RPC means the deployment predates the traversal
        migration, which is a real state during a rollout. It is reported as
        ``unavailable`` rather than as an error, because a corpus that cannot
        traverse yet is not a broken corpus.
        """
        if not self.enabled or not self._client:
            return {"state": "unavailable", "connected": []}
        try:
            response = await self._client.post(
                "/rest/v1/rpc/traverse_research_graph",
                json={
                    "start_id": document_id,
                    "max_depth": max(1, min(int(max_depth), 4)),
                    "match_count": max(1, min(int(match_count), 50)),
                },
            )
        except httpx.HTTPError:
            return {"state": "unavailable", "connected": []}
        if response.status_code == 404:
            return {"state": "unavailable", "connected": []}
        if response.status_code >= 300:
            return {"state": "unavailable", "connected": []}
        try:
            rows = response.json() or []
        except ValueError:
            return {"state": "unavailable", "connected": []}
        return {"state": "ok", "connected": rows}
