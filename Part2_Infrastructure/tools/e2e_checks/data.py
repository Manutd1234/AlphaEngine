"""Data-plane checks: the two databases, market data, a real backtest, and the
embedding route the Oracle search depends on.

Split out of ``tools/e2e_smoke.py``. Unconfigured is reported as SKIP with the
reason, never as a pass and never as an empty result.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from tools.e2e_checks.transport import FAIL, GATEWAY, OK, SKIP, TIMEOUT, VERCEL, Result, fetch


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
