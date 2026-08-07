"""Replay the audit log's backtest history into the pgvector research index.

The corpus already exists: ``backtest_runs`` has been accumulating DSR,
OOS Sharpe, PBO, ``request_json`` and ``data_hash`` since the table was
written. This tool turns that audit table into a research index with no new
instrumentation — and re-embeds any document previously stored
``embedding_status='pending'`` (the honest record of an embed outage).

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

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import settings  # noqa: E402
from modules.audit import get_audit  # noqa: E402
from modules.research_rag import (  # noqa: E402
    EMBEDDING_MODEL,
    get_rag,
    render_backtest_card,
)


async def backfill(limit: int) -> int:
    rag = get_rag()
    if not rag.enabled:
        print("Supabase RAG is not configured (SUPABASE_URL / key / RESEARCH_RAG_ENABLED).")
        return 1

    await rag.start()
    audit = get_audit()
    rows = audit.recent_backtests(limit=limit)
    print(f"{len(rows)} backtest rows in the audit log")

    written = pending = 0
    assert rag._client is not None  # started above
    for row in rows:
        title, body = render_backtest_card(row)
        vector = await rag._embed(body)
        payload = {
            "desk_id": settings.supabase_desk_id,
            "kind": "backtest_run",
            "source_ref": str(row.get("job_id")),
            "symbol": row.get("symbol"),
            "interval": row.get("interval"),
            "strategy": row.get("strategy"),
            "occurred_at": (
                row.get("ts").isoformat()
                if isinstance(row.get("ts"), datetime)
                else str(row.get("ts") or datetime.now(timezone.utc).isoformat())
            ),
            "title": title,
            "body": body,
            "metrics": {
                key: row.get(key)
                for key in ("sharpe", "dsr", "oos_sharpe", "pbo", "combos_tested")
            },
            "data_hash": row.get("data_hash"),
            "embedding": vector,
            "embedding_model": EMBEDDING_MODEL if vector else None,
            "embedding_status": "ready" if vector else "pending",
        }
        response = await rag._client.post(
            "/rest/v1/research_documents",
            json=payload,
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )
        if response.status_code < 300:
            if vector:
                written += 1
            else:
                pending += 1
        else:
            print(f"  ! {row.get('job_id')}: HTTP {response.status_code}")

    await rag.stop()
    print(f"indexed {written} with embeddings, {pending} stored pending (embed outage)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=200)
    args = parser.parse_args()
    return asyncio.run(backfill(args.limit))


if __name__ == "__main__":
    raise SystemExit(main())
