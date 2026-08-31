"""Embedding and retrieval: the read half of the research index.

Split out of ``modules/research_rag.py``. ``_RetrievalMixin`` carries every
method that only needs ``self._client`` — nothing here reads ``settings``, so
the whole configuration surface stays in ``writer.py`` and a test stubbing
settings has exactly one module to patch. Two more files came out of this one
when it ran out of room for the tenant scope: ``arms.py`` (the relevance floor,
the refusal vocabulary, ``apply_bm25``) and ``embedding.py`` (``embed_many`` and
the model constants). Both are re-exported here, because two suites, one
TypeScript parity test and ``writer.py`` read those names off THIS module.

Two honesty rules live here and neither may be relaxed:

* an embed that fails returns ``None``, never a zero vector — a zero vector is
  equidistant from everything and would be returned as "similar" to any query;
* ``search`` and ``connected`` return a typed ``unavailable`` state, never an
  empty list. "Searched and found nothing" is a different fact from "could not
  search", and the workspace renders them differently.

Retrieval fuses FOUR arms at RRF k = 60: Postgres dense/sparse, in-process BM25,
and the CLIP ``image_embedding`` ranker, which alone can ADD a document. Both
optional arms report ``ranked: False`` with a named ``reason`` rather than
failing, so with either absent yesterday's ordering stands UNCHANGED.

THE TENANT SCOPE. ``search``, ``connected``, ``_match_arms`` and ``_match``
thread ``desk_id`` to every corpus-reading RPC as ``filter_desk_id``, the
migrations' pinned argument. ``None`` means UNSCOPED and leaves the key off;
see ``_scope`` for the rollout reason.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

# Every import in this block is also a RE-EXPORT, and that is the split's whole
# cost. `modules/research_rag/__init__.py` publishes `RAG_MIN_SIMILARITY` from
# here, `writer.py` takes `EMBEDDING_MODEL` from here, and
# `tests/test_research_bm25_wiring.py` reads `retrieval.research_bm25`,
# `retrieval.REASON_DENSE_ONLY` and `retrieval._unretrieved` off the module
# object. None of those files is this change's to edit, so a split that moved
# the import path of a constant would be a split that broke three suites to buy
# a line count. `research_bm25` is bound here for exactly that reason and is
# called from `arms.apply_bm25`, one import away.
from modules import research_bm25  # noqa: F401 - re-exported: the wiring suite reads the arm off this module
from modules.research_graph_fusion import fuse_graph_matches  # noqa: F401 - re-exported: the arms are named here
from modules.research_image_arm import image_arm
from modules.research_rag.arms import (
    RAG_MIN_SIMILARITY,
    REASON_DENSE_ONLY,
    REASON_RETRIEVAL_UNAVAILABLE,  # noqa: F401 - re-exported
    REASON_UNJOINABLE_CANDIDATES,  # noqa: F401 - re-exported
    REASON_UNPARSEABLE_BODY,
    _arm_unavailable,
    _unretrieved,
    apply_bm25,
)
from modules.research_rag.chunking import collapse_parent_matches
from modules.research_rag.embedding import (
    EMBEDDING_DIMENSIONS,  # noqa: F401 - re-exported
    EMBEDDING_MODEL,  # noqa: F401 - re-exported
    _EmbeddingMixin,
)
from modules.research_rag.query_cache import search_with_cache

log = logging.getLogger("alphaengine.rag")


def _scope(desk_id: str | None) -> dict[str, str]:
    """The tenant argument for a retrieval RPC, or NOTHING AT ALL.

    ``None`` leaves ``filter_desk_id`` off the payload rather than sending it as
    an explicit null. Inside the function the two are identical — the predicate
    is ``filter_desk_id is null or d.desk_id = filter_desk_id`` — so this is not
    about SQL. It is about PostgREST during a rollout: an RPC call naming an
    argument the deployed function does not declare is answered PGRST202, "could
    not find the function with those parameters", as a 404. A gateway that had
    learned this parameter while the migration had not yet run would 404 EVERY
    search, on a deployment that had asked for no scoping at all.

    So an unscoped deployment sends exactly the payload it sent before this
    change existed, and the only deployment that can be broken by the new
    argument is one that deliberately switched `RESEARCH_SCOPE_TO_DESK` on. The
    rejected alternative was always sending the key and treating the 404 as the
    "migration has not run" signal `_hybrid_arms` already handles — which would
    silently downgrade a SCOPED search to the unscoped dense function, serving
    every desk's rows to the one deployment that said it must not see them.
    """
    return {"filter_desk_id": desk_id} if desk_id else {}


def _body(response: Any) -> tuple[list[dict[str, Any]] | None, str]:
    """The rows an RPC returned, or the reason its body could not be read.

    Rows and reason rather than a raise, for the reason ``_unretrieved`` exists:
    a body that will not parse is a state of the retrieval and the caller has a
    field to put it in. The failure is the same one ``embed_many`` documents — a
    proxy answering 200 with an HTML error page — and it reaches these two
    handlers by exactly the same route.
    """
    try:
        payload = response.json()
    except ValueError:
        return None, (
            f"the RPC answered HTTP {getattr(response, 'status_code', '2xx')} with a body that is "
            f"not JSON ({REASON_UNPARSEABLE_BODY}), so nothing was retrieved"
        )
    if not isinstance(payload, list) or not all(isinstance(row, dict) for row in payload):
        return None, (
            f"the RPC answered HTTP {getattr(response, 'status_code', '2xx')} with JSON that is "
            f"not an array of documents ({REASON_UNPARSEABLE_BODY}), so nothing was retrieved"
        )
    return payload, ""


class _RetrievalMixin(_EmbeddingMixin):
    """The read half of ``ResearchRag``; see ``writer.ResearchRag``."""
    _client: httpx.AsyncClient | None

    # -- retrieval --------------------------------------------------------- #
    async def _match(
        self,
        vector: list[float],
        match_count: int = 3,
        kind: str | None = None,
        query_text: str | None = None,
        desk_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """The rows alone, for a caller with nowhere to put the arm's report.

        ``writer.py``'s anomaly path embeds a card and wants the neighbours; it
        has no query string and no response to carry a report. Widening this
        method to a tuple would have broken that caller SILENTLY rather than
        loudly — ``matches[0]`` on a tuple is a list, not a row — so the two
        shapes are two methods.

        ``desk_id`` is here as well as on ``search`` because this is the second
        door into the same RPCs. A tenant predicate applied on one of two paths
        is not a tenant predicate; it is a setting that is true of some requests.
        """
        matches, _report = await self._match_arms(
            vector, match_count=match_count, kind=kind, query_text=query_text, desk_id=desk_id,
        )
        collapsed, duplicate = collapse_parent_matches(matches, match_count)
        wider = min(20, max(match_count + 1, match_count * 4))
        if duplicate and len(collapsed) < match_count and wider > match_count:
            matches, _report = await self._match_arms(
                vector, match_count=wider, kind=kind, query_text=query_text, desk_id=desk_id,
            )
            collapsed = collapse_parent_matches(matches, match_count)[0][:match_count]
        return collapsed

    async def _hybrid_arms(
        self,
        vector: list[float],
        match_count: int,
        kind: str | None,
        query_text: str,
        desk_id: str | None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]] | None:
        """The hybrid RPC's answer, or ``None`` meaning "fall through to dense".

        Extracted from ``_match_arms`` when the unparseable-body handling landed:
        the two paths together crossed ruff's ``C901`` ceiling, and a function
        nobody can hold in their head is where a fallback quietly becomes a
        fallback chain. The three outcomes are now explicit — a result, a typed
        refusal, and the ONE case that may fall through.

        ``None`` is that one case and it is only HTTP 404. A 404 from this RPC
        means the deployment predates the migration, which is a real state during
        a rollout. Every other failure returns a refusal rather than quietly
        serving the dense function's worse results under the same label.
        """
        assert self._client is not None
        try:
            response = await self._client.post(
                "/rest/v1/rpc/match_research_documents_hybrid",
                json={
                    "query_embedding": vector,
                    "query_text": query_text,
                    "match_count": match_count,
                    "filter_kind": kind,
                    **_scope(desk_id),
                },
            )
        except httpx.HTTPError:
            return [], _unretrieved("the hybrid RPC could not be reached")
        if response.status_code >= 300:
            if response.status_code != 404:
                return [], _unretrieved(f"the hybrid RPC answered HTTP {response.status_code}")
            log.info("hybrid RPC absent (404) — deployment predates the migration")
            return None
        rows, unreadable = _body(response)
        if rows is None:
            return [], _unretrieved(unreadable)
        # The relevance floor is applied here rather than inside the function: a
        # document surfaced by an exact lexical match is relevant even when its
        # cosine similarity is unremarkable, which is the whole reason lexical
        # retrieval was added.
        #
        # BM25 is handed the SURVIVORS of that floor. Its statistics are of the
        # set it is given, so scoring rows that will not be returned would let a
        # discarded document reorder the kept ones — rejected for that, though it
        # would have given the arm more collection to work with.
        return apply_bm25(
            [
                r for r in rows
                if r.get("lexical_rank") is not None
                or float(r.get("similarity") or 0) >= RAG_MIN_SIMILARITY
            ],
            query_text,
        )

    async def _match_arms(
        self,
        vector: list[float],
        match_count: int = 3,
        kind: str | None = None,
        query_text: str | None = None,
        desk_id: str | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        """Hybrid when a query string is available, dense-only otherwise.

        The hybrid RPC fuses the vector ranking with a lexical one by Reciprocal
        Rank Fusion. It exists because this corpus is keyed by exactly the tokens
        a sentence embedder handles worst — ``BTCUSDT``, a job id, an eight-
        character ``data_hash``, a parameter pair like ``20/100``. gte-small maps
        those to whatever its subword tokeniser makes of them, so an exact job id
        can rank below three documents about job ids in general.

        THE THIRD ARM IS ADDED IN ``_hybrid_arms``, not in the function:
        ``apply_bm25`` re-scores the rows the RPC returned and fuses its ranking
        with the two the RPC states. The second half of the return is that arm's
        report, and every path below returns one.

        NOT A FALLBACK CHAIN, EXCEPT WHERE THE MIGRATION HAS NOT RUN — the whole
        of that argument now lives on ``_hybrid_arms``, which is the only thing
        that can decide to fall through.

        ``desk_id`` reaches BOTH functions, because both of them read the same
        table and a predicate on one is a hole under the other.
        """
        if not self._client:
            return [], _unretrieved("Supabase is not configured, so nothing was retrieved")
        if query_text:
            hybrid = await self._hybrid_arms(vector, match_count, kind, query_text, desk_id)
            if hybrid is not None:
                return hybrid

        try:
            response = await self._client.post(
                "/rest/v1/rpc/match_research_documents",
                json={
                    "query_embedding": vector,
                    "match_count": match_count,
                    "min_similarity": RAG_MIN_SIMILARITY,
                    "filter_kind": kind,
                    **_scope(desk_id),
                },
            )
            if response.status_code >= 300:
                return [], _unretrieved(f"the dense RPC answered HTTP {response.status_code}")
        except httpx.HTTPError:
            return [], _unretrieved("the dense RPC could not be reached")
        rows, unreadable = _body(response)
        if rows is None:
            return [], _unretrieved(unreadable)
        # No third arm here, and that is conservatism rather than a gap. These
        # rows carry neither ``vector_rank`` nor ``lexical_rank``, so fusing
        # would score each of them on the BM25 arm ALONE and discard the
        # similarity ordering that is the only ordering this path has — worse
        # than today, which this wiring may not be. Synthesising a vector rank
        # from the row order was the rejected alternative: it writes a rank the
        # RPC never stated into the field the workspace reads as evidence of
        # which retriever fired.
        detail = "the dense-only function answered, and its rows carry no rank to fuse with"
        return rows, _arm_unavailable(REASON_DENSE_ONLY, detail, candidates=len(rows))

    async def search(
        self, query: str, match_count: int = 3, kind: str | None = None,
        desk_id: str | None = None,
    ) -> dict[str, Any]:
        """Typed, cached search; ``desk_id`` is part of both query and cache scope."""
        return await search_with_cache(self, query, match_count, kind, desk_id, image_arm)

    async def _corpus_size(self, desk_id: str | None = None) -> int | None:
        """How many embedded documents the search could have matched.

        `None`, never 0, when the count cannot be taken — the denominator's
        whole job is to tell "one of one" apart from "one of four hundred", and
        a failed count reported as zero would say something worse than nothing.

        SCOPED WITH THE SEARCH, and that is the honesty rule rather than a
        nicety: "1 of 412" under a desk predicate that only let the search see
        forty documents is a denominator counting rows the numerator could not
        have come from. The filter is a plain PostgREST predicate rather than an
        RPC argument, so unlike `_scope` there is no rollout case — `desk_id` is
        a column on `research_documents` and has been since the table existed.
        """
        if not self._client:
            return None
        params = {"select": "id", "embedding_status": "eq.ready"}
        if desk_id:
            params["desk_id"] = f"eq.{desk_id}"
        try:
            response = await self._client.head(
                "/rest/v1/research_documents",
                params=params,
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
        self, document_id: str, max_depth: int = 2, match_count: int = 10,
        relations: list[str] | None = None, desk_id: str | None = None,
    ) -> dict[str, Any]:
        """Documents reachable from one document over research_edges.

        The other question the corpus can be asked. ``search`` answers "what is
        similar to this"; this answers "what is CONNECTED to this" — every run
        that saw the same bars, the incident that followed a promotion. Those
        are relations, and a fused similarity ranking cannot express one.

        Typed like ``search``: ``unavailable`` is a state and never an empty
        list, because "this document is connected to nothing" and "I could not
        ask" are different facts and the panel renders them differently.

        A 404 means the deployment predates the traversal migration, a real state
        in a rollout, so it is ``unavailable`` and not an error. ``relations``
        reaches the CTE filter, and since this change reaches it from the ROUTE
        as well: ``None`` traverses every relation, and ``[]`` is left OFF the
        payload, never sent as an empty array.

        ``desk_id`` is optional for the same staged-rollout reason as on
        ``search``. With the default scope setting off the key stays absent and
        a deployment predating the graph-scope migration receives the exact old
        payload. Once the setting is enabled, a missing migration produces the
        typed ``unavailable`` state below rather than an unscoped fallback.
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
                    **({"relations": list(relations)} if relations else {}),
                    **_scope(desk_id),
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
