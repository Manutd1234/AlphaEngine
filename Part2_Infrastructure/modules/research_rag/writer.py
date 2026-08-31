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
import time
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

import httpx

from config import settings
from modules.research_cards import classify_anomaly, render_backtest_documents, render_incident_card, render_ml_card
from modules.research_graph import persist_edges
from modules.research_image_ingest import attach_chart_pngs
from modules.research_image_store_write import persist_chart_image
from modules.research_ingest_delivery import REASON_ERROR, DeadLetterBook, Delivered, Undelivered, deliver
from modules.research_rag.chunking import parent_source_ref
from modules.research_rag.query_cache import invalidate
from modules.research_rag.replacement import REPLACE_PATH, prepare_replacement
from modules.research_rag.retrieval import EMBEDDING_MODEL, _RetrievalMixin
from modules.research_rag.session import _SessionIngestMixin

if TYPE_CHECKING:
    from modules.schemas import OrderRequest, RiskDecision

log = logging.getLogger("alphaengine.rag")

class ResearchRag(_RetrievalMixin, _SessionIngestMixin):
    """Write path + retrieval; a no-op when unconfigured."""

    def __init__(self) -> None:
        self.enabled = bool(
            settings.supabase_url
            and settings.supabase_service_role_key
            and str(settings.supabase_desk_id or "").strip()
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
        self._drop_logged_at = 0.0
        self._restarts = 0
        self._dead = DeadLetterBook()
        self._last_matches: list[dict[str, Any]] = []
        self._last_anomaly_at: datetime | None = None
        # Strong references to the session-summary tasks `_SessionIngestMixin`
        # schedules. `create_task` keeps only a weak one, so an unheld task can
        # be collected mid-`await` and its document never appears.
        self._session_tasks: set[asyncio.Task[None]] = set()

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
        # A summary still sitting out its settle is re-derivable by the
        # backfill; a task left pending when the loop closes is a shutdown
        # warning and nothing else.
        for task in list(self._session_tasks):
            task.cancel()
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
        # One queue item per LOGICAL document.  Splitting before the bounded
        # queue could accept three siblings and drop the fourth; no later code
        # could know that the set was incomplete.
        if self._loop is None:
            self._offer(document)
        else:
            self._loop.call_soon_threadsafe(self._offer, document)

    def _offer(self, document: dict[str, Any]) -> None:
        """Put one document on the queue, and keep the drain alive.

        The overflow used to be a bare counter, readable only by whoever thought
        to open ``GET /api/research/rag/status``. Nothing in the logs said the
        corpus had started losing documents, so the first evidence of a stalled
        drain was a query that could not find a run everybody remembered making.
        The drop now says so, rate-limited to once a minute the way the order
        mirror's is — a warning printed once per dropped document during a burst
        is a warning nobody reads.
        """
        self._ensure_drain_alive()
        try:
            self._queue.put_nowait(document)
        except asyncio.QueueFull:
            self._dropped += 1
            now = time.monotonic()
            if now - self._drop_logged_at > 60:
                self._drop_logged_at = now
                log.warning(
                    "research index queue full (max %d); %d documents dropped so far, "
                    "latest %s/%s — nothing is indexing fast enough to keep up",
                    self._queue.maxsize, self._dropped,
                    document.get("kind"), document.get("source_ref"),
                )

    def _ensure_drain_alive(self) -> None:
        """Revive a drain task that ended, whatever ended it.

        ``_drain`` guards every document, so this should be unreachable — which
        is exactly why it is here. The failure it insures against has happened
        once already: an exception escaping the loop killed the task, ``running``
        went False, and every later submission sat in the queue until the process
        was restarted, with nothing indexing and nothing saying so. A supervisor
        on the SUBMIT path costs one comparison per document and needs no second
        loop to watch the first one.
        """
        if self._task is None or not self._task.done() or self._client is None:
            return
        if self._loop is None or self._loop.is_closed():
            return
        self._restarts += 1
        log.error(
            "research index drain had ended (%s); restarting it — restart %d",
            self._task.exception() if not self._task.cancelled() else "cancelled",
            self._restarts,
        )
        self._task = asyncio.create_task(self._drain(), name="research-rag")

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
        # The JOB's finish time, not the render's. `JobQueue` stamps
        # `finished_at` before it fires the completion hooks, so this is always
        # present on the live path; a record that somehow lacks one says so
        # rather than letting the renderer's fallback pass unremarked.
        finished_at = getattr(record, "finished_at", None)
        if finished_at is None:
            log.warning(
                "backtest %s carried no finish time; the corpus will hold its "
                "ingest time instead",
                getattr(record, "job_id", "?"),
            )
        # The PNG travels WITH the document — `_index_one` sees a queue entry,
        # not a result. A no-op unless the image arm is configured.
        for document in attach_chart_pngs(render_backtest_documents(
            result, occurred_at=finished_at.isoformat() if finished_at else None
        ), result):
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
        """One document at a time, and NO document may end the loop.

        The guard is around the whole of ``_index_one`` on purpose rather than
        around the insert. The fault that took this task down was not the insert
        at all: ``embed_many`` catches ``httpx.HTTPError``, an HTML error page
        served with a 200 by a proxy parses as JSON only in the sense that it
        raises ``JSONDecodeError``, and that is a ``ValueError`` — so it went
        past every ``except`` in the package, out of this loop, and killed the
        task. Narrowing the guard to the exception seen once is how the same
        outage returns wearing a different exception type.

        ``CancelledError`` is re-raised, not swallowed: ``stop()`` cancels this
        task and awaits it, and a loop that catches its own cancellation hangs
        shutdown forever.
        """
        assert self._client is not None
        while True:
            document = await self._queue.get()
            try:
                await self._index_one(document)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._failed += 1
                self._dead.record(
                    document,
                    Undelivered(reason=REASON_ERROR, detail=type(exc).__name__, attempts=1),
                )
                log.error(
                    "research document %s/%s not indexed (%s: %s); dead-lettered, "
                    "the drain continues",
                    document.get("kind"), document.get("source_ref"),
                    type(exc).__name__, exc,
                )

    async def _index_one(self, document: dict[str, Any]) -> None:
        """Atomically replace one logical document, then write its sidecars."""
        assert self._client is not None
        prepared = await prepare_replacement(
            document, desk_id=settings.supabase_desk_id,
            embedding_model=EMBEDDING_MODEL, embed=self._embed,
        )
        outcome = await deliver(
            self._client, prepared.payload, path=REPLACE_PATH,
            prefer="return=representation", identity=document,
        )
        if not isinstance(outcome, Delivered):
            # Counted AND kept. The counter alone said a number of documents had
            # been lost and never which ones, so there was nothing to replay and
            # no way to tell a rejected schema from an unreachable corpus.
            self._failed += 1
            self._dead.record(document, outcome)
            log.error(
                "research document %s/%s gave up after %d attempts (%s: %s); dead-lettered",
                document.get("kind"), document.get("source_ref"),
                outcome.attempts, outcome.reason, outcome.detail,
            )
            return
        invalidate(self)
        if not prepared.pending:
            await persist_edges(self._client, outcome.response, desk_id=settings.supabase_desk_id)
        # The chart's pixels, keyed to the document that just landed, so an
        # answer can show the model a chart drawn by a Celery worker or by a
        # process that has since restarted. Separate table, separate request,
        # after the document is safe — `research_image_store_write` argues why.
        if prepared.chart is not None and not prepared.pending:
            chart_png, chart_document = prepared.chart
            await persist_chart_image(self._client, outcome.response, chart_png, chart_document)
        self._indexed += prepared.indexed
        self._pending += prepared.pending
        if prepared.retrieve is not None:
            vector, retrieved_document = prepared.retrieve
            # Always scope the neighbour read to the row just written.
            matches = await self._match(vector, match_count=3, desk_id=settings.supabase_desk_id)
            # The document itself is in the index now; drop self-matches.
            self._last_matches = [
                m for m in matches if m.get("source_ref") != parent_source_ref(retrieved_document)
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
            # Depth, not just a count of failures: a document that failed is
            # somewhere, and an operator needs to know there is something to
            # replay before they can decide to replay it.
            "dead_lettered": self._dead.depth,
            "dead_letters_discarded": self._dead.discarded,
            "dead_letters": self._dead.recent(),
            "drain_restarts": self._restarts,
            "last_anomaly_at": self._last_anomaly_at.isoformat() if self._last_anomaly_at else None,
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
