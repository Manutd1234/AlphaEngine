#!/usr/bin/env python3
"""
Record real Kalshi payloads into ``tests/fixtures/coherence/`` so the coherence
suite can run offline.

Every parser, every lattice rule and every price-grid decision in
``modules/coherence`` is written against these files rather than against a live
exchange, for the reason ``tools/make_risk_fixture.py`` states about its own
inputs: a suite that depends on a network call fails for reasons unrelated to
the code it pins. Unlike that generator, these inputs cannot be *invented* —
the whole point is that the field names, the fixed-point string widths and the
strike vocabulary are Kalshi's and not ours — so they are captured once, read
by a human, and committed.

    python tools/capture_kalshi_fixtures.py            # refresh every fixture
    python tools/capture_kalshi_fixtures.py --list     # show what would be fetched

Only public, unauthenticated GETs are made. Kalshi's OpenAPI contract marks the
two orderbook routes as requiring a key while the quick-start guide and the
live exchange both serve them keyless; when that changes, the capture records
the refusal as a fixture too, because "the contract tightened" is exactly the
case the client's degradation path has to handle.

The capture is deliberately slow — one request at a time, well under any
plausible unauthenticated budget. Kalshi documents its token buckets per
account and says nothing about keyless traffic, so this tool takes the
conservative reading rather than the fast one.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "fixtures" / "coherence"

BASE = "https://external-api.kalshi.com/trade-api/v2"
USER_AGENT = "AlphaEngine-Coherence/1.0 (fixture capture; contact via repository)"
PAUSE_S = 0.4
TIMEOUT_S = 20.0

# The families each fixture is here to pin. Written down because a fixture whose
# purpose is not recorded gets "refreshed" into uselessness by the next person:
# KXFEDDECISION is the mutually-exclusive basket (five outcomes, one must
# happen), KXHIGHNY carries a threshold ladder AND `between` buckets in one
# event, and KXBTCD is the crypto family whose exchange_index moves on
# 24 Aug 2026 — captured before the migration on purpose.
MEE_EVENT = "KXFEDDECISION-28JAN"
LADDER_EVENT_SERIES = "KXHIGHNY"
CRYPTO_SERIES = "KXBTCD"


class CaptureError(RuntimeError):
    """A fixture could not be recorded. Never write a partial file."""


def _get(path: str) -> tuple[int, Any]:
    """One public GET. Returns (status, decoded body) and never raises on 4xx.

    A 401 or 403 is DATA here, not a failure: the orderbook routes are the ones
    whose access is contested, and a recorded refusal is what lets the client's
    fallback be tested without waiting for the contract to tighten.
    """
    request = urllib.request.Request(f"{BASE}{path}", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:  # noqa: S310
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(body)
        except json.JSONDecodeError:
            return exc.code, {"non_json_body": body[:500]}
    except (urllib.error.URLError, TimeoutError) as exc:
        raise CaptureError(f"GET {path} did not complete: {exc}") from exc


def _write(name: str, path: str, status: int, body: Any) -> None:
    """Write one fixture, stamped with where and when it came from.

    ``captured_at`` is the honest part: these are real quotes from a real
    moment, and a reader who assumes they are current will misread every
    number in them.
    """
    document = {
        "captured_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": f"{BASE}{path}",
        "status": status,
        "authenticated": False,
        "body": body,
    }
    target = OUT / f"{name}.json"
    target.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    shape = f"{len(json.dumps(body)):,} bytes"
    print(f"  {target.name:<34} {status}  {shape}")


def _plan() -> list[tuple[str, str]]:
    """Every fixture, as (name, path). Order is the order they are fetched."""
    return [
        # The exchange itself: shard topology and the token costs the budgeter reads.
        ("exchange_status", "/exchange/status"),
        ("endpoint_costs", "/account/endpoint_costs"),
        ("historical_cutoff", "/historical/cutoff"),
        # A mutually-exclusive basket — constraint family 3.
        ("event_mee", f"/events/{MEE_EVENT}?with_nested_markets=true"),
        # A threshold ladder plus buckets in one event — families 2, 4 and 5.
        ("markets_ladder", f"/markets?series_ticker={LADDER_EVENT_SERIES}&status=open&limit=60"),
        # Crypto, captured before its shard moves on 24 Aug 2026.
        ("markets_crypto", f"/markets?series_ticker={CRYPTO_SERIES}&status=open&limit=60"),
        # Fees: the per-series multiplier and both scheduled-override feeds.
        ("series_ladder", f"/series/{LADDER_EVENT_SERIES}"),
        ("series_fee_changes", "/series/fee_changes?show_historical=false"),
        ("event_fee_changes", "/events/fee_changes?limit=20"),
        # The tape, for the block-trade flag the microstructure layer filters on.
        ("trades", f"/markets/trades?ticker={MEE_EVENT}-H0&limit=20"),
    ]


def _orderbook_plan(two_sided: str | None, one_sided: str | None, tickers: list[str]) -> list[tuple[str, str]]:
    """Orderbooks are planned separately: their access is the contested part.

    ``tickers`` on the BULK route is a REPEATED query parameter, not a
    comma-separated list — and this is the trap the last fixture exists to pin.
    ``GET /markets`` documents ``tickers`` as "Comma-separated list", so the
    comma reads as the house convention; on ``/markets/orderbooks`` the
    comma-joined form returns **HTTP 200** carrying one entry whose ``ticker``
    is the whole joined string and whose ladders are empty. That is
    indistinguishable, downstream, from a market nobody is quoting — an empty
    book is a legitimate state — so a client that gets this wrong reports "no
    liquidity" across the exchange and never raises. Both forms are recorded.
    """
    plan: list[tuple[str, str]] = []
    if two_sided:
        plan.append(("orderbook_two_sided", f"/markets/{two_sided}/orderbook?depth=20"))
    if one_sided:
        plan.append(("orderbook_one_sided", f"/markets/{one_sided}/orderbook?depth=20"))
    if tickers:
        repeated = "&".join(f"tickers={t}" for t in tickers[:8])
        plan.append(("orderbook_bulk", f"/markets/orderbooks?{repeated}"))
        joined = ",".join(tickers[:8])
        plan.append(("orderbook_bulk_comma_joined", f"/markets/orderbooks?tickers={joined}"))
    return plan


def _tickers_from(fixture: str) -> list[str]:
    """Read back the tickers of a market fixture we just wrote."""
    document = json.loads((OUT / f"{fixture}.json").read_text(encoding="utf-8"))
    body = document.get("body") or {}
    markets = body.get("markets") or body.get("event", {}).get("markets") or []
    return [m["ticker"] for m in markets if m.get("ticker")]


def _two_sided_and_one_sided(fixture: str) -> tuple[str | None, str | None]:
    """Pick one market quoted on both sides and one quoted on neither.

    Both are wanted, and the one-sided one is not a degenerate case to be
    tolerated — it is the fixture that proves an absent quote stays absent. A
    market like "NYC high above 87F" in August has heavy NO bids and no YES bid
    at all: read honestly its YES bid is None and its spread is unknowable;
    read with a zero default it looks like a one-cent market with a tight
    spread, which is a liquidity claim nobody made.
    """
    document = json.loads((OUT / f"{fixture}.json").read_text(encoding="utf-8"))
    markets = (document.get("body") or {}).get("markets") or []
    two_sided = one_sided = None
    for market in markets:
        bid = market.get("yes_bid_dollars")
        ask = market.get("yes_ask_dollars")
        if bid is None or ask is None:
            continue
        quoted_both = Decimal(bid) > 0 and Decimal(ask) < 1
        if quoted_both and two_sided is None:
            two_sided = market["ticker"]
        if not quoted_both and one_sided is None:
            one_sided = market["ticker"]
    return two_sided, one_sided


def main() -> int:
    parser = argparse.ArgumentParser(description="Record public Kalshi payloads as test fixtures.")
    parser.add_argument("--list", action="store_true", help="print the plan without fetching")
    args = parser.parse_args()

    plan = _plan()
    if args.list:
        for name, path in plan:
            print(f"{name:<24} {BASE}{path}")
        derived_names = ("orderbook_two_sided", "orderbook_one_sided", "orderbook_bulk", "orderbook_bulk_comma_joined")
        for derived in derived_names:
            print(f"{derived:<24} (derived from markets_ladder)")
        return 0

    OUT.mkdir(parents=True, exist_ok=True)
    print(f"Recording into {OUT.relative_to(ROOT)}")
    for name, path in plan:
        status, body = _get(path)
        _write(name, path, status, body)
        time.sleep(PAUSE_S)

    tickers = _tickers_from("markets_ladder")
    if not tickers:
        raise CaptureError("markets_ladder recorded no tickers; the orderbook fixtures cannot be derived")
    two_sided, one_sided = _two_sided_and_one_sided("markets_ladder")
    for name, path in _orderbook_plan(two_sided, one_sided, tickers):
        status, body = _get(path)
        _write(name, path, status, body)
        time.sleep(PAUSE_S)

    print("Read the diff before committing: these are quotes from one real moment, not invariants.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except CaptureError as exc:
        print(f"capture failed: {exc}", file=sys.stderr)
        sys.exit(1)
