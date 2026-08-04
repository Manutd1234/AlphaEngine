#!/usr/bin/env python3
"""
Synthetic probe: walk the money path and prove it still works end to end.

Unit tests answer "is each part correct". This answers the question an operator
actually asks after a deploy — "can a trader get a price, cost it, and have the
risk gate stop a bad order, right now" — by exercising the whole chain in one
pass and timing each step.

    python tools/synthetic_probe.py                      # in-process, offline
    python tools/synthetic_probe.py --url http://host    # against a deployment
    python tools/synthetic_probe.py --token $TOKEN       # when REQUIRE_AUTH=1

Exit code is 0 only if every step passes, so it drops straight into CI or a
cron. The in-process mode needs no server and no network: with market data
disabled the gateway serves a clearly-tagged synthetic book, which is enough to
prove the wiring even where no venue is reachable.

The order step deliberately submits a *rejectable* order. A probe that placed a
fillable one would move the paper book every time it ran; asserting that the
fat-finger gate fires tests more of the system and leaves no position behind.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

PASS, FAIL = "PASS", "FAIL"


class Probe:
    """Runs steps in order, timing each, and remembers the first failure."""

    def __init__(self, get: Callable[..., Any], post: Callable[..., Any]) -> None:
        self.get, self.post = get, post
        self.results: list[tuple[str, str, float, str]] = []

    def step(self, name: str, fn: Callable[[], str]) -> bool:
        started = time.perf_counter()
        try:
            detail = fn()
            status = PASS
        except Exception as exc:
            detail, status = f"{type(exc).__name__}: {exc}", FAIL
        elapsed = (time.perf_counter() - started) * 1000
        self.results.append((name, status, elapsed, detail))
        print(f"  {status}  {name:<28} {elapsed:7.1f} ms   {detail}")
        return status == PASS

    @property
    def ok(self) -> bool:
        return all(status == PASS for _, status, _, _ in self.results)


def run(probe: Probe, symbol: str) -> bool:
    print(f"\nmoney-path probe · {symbol}\n" + "-" * 72)

    def health() -> str:
        body = probe.get("/health")
        modules = body["modules"]
        assert {"A_tca", "B_risk", "C_backtest"} <= set(modules), "a module is missing from /health"
        return f"status={body['status']} audit={body['audit']['backend']}"

    def metrics() -> str:
        text = probe.get("/metrics", raw=True)
        assert "alphaengine_kill_switch_active" in text, "risk state is not exported"
        samples = [ln for ln in text.splitlines() if ln and not ln.startswith("#")]
        return f"{len(samples)} samples exported"

    def book() -> str:
        books = probe.get(f"/api/book/{symbol}?depth=5")
        assert books, "no venue returned a book"
        top = books[0]
        assert top["bids"] and top["asks"], "book has an empty side"
        assert top["bids"][0]["price"] < top["asks"][0]["price"], "crossed book"
        tag = " (synthetic)" if top.get("synthetic") else ""
        return f"{len(books)} venue(s), spread ok{tag}"

    def tca() -> str:
        report = probe.get(f"/api/tca/{symbol}?side=BUY&notional=50000")
        assert report["smart_route"], "router produced no legs"
        vwap, mid = report["smart_route_vwap"], report["consolidated_mid"]
        # A buy should cost at least the mid. Tolerance of 1 bp because the
        # consolidated mid is depth-weighted across venues and can sit a hair
        # above one venue's ask during a genuine cross — a market condition the
        # router already handles, not a defect for a probe to fail on.
        assert vwap >= mid * (1 - 1e-4), f"routed buy VWAP {vwap} is below the consolidated mid {mid}"
        return f"vwap={vwap:.2f} mid={mid:.2f} slip={report.get('smart_route_slippage_bps')}"

    def risk_gate() -> str:
        # 100x the fat-finger cap: this must be refused by max_order_notional.
        limits = probe.get("/api/risk/limits")
        notional = limits["max_order_notional_usd"] * 100
        decision = probe.post("/api/orders", {
            "symbol": symbol, "side": "BUY", "notional": notional, "order_type": "MARKET",
        })
        assert decision["accepted"] is False, "the fat-finger gate let a 100x order through"
        assert "max_order_notional" in decision["rejected_by"], f"rejected by {decision['rejected_by']}"
        assert decision["checks"], "no check vector returned"
        return f"blocked ${notional:,.0f} in {decision['latency_ms']:.2f} ms"

    def audit_trail() -> str:
        rows = probe.get("/api/audit/orders?limit=5")
        assert rows, "the rejected order left no audit record"
        assert any(not row["accepted"] for row in rows), "no rejection in the recent audit trail"
        return f"{len(rows)} recent decisions persisted"

    for name, fn in (
        ("gateway health", health),
        ("metrics exposition", metrics),
        ("order book", book),
        ("execution cost (TCA)", tca),
        ("risk gate rejects", risk_gate),
        ("audit trail", audit_trail),
    ):
        if not probe.step(name, fn) and name == "gateway health":
            break  # nothing downstream can pass if the process is not up

    print("-" * 72)
    total = sum(ms for _, _, ms, _ in probe.results)
    failed = [name for name, status, _, _ in probe.results if status == FAIL]
    print(f"{len(probe.results) - len(failed)}/{len(probe.results)} steps passed in {total:.0f} ms")
    if failed:
        print(f"FAILED: {', '.join(failed)}")
    return probe.ok


def configure_in_process() -> None:
    """Pin the in-process run to one synthetic venue.

    Must run before *any* import that reads configuration — settings are frozen
    at first import and `load_dotenv` will not override what is already set, so
    whichever happens first wins. Getting this order wrong silently points the
    probe at live venues.

    The single synthetic venue is what makes this runnable anywhere: it is a
    real VenueFeed producing a real ladder, so every step downstream of the book
    is exercised for real, with no socket to the outside world. Books it serves
    are tagged ``synthetic`` and the probe prints that tag rather than
    pretending the prices are a venue's.
    """
    os.environ.setdefault("ENABLE_MARKET_DATA", "1")
    os.environ.setdefault("VENUES", "SIM")
    os.environ.setdefault("TELEGRAM_BOT_TOKEN", "")


def in_process_probe(token: str | None) -> Probe:
    from fastapi.testclient import TestClient

    import main

    client = TestClient(main.app)
    client.__enter__()  # run lifespan so the modules are started
    time.sleep(0.3)  # let the synthetic feed publish its first book
    headers = {"X-AlphaEngine-Token": token} if token else {}

    def get(path: str, raw: bool = False) -> Any:
        resp = client.get(path, headers=headers)
        assert resp.status_code == 200, f"HTTP {resp.status_code} {resp.text[:120]}"
        return resp.text if raw else resp.json()

    def post(path: str, body: dict) -> Any:
        resp = client.post(path, json=body, headers=headers)
        assert resp.status_code == 200, f"HTTP {resp.status_code} {resp.text[:120]}"
        return resp.json()

    return Probe(get, post)


def http_probe(base: str, token: str | None, timeout: float) -> Probe:
    import httpx

    client = httpx.Client(base_url=base.rstrip("/"), timeout=timeout)
    headers = {"X-AlphaEngine-Token": token} if token else {}

    def get(path: str, raw: bool = False) -> Any:
        resp = client.get(path, headers=headers)
        assert resp.status_code == 200, f"HTTP {resp.status_code} {resp.text[:120]}"
        return resp.text if raw else resp.json()

    def post(path: str, body: dict) -> Any:
        resp = client.post(path, json=body, headers=headers)
        assert resp.status_code == 200, f"HTTP {resp.status_code} {resp.text[:120]}"
        return resp.json()

    return Probe(get, post)


def _configured_token() -> str | None:
    """The gateway's own token, resolved the way the gateway resolves it.

    Reads through `config.settings` rather than `os.environ` so a token in a
    local `.env` is found — every other component in this repo reads config
    that way, and the probe reading it differently is how the documented
    one-command check came to fail against a documented setup.
    """
    token = os.environ.get("WEB_API_TOKEN")
    if token:
        return token
    try:
        from config import settings

        return settings.web_api_token or None
    except Exception:
        return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", help="probe a running gateway instead of an in-process app")
    # Deliberately no `default=` here: argparse evaluates defaults before
    # `config` has loaded `.env`, so reading WEB_API_TOKEN at this point misses
    # the value on every deployment configured the documented way.
    parser.add_argument("--token", help="gateway token when auth is required (defaults to the configured one)")
    parser.add_argument("--symbol", default="BTCUSDT")
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args(argv)

    if not args.url:
        configure_in_process()  # before the token lookup imports config

    token = args.token or _configured_token()
    probe = http_probe(args.url, token, args.timeout) if args.url else in_process_probe(token)
    target = args.url or "in-process"
    print(f"target: {target}")
    return 0 if run(probe, args.symbol.upper()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
