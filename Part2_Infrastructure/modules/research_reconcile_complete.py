"""Deploy-only, zero-grace walk of the complete desk-scoped research corpus.

The scheduled reconciler intentionally visits one recent-grace-bounded window.
A deployment bootstrap has a different contract: rebuild every document that
exists at one fixed horizon, then prove that the population did not change
while it was being walked.  This module composes repeated ``sweep_edges`` calls;
it does not introduce another linker or graph writer.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

from modules.research_corpus_reads import _backlog, _iso, _query
from modules.research_reconcile import MAX_CANDIDATES_PER_DOCUMENT, sweep_edges

DEFAULT_BATCH_SIZE = 200
DEFAULT_MAX_DOCUMENTS = 10_000
DEFAULT_MAX_SECONDS = 150.0

Sweep = Callable[..., Awaitable[dict[str, Any]]]
Count = Callable[..., Awaitable[tuple[int | None, str]]]


def _report(now_ms: float, *, batch_size: int, max_documents: int, max_seconds: float) -> dict[str, Any]:
    return {
        "scope": "complete_edges",
        "swept_at": _iso(now_ms),
        "reachable": True,
        "complete": False,
        "eligible_documents": None,
        "documents_swept": 0,
        "documents_not_assessable": 0,
        "cursor": None,
        "wrapped": False,
        "deferred": None,
        "edges_derived": 0,
        "edges_written": 0,
        "edges_already_present": 0,
        "writes_failed": 0,
        "batches": 0,
        "why": None,
        "bounds": {
            "batch_size": batch_size,
            "max_documents": max_documents,
            "max_seconds": max_seconds,
            "grace_ms": 0,
        },
        "graph": {"projected": False, "documents": 0, "edges": 0, "reason": None},
    }


def _refuse(report: dict[str, Any], reason: str, *, reachable: bool | None = None) -> dict[str, Any]:
    report["complete"] = False
    report["why"] = reason
    if reachable is not None:
        report["reachable"] = reachable
    return report


def _add_nullable(report: dict[str, Any], page: dict[str, Any], key: str) -> None:
    if report[key] is None or page.get(key) is None:
        report[key] = None
    else:
        report[key] = int(report[key]) + int(page.get(key) or 0)


def _accept_page(report: dict[str, Any], page: dict[str, Any]) -> str | None:
    """Accumulate a clean page; return the reason when it cannot prove itself."""
    report["batches"] += 1
    report["documents_not_assessable"] += int(page.get("documents_not_assessable") or 0)
    report["writes_failed"] += int(page.get("writes_failed") or 0)
    report["edges_derived"] += int(page.get("edges_derived") or 0)
    _add_nullable(report, page, "edges_written")
    _add_nullable(report, page, "edges_already_present")
    if not page.get("reachable"):
        return str(page.get("why") or "a corpus page could not be read")
    if int(page.get("documents_not_assessable") or 0):
        return "a corpus page left documents not assessable"
    if int(page.get("writes_failed") or 0):
        return "authoritative edge writes failed in a corpus page"

    swept = int(page.get("documents_swept") or 0)
    if swept == 0:
        return None if page.get("wrapped") else "a corpus page made no progress"
    projection = page.get("graph") if isinstance(page.get("graph"), dict) else {}
    if not projection.get("projected"):
        return str(projection.get("reason") or "Neo4j projection failed in a corpus page")
    if int(projection.get("documents") or 0) != swept:
        return "Neo4j projected a different document count than a corpus page"
    report["documents_swept"] += swept
    report["graph"]["projected"] = True
    report["graph"]["documents"] += int(projection.get("documents") or 0)
    report["graph"]["edges"] += int(projection.get("edges") or 0)
    report["graph"]["reason"] = report["graph"]["reason"] or projection.get("reason")
    return None


async def _eligible_count(client: Any, *, desk_id: str, horizon: str) -> tuple[int | None, str]:
    return await _backlog(client, _query(desk_id=desk_id, cursor=None, horizon=horizon))


async def _walk(
    client: Any,
    report: dict[str, Any],
    *,
    desk_id: str,
    now_ms: float,
    batch_size: int,
    max_documents: int,
    sweep_fn: Sweep,
    count_fn: Count,
) -> dict[str, Any]:
    horizon = _iso(now_ms)
    eligible, count_reason = await count_fn(client, desk_id=desk_id, horizon=horizon)
    if eligible is None:
        return _refuse(report, f"the zero-grace corpus could not be counted ({count_reason})", reachable=False)
    report["eligible_documents"] = eligible
    if eligible > max_documents:
        return _refuse(report, f"eligible corpus exceeds the {max_documents}-document deploy safety ceiling")

    cursor: dict[str, Any] | None = None
    while report["documents_swept"] < eligible:
        remaining = eligible - int(report["documents_swept"])
        page = await sweep_fn(
            client,
            desk_id=desk_id,
            now_ms=now_ms,
            cursor=cursor,
            max_documents=min(batch_size, remaining),
            candidates=MAX_CANDIDATES_PER_DOCUMENT,
            grace_ms=0.0,
        )
        reason = _accept_page(report, page)
        if reason:
            return _refuse(report, reason, reachable=bool(page.get("reachable")))
        next_cursor = page.get("cursor")
        if report["documents_swept"] >= eligible and not page.get("wrapped") and page.get("deferred") != 0:
            return _refuse(report, "the final corpus page did not prove that the cursor was exhausted")
        if report["documents_swept"] < eligible:
            if not isinstance(next_cursor, dict) or next_cursor == cursor:
                return _refuse(report, "the complete-corpus cursor did not advance")
            cursor = next_cursor
            report["cursor"] = cursor

    verified, verify_reason = await count_fn(client, desk_id=desk_id, horizon=horizon)
    if verified is None:
        return _refuse(report, f"the completed corpus could not be recounted ({verify_reason})", reachable=False)
    if verified != eligible or report["documents_swept"] != verified:
        return _refuse(report, "the zero-grace corpus changed or was skipped during the deploy sweep")
    report.update({"complete": True, "wrapped": True, "cursor": None, "deferred": 0, "why": None})
    return report


async def sweep_to_exhaustion(
    client: Any,
    *,
    desk_id: str,
    now_ms: float,
    batch_size: int = DEFAULT_BATCH_SIZE,
    max_documents: int = DEFAULT_MAX_DOCUMENTS,
    max_seconds: float = DEFAULT_MAX_SECONDS,
    sweep_fn: Sweep = sweep_edges,
    count_fn: Count = _eligible_count,
) -> dict[str, Any]:
    """Walk and verify one fixed zero-grace snapshot, bounded in size and time."""
    report = _report(now_ms, batch_size=batch_size, max_documents=max_documents, max_seconds=max_seconds)
    if client is None:
        return _refuse(report, "the research corpus is not configured", reachable=False)
    if batch_size < 1 or max_documents < 1 or max_seconds <= 0:
        return _refuse(report, "complete-corpus bounds must be positive")
    try:
        return await asyncio.wait_for(
            _walk(
                client,
                report,
                desk_id=desk_id,
                now_ms=now_ms,
                batch_size=batch_size,
                max_documents=max_documents,
                sweep_fn=sweep_fn,
                count_fn=count_fn,
            ),
            timeout=max_seconds,
        )
    except TimeoutError:
        return _refuse(report, f"complete-corpus sweep exceeded its {max_seconds:g}-second safety bound")


def reconcile_graph_complete(
    *,
    desk_id: str,
    batch_size: int = DEFAULT_BATCH_SIZE,
    max_documents: int = DEFAULT_MAX_DOCUMENTS,
    max_seconds: float = DEFAULT_MAX_SECONDS,
    now_ms: float | None = None,
    job_id: str | None = None,
) -> dict[str, Any]:
    """Configured synchronous adapter used only by the deploy one-shot."""
    del job_id
    from config import settings

    stamp_ms = now_ms if now_ms is not None else time.time() * 1000.0
    key = settings.supabase_service_role_key
    if not (settings.supabase_url and key):
        report = _report(stamp_ms, batch_size=batch_size, max_documents=max_documents, max_seconds=max_seconds)
        return _refuse(report, "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset", reachable=False)

    import httpx

    async def _run() -> dict[str, Any]:
        headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(
            base_url=settings.supabase_url.rstrip("/"), headers=headers, timeout=settings.supabase_timeout_s,
        ) as client:
            return await sweep_to_exhaustion(
                client,
                desk_id=desk_id,
                now_ms=stamp_ms,
                batch_size=batch_size,
                max_documents=max_documents,
                max_seconds=max_seconds,
            )

    return asyncio.run(_run())
