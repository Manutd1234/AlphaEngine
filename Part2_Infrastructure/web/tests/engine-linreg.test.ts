/**
 * The fitted strategy.
 *
 * Every other strategy in this catalogue applies a rule the user chose. This
 * one estimates its coefficients from the data, and that changes which mistakes
 * are possible: a parametric rule cannot accidentally see the future, and a
 * fitted one can, in a way that produces a spectacular equity curve and no error.
 *
 * So these tests are about the fit's boundaries rather than its arithmetic —
 * `parity.test.ts` already pins the arithmetic against the Python reference on
 * live bars, which is the strongest statement available about whether the two
 * implementations agree.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { paramGrid, runCombo } from "@/lib/engine";
import { STRATEGY_DOCS } from "@/lib/strategy-docs";
import { DEFAULT_REQUEST, STRATEGY_FAMILY, type Bar, type SweepRequest } from "@/lib/types";

/** `runCombo`'s positional argument list, built once from a close series. */
function cols(close: number[]) {
  const n = close.length;
  const c = new Float64Array(close);
  const pxRet = new Float64Array(n);
  for (let i = 1; i < n; i++) pxRet[i] = c[i - 1] !== 0 ? c[i] / c[i - 1] - 1 : 0;
  const bars: Bar[] = close.map((v, i) => ({
    t: i * 36e5, o: v, h: v * 1.002, l: v * 0.998, c: v, v: 1e6,
  }));
  return [
    bars, c,
    new Float64Array(close.map((v) => v * 1.002)),
    new Float64Array(close.map((v) => v * 0.998)),
    new Float64Array(n).fill(1e6),
    pxRet,
  ] as const;
}

/**
 * One combination, flattened.
 *
 * `runCombo` returns the metrics under `result` and the per-bar arrays beside
 * it; these tests want both, so the position path is lifted alongside the
 * statistics rather than reached for through two different shapes.
 */
function run(close: number[], req: SweepRequest, fast: number, slow: number) {
  const [bars, c, high, low, volume, pxRet] = cols(close);
  const combo = runCombo(bars, c, high, low, volume, pxRet, req, fast, slow);
  return { ...combo.result, position: Array.from(combo.position) };
}

/** Deterministic random walk — no seeded library needed, and reproducible. */
function walk(n: number, drift = 0.0002, vol = 0.01, seed = 7): number[] {
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const out = [100];
  for (let i = 1; i < n; i++) {
    const u = Math.max(next(), 1e-12);
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    out.push(out[i - 1] * Math.exp(drift + z * vol));
  }
  return out;
}

const request = (over: Partial<SweepRequest> = {}): SweepRequest => ({
  ...DEFAULT_REQUEST, strategy: "linreg_forecast", interval: "1h",
  feeBps: 0, slippageBps: 0, ...over,
});

describe("the fit cannot see the future", () => {
  it("changing a bar's future leaves every earlier decision identical", () => {
    // The decisive property, and the one a fitted strategy can lose silently.
    // If the refit at bar i used any row whose target needed close[i+1], then
    // rewriting the tail would change positions BEFORE the rewrite — which is
    // exactly how a look-ahead bug produces a beautiful equity curve.
    const base = walk(600);
    const CUT = 400;
    const tampered = base.slice();
    for (let i = CUT; i < tampered.length; i++) tampered[i] *= 3;

    const req = request();
    const a = run(base, req, 120, 0.2);
    const b = run(tampered, req, 120, 0.2);

    // The position path up to the cut, which is what "no look-ahead" means
    // operationally: nothing after bar CUT may influence anything before it.
    assert.deepEqual(a.position.slice(0, CUT), b.position.slice(0, CUT),
      "rewriting the future changed a decision made before it");
  });

  it("the two series really do diverge after the cut", () => {
    // Guards the test above: if `runCombo` ignored the tail entirely the
    // assertion would pass for the wrong reason.
    const base = walk(600);
    const tampered = base.slice();
    for (let i = 400; i < tampered.length; i++) tampered[i] *= 3;
    const req = request();
    assert.notEqual(
      run(base, req, 120, 0.2).totalReturn,
      run(tampered, req, 120, 0.2).totalReturn,
    );
  });
});

describe("a degenerate fit stays flat rather than inventing a coefficient", () => {
  it("takes no position on a series with no variation to regress", () => {
    // A constant price makes every feature zero: the design matrix is singular
    // and the solve returns null. The strategy must remain flat, not trade on
    // whatever a pseudo-inverse would have produced.
    const flat = new Array(600).fill(100);
    const result = run(flat, request(), 120, 0.2);
    assert.equal(result.trades, 0);
    assert.equal(result.exposure, 0);
  });

  it("stays flat through its warm-up rather than defaulting to long", () => {
    // Before the first successful fit there is no forecast. "No opinion" is not
    // "buy", and the distinction is worth a test because the state variable
    // starts at zero and could as easily have started at one.
    const { position } = run(walk(600), request(), 240, 0.2);
    assert.deepEqual(position.slice(0, 20), new Array(20).fill(0));
  });
});

describe("the threshold does what its units claim", () => {
  it("a higher threshold in residual sigma never trades more", () => {
    // Monotonicity is the whole meaning of the axis. If raising the bar
    // produced more trades, the units would be decorative.
    const prices = walk(1200);
    const req = request();
    const counts = [0.0, 0.2, 0.6, 1.0].map((t) => run(prices, req, 120, t).trades);
    for (let i = 1; i < counts.length; i++) {
      assert.ok(counts[i] <= counts[i - 1], `threshold rose and trades went ${counts[i - 1]} → ${counts[i]}`);
    }
  });

  it("an unreachable threshold takes no trades instead of erroring", () => {
    const result = run(walk(800), request(), 120, 50);
    assert.equal(result.trades, 0);
    assert.ok(Number.isFinite(result.sharpe));
  });
});

describe("the grid is the fit's grid, not the period sweep's", () => {
  it("sweeps training windows long enough to estimate four coefficients", () => {
    // The default fast axis is 5-40 bars — a sensible moving-average period and
    // an unusable training window for a four-parameter regression. Fitting four
    // coefficients to five observations reproduces the observations exactly and
    // means nothing.
    const combos = paramGrid(request());
    assert.ok(combos.length > 0);
    for (const [window] of combos) {
      assert.ok(window >= 60, `training window ${window} cannot support four coefficients`);
    }
  });

  it("does not apply the fast-below-slow rule to incomparable axes", () => {
    // `f < s` is right when both axes are periods and nonsense here: a 120-bar
    // window against a 0.2σ threshold fails `120 < 0.2`, and every combination
    // would be discarded — the strategy would silently take no trades at all.
    const combos = paramGrid(request());
    assert.ok(combos.some(([f, s]) => f > s), "the period ordering rule is still being applied");
  });

  it("stays inside a research-time budget", () => {
    // ~15 ms per combination against ~0.4 ms for a parametric one, because it
    // refits a regression 100 times per pass. Pinned so a future feature cannot
    // quietly turn a sweep into a minute.
    const combos = paramGrid(request());
    assert.ok(combos.length <= 60, `${combos.length} combinations is too many at ~15 ms each`);
  });
});

describe("it is presented as fitted, not as one more parametric row", () => {
  it("has its own family", () => {
    // The discriminator a reader needs: estimated coefficients are not tuned
    // parameters, and a picker that groups them together invites reading one as
    // the other.
    assert.equal(STRATEGY_FAMILY.linreg_forecast, "Fitted");
    const others = Object.entries(STRATEGY_FAMILY).filter(([id]) => id !== "linreg_forecast");
    assert.ok(others.every(([, family]) => family !== "Fitted"));
  });

  it("its doc card names the failure that is specific to being fitted", () => {
    const doc = STRATEGY_DOCS.linreg_forecast;
    assert.match(doc.whenItFails, /regime/i);
    assert.match(doc.formula, /refit/i);
    // And tells the reader to judge it by out-of-sample degradation rather than
    // by the coefficients, which look authoritative and are not evidence.
    assert.match(doc.whenItFails, /out-of-sample|in-sample/i);
  });
});
