"""The reversible operations drill: a simulated provider outage and the kill
switch, each restored before the function returns.

Split out of ``tools/e2e_smoke.py``. Mutating on purpose — this is the drill,
not the smoke, and it runs only under ``--drill``.
"""

from __future__ import annotations

import os

from tools.e2e_checks.transport import FAIL, OK, SKIP, VERCEL, Result, fetch

# --------------------------------------------------------------------------- #

def drill_outage() -> Result:
    """Simulate a provider outage, prove it propagates, restore it.

    Mutating on purpose — this is the drill, not the smoke. Everything it
    touches is reversible (the outage self-expires in 60s even if the restore
    step dies) and it runs only under --drill.
    """
    status, body, ms = fetch(
        f"{VERCEL}/api/system/actions",
        method="POST",
        token=os.environ.get("ALPHAENGINE_OPERATOR_TOKEN") or None,
        body={"action": "simulate_outage", "provider": "tiingo", "ttlMs": 60_000},
    )
    if status in (401, 503):
        return Result(
            "outage drill", SKIP,
            f"operator gate closed (HTTP {status}) — set ALPHAENGINE_OPERATOR_OPEN=1 or export ALPHAENGINE_OPERATOR_TOKEN",
        )
    if status != 200 or not isinstance(body, dict) or not body.get("ok"):
        return Result("outage drill", FAIL, f"simulate_outage answered HTTP {status}",
                      fix="Check /api/system/actions on the deployment")

    health = body.get("health") or {}
    surfaces: list[str] = []
    if "tiingo" in ((health.get("summary") or {}).get("simulated") or []):
        surfaces.append("summary")
    if any(o.get("provider") == "tiingo" for o in health.get("outages") or []):
        surfaces.append("incident-row")
    if any(
        n.get("provider") == "tiingo" and n.get("state") == "simulated_outage"
        for route in health.get("routes") or [] for n in route.get("nodes") or []
    ):
        surfaces.append("failover-graph")
    tiingo = next((p for p in health.get("providers") or [] if p.get("id") == "tiingo"), {})
    if tiingo.get("ready") is False:
        surfaces.append("provider-matrix")

    r_status, r_body, _ = fetch(
        f"{VERCEL}/api/system/actions", method="POST",
        token=os.environ.get("ALPHAENGINE_OPERATOR_TOKEN") or None,
        body={"action": "clear_outage", "provider": "tiingo"},
    )
    restored = (
        r_status == 200 and isinstance(r_body, dict)
        and not ((r_body.get("health") or {}).get("summary") or {}).get("simulated")
    )
    if not restored:
        return Result("outage drill", FAIL,
                      "restore did not clear the outage (it self-expires in 60s)",
                      fix="Clear it in Data → Providers & Capacity")
    if len(surfaces) < 3:
        return Result("outage drill", FAIL,
                      f"only {len(surfaces)} dependent surfaces reacted: {', '.join(surfaces) or 'none'}")
    return Result(
        "outage drill", OK,
        f"{ms:.0f}ms round trip · {len(surfaces)} surfaces reacted ({', '.join(surfaces)}) · restored",
        data={"latency_ms": ms, "surfaces": surfaces},
    )


def drill_kill_switch() -> Result:
    """Halt the paper gateway, prove the book shows it, resume immediately."""
    operator = os.environ.get("ALPHAENGINE_OPERATOR_TOKEN") or None
    status, _, ms = fetch(
        f"{VERCEL}/api/gateway/risk", method="POST", token=operator,
        body={"action": "halt", "confirm": "HALT", "reason": "e2e ops drill — resumes immediately"},
    )
    if status in (401, 503):
        return Result("kill-switch drill", SKIP, f"operator gate closed (HTTP {status})")
    if status != 200:
        return Result("kill-switch drill", FAIL, f"halt answered HTTP {status}")

    _, book, _ = fetch(f"{VERCEL}/api/gateway/portfolio")
    halted = isinstance(book, dict) and book.get("trading_halted") is True

    r_status, _, _ = fetch(
        f"{VERCEL}/api/gateway/risk", method="POST", token=operator,
        body={"action": "resume", "confirm": "RESUME", "reason": "e2e ops drill resume"},
    )
    _, book_after, _ = fetch(f"{VERCEL}/api/gateway/portfolio")
    resumed = isinstance(book_after, dict) and book_after.get("trading_halted") is False

    if not resumed:
        return Result("kill-switch drill", FAIL,
                      f"RESUME answered HTTP {r_status} and the book still reads halted",
                      fix="Resume manually in Risk → Controls")
    if not halted:
        return Result("kill-switch drill", FAIL,
                      "halt was accepted but the gateway book never showed trading_halted")
    return Result("kill-switch drill", OK,
                  f"halt {ms:.0f}ms · gateway refused trading · resumed clean",
                  data={"halt_ms": ms})
