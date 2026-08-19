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

ANOMALY_GATES = {"est_slippage", "daily_drawdown"}


# --------------------------------------------------------------------------- #
# cards — the exact text that gets embedded
# --------------------------------------------------------------------------- #
def _line(label: str, value: Any) -> str:
    return f"{label}: {value}"


def render_backtest_card(row: dict[str, Any]) -> tuple[str, str]:
    """(title, body) for one ``backtest_runs`` row (audit-log column names)."""
    title = (
        f"Backtest {row.get('symbol')} {row.get('interval')} "
        f"{row.get('strategy')} {row.get('best_fast')}/{row.get('best_slow')}"
    )
    dsr = row.get("dsr")
    oos = row.get("oos_sharpe")
    body = "\n".join([
        title,
        _line("Engine", row.get("engine")),
        _line("Combinations tested", row.get("combos_tested")),
        _line("Best Sharpe", row.get("sharpe")),
        _line("Total return", row.get("total_return")),
        _line("Max drawdown", row.get("max_drawdown")),
        _line("Deflated Sharpe (DSR)", "not computed" if dsr is None else dsr),
        _line("Walk-forward OOS Sharpe", "not computed" if oos is None else oos),
        _line("Overfit probability (PBO)", row.get("pbo") if row.get("pbo") is not None else "not computed"),
        _line("Data hash", row.get("data_hash") or "unrecorded"),
        _line("Job", row.get("job_id")),
    ])
    return title, body


def render_ml_card(run: dict[str, Any]) -> tuple[str, str]:
    """(title, body) for one supervised run.

    Deliberately shaped like ``render_backtest_card`` — same vocabulary, same
    order, so an ML run and a sweep retrieved by the same query read as two
    answers to one question rather than two kinds of document.

    Three lines exist here that a sweep has no equivalent for, and each is the
    reason this is its own kind. The ENGINE says whether the hand-rolled models
    or the optional scikit-learn ran, because a run that fell back is a
    different run. The FEATURES line carries the spec hash, which is what makes
    two runs comparable at all. And the PURGE is stated per fold, because an
    out-of-sample Sharpe from an unpurged fold is not an out-of-sample Sharpe.
    """
    title = (
        f"ML run {run.get('symbol')} {run.get('interval')} "
        f"{run.get('model')} seed {run.get('seed')}"
    )
    folds = run.get("folds") or []
    features = run.get("features") or {}
    purges = {int(f.get("purge_bars", 0)) for f in folds}
    purge = (
        "no folds recorded" if not folds
        else f"{purges.pop()} bars" if len(purges) == 1
        else f"{min(purges)}–{max(purges)} bars"
    )
    positive = sum(1 for f in folds if (f.get("oos_sharpe") or 0) > 0)
    body = "\n".join([
        title,
        _line("Engine", run.get("engine") or "unrecorded"),
        _line("Status", run.get("status")),
        _line("Out-of-sample Sharpe", run.get("oos_sharpe") if run.get("oos_sharpe") is not None else "not computed"),
        _line("Deflated Sharpe (DSR)", run.get("deflated_sharpe") if run.get("deflated_sharpe") is not None else "not computed"),
        _line("Overfit probability (PBO)", run.get("pbo") if run.get("pbo") is not None else "not computed"),
        _line("Folds", f"{positive} of {len(folds)} positive out-of-sample" if folds else "none recorded"),
        _line("Purge per fold", purge),
        _line(
            "Features",
            f"{features.get('feature_count')} predicting {features.get('label')} "
            f"over {features.get('label_horizon_bars')} bars, spec {features.get('spec_hash', '')[:8]}"
            if features else "unrecorded",
        ),
        _line("Data hash", run.get("data_hash") or "unrecorded"),
        _line("Build", run.get("git_sha")[:8] if run.get("git_sha") else "unrecorded"),
    ])
    return title, body


def render_incident_card(
    kind: str, decision: RiskDecision, request: OrderRequest, detail: str
) -> tuple[str, str]:
    """(title, body) for an execution anomaly / risk incident."""
    title = f"{kind}: {decision.symbol} {decision.side} order {decision.order_id}"
    fill = decision.fill
    body = "\n".join([
        title,
        _line("Detail", detail),
        _line("Accepted", decision.accepted),
        _line("Rejected by", ", ".join(decision.rejected_by) or "—"),
        _line("Notional", decision.notional),
        _line("Realised slippage bps", fill.slippage_bps if fill else "no fill"),
        _line("Venue", fill.venue if fill else "—"),
        _line("Decision latency ms", decision.latency_ms),
        _line("Strategy", request.strategy or "untagged"),
        _line("At", decision.timestamp.isoformat()),
    ])
    return title, body


def classify_anomaly(decision: RiskDecision) -> str | None:
    """The precise trigger definition; None means no anomaly."""
    fill = decision.fill
    if (
        decision.accepted
        and fill is not None
        and fill.slippage_bps is not None
        and fill.slippage_bps > settings.max_est_slippage_bps
    ):
        return (
            f"realised slippage {fill.slippage_bps:.2f} bps exceeded the "
            f"{settings.max_est_slippage_bps:.0f} bps pre-trade ceiling"
        )
    if not decision.accepted and ANOMALY_GATES.intersection(decision.rejected_by):
        gates = ", ".join(sorted(ANOMALY_GATES.intersection(decision.rejected_by)))
        return f"rejected by {gates}"
    return None


# --------------------------------------------------------------------------- #
# the index
# --------------------------------------------------------------------------- #
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
        if not self.enabled:
            return
        try:
            self._queue.put_nowait(document)
        except asyncio.QueueFull:
            self._dropped += 1

    def on_backtest_complete(self, record: Any) -> None:
        """`queue.on_complete` hook — same seam the Telegram push uses."""
        if not self.enabled or getattr(record, "kind", None) != "backtest":
            return
        result = getattr(record, "result", None)
        if result is None:
            return
        try:
            row = {
                "symbol": result.request.symbol,
                "interval": result.request.interval,
                "strategy": result.request.strategy,
                "engine": result.engine,
                "combos_tested": result.combos_tested,
                "best_fast": result.best.fast,
                "best_slow": result.best.slow,
                "sharpe": result.best.sharpe,
                "total_return": result.best.total_return,
                "max_drawdown": result.best.max_drawdown,
                "dsr": result.deflated_sharpe_ratio,
                "oos_sharpe": result.walk_forward_oos_sharpe,
                "pbo": getattr(result, "pbo", None),
                "data_hash": result.data_hash,
                "job_id": result.job_id,
            }
        except AttributeError:
            return
        title, body = render_backtest_card(row)
        self._submit({
            "kind": "backtest_run",
            "source_ref": str(row["job_id"]),
            "symbol": row["symbol"],
            "interval": row["interval"],
            "strategy": row["strategy"],
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "title": title,
            "body": body,
            "metrics": {
                k: row[k]
                for k in ("sharpe", "dsr", "oos_sharpe", "pbo", "combos_tested")
            },
            "data_hash": row["data_hash"],
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
                    headers={
                        "Prefer": "resolution=ignore-duplicates,return=minimal"
                    },
                )
                if response.status_code < 300:
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
        }

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
