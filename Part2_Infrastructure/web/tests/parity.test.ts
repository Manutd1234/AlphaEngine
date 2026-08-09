/**
 * Cross-engine parity: TypeScript vs the Python reference.
 * ========================================================
 *
 * The portal reimplements the backtest engine in TypeScript so a sweep can run
 * in a serverless function. Two implementations of the same accounting is two
 * chances to be wrong, so this suite replays real Binance bars through the TS
 * engine and asserts it reproduces what `modules/backtester.py::NumpyEngine`
 * produced from the identical input.
 *
 * Regenerate the fixture:
 *   cd Part2_Infrastructure && python tools/make_parity_fixture.py
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { runCombo } from "../lib/engine";
import type { Bar, Direction, Strategy } from "../lib/types";

interface Expected {
  fast: number;
  slow: number;
  totalReturn: number;
  cagr: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  calmar: number;
  winRate: number;
  trades: number;
  exposure: number;
  turnover: number;
  feesPaid: number;
}

interface Case {
  symbol: string;
  interval: string;
  strategy: Strategy;
  direction: Direction;
  feeBps: number;
  slippageBps: number;
  source: string;
  bars: Bar[];
  expected: Expected[];
}

const fixturePath = fileURLToPath(new URL("./fixtures/parity.json", import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  bars: number;
  combos: Array<[number, number]>;
  cases: Case[];
};

function columns(bars: Bar[]) {
  const n = bars.length;
  const close = new Float64Array(n);
  const high = new Float64Array(n);
  const low = new Float64Array(n);
  const pxRet = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    close[i] = bars[i].c;
    high[i] = bars[i].h;
    low[i] = bars[i].l;
  }
  for (let i = 1; i < n; i++) pxRet[i] = close[i - 1] !== 0 ? close[i] / close[i - 1] - 1 : 0;
  return { close, high, low, pxRet };
}

/** Relative closeness, with an absolute floor so near-zero values don't blow up. */
function near(actual: number, expected: number, rel: number, abs: number, what: string) {
  const diff = Math.abs(actual - expected);
  const tol = Math.max(abs, Math.abs(expected) * rel);
  assert.ok(
    diff <= tol,
    `${what}: TS ${actual.toPrecision(8)} vs Python ${expected.toPrecision(8)} (Δ ${diff.toPrecision(4)} > tol ${tol.toPrecision(4)})`,
  );
}

describe("TypeScript engine reproduces the Python reference", () => {
  it("fixture covers every strategy and both directions on live data", () => {
    // Every strategy the API accepts, not a sample of them. A model that exists
    // in both engines and differs subtly between them fails only when someone
    // runs the Python path, long after the TypeScript one was reviewed.
    const strategies = new Set(fixture.cases.map((c) => c.strategy));
    assert.deepEqual([...strategies].sort(), [
      "bollinger_breakout", "breakout_sma", "donchian", "donchian_mid",
      "ema_cross", "ema_slope",
      "ma_cross", "macd_cross", "momentum", "ppo_cross", "price_channel",
      "roc_trend", "rsi_reversion", "rsi_trend", "stochastic",
      "triple_ma", "trix_cross", "williams_r", "zscore_reversion",
    ]);
    assert.ok(fixture.cases.some((c) => c.direction === "long_short"));
    for (const c of fixture.cases) {
      assert.equal(c.source, "binance_rest", `${c.symbol} fixture is not live market data`);
      assert.equal(c.bars.length, fixture.bars);
    }
  });

  for (const c of fixture.cases) {
    describe(`${c.symbol} ${c.interval} ${c.strategy} ${c.direction}`, () => {
      const cols = columns(c.bars);
      const req = {
        strategy: c.strategy,
        direction: c.direction,
        feeBps: c.feeBps,
        slippageBps: c.slippageBps,
        interval: c.interval,
      };

      for (const exp of c.expected) {
        it(`matches on ${exp.fast}/${exp.slow}`, () => {
          const { result } = runCombo(
            c.bars,
            cols.close,
            cols.high,
            cols.low,
            cols.pxRet,
            req,
            exp.fast,
            exp.slow,
          );

          // Position sizing and cost accounting must be exact to floating point.
          assert.equal(result.trades, exp.trades, "trade count");
          near(result.exposure, exp.exposure, 1e-9, 1e-9, "exposure");
          near(result.turnover, exp.turnover, 1e-9, 1e-9, "turnover");
          near(result.winRate, exp.winRate, 1e-9, 1e-9, "win rate");

          // Return-stream statistics: same formulas, different accumulation
          // order, so allow float drift but nothing that would change a decision.
          near(result.totalReturn, exp.totalReturn, 1e-6, 1e-9, "total return");
          near(result.cagr, exp.cagr, 1e-6, 1e-9, "CAGR");
          near(result.sharpe, exp.sharpe, 1e-6, 1e-9, "Sharpe");
          near(result.sortino, exp.sortino, 1e-6, 1e-9, "Sortino");
          near(result.maxDrawdown, exp.maxDrawdown, 1e-6, 1e-9, "max drawdown");
          near(result.calmar, exp.calmar, 1e-6, 1e-9, "Calmar");
          near(result.feesPaid, exp.feesPaid, 1e-6, 1e-6, "fees paid");
        });
      }
    });
  }
});
