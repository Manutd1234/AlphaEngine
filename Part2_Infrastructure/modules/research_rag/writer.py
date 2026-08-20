"""The write half of the research index: lifecycle, the queue, the hooks, drain.

Split out of ``modules/research_rag.py``. ``ResearchRag`` is still one class —
the read half is ``retrieval._RetrievalMixin`` — and this file is the only one
in the package that reads ``settings``. That is deliberate: a test stubbing
configuration patches ``modules.research_rag.writer.settings`` and nothing else.

The threading note on ``_submit`` below is load-bearing and must not be
"simplified" into a direct ``put_nowait``.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

import httpx

from config import settings
from modules.research_cards import classify_anomaly, render_backtest_documents, render_incident_card, render_ml_card
from modules.research_graph import persist_edges
from modules.research_rag.retrieval import EMBEDDING_MODEL, _RetrievalMixin

if TYPE_CHECKING:
    from modules.schemas import OrderRequest, RiskDecision

log = logging.getLogger("alphaengine.rag")


class ResearchRag(_RetrievalMixin):
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
