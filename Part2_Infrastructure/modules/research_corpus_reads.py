"""The corpus reads a reconciliation sweep makes, and the report it fills in.

Split out of ``modules/research_reconcile.py``: that module decides WHICH
documents to re-link and this one is how it asks the corpus and what it writes
down. Separating them keeps the sweep's decision logic readable and lets the
query shape be asserted without a client.

The report is built up-front with every key present, so a caller can branch on
``reachable`` and ``documents_swept`` without probing for keys. A sweep that
returned a sparse dict on the unreachable path would make "could not sweep"
and "nothing needed sweeping" indistinguishable at the call site, which is the
one distinction this whole loop exists to preserve.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

_DOCUMENTS = "/rest/v1/research_documents"
_DOCUMENT_COLUMNS = "id,kind,symbol,strategy,occurred_at,data_hash,metrics"

log = logging.getLogger("alphaengine.research_reconcile")


def _iso(ms: float) -> str:
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).isoformat().replace("+00:00", "Z")



def _report(now_ms: float, *, max_documents: int, candidates: int) -> dict[str, Any]:
    """Every key the result carries, so a reader never has to guess at an absence."""
    return {
        "scope": "edges",
        "swept_at": _iso(now_ms),
        "reachable": True,
        "documents_swept": 0,
        "documents_not_assessable": 0,
        "cursor": None,
        "wrapped": False,
        "deferred": None,
        "deferred_reason": "not counted",
        "edges_derived": 0,
        "edges_written": 0,
        "edges_already_present": 0,
        "writes_failed": 0,
        "why": None,
        "bounds": {
            "max_documents": max_documents, "candidates_per_document": candidates,
            "pair_comparisons_at_most": max_documents * ((candidates + 1) * candidates // 2),
        },
    }


def _query(*, desk_id: str, cursor: dict[str, Any] | None, horizon: str) -> dict[str, str]:
    """Keyset pagination on ``(occurred_at, id)`` — the graph's own ordering.

    ``lt`` on the timestamp alone would skip every document sharing the boundary
    instant, and a skipped document is the defect being reconciled. The id
    tiebreak means the walk neither skips nor repeats.
    """
    params = {"select": _DOCUMENT_COLUMNS, "desk_id": f"eq.{desk_id}",
              "occurred_at": f"lt.{horizon}", "order": "occurred_at.desc,id.desc"}
    if cursor and cursor.get("occurred_at") and cursor.get("id"):
        at, doc_id = cursor["occurred_at"], cursor["id"]
        params["or"] = f"(occurred_at.lt.{at},and(occurred_at.eq.{at},id.lt.{doc_id}))"
    return params


async def _fetch(client: Any, params: dict[str, str], limit: int) -> list[dict[str, Any]] | None:
    """The batch, or ``None`` when the corpus could not be read. Never ``[]`` for a failure."""
    try:
        response = await client.get(_DOCUMENTS, params={**params, "limit": str(limit)})
        rows = response.json() if getattr(response, "status_code", 599) < 300 else None
    except Exception as exc:
        log.warning("research reconcile: corpus read failed (%s)", type(exc).__name__)
        return None
    return rows if isinstance(rows, list) else None


async def _backlog(client: Any, params: dict[str, str]) -> tuple[int | None, str]:
    """How many documents this tick deferred. ``None`` with a reason, never 0."""
    head = getattr(client, "head", None)
    if head is None:
        return None, "the client cannot take a count"
    try:
        response = await head(_DOCUMENTS, params={**params, "select": "id", "limit": "1"},
                              headers={"Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"})
    except Exception as exc:
        return None, f"{type(exc).__name__} counting the remainder"
    if getattr(response, "status_code", 599) >= 400:
        return None, f"HTTP {response.status_code} counting the remainder"
    total = str(response.headers.get("content-range", "")).split("/")[-1]
    return (int(total), "counted") if total.isdigit() else (None, "the store returned no exact count")
