#!/usr/bin/env python3
"""
Generate the cross-engine parity fixture.

The Vercel portal reimplements the backtest engine in TypeScript so sweeps can
run in a serverless function. Two implementations of the same accounting is two
chances to be wrong, so the Python engine — the reference — emits real market
bars plus its own results here, and the TypeScript test-suite asserts it
reproduces them.

    python tools/make_parity_fixture.py            # refresh from live Binance
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from modules.backtester import NumpyEngine, fetch_ohlcv  # noqa: E402
from modules.schemas import BacktestRequest  # noqa: E402

OUT = ROOT / "web" / "tests" / "fixtures" / "parity.json"

# Every strategy in the catalogue, on live bars. A model present in one engine
# and subtly different in the other fails only when someone runs the Python
# path, long after the TypeScript one was reviewed — and the two are supposed
# to be the same model.
CASES = [
    ("BTCUSDT", "4h", "ma_cross", "long_only"),
    ("ETHUSDT", "1h", "donchian", "long_only"),
    ("BTCUSDT", "1d", "rsi_reversion", "long_only"),
    ("ETHUSDT", "4h", "ma_cross", "long_short"),
    ("BTCUSDT", "4h", "ema_cross", "long_only"),
    ("BTCUSDT", "4h", "macd_cross", "long_only"),
    ("ETHUSDT", "4h", "donchian_mid", "long_only"),
    ("BTCUSDT", "1h", "breakout_sma", "long_only"),
    ("ETHUSDT", "1d", "williams_r", "long_only"),
    ("BTCUSDT", "4h", "stochastic", "long_only"),
    ("ETHUSDT", "4h", "momentum", "long_only"),
    ("BTCUSDT", "1h", "roc_trend", "long_only"),
    ("BTCUSDT", "4h", "triple_ma", "long_only"),
    ("ETHUSDT", "4h", "ppo_cross", "long_only"),
    ("BTCUSDT", "1d", "trix_cross", "long_only"),
    ("BTCUSDT", "4h", "rsi_trend", "long_only"),
    ("ETHUSDT", "4h", "price_channel", "long_only"),
    ("BTCUSDT", "1h", "ema_slope", "long_only"),
    ("BTCUSDT", "4h", "bollinger_breakout", "long_only"),
    ("ETHUSDT", "4h", "zscore_reversion", "long_only"),
    ("BTCUSDT", "4h", "atr_breakout", "long_only"),
    ("ETHUSDT", "4h", "keltner_breakout", "long_only"),
    ("BTCUSDT", "1h", "supertrend", "long_only"),
    ("ETHUSDT", "1d", "atr_trailing_stop", "long_only"),
    ("BTCUSDT", "4h", "obv_trend", "long_only"),
    ("ETHUSDT", "4h", "volume_breakout", "long_only"),
    ("BTCUSDT", "1h", "mfi_reversion", "long_only"),
    ("BTCUSDT", "1h", "linreg_forecast", "long_only"),
    ("ETHUSDT", "4h", "linreg_forecast", "long_short"),
]
COMBOS = [(5, 20), (10, 50), (20, 100), (35, 180)]
#: The second axis is a standard-deviation multiple for these, not a period.
#: Sweeping them at 20..180 sigma would exercise a band nothing ever crosses.
FREE_COMBOS = [(10, 0.5), (14, 1.0), (20, 1.5), (20, 2.0)]
#: Mirrors FREE_SECOND_AXIS in the engine — these sweep their own units.
FREE_AXIS_STRATEGIES = {
    "bollinger_breakout", "zscore_reversion",
    "atr_breakout", "keltner_breakout", "supertrend", "atr_trailing_stop",
}
#: The fitted strategy: first axis is a training window (60+ bars, not 5) and
#: the second is a threshold in residual sigma. Both differ from the parametric
#: grid, and a 5-bar window would fit four coefficients to one observation.
#: Thresholds deliberately straddle zero-trade territory — a combination that
#: never fires still has to agree across engines about firing zero times.
FITTED_COMBOS = [(60, 0.0), (90, 0.2), (150, 0.6), (240, 1.0)]
FITTED_STRATEGIES = {"linreg_forecast"}
BARS = 1200


def main() -> int:
    payload: dict = {"bars": BARS, "combos": COMBOS, "cases": []}

    for symbol, interval, strategy, direction in CASES:
        df, source = fetch_ohlcv(symbol, interval, BARS)
        if source != "binance_rest":
            print(f"WARNING: {symbol} {interval} came from '{source}', not live Binance", file=sys.stderr)

        req = BacktestRequest(
            symbol=symbol, interval=interval, strategy=strategy,
            direction=direction, bars=BARS, fee_bps=6, slippage_bps=2,
        )
        if strategy in FITTED_STRATEGIES:
            combos = FITTED_COMBOS
        elif strategy in FREE_AXIS_STRATEGIES:
            combos = FREE_COMBOS
        else:
            combos = COMBOS
        results, _ = NumpyEngine().run(df, combos, req)

        payload["cases"].append({
            "combos": combos,
            "symbol": symbol,
            "interval": interval,
            "strategy": strategy,
            "direction": direction,
            "feeBps": 6,
            "slippageBps": 2,
            "source": source,
            "bars": [
                {"t": int(ts.value // 1_000_000), "o": float(o), "h": float(h),
                 "l": float(low), "c": float(c), "v": float(v)}
                for ts, o, h, low, c, v in df.reset_index()[
                    ["ts", "open", "high", "low", "close", "volume"]
                ].itertuples(index=False)
            ],
            "expected": [
                {
                    "fast": r.fast, "slow": r.slow,
                    "totalReturn": r.total_return, "cagr": r.cagr,
                    "sharpe": r.sharpe, "sortino": r.sortino,
                    "maxDrawdown": r.max_drawdown, "calmar": r.calmar,
                    "winRate": r.win_rate, "trades": r.trades,
                    "exposure": r.exposure, "turnover": r.turnover,
                    "feesPaid": r.fees_paid,
                }
                for r in results
            ],
        })
        print(f"  {symbol:9} {interval:4} {strategy:14} {direction:11} {len(df):5} bars  [{source}]")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload))
    size_kb = OUT.stat().st_size / 1024
    print(f"\nwrote {OUT.relative_to(ROOT)} ({size_kb:.0f} KB, {len(CASES)} cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
