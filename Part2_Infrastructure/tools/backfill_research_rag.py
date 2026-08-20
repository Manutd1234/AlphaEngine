"""Replay the desk's own run history into the pgvector research index.

The corpus already exists: ``backtest_runs`` has been accumulating DSR,
OOS Sharpe, PBO, ``request_json`` and ``data_hash`` since the table was
written, and ``ml_runs`` has been accumulating fitted models since migration
20260820090000. This tool turns both into a research index with no new
instrumentation — and re-embeds any document previously stored
``embedding_status='pending'`` (the honest record of an embed outage).

BOTH KINDS, because the corpus has two. ``ml_run`` joined the kind enum in
migration 20260820090600 and this tool emitted only ``backtest_run``, so a desk
that backfilled had a corpus in which no fitted model existed — and a query for
one came back with sweeps, ranked, looking exactly like an answer.

A fitted run is fetched WITH its folds and its feature spec, which the live
ingest path does not have to hand. The card is therefore fuller than the one
written when the run finished, and the upsert is ``merge-duplicates``, so a
backfill improves those documents rather than restating them. ``body`` and the
vector are always written together, so the stored text never stops describing
the stored vector.

Backtest CHARTS are deliberately not emitted here. The live path indexes one
document per chart from the tear sheet's own figures — trades, exposure, the
buy-and-hold line, the fold table — and the audit log carries none of them. A
backfill emitting thinner chart documents over richer ones would degrade the
corpus in the name of repairing it.

Manual and network-bound by design — never run in CI:

    SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… RESEARCH_RAG_ENABLED=1 \\
        venv/bin/python tools/backfill_research_rag.py [--limit 200]
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import settings  # noqa: E402
from modules.audit import get_audit  # noqa: E402
from modules.ml.store import MLRunStore  # noqa: E402
from modules.research_rag import (  # noqa: E402
    EMBEDDING_MODEL,
    ResearchRag,
    get_rag,
    render_backtest_card,
    render_ml_card,
)


def _stamp(value: Any) -> str:
    """An ISO timestamp, whatever shape the row carried it in."""
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value or datetime.now(timezone.utc).isoformat())


async def _store(rag: ResearchRag, payload: dict[str, Any]) -> str:
    """Embed one document and upsert it. Returns written / pending / failed.

    A failed embed is stored ``embedding_status='pending'`` with a NULL vector,
    never a zero vector — which is equidistant from everything and would come
    back as "similar" to any query. A later run of this tool picks those up.
    """
    vector = await rag._embed(payload["body"])
    assert rag._client is not None  # the caller started the client
    response = await rag._client.post(
        "/rest/v1/research_documents",
        json={
            **payload,
            "desk_id": settings.supabase_desk_id,
            "embedding": vector,
            "embedding_model": EMBEDDING_MODEL if vector else None,
            "embedding_status": "ready" if vector else "pending",
        },
        headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
    )
    if response.status_code >= 300:
        print(f"  ! {payload['kind']} {payload['source_ref']}: HTTP {response.status_code}")
        return "failed"
    return "written" if vector else "pending"


def _tally(outcome: str, written: int, pending: int) -> tuple[int, int]:
    return written + (outcome == "written"), pending + (outcome == "pending")


async def _backfill_backtests(rag: ResearchRag, limit: int) -> tuple[int, int]:
    """Every sweep the audit log holds, as a run card."""
    rows = get_audit().recent_backtests(limit=limit)
    print(f"{len(rows)} backtest rows in the audit log")
    written = pending = 0
    for row in rows:
        title, body = render_backtest_card(row)
        outcome = await _store(rag, {
            "kind": "backtest_run",
            "source_ref": str(row.get("job_id")),
            "symbol": row.get("symbol"),
            "interval": row.get("interval"),
            "strategy": row.get("strategy"),
            "occurred_at": _stamp(row.get("ts")),
            "title": title,
            "body": body,
            "metrics": {
                key: row.get(key)
                for key in ("sharpe", "dsr", "oos_sharpe", "pbo", "combos_tested")
            },
            "data_hash": row.get("data_hash"),
        })
        written, pending = _tally(outcome, written, pending)
    return written, pending


async def _backfill_ml_runs(rag: ResearchRag, limit: int) -> tuple[int, int]:
    """Every fitted run the ML store holds, as an ``ml_run`` card.

    Each run is re-read with ``get_run`` for its folds and its feature spec: the
    purge, the count of positive folds and the spec hash are what make one
    fitted run comparable with another, and the listing does not carry them.
    """
    store = MLRunStore()
    if not store.enabled:
        print("ml runs: the ML store is not configured — none indexed")
        return 0, 0
    await store.start()
    try:
        listed = await store.list_runs(limit=limit)
        if listed is None:
            # `None` is "could not read", never "there are none". Reporting an
            # unreachable store as an empty one would say this desk has never
            # fitted a model, which is a different and much worse claim.
            print("ml runs: the ML store could not be read — none indexed")
            return 0, 0
        print(f"{len(listed)} ML runs on this desk")
        written = pending = 0
        for listed_run in listed:
            run_id = str(listed_run.get("id") or "")
            if not run_id:
                continue
            full = await store.get_run(run_id)
            run = full if isinstance(full, dict) else listed_run
            title, body = render_ml_card(run)
            outcome = await _store(rag, {
                "kind": "ml_run",
                "source_ref": run_id,
                "symbol": run.get("symbol"),
                "interval": run.get("interval"),
                "strategy": run.get("model"),
                "occurred_at": _stamp(run.get("finished_at") or run.get("started_at")),
                "title": title,
                "body": body,
                "metrics": {
                    key: run.get(key)
                    for key in ("oos_sharpe", "deflated_sharpe", "pbo", "engine")
                },
                "data_hash": run.get("data_hash"),
            })
            written, pending = _tally(outcome, written, pending)
        return written, pending
    finally:
        await store.stop()


async def backfill(limit: int) -> int:
    rag = get_rag()
    if not rag.enabled:
        print("Supabase RAG is not configured (SUPABASE_URL / key / RESEARCH_RAG_ENABLED).")
        return 1

    await rag.start()
    try:
        sweeps_written, sweeps_pending = await _backfill_backtests(rag, limit)
        runs_written, runs_pending = await _backfill_ml_runs(rag, limit)
    finally:
        await rag.stop()

    written = sweeps_written + runs_written
    pending = sweeps_pending + runs_pending
    print(f"indexed {written} with embeddings, {pending} stored pending (embed outage)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=200)
    args = parser.parse_args()
    return asyncio.run(backfill(args.limit))


if __name__ == "__main__":
    raise SystemExit(main())
