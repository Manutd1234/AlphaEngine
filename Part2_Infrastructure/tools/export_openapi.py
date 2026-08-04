#!/usr/bin/env python3
"""
Export the gateway's OpenAPI schema to a committed snapshot.

The web workspace and the Telegram companion are both clients of this API, and
neither is type-checked against it at build time. A committed schema turns an
accidental contract change into a diff a reviewer sees: rename a field, drop a
route, tighten a bound, and ``tests/test_openapi_contract.py`` fails until the
snapshot is regenerated deliberately.

    python tools/export_openapi.py            # rewrite tools/openapi.json
    python tools/export_openapi.py --check    # exit 1 if it is out of date

Generating the schema only needs the app object, not a running server — no
lifespan, no market data, no network.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# The schema must describe the code, not one machine's deployment: a developer's
# .env would otherwise bake its symbol list and webhook path into the snapshot.
os.environ.setdefault("ENABLE_MARKET_DATA", "0")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "")

OUT = ROOT / "tools" / "openapi.json"


def build_schema() -> dict:
    from main import app

    return app.openapi()


def render(schema: dict) -> str:
    # Sorted keys and a trailing newline so the diff shows real contract changes
    # rather than dictionary ordering churn.
    return json.dumps(schema, indent=2, sort_keys=True) + "\n"


def main(argv: list[str]) -> int:
    rendered = render(build_schema())

    if "--check" in argv:
        if not OUT.exists():
            print(f"missing snapshot: {OUT.relative_to(ROOT)} — run tools/export_openapi.py", file=sys.stderr)
            return 1
        if OUT.read_text() != rendered:
            print(f"{OUT.relative_to(ROOT)} is out of date — run tools/export_openapi.py", file=sys.stderr)
            return 1
        print(f"{OUT.relative_to(ROOT)} matches the live schema")
        return 0

    OUT.write_text(rendered)
    paths = len(json.loads(rendered).get("paths", {}))
    print(f"wrote {OUT.relative_to(ROOT)} ({paths} paths, {OUT.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
