#!/usr/bin/env python3
"""
Generate the Python↔TypeScript risk-parity fixture.

``modules/quant_risk.py`` and ``web/lib/portfolio-risk.ts`` are two
implementations of the same risk arithmetic, for the same reason the backtester
is: the Telegram companion cannot reach the TypeScript, and the browser cannot
reach the Python. Two implementations of one calculation is two chances to be
wrong, so the Python side — the reference — emits its answers here and the
TypeScript suite asserts it reproduces them.

    python tools/make_risk_fixture.py

The input series is generated deterministically rather than fetched: a parity
fixture that depends on a network call is a parity fixture that fails for
reasons unrelated to the code it pins.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from modules.quant_risk import (  # noqa: E402
    apply_scenario,
    build_covariance,
    historical_var,
    propose_allocation,
    rolling_var_backtest,
)

OUT = ROOT / "web" / "tests" / "fixtures" / "risk-parity.json"

# Quiet most days with occasional large losses — the fat left tail that
# separates the empirical figure from the normal one, which is the whole reason
# both are computed.
CRASH_DAYS = (17, 53, 91, 140, 190)
OBSERVATIONS = 220
WINDOW = 60


def build_history() -> dict[str, list[float]]:
    series = [round(0.002 if i % 2 else -0.0018, 6) for i in range(OBSERVATIONS)]
    for day in CRASH_DAYS:
        series[day] = -0.09
    return {
        "BTCUSDT": series,
        # Exactly 1.5x, so the measured beta is a known quantity rather than an
        # artefact of the sample.
        "ETHUSDT": [round(r * 1.5, 8) for r in series],
    }


def main() -> int:
    history = build_history()
    positions = [
        {"symbol": "BTCUSDT", "side": "LONG", "notional": 100_000},
        {"symbol": "ETHUSDT", "side": "SHORT", "notional": 40_000},
    ]
    equity = 1_000_000.0

    backtest = rolling_var_backtest(positions, history, equity, window=WINDOW)
    empirical = historical_var(positions, history, equity)
    scenario = apply_scenario(positions, equity, {"BTCUSDT": -0.20}, history)

    cov = build_covariance(history, interval="1d")
    allocation = propose_allocation(positions, cov, equity, method="equal_risk") if cov else None

    if backtest is None or empirical is None or allocation is None:
        print("reference engine declined to produce a result — fixture not written", file=sys.stderr)
        return 1

    payload = {
        "window": WINDOW,
        "history": history,
        # The TypeScript API takes signed notionals directly rather than a side.
        "positions": [
            {"symbol": "BTCUSDT", "signedNotional": 100_000},
            {"symbol": "ETHUSDT", "signedNotional": -40_000},
        ],
        "expected": {
            "varBacktest": {
                "observations": backtest.observations,
                "exceptions": backtest.exceptions,
                "expectedExceptions": backtest.expected_exceptions,
                "exceptionRate": backtest.exception_rate,
                "kupiecStatistic": backtest.kupiec_statistic,
                "zone": backtest.zone,
            },
            "historicalVar": {
                "var95": round(empirical.var95, 6),
                "cvar95": round(empirical.cvar95, 6),
                "observations": empirical.observations,
            },
            "allocation": {
                "method": allocation.method,
                "grossBefore": allocation.gross_before,
                "targets": [
                    {"symbol": t.symbol, "targetWeight": round(t.target_weight, 8),
                     "targetNotional": round(t.target_notional, 4)}
                    for t in sorted(allocation.targets, key=lambda t: t.symbol)
                ],
            },
            "scenario": {
                "totalPnl": round(scenario.total_pnl, 6),
                "usedBeta": scenario.used_beta,
                "legs": [
                    {"symbol": leg.symbol, "appliedMove": round(leg.applied_move, 8),
                     "pnl": round(leg.pnl, 6), "viaBeta": leg.via_beta}
                    for leg in scenario.legs
                ],
            },
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}")
    print(f"  VaR backtest : {backtest.exceptions}/{backtest.observations} exceptions, {backtest.zone}")
    print(f"  historical   : VaR {empirical.var95:,.0f} · CVaR {empirical.cvar95:,.0f}")
    print(f"  scenario     : {scenario.total_pnl:+,.0f}")
    weights = ", ".join(f"{t.symbol} {t.target_weight:.1%}" for t in allocation.targets)
    print(f"  allocation   : {weights}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
