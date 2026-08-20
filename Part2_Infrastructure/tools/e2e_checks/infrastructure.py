"""Gateway-side checks: health, venue feeds, auth, the decision histogram.

Split out of ``tools/e2e_smoke.py``. Every check names its own fix — a red line
that just says "failed" ends nothing.
"""

from __future__ import annotations

from tools.e2e_checks.transport import FAIL, GATEWAY, OK, SKIP, Result, fetch


def check_gateway_health() -> Result:
    status, body, ms = fetch(f"{GATEWAY}/health")
    if status != 200 or not isinstance(body, dict):
        return Result(
            "gateway /health", FAIL, f"HTTP {status} in {ms:.0f}ms",
            fix="Is the container up? ssh in and run `docker ps`. "
                "To redeploy: gh workflow run 'Deploy gateway to OCI'",
        )
    tca = body.get("modules", {}).get("A_tca", {})
    uptime_h = tca.get("uptime_s", 0) / 3600
    return Result(
        "gateway /health", OK,
        f"{body.get('status')} · {body.get('environment')} · up {uptime_h:.1f}h · {ms:.0f}ms",
        data={"uptime_h": round(uptime_h, 2), "latency_ms": round(ms)},
    )


def check_venue_feeds() -> Result:
    status, body, _ = fetch(f"{GATEWAY}/health")
    if status != 200 or not isinstance(body, dict):
        return Result("venue feeds", FAIL, "gateway did not answer")
    feeds = body.get("modules", {}).get("A_tca", {}).get("feeds", [])
    if not feeds:
        return Result("venue feeds", FAIL, "no feeds reported", fix="Check ENABLE_MARKET_DATA and VENUES.")
    down = [f["venue"] for f in feeds if not f.get("connected")]
    stale = [
        f"{f['venue']}/{sym}"
        for f in feeds
        for sym, s in (f.get("symbols") or {}).items()
        if s.get("stale")
    ]
    if down:
        return Result(
            "venue feeds", FAIL, f"disconnected: {', '.join(down)}",
            fix="A venue going dark is a trading condition — quotes from a stale book are not safe to size against.",
        )
    detail = " · ".join(f"{f['venue']} {len(f.get('symbols') or {})} symbols" for f in feeds)
    if stale:
        return Result("venue feeds", FAIL, f"connected but stale: {', '.join(stale)}")
    return Result("venue feeds", OK, detail)


def check_gateway_auth(token: str | None) -> Result:
    """Auth must actually be enforced. A gateway that answers unauthenticated is
    a public order-entry endpoint, which is worse than one that is down."""
    status, _, _ = fetch(f"{GATEWAY}/api/portfolio")
    if status in (200, 201):
        return Result(
            "gateway auth", FAIL, "answered WITHOUT a token",
            fix="Set REQUIRE_AUTH=1 and WEB_API_TOKEN on the gateway. This endpoint places orders.",
        )
    if not token:
        return Result("gateway auth", SKIP, f"unauthenticated correctly refused ({status}); no token to test the accept path")
    ok_status, _, ms = fetch(f"{GATEWAY}/api/portfolio", token=token)
    if ok_status != 200:
        return Result(
            "gateway auth", FAIL, f"token rejected (HTTP {ok_status})",
            fix="WEB_API_TOKEN on the VM must equal ALPHAENGINE_GATEWAY_TOKEN in Vercel.",
        )
    return Result("gateway auth", OK, f"refused without a token, accepted with one · {ms:.0f}ms")


def check_decision_histogram(token: str | None) -> Result:
    status, body, _ = fetch(f"{GATEWAY}/metrics", token=token)
    if status != 200 or not isinstance(body, str):
        return Result("decision latency metrics", FAIL, f"HTTP {status}")
    if "alphaengine_decision_samples_total" not in body:
        return Result(
            "decision latency metrics", FAIL, "series missing",
            fix="modules/metrics.py should export decision_latency_us; is the deployed image current?",
        )
    line = next((x for x in body.splitlines() if x.startswith("alphaengine_decision_samples_total ")), "")
    samples = line.rsplit(" ", 1)[-1] if line else "?"
    if samples in ("0", "?"):
        return Result(
            "decision latency metrics", OK,
            "series present, 0 samples (no orders since restart — quantiles correctly absent)",
        )
    quantiles = [x for x in body.splitlines() if x.startswith("alphaengine_decision_latency_us")]
    return Result("decision latency metrics", OK, f"{samples} decisions, {len(quantiles)} quantiles published")
