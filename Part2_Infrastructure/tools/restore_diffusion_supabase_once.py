#!/usr/bin/env python3
"""Restore and verify the complete Diffusion evidence ledger in Supabase.

The live gateway remains on its durable SQLite volume.  This bounded deployment
one-shot gives Supabase the same tenant-scoped 62 events, 62 issuer statements,
248 measured runs, and four spectrum studies without making a remote database
part of request-time availability.  Oracle is intentionally not a target: its
contract in this repository is the independent VaR calculation, not Diffusion.
"""

from __future__ import annotations

import json

from config import settings
from modules.coherence.diffusion.bootstrap import EXPECTED_COUNTS, restore_verified_fomc
from modules.data_ops_postgrest import PostgrestStore


def main() -> int:
    desk_id = settings.supabase_desk_id.strip()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise SystemExit("Supabase diffusion restore needs the configured repository pair")
    if not desk_id or desk_id.lower() == "default":
        raise SystemExit("Supabase diffusion restore needs a non-default SUPABASE_DESK_ID")

    store = PostgrestStore(
        settings.supabase_url,
        settings.supabase_service_role_key,
        desk_id=desk_id,
    )
    try:
        result = restore_verified_fomc(store)
    finally:
        store.close()

    counts = {
        name: table.final_present
        for name, table in result.tables.items()
    }
    if counts != EXPECTED_COUNTS:
        raise SystemExit("Supabase diffusion restore did not reach the verified manifest counts")
    print(json.dumps({
        "backend": result.backend,
        "dataset_id": result.dataset_id,
        "tables": counts,
    }, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
