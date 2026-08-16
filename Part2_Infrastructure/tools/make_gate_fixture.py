#!/usr/bin/env python3
"""Generate the pre-trade gate-decision parity fixture.

``RiskGateway.submit`` in ``modules/risk_proxy.py`` is the reference
implementation of the seventeen pre-trade gates. A second implementation lives
in ``web/lib/blotter.ts`` (`judge()`), a third is planned in C++, and the
Telegram companion previews the same battery — four chances to disagree about
whether an order is accepted and which gate stopped it, and until now nothing
pinned them to one answer.

This records what the Python reference decides for twenty deterministic
scenarios — full input state, a fixed clock, explicit limits — so
``tests/test_gate_parity.py`` (Python) and ``web/tests/gate-parity.test.ts``
(TypeScript) can each assert they reproduce it, and a native engine has a
fixture to plug into on day one.

    python tools/make_gate_fixture.py

The scenarios below carry every gate's inputs on purpose: the point of a parity
fixture is that it depends on nothing but itself.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools.gate_fixture import default_limits, expected_from, judge_standalone  # noqa: E402

OUT = ROOT / "web" / "tests" / "fixtures" / "gate-parity.json"

WALL = "2026-06-01T12:00:00Z"
MONO = 100_000.0


def _book(venue: str, symbol: str, mid: float, size: float = 5000.0, levels: int = 50, tick: float = 0.01, **extra):
    return {
        "venue": venue,
        "symbol": symbol,
        "bids": [[round(mid - i * tick, 6), size] for i in range(levels)],
        "asks": [[round(mid + i * tick, 6), size] for i in range(levels)],
        **extra,
    }


def _btc_books():
    return [_book("BINANCE", "BTCUSDT", 100.0), _book("BYBIT", "BTCUSDT", 100.0)]


def _base(order, **over):
    """A happy two-venue scenario; each scenario overrides only what it tests."""
    scenario = {
        "clock": {"wall_iso": WALL, "monotonic_s": MONO},
        "limits": default_limits(),
        "books": _btc_books(),
        "positions": [],
        "working": [],
        "kill": {"active": False, "reason": None, "halted": []},
        "seen_client_ids": [],
        "bucket": {"rate": 5.0, "burst": 10, "tokens": 10, "recent_rel": []},
        "start_of_day_equity": 1_000_000.0,
        "carried_realized_pnl": 0.0,
        "reduce_only_override": False,
        "order": order,
    }
    scenario.update(over)
    return scenario


def scenarios() -> dict[str, dict]:
    market = {"symbol": "BTCUSDT", "side": "BUY", "notional": 1000.0, "order_type": "MARKET", "strategy": "fix"}
    thin_book = [_book("BINANCE", "BTCUSDT", 100.0, size=1.0, levels=3)]
    # Best level holds only $5, so a $30 order must walk into the gapped upper
    # rungs (100 → 105 → 110), pushing the routed VWAP well past the 75 bps cap.
    gap_book = [_book("BINANCE", "BTCUSDT", 100.0, size=0.05, levels=3, tick=5.0)]
    # 4.5% down: inside the reduce-only band (>= 80% of the 5% budget) but the
    # daily_drawdown hard gate (< 5%) still passes, so reduce_only is the gate
    # that actually decides these two.
    reduce_only_carry = -45_000.0
    return {
        "kill_switch_on": _base(market, kill={"active": True, "reason": "manual halt", "halted": []}),
        "symbol_halted": _base(market, kill={"active": False, "reason": None, "halted": ["BTCUSDT"]}),
        "not_whitelisted": _base({**market, "symbol": "DOGEUSDT"},
                                 books=[_book("BINANCE", "DOGEUSDT", 100.0)]),
        "duplicate_client_id": _base({**market, "client_order_id": "abc"}, seen_client_ids=["abc"]),
        "rate_limited": _base(market, bucket={"rate": 5.0, "burst": 10, "tokens": 0, "recent_rel": []}),
        "no_price": _base(market, books=[]),
        "oversize_notional": _base({**market, "notional": 60_000.0}),
        "concentration_breach": _base(
            {**market, "notional": 100_000.0},
            positions=[{"symbol": "BTCUSDT", "quantity": 900.0, "avg_price": 100.0}],
        ),
        "gross_breach": _base(
            {**market, "notional": 40_000.0},
            positions=[{"symbol": "ETHUSDT", "quantity": 4900.0, "avg_price": 100.0}],
            books=[_book("BINANCE", "BTCUSDT", 100.0), _book("BINANCE", "ETHUSDT", 100.0)],
        ),
        "price_band": _base({"symbol": "BTCUSDT", "side": "BUY", "quantity": 5.0,
                             "order_type": "LIMIT", "limit_price": 130.0, "strategy": "fix"}),
        "working_book_full": _base(
            {"symbol": "BTCUSDT", "side": "BUY", "quantity": 5.0, "order_type": "LIMIT",
             "limit_price": 99.0, "strategy": "fix"},
            limits={**default_limits(), "max_working_orders": 1},
            working=[{"symbol": "ETHUSDT", "side": "BUY", "quantity": 1.0, "limit_price": 1.0}],
            books=[_book("BINANCE", "BTCUSDT", 100.0), _book("BINANCE", "ETHUSDT", 1.0)],
        ),
        "drawdown_reduce_only_blocks_opening": _base(
            market,
            positions=[{"symbol": "BTCUSDT", "quantity": 10.0, "avg_price": 100.0}],
            start_of_day_equity=1_000_000.0,
            carried_realized_pnl=reduce_only_carry,
        ),
        "drawdown_reduce_only_allows_close": _base(
            {"symbol": "BTCUSDT", "side": "SELL", "notional": 500.0, "order_type": "MARKET", "strategy": "fix"},
            positions=[{"symbol": "BTCUSDT", "quantity": 50.0, "avg_price": 100.0}],
            start_of_day_equity=1_000_000.0,
            carried_realized_pnl=reduce_only_carry,
        ),
        "slippage_partial": _base({**market, "notional": 5_000.0}, books=thin_book),
        "slippage_breach": _base({**market, "notional": 30.0}, books=gap_book),
        "happy_market": _base(market),
        "happy_limit_resting": _base({"symbol": "BTCUSDT", "side": "BUY", "quantity": 5.0,
                                      "order_type": "LIMIT", "limit_price": 99.5, "strategy": "fix"}),
        "paper_equity_happy": _base(
            {"symbol": "AAPL", "side": "BUY", "notional": 1000.0, "order_type": "MARKET", "strategy": "fix",
             "paper_execution": {"asset_class": "equity", "price": 200.0, "as_of": WALL, "source": "tiingo"}},
            books=[],
        ),
        "paper_equity_stale_quote": _base(
            {"symbol": "AAPL", "side": "BUY", "notional": 1000.0, "order_type": "MARKET", "strategy": "fix",
             "paper_execution": {"asset_class": "equity", "price": 200.0,
                                 "as_of": "2026-06-01T11:00:00Z", "source": "tiingo"}},
            books=[],
        ),
        "paper_equity_limit_rejected": _base(
            {"symbol": "AAPL", "side": "BUY", "quantity": 5.0, "order_type": "LIMIT", "limit_price": 200.0,
             "strategy": "fix",
             "paper_execution": {"asset_class": "equity", "price": 200.0, "as_of": WALL, "source": "tiingo"}},
            books=[],
        ),
    }


def main() -> int:
    built = {}
    for name, scenario in scenarios().items():
        decision = judge_standalone(scenario)
        built[name] = {**scenario, "expected": expected_from(decision)}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"version": 1, "scenarios": built}, indent=2, sort_keys=True) + "\n")
    accepted = sum(1 for s in built.values() if s["expected"]["accepted"])
    print(f"wrote {len(built)} gate scenarios to {OUT.relative_to(ROOT.parent)} ({accepted} accepted)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
