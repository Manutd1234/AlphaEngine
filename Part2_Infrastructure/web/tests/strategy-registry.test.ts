/**
 * The strategy registry, and the fall-through it replaced.
 *
 * WHAT WAS THERE
 *
 * `longState` was a 737-line `if (strategy === ...) { ... return out; }` chain
 * inside `lib/engine.ts`, and its last branch had no condition: `rsi_reversion`
 * was the fall-through. A strategy added to the `Strategy` union and forgotten
 * in the chain did not fail — it traded RSI reversion and the sweep reported it
 * under the name that was asked for. That is the defect class this repo is most
 * alert to, applied to a model instead of to a metric: a number that is not
 * what its label says, with nothing on screen admitting it.
 *
 * WHAT GUARDS IT NOW
 *
 * `LONG_STATE_RULES` is typed `Record<Strategy, LongStateRule>`, so the missing
 * rule is a compile error rather than a wrong number. That guard lives in the
 * type system and `npm run typecheck` enforces it; the tests below cover what
 * `tsc` cannot see — that the rules are 46 distinct functions, that each one is
 * filed under the family its label claims, that an id outside the union is
 * REPORTED rather than answered, and that the exit-beats-entry ordering the
 * parity contract rests on is still ordering the way it must.
 *
 * The arithmetic itself is not pinned here. `tests/parity.test.ts` replays all
 * forty-six against the Python reference bar by bar, which is a stronger
 * statement than anything this file could make.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LONG_STATE_RULES, longState } from "../lib/strategies";
import { BREAKOUT_RULES } from "../lib/strategies/breakout";
import { FITTED_RULES } from "../lib/strategies/fitted";
import { MEAN_REVERSION_RULES } from "../lib/strategies/mean-reversion";
import { MOMENTUM_RULES } from "../lib/strategies/momentum";
import { TREND_RULES } from "../lib/strategies/trend";
import { VOLATILITY_RULES } from "../lib/strategies/volatility";
import { VOLUME_RULES } from "../lib/strategies/volume";
import { rsi, sma } from "../lib/indicators";
import { STRATEGY_FAMILY, STRATEGY_LABELS, type Strategy } from "../lib/types";

const ids = Object.keys(STRATEGY_LABELS) as Strategy[];

describe("every strategy in the catalogue has a rule of its own", () => {
  it("the registry and the label table name the same strategies", () => {
    assert.deepEqual(Object.keys(LONG_STATE_RULES).sort(), [...ids].sort());
  });

  it("no two ids share a rule", () => {
    // An alias would make two strategies one strategy while the picker went on
    // offering both — the same lie as the fall-through, spelled differently.
    assert.equal(new Set(Object.values(LONG_STATE_RULES)).size, ids.length);
  });

  it("a rule fills the array it is handed and answers only 0 or 1", () => {
    const n = 320;
    const close = new Float64Array(n);
    const high = new Float64Array(n);
    const low = new Float64Array(n);
    const volume = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      // Deterministic, and it turns: a monotone ramp leaves half the catalogue
      // never firing, which would pass this test while proving nothing.
      close[i] = 100 + 20 * Math.sin(i / 11) + i / 40;
      high[i] = close[i] + 1.5;
      low[i] = close[i] - 1.5;
      volume[i] = 1000 + 400 * Math.sin(i / 7);
    }
    for (const id of ids) {
      const state = longState(id, close, high, low, volume, 14, 40);
      assert.equal(state.length, n, `${id} returned the wrong length`);
      assert.ok(
        state.every((v) => v === 0 || v === 1),
        `${id} answered something that is neither long nor flat`,
      );
    }
  });
});

describe("a rule lives in the module its family names", () => {
  const modules: Array<[string, Record<string, unknown>]> = [
    ["Trend", TREND_RULES],
    ["Breakout", BREAKOUT_RULES],
    ["Mean reversion", MEAN_REVERSION_RULES],
    ["Momentum", MOMENTUM_RULES],
    ["Volume", VOLUME_RULES],
    ["Volatility", VOLATILITY_RULES],
    ["Fitted", FITTED_RULES],
  ];

  it("each module holds exactly the strategies STRATEGY_FAMILY assigns to it", () => {
    // Without this the split is seven arbitrary buckets that drift, and the
    // picker's grouping and the source's grouping stop being the same claim.
    for (const [family, rules] of modules) {
      const expected = ids.filter((id) => STRATEGY_FAMILY[id] === family).sort();
      assert.deepEqual(Object.keys(rules).sort(), expected, `${family} module`);
    }
  });

  it("the seven modules between them are the whole catalogue, counted once", () => {
    const all = modules.flatMap(([, rules]) => Object.keys(rules));
    assert.equal(all.length, ids.length, "a strategy is in two modules, or in none");
  });
});

describe("an id outside the catalogue is reported, not answered", () => {
  it("throws and names the id", () => {
    const flat = new Float64Array(300).fill(100);
    assert.throws(
      () => longState("tsmom" as Strategy, flat, flat, flat, flat, 14, 40),
      /Unknown strategy "tsmom"/,
      "an unknown id must not be answered by whichever rule happens to be last",
    );
  });

  it("the answer it used to give is no longer reachable", () => {
    // The old chain fell through to rsi_reversion, so "tsmom" came back as a
    // full RSI-reversion signal series with nothing marking the substitution.
    // A probe once read that as a PASS for a strategy that never ran.
    const n = 300;
    const close = new Float64Array(n);
    for (let i = 0; i < n; i++) close[i] = 100 + 15 * Math.sin(i / 9);
    const high = close.map((c) => c + 1) as Float64Array;
    const low = close.map((c) => c - 1) as Float64Array;
    const volume = new Float64Array(n).fill(1000);
    const rsiReversion = longState("rsi_reversion", close, high, low, volume, 14, 40);
    assert.ok(
      rsiReversion.some((v) => v === 1),
      "the comparison series never goes long — there would be nothing to mistake it for",
    );
    let answered = false;
    try {
      longState("tsmom" as Strategy, close, high, low, volume, 14, 40);
      answered = true;
    } catch {
      answered = false;
    }
    assert.equal(answered, false, "an unknown id was silently given a real signal series");
  });
});

describe("the exit still beats the entry on a bar where both fire", () => {
  /**
   * The convention both engines apply, pinned behaviourally rather than by
   * reading the source. `rsi_reversion` is the clearest case: oversold arms the
   * long, and being below the trend MA is a stop. In a crash both are true at
   * once, and the reference assigns entry then exit, so the bar ends FLAT.
   * Reverse the two `if`s and this strategy goes from 2 trades to 70.
   */
  const n = 260;
  const close = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // A long, calm climb so the trend MA sits below price, then a sharp fall
    // that puts RSI under 30 and price under the MA on the same bars.
    close[i] = i < 200 ? 100 + i * 0.4 : 180 - (i - 200) * 5;
  }
  const high = new Float64Array(n);
  const low = new Float64Array(n);
  const volume = new Float64Array(n).fill(1000);
  for (let i = 0; i < n; i++) { high[i] = close[i] + 1; low[i] = close[i] - 1; }

  const fast = 14;
  const slow = 40;
  const r = rsi(close, fast);
  const trend = sma(close, slow);
  const both: number[] = [];
  for (let i = 0; i < n; i++) {
    const oversold = !Number.isNaN(r[i]) && r[i] < 30;
    const belowTrend = !Number.isNaN(trend[i]) && close[i] < trend[i];
    if (oversold && belowTrend) both.push(i);
  }

  it("the series actually contains such a bar", () => {
    // Without this the assertion below is vacuously true and would stay green
    // through any reordering — the failure mode that hides a moved convention.
    assert.ok(both.length > 0, "no bar has entry and exit both firing; the fixture proves nothing");
  });

  it("every one of those bars ends flat", () => {
    const state = longState("rsi_reversion", close, high, low, volume, fast, slow);
    for (const i of both) {
      assert.equal(state[i], 0, `bar ${i}: entry and exit both fired and the entry won`);
    }
  });
});
