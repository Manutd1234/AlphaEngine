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
    ALLOCATION_METHODS,
    apply_scenario,
    build_covariance,
    historical_var,
    propose_allocation,
    rebalance_trades,
    rolling_var_backtest,
)

OUT = ROOT / "web" / "tests" / "fixtures" / "risk-parity.json"

# Quiet most days with occasional large losses — the fat left tail that
# separates the empirical figure from the normal one, which is the whole reason
# both are computed.
CRASH_DAYS = (17, 53, 91, 140, 190)
OBSERVATIONS = 220
WINDOW = 60

ALLOCATION_OBSERVATIONS = 120


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


def build_allocation_history() -> dict[str, list[float]]:
    """Three deterministic series with unequal volatility and one negative pair.

    The VaR book above is deliberately collinear — ETHUSDT is exactly 1.5x
    BTCUSDT — because that makes the measured beta a known quantity rather than
    a sample artefact. It also makes the covariance singular, which is the worst
    possible input for a minimum-variance solve: the objective is flat along one
    direction, and two implementations wander apart there for reasons that have
    nothing to do with either being wrong.

    So the allocation methods get their own book. It is non-degenerate on
    purpose: three unequal volatilities, and CCC moves against the base, so a
    solver that accounts for correlation reaches a visibly different answer from
    one that does not.
    """
    base = [
        round(0.004 * (1 if i % 2 else -1) + 0.0006 * ((i % 7) - 3), 8)
        for i in range(ALLOCATION_OBSERVATIONS)
    ]
    swing = [
        round(0.0015 * ((i % 5) - 2) + 0.0004 * (1 if i % 3 else -1), 8)
        for i in range(ALLOCATION_OBSERVATIONS)
    ]
    return {
        "AAA": base,
        "BBB": [round(0.6 * b + 2.0 * s, 8) for b, s in zip(base, swing, strict=True)],
        "CCC": [round(-0.4 * b + 0.5 * s, 8) for b, s in zip(base, swing, strict=True)],
    }


def _targets(proposal) -> list[dict[str, object]]:
    """Serialised per symbol, never per index.

    ``build_covariance`` sorts its symbols on the Python side and does not on the
    TypeScript side, so the two engines can hold the same covariance under a
    different ordering. The numerical effect is ~1e-15 and the fixture tolerates
    1e-4 — but only if the comparison is keyed by symbol.
    """
    return [
        {
            "symbol": t.symbol,
            "targetWeight": round(t.target_weight, 8),
            "targetNotional": round(t.target_notional, 4),
            "clippedBy": t.clipped_by,
        }
        for t in sorted(proposal.targets, key=lambda t: t.symbol)
    ]


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

    # The allocation methods run on their own non-degenerate book. Positions are
    # deliberately not in alphabetical order: that is what proves the symbol
    # ordering inside the covariance does not leak into the answer.
    allocation_history = build_allocation_history()
    allocation_positions = [
        {"symbol": "BBB", "side": "LONG", "notional": 180_000},
        {"symbol": "AAA", "side": "LONG", "notional": 120_000},
        {"symbol": "CCC", "side": "SHORT", "notional": 60_000},
    ]
    allocation_limits = {"maxSymbolNotional": 150_000.0, "maxGrossNotional": 300_000.0}

    allocation_cov = build_covariance(allocation_history, interval="1d")
    if backtest is None or empirical is None or allocation_cov is None:
        print("reference engine declined to produce a result — fixture not written", file=sys.stderr)
        return 1

    methods = {}
    for method in ALLOCATION_METHODS:
        proposal = propose_allocation(allocation_positions, allocation_cov, equity, method=method)
        if proposal is None:
            print(f"reference engine declined method {method} — fixture not written", file=sys.stderr)
            return 1
        methods[method] = {
            "method": proposal.method,
            "grossBefore": proposal.gross_before,
            "grossAfter": proposal.gross_after,
            "clipped": proposal.clipped,
            "targets": _targets(proposal),
        }

    clipped = propose_allocation(
        allocation_positions, allocation_cov, equity, method="min_variance",
        max_symbol_notional=allocation_limits["maxSymbolNotional"],
        max_gross_notional=allocation_limits["maxGrossNotional"],
    )
    unclipped_min_variance = propose_allocation(
        allocation_positions, allocation_cov, equity, method="min_variance",
    )
    if clipped is None or unclipped_min_variance is None:
        print("reference engine declined the clipped solve — fixture not written", file=sys.stderr)
        return 1

    # `reason` is not serialised on purpose: Python's f-string percent formatting
    # and JavaScript's toFixed round half-way values in opposite directions, and
    # a prose string is not the property this fixture exists to pin.
    trades = [
        {"symbol": t["symbol"], "side": t["side"], "notional": t["notional"]}
        for t in rebalance_trades(unclipped_min_variance, allocation_positions, drift_band=0.05)
    ]

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
                "history": allocation_history,
                # The TypeScript API takes signed notionals directly.
                "positions": [
                    {"symbol": "BBB", "signedNotional": 180_000},
                    {"symbol": "AAA", "signedNotional": 120_000},
                    {"symbol": "CCC", "signedNotional": -60_000},
                ],
                "limits": allocation_limits,
                "methods": methods,
                "clipped": {
                    "method": clipped.method,
                    "grossBefore": clipped.gross_before,
                    "grossAfter": clipped.gross_after,
                    "clipped": clipped.clipped,
                    "targets": _targets(clipped),
                },
                "trades": trades,
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
    for method, block in methods.items():
        weights = ", ".join(
            f"{t['symbol']} {t['targetWeight']:.1%}" for t in block["targets"]
        )
        print(f"  {method:<13}: {weights}")
    print(f"  clipped      : {clipped.clipped} · gross {clipped.gross_before:,.0f} → {clipped.gross_after:,.0f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
