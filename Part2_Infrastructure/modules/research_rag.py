"""pgvector research index: what the desk already records, made retrievable.

The corpus is not new instrumentation. Completed backtests already land in the
audit log's ``backtest_runs`` table with DSR, OOS Sharpe, PBO and ``data_hash``;
risk incidents already flow through the gateway's alert path. This module
renders each of those into a plain-text card, embeds it via the
``embed-research`` edge function (gte-small, 384-dim — no paid API, no model
weights in the gateway image), and stores card + vector in
``public.research_documents``.

Retrieval triggers on a precisely-defined execution anomaly — not on vibes:

* an **accepted** fill whose realised ``slippage_bps`` exceeds
  ``settings.max_est_slippage_bps`` (the pre-trade estimate was wrong — the
  interesting case, and the gateway computes both numbers on the same order);
* a rejection citing ``est_slippage`` or ``daily_drawdown``;
* the drawdown circuit breaker engaging the kill switch.

Honesty rules, non-negotiable:

* ``body`` stores the exact text that was embedded, so a renderer change can
  never silently invalidate stored vectors.
* An embed failure stores the document ``embedding_status='pending'`` — never
  a zero vector, which is equidistant from everything and would be returned as
  "similar" to any query. The backfill tool re-embeds pending rows.
* With Supabase unconfigured, ``search`` reports ``unavailable`` — never an
  empty list. "Searched and found nothing" is a different fact from "could
  not search", and the workspace renders them differently.

A completed sweep yields one document per CHART as well as the run card — the
equity curve, the drawdown envelope, the fold table — described from the figures
the desk already computed in order to draw them. No image is embedded and there
is no vision model in this path: the Edge runtime's ``Supabase.ai.Session``
exposes gte-small and takes no image, so a chart is retrievable by what it says.

Card rendering deliberately does not import ``modules.telegram`` (matplotlib
is heavy); ``telegram.text_card`` is the design lineage — title, state, metric
lines, provenance footer — because a card an LLM retrieves and a card a human
reads on a phone want the same shape.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

import httpx

from config import settings

# Re-exported: `render_ml_card` and the others are imported from here by
# tools/ and tests/, and the `as` form keeps `ruff --fix` from deleting them.
from modules.research_cards import ANOMALY_GATES as ANOMALY_GATES
from modules.research_cards import classify_anomaly as classify_anomaly
from modules.research_cards import render_backtest_card as render_backtest_card
from modules.research_cards import render_backtest_documents
from modules.research_cards import render_incident_card as render_incident_card
from modules.research_cards import render_ml_card as render_ml_card
from modules.research_graph import persist_edges

if TYPE_CHECKING:
    from modules.schemas import OrderRequest, RiskDecision

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



class ResearchRag:
    """Write path + retrieval; a no-op when unconfigured."""

    def __init__(self) -> None:
        self.enabled = bool(
            settings.supabase_url
            and settings.supabase_service_role_key
            and settings.research_rag_enabled
        )
        self._client: httpx.AsyncClient | None = None
        self._queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(
            maxsize=settings.supabase_mirror_queue_max
        )
        self._task: asyncio.Task[None] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._indexed = 0
        self._pending = 0
        self._failed = 0
        self._dropped = 0
        self._last_matches: list[dict[str, Any]] = []
        self._last_anomaly_at: datetime | None = None

    # -- lifecycle --------------------------------------------------------- #
    async def start(self) -> None:
        if not self.enabled or self._task:
            return
        self._client = httpx.AsyncClient(
            base_url=settings.supabase_url.rstrip("/"),
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "Content-Type": "application/json",
            },
            timeout=settings.supabase_timeout_s,
        )
        self._loop = asyncio.get_running_loop()
        self._task = asyncio.create_task(self._drain(), name="research-rag")
        log.info("research RAG started")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if self._client:
            await self._client.aclose()
            self._client = None
        self._loop = None

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

    # -- write path (all through the bounded queue) ------------------------ #
    def _submit(self, document: dict[str, Any]) -> None:
        """Queue a document from any thread.

        `asyncio.Queue` binds itself to the loop that first touches it, so
        `put_nowait` from the job queue's WORKER THREAD raises

            RuntimeError: <asyncio.locks.Event ...> is bound to a
            different event loop

        which is the same fault that stopped a fitted model being filed. There
        it surfaced on the panel; here it was swallowed by the caller's
        `except Exception` and logged as "corpus card not indexed", so a fitted
        run simply never reached the corpus and nothing said why.

        Hopping through the owning loop is safe from that loop too —
        `call_soon_threadsafe` from inside the loop just schedules — so there
        is no branch on which thread is calling.
        """
        if not self.enabled:
            return
        if self._loop is None:
            # Never started: no loop owns the queue yet, so this thread may as
            # well be the one that binds it.
            self._offer(document)
        else:
            self._loop.call_soon_threadsafe(self._offer, document)

    def _offer(self, document: dict[str, Any]) -> None:
        try:
            self._queue.put_nowait(document)
        except asyncio.QueueFull:
            self._dropped += 1

    def on_backtest_complete(self, record: Any) -> None:
        """`queue.on_complete` hook — same seam the Telegram push uses.

        One sweep is MORE THAN ONE DOCUMENT: the run card, and one per chart the
        run drew, described from the figures it already computed to draw them.
        The charts were previously unreachable from the corpus — not because
        their meaning was unavailable, but because it was only ever rendered
        into a PNG. Which documents a result yields is
        `render_backtest_documents`'s decision; this hook only queues them.
        """
        if not self.enabled or getattr(record, "kind", None) != "backtest":
            return
        result = getattr(record, "result", None)
        if result is None:
            return
        for document in render_backtest_documents(result):
            self._submit(document)

    def on_ml_run_complete(self, run: dict[str, Any]) -> None:
        """Index one supervised run, the same way a sweep is indexed.

        `render_ml_card` existed with no production caller, so the `ml_run`
        document kind that migration 20260820090600 added to the corpus could
        never be emitted by anything — a kind in the enum, in the Oracle CHECK
        constraint and in the generated contract, that no code path could
        produce. This is the caller.

        Takes the run dict the store filed rather than the job's result, so the
        card describes what is IN the corpus. A card that disagreed with the row
        it points at would be worse than no card.
        """
        if not self.enabled or not run:
            return
        title, body = render_ml_card(run)
        self._submit({
            "kind": "ml_run",
            "source_ref": str(run.get("id") or ""),
            "symbol": run.get("symbol"),
            "interval": run.get("interval"),
            "strategy": run.get("model"),
            "occurred_at": (run.get("finished_at") or datetime.now(timezone.utc).isoformat()),
            "title": title,
            "body": body,
            "metrics": {
                k: run.get(k)
                for k in ("oos_sharpe", "deflated_sharpe", "pbo", "engine")
            },
            "data_hash": run.get("data_hash"),
        })

    def on_decision(self, decision: RiskDecision, request: OrderRequest, source: str) -> None:
        """`add_decision_hook` observer: index + retrieve on anomaly."""
        if not self.enabled:
            return
        detail = classify_anomaly(decision)
        if detail is None:
            return
        self._last_anomaly_at = datetime.now(timezone.utc)
        title, body = render_incident_card("Execution anomaly", decision, request, detail)
        self._submit({
            "kind": "risk_incident",
            "source_ref": decision.order_id,
            "symbol": decision.symbol,
            "strategy": request.strategy,
            "occurred_at": decision.timestamp.isoformat(),
            "title": title,
            "body": body,
            "metrics": {
                "latency_ms": decision.latency_ms,
                "slippage_bps": decision.fill.slippage_bps if decision.fill else None,
            },
            "data_hash": None,
            # After indexing, the drain task retrieves similars for this body
            # and caches them on the status route.
            "_retrieve_after": True,
        })

    async def _drain(self) -> None:
        assert self._client is not None
        while True:
            document = await self._queue.get()
            retrieve_after = document.pop("_retrieve_after", False)
            body = document["body"]
            vector = await self._embed(body)
            row = {
                **document,
                "desk_id": settings.supabase_desk_id,
                "embedding": vector,
                "embedding_model": EMBEDDING_MODEL if vector else None,
                "embedding_status": "ready" if vector else "pending",
            }
            try:
                response = await self._client.post(
                    "/rest/v1/research_documents",
                    json=row,
                    headers={"Prefer": "resolution=ignore-duplicates,return=representation"},
                )
                if response.status_code < 300:
                    await persist_edges(self._client, response, desk_id=settings.supabase_desk_id)
                    if vector:
                        self._indexed += 1
                    else:
                        self._pending += 1
                else:
                    self._failed += 1
            except httpx.HTTPError:
                self._failed += 1
                continue
            if retrieve_after and vector:
                matches = await self._match(vector, match_count=3)
                # The document itself is in the index now; drop self-matches.
                self._last_matches = [
                    m for m in matches if m.get("source_ref") != document["source_ref"]
                ][:3]

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

    def status(self) -> dict[str, Any]:
        """Counters and the cached anomaly matches — no URL, no key."""
        return {
            "configured": self.enabled,
            "running": self._task is not None and not self._task.done(),
            "queued": self._queue.qsize(),
            "indexed": self._indexed,
            "pending_embeddings": self._pending,
            "failed": self._failed,
            "dropped": self._dropped,
            "last_anomaly_at": (
                self._last_anomaly_at.isoformat() if self._last_anomaly_at else None
            ),
            "last_anomaly_matches": [
                {
                    "title": m.get("title"),
                    "kind": m.get("kind"),
                    "similarity": m.get("similarity"),
                    "occurred_at": m.get("occurred_at"),
                }
                for m in self._last_matches
            ],
        }


_rag: ResearchRag | None = None


def get_rag() -> ResearchRag:
    global _rag
    if _rag is None:
        _rag = ResearchRag()
    return _rag


def reset_rag() -> None:
    """Test seam."""
    global _rag
    _rag = None
