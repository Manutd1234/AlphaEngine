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
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable

# Defaults mirror docs/FEATURE_TOUR.md; the env vars are authoritative when the
# deployment moves — a stale default here must fail loudly, not silently probe
# the wrong host.
GATEWAY = os.environ.get("E2E_GATEWAY_URL", "http://149.118.48.255:8000").rstrip("/")
VERCEL = os.environ.get("E2E_VERCEL_URL", "https://alphaengine-workspace.vercel.app").rstrip("/")
TIMEOUT = float(os.environ.get("E2E_TIMEOUT", "20"))

OK, FAIL, SKIP = "ok", "fail", "skip"


@dataclass
class Result:
    name: str
    state: str
    detail: str = ""
    fix: str = ""
    data: dict[str, Any] = field(default_factory=dict)


def fetch(
    url: str, *, token: str | None = None, method: str = "GET", body: dict | None = None
) -> tuple[int, Any, float]:
    """Returns (status, parsed-or-text, elapsed_ms). Never raises for HTTP status."""
    payload = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=payload, method=method)
    request.add_header("User-Agent", "alphaengine-e2e/1.0")
    if payload is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")

    # The gateway is plain HTTP; Vercel and Supabase are TLS. Default context.
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT, context=ssl.create_default_context()) as response:
            raw = response.read().decode("utf-8", "replace")
            status = response.status
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        status = error.code
    except Exception as error:  # noqa: BLE001 — a transport failure is a result, not a crash
        return 0, str(error), (time.perf_counter() - started) * 1000
    elapsed = (time.perf_counter() - started) * 1000
    try:
        return status, json.loads(raw), elapsed
    except json.JSONDecodeError:
        return status, raw, elapsed


# --------------------------------------------------------------------------- #
# Checks
# --------------------------------------------------------------------------- #

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


def check_rag_embed(token: str | None) -> Result:
    """The route whose absence made Oracle RAG return embed_failed forever."""
    if not token:
        return Result("rag embed route", SKIP, "needs the gateway token")
    status, body, ms = fetch(
        f"{GATEWAY}/api/research/rag/embed", token=token, method="POST",
        body={"texts": ["donchian breakout drawdown"]},
    )
    if status != 200 or not isinstance(body, dict):
        return Result("rag embed route", FAIL, f"HTTP {status}", fix="Route added in main.py; is the image current?")
    state = body.get("state")
    if state == "unavailable":
        return Result(
            "rag embed route", SKIP, "route live, embedding service not configured",
            fix="Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and RESEARCH_RAG_ENABLED=1 on the gateway.",
        )
    vectors = body.get("embeddings") or []
    dims = len(vectors[0]) if vectors else 0
    if dims != 384:
        return Result(
            "rag embed route", FAIL, f"got {dims} dimensions, expected 384",
            fix="A dimension mismatch means the corpus and queries used different models — retrieval would rank nonsense.",
        )
    return Result("rag embed route", OK, f"{len(vectors)}x{dims}-dim vector in {ms:.0f}ms")


def check_vercel_app() -> Result:
    status, _, ms = fetch(f"{VERCEL}/")
    if status != 200:
        return Result(
            "vercel app", FAIL, f"HTTP {status}",
            fix="Check the Vercel deployment log. A missing module here usually means .vercelignore dropped it.",
        )
    return Result("vercel app", OK, f"200 in {ms:.0f}ms")


def check_vercel_to_gateway() -> Result:
    """The web→gateway hop, probed from outside instead of inferred.

    Every other gateway check in this file runs from wherever this script
    happens to execute — a GitHub runner, a laptop — and proves only that the
    gateway answers *that* caller. The hop the workspace actually depends on is
    Vercel's serverless function reaching the gateway, and nothing measured it.

    That gap is not hypothetical. The deployment spent a day serving a healthy
    gateway on both ports while every gateway-backed panel showed a degraded
    card, because the function could not verify the gateway's pinned
    certificate. `/health` was green from three other vantage points the whole
    time.

    So this asks the deployment itself, through a route that must traverse the
    hop. A 200 is proof; anything else carries the reason back, now that
    `lib/gateway.ts` names its transport failures.
    """
    status, body, ms = fetch(f"{VERCEL}/api/gateway/portfolio")
    if status == 200:
        return Result("vercel → gateway", OK, f"proxied the book in {ms:.0f}ms")

    code = body.get("code") if isinstance(body, dict) else None
    if code == "gateway_not_configured":
        # A deployment with no gateway is a documented, complete state — the
        # demo tier. Failing here would make a fork red for being a fork.
        return Result(
            "vercel → gateway", SKIP,
            "no gateway configured on this deployment",
        )

    if isinstance(body, dict):
        detail = body.get("error") or f"code {body.get('code')}"
        hint = body.get("hint")
    else:
        # An HTML body means this is not the workspace at all. Echoing 120
        # characters of markup buries that; naming it is the useful answer.
        detail = "non-JSON response — is E2E_VERCEL_URL pointing at the workspace?"
        hint = None
    return Result(
        "vercel → gateway", FAIL,
        f"HTTP {status} · {detail}",
        fix=hint or (
            "The gateway may be reachable from here and unreachable from Vercel — check "
            "ALPHAENGINE_GATEWAY_URL and NODE_EXTRA_CA_CERTS on the deployment, not the gateway host."
        ),
    )


def check_vercel_health() -> Result:
    status, body, ms = fetch(f"{VERCEL}/api/system/health")
    if status != 200 or not isinstance(body, dict):
        return Result("vercel /api/system/health", FAIL, f"HTTP {status}")
    providers = body.get("providers") or []
    ready = sum(1 for p in providers if p.get("configured"))
    return Result(
        "vercel /api/system/health", OK,
        f"{ready}/{len(providers)} providers configured · {ms:.0f}ms",
        data={"providers_ready": ready, "providers_total": len(providers)},
    )


def check_oracle() -> Result:
    """Reported through the app's own probe, so this is the panel's real state."""
    status, body, _ = fetch(f"{VERCEL}/api/system/health")
    if status != 200 or not isinstance(body, dict):
        return Result("oracle adb", FAIL, "health route unavailable")
    oracle = body.get("oracle") or {}
    if not oracle.get("configured"):
        return Result(
            "oracle adb", SKIP, "not configured in this deployment",
            fix="Set ORACLE_CONN_STRING and ORACLE_PASSWORD in Vercel.",
        )
    if oracle.get("ready"):
        return Result("oracle adb", OK, f"answered in {oracle.get('latencyMs')}ms")
    reason = oracle.get("reason") or "unknown"
    fixes = {
        "oracle_wallet_invalid":
            "This database requires mutual TLS. Set ORACLE_WALLET_PEM_B64 (base64 of ewallet.pem) "
            "and ORACLE_WALLET_PASSWORD in Vercel, or give the database a network ACL and turn mTLS off.",
        "oracle_service_unknown":
            "The listener answered but has no such service. Compare the service name in "
            "ORACLE_CONN_STRING with the console's connection strings.",
        "oracle_timeout":
            "The probe exceeded its budget. Usually mutual TLS or a wrong service name underneath — "
            "run `gh workflow run 'Keep Oracle ADB awake'` for the precise ORA code.",
        "oracle_auth_failed": "Wrong ORACLE_PASSWORD, or the account is locked or expired.",
        "oracle_schema_missing":
            "Connected, but the objects are absent. Run the 'Apply database schema' workflow.",
    }
    return Result("oracle adb", FAIL, f"configured but not ready: {reason}", fix=fixes.get(reason, ""))


def check_supabase() -> Result:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        return Result("supabase rls", SKIP, "SUPABASE_URL / anon key not in this environment")
    request = urllib.request.Request(f"{url.rstrip('/')}/rest/v1/desk_risk_limits?select=id&limit=1")
    request.add_header("apikey", key)
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            status = response.status
    except urllib.error.HTTPError as error:
        status = error.code
    except Exception as error:  # noqa: BLE001
        return Result("supabase rls", FAIL, str(error))
    if status == 200:
        return Result(
            "supabase rls", FAIL, "anon can read desk_risk_limits",
            fix="The REVOKE was lost. Publishing where the gates sit tells anyone how to size an order that passes them.",
        )
    if status in (401, 403, 404):
        return Result("supabase rls", OK, f"anon correctly denied ({status})")
    return Result("supabase rls", FAIL, f"unexpected status {status}")


def check_market_data() -> Result:
    """The backtester's own data path, through Vercel."""
    status, body, ms = fetch(f"{VERCEL}/api/ohlcv?symbol=BTCUSDT&interval=1h&bars=120")
    if status != 200 or not isinstance(body, dict):
        return Result("market data (ohlcv)", FAIL, f"HTTP {status}")
    bars = body.get("bars") or body.get("data") or []
    source = body.get("source") or body.get("provider") or "?"
    if not bars:
        return Result("market data (ohlcv)", FAIL, "no bars returned")
    synthetic = "synthetic" in json.dumps(body).lower()
    if synthetic:
        return Result(
            "market data (ohlcv)", FAIL, f"{len(bars)} bars but SYNTHETIC",
            fix="Binance was unreachable from the serverless region and a deterministic fallback was served. "
                "It is tagged as such, but it is not market data.",
        )
    return Result("market data (ohlcv)", OK, f"{len(bars)} real bars from {source} · {ms:.0f}ms")


def check_backtest() -> Result:
    """The money path: a real sweep through the deployed engine."""
    status, body, ms = fetch(
        f"{VERCEL}/api/backtest", method="POST",
        body={"symbol": "BTCUSDT", "interval": "1h", "bars": 800, "strategy": "ma_cross",
              "fastFrom": 5, "fastTo": 20, "fastStep": 5,
              "slowFrom": 30, "slowTo": 90, "slowStep": 30,
              "direction": "long_only", "feeBps": 6, "slippageBps": 2, "folds": 4},
    )
    if status != 200 or not isinstance(body, dict):
        return Result("backtest sweep", FAIL, f"HTTP {status}: {str(body)[:120]}")
    results = body.get("results") or []
    best = body.get("best") or {}
    if not results:
        return Result("backtest sweep", FAIL, "no combinations returned")
    return Result(
        "backtest sweep", OK,
        f"{len(results)} combos in {ms:.0f}ms · best Sharpe {best.get('sharpe', '?')}",
        data={"combos": len(results), "ms": round(ms)},
    )


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
