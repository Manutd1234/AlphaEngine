#!/usr/bin/env python3
"""End-to-end smoke test across every deployed surface.

    python tools/e2e_smoke.py                 # everything reachable without secrets
    python tools/e2e_smoke.py --full          # adds the authenticated gateway checks
    python tools/e2e_smoke.py --json          # machine-readable, for CI

WHAT THIS IS FOR

The unit suites prove the code is correct. They cannot prove the *deployment*
is correct, because every one of them runs against local files: a gateway that
never started, an image that never pushed, a Vercel build missing a directory
and a database that requires a wallet all pass `npm test` and `pytest`
perfectly. Those are the failures this repository has actually had.

So this asks the only question those suites cannot: with everything deployed
exactly as it is right now, does the whole path work?

EVERY CHECK NAMES ITS OWN FIX

A red line here is useless if it just says "failed". Each check reports what it
expected, what it got, and where to go — because the point of an end-to-end
probe is to end an investigation, not start one.

NOTHING HERE IS DESTRUCTIVE. Reads only: no orders, no writes, no restarts.
Safe against production, which is the only place it means anything.

Exit codes: 0 all required checks passed, 1 at least one failed. Checks that are
merely unconfigured are reported and do not fail the run — "not set up" and
"broken" are different facts and this must not conflate them.

The checks moved into ``tools/e2e_checks/`` — one module per boundary, over a
shared transport. This file kept what makes it a probe rather than a library:
the registry that says which checks run in which group, the rendering that puts
a fix under every red line, and the exit code.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Callable

# Run as a script (`venv/bin/python tools/e2e_smoke.py`), so sys.path[0] is
# `tools/` and the package below would not resolve without this.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.e2e_checks import (  # noqa: E402
    FAIL,
    GATEWAY,
    OK,
    SKIP,
    VERCEL,
    Result,
    check_backtest,
    check_decision_histogram,
    check_gateway_auth,
    check_gateway_health,
    check_market_data,
    check_oracle,
    check_rag_embed,
    check_supabase,
    check_venue_feeds,
    check_vercel_app,
    check_vercel_health,
    check_vercel_root_redirect,
    check_vercel_to_gateway,
    drill_kill_switch,
    drill_outage,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--full", action="store_true", help="include authenticated gateway checks")
    parser.add_argument(
        "--drill", action="store_true",
        help="run the reversible ops drill (simulated outage + kill switch) against the deployment",
    )
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args()

    token = os.environ.get("WEB_API_TOKEN") or os.environ.get("ALPHAENGINE_GATEWAY_TOKEN")
    if args.full and not token:
        print("--full needs WEB_API_TOKEN in the environment.", file=sys.stderr)
        return 1

    checks: list[tuple[str, Callable[[], Result]]] = [
        ("infrastructure", check_gateway_health),
        ("infrastructure", check_venue_feeds),
        ("infrastructure", lambda: check_gateway_auth(token)),
        ("infrastructure", lambda: check_decision_histogram(token)),
        ("web", check_vercel_app),
        ("web", check_vercel_root_redirect),
        ("web", check_vercel_health),
        # Runs unauthenticated and always: the proxy holds the gateway token
        # server-side, so this needs no secret — which is the point, since the
        # hop it covers is the one that had no coverage at all.
        ("web", check_vercel_to_gateway),
        ("data", check_market_data),
        ("data", check_backtest),
        ("databases", check_oracle),
        ("databases", check_supabase),
        ("research", lambda: check_rag_embed(token)),
    ]
    if args.drill:
        checks += [
            ("drill", drill_outage),
            ("drill", drill_kill_switch),
        ]

    results: list[Result] = []
    if not args.json:
        print(f"\nAlphaEngine end-to-end smoke\n  gateway {GATEWAY}\n  web     {VERCEL}\n")

    current_group = None
    for group, check in checks:
        result = check()
        results.append(result)
        if args.json:
            continue
        if group != current_group:
            print(f"  {group.upper()}")
            current_group = group
        mark = {OK: "  ok  ", FAIL: " FAIL ", SKIP: " skip "}[result.state]
        print(f"  {mark} {result.name:28} {result.detail}")
        if result.fix and result.state == FAIL:
            for line in result.fix.split(". "):
                if line.strip():
                    print(f"         -> {line.strip().rstrip('.')}.")

    failed = [r for r in results if r.state == FAIL]
    skipped = [r for r in results if r.state == SKIP]

    if args.json:
        print(json.dumps({
            "ok": not failed,
            "checks": [{"name": r.name, "state": r.state, "detail": r.detail, **r.data} for r in results],
        }, indent=2))
    else:
        print(
            f"\n  {len(results) - len(failed) - len(skipped)} passed, "
            f"{len(failed)} failed, {len(skipped)} not configured\n"
        )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
