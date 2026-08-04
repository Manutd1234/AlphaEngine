/**
 * Research analytics — the maths, and the one thing that must not move.
 *
 * Two jobs. First, pin the new analytics against properties that can be checked
 * without a golden file: a regression must recover coefficients it was given, a
 * CVaR must sit below its VaR, monthly returns must compound back to the total.
 *
 * Second, and more important: **prove the cost model is inert by default.** The
 * frictions enter the compounding equity path, which is the one place a change
 * silently rewrites every metric the Python parity fixture pins. `parity.test.ts`
 * would catch a regression there, but only for the four fixture cases — this
 * asserts the property directly, on the expression itself, so the guarantee does
 * not depend on which combinations someone happened to freeze.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runCombo } from "../lib/engine";
import {
  NO_FRICTIONS,
  averageDailyVolume,
  buildFactors,
  holdingCost,
  hoursPerBar,
  monthlyReturns,
  parameterStability,
  promotionGate,
  regress,
  tailReport,
  turnoverCost,
  walkForwardReport,
} from "../lib/quant";
import { syntheticBars } from "../lib/marketdata";
import type { Bar, CostSummary, ParamResult, WalkForwardFold } from "../lib/types";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const close = (a: number, b: number, tol: number, what = "") =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} !== ${b} (Δ ${Math.abs(a - b)} > ${tol})`);

/** Deterministic LCG — the house pattern for anything needing randomness. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function paramResult(fast: number, slow: number, sharpe: number): ParamResult {
  return {
    fast, slow, sharpe,
    totalReturn: 0, cagr: 0, sortino: 0, maxDrawdown: -0.1, calmar: 0,
    winRate: 0.5, trades: 40, exposure: 0.5, turnover: 10, feesPaid: 0,
  };
}

function fold(n: number, isSharpe: number, oosSharpe: number, f = 10, s = 40): WalkForwardFold {
  return {
    fold: n,
    trainStart: "", trainEnd: "", testStart: "", testEnd: "",
    chosenFast: f, chosenSlow: s,
    isSharpe, oosSharpe, oosReturn: 0,
  };
}

// --------------------------------------------------------------------------
// The guarantee: frictions off ⇒ nothing changed
// --------------------------------------------------------------------------

describe("the cost model is inert until a researcher switches it on", () => {
  const bars: Bar[] = syntheticBars("BTCUSDT", "4h", 900);
  const n = bars.length;
  const cols = (() => {
    const c = new Float64Array(n);
    const h = new Float64Array(n);
    const l = new Float64Array(n);
    const r = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      c[i] = bars[i].c;
      h[i] = bars[i].h;
      l[i] = bars[i].l;
    }
    for (let i = 1; i < n; i++) r[i] = c[i - 1] !== 0 ? c[i] / c[i - 1] - 1 : 0;
    return { close: c, high: h, low: l, pxRet: r };
  })();

  const base = {
    strategy: "ma_cross" as const,
    direction: "long_only" as const,
    feeBps: 6,
    slippageBps: 2,
    interval: "4h",
  };

  it("turnoverCost with no frictions is exactly the flat expression", () => {
    const model = { feeBps: 6, slippageBps: 2, ...NO_FRICTIONS };
    // Not "close to" — identical. This is the expression the Python engine
    // evaluates, and floating point must reproduce it bit for bit.
    assert.equal(turnoverCost(model, 5_000_000), (6 + 2) / 1e4);
    assert.equal(turnoverCost(model, 0), (6 + 2) / 1e4);
  });

  it("holdingCost with no frictions is exactly zero for every position", () => {
    const model = { feeBps: 6, slippageBps: 2, ...NO_FRICTIONS };
    for (const position of [-1, 0, 1]) {
      assert.equal(holdingCost(model, position, "4h"), 0, `position ${position}`);
    }
  });

  it("a request that omits the friction group reproduces the bare request exactly", () => {
    const bare = runCombo(bars, cols.close, cols.high, cols.low, cols.pxRet, base, 10, 40);
    const explicit = runCombo(
      bars, cols.close, cols.high, cols.low, cols.pxRet,
      { ...base, impactCoefficient: 0, orderNotional: 0, fundingBpsPer8h: 0, borrowBpsAnnual: 0 },
      10, 40,
      averageDailyVolume(bars, "4h"),
    );
    // Every field, exactly — an epsilon here would hide precisely the drift the
    // parity fixture exists to catch.
    assert.deepEqual(explicit.result, bare.result);
    assert.equal(explicit.holdingDrag, 0);
  });

  it("a non-zero friction actually changes the answer, so the switch is real", () => {
    const bare = runCombo(bars, cols.close, cols.high, cols.low, cols.pxRet, base, 10, 40);
    const charged = runCombo(
      bars, cols.close, cols.high, cols.low, cols.pxRet,
      { ...base, fundingBpsPer8h: 3 },
      10, 40,
    );
    assert.ok(
      charged.result.totalReturn < bare.result.totalReturn,
      "funding was configured but cost nothing",
    );
    assert.ok(charged.holdingDrag > 0, "holding drag was not accumulated");
  });

  it("borrow costs nothing in a long-only run and something when short", () => {
    const model = { feeBps: 0, slippageBps: 0, ...NO_FRICTIONS, borrowBpsAnnual: 1000 };
    assert.equal(holdingCost(model, 1, "4h"), 0, "a long position was charged borrow");
    assert.ok(holdingCost(model, -1, "4h") > 0, "a short position was not charged borrow");
  });

  it("square-root impact is concave — 4× the size costs 2× the impact", () => {
    const model = { feeBps: 0, slippageBps: 0, ...NO_FRICTIONS, impactCoefficient: 0.1 };
    const adv = 10_000_000;
    const small = turnoverCost({ ...model, orderNotional: 100_000 }, adv);
    const large = turnoverCost({ ...model, orderNotional: 400_000 }, adv);
    close(large, small * 2, 1e-12, "sqrt impact");
  });

  it("participation is capped at 100% of ADV rather than extrapolating past it", () => {
    const model = { feeBps: 0, slippageBps: 0, ...NO_FRICTIONS, impactCoefficient: 0.2 };
    const adv = 1_000;
    assert.equal(turnoverCost({ ...model, orderNotional: 10 * adv }, adv), 0.2);
  });

  it("hoursPerBar matches the interval table the annualisation uses", () => {
    assert.equal(hoursPerBar("4h"), 4);
    assert.equal(hoursPerBar("1d"), 24);
    // 4h bars: 6 per day × 365 = 2190, the BARS_PER_YEAR entry.
    close((24 / hoursPerBar("4h")) * 365, 2190, 1e-9, "4h bars per year");
  });
});

// --------------------------------------------------------------------------
// Regression
// --------------------------------------------------------------------------

describe("OLS recovers what it was given", () => {
  it("finds known coefficients on a constructed series", () => {
    const rand = lcg(7);
    const n = 4000;
    const x1 = new Float64Array(n);
    const x2 = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x1[i] = rand() - 0.5;
      x2[i] = rand() - 0.5;
      // y = 0.001 + 0.6·x1 - 0.25·x2 + noise
      y[i] = 0.001 + 0.6 * x1[i] - 0.25 * x2[i] + (rand() - 0.5) * 0.02;
    }
    const r = regress(y, [{ name: "a", values: x1 }, { name: "b", values: x2 }], 2190)!;
    assert.ok(r, "regression failed to solve");
    close(r.alpha, 0.001, 5e-4, "alpha");
    close(r.loadings[0].beta, 0.6, 0.02, "beta a");
    close(r.loadings[1].beta, -0.25, 0.02, "beta b");
    assert.ok(r.rSquared > 0.9, `R² too low: ${r.rSquared}`);
  });

  it("a pure market clone loads ~1 on market with almost no residual", () => {
    const rand = lcg(11);
    const n = 3000;
    const pxRet = new Float64Array(n);
    for (let i = 0; i < n; i++) pxRet[i] = (rand() - 0.5) * 0.04;
    const factors = buildFactors(pxRet);
    // The strategy IS buy-and-hold, so the market loading must be 1.
    const r = regress(pxRet, factors.names.map((name, i) => ({ name, values: factors.values[i] })), 2190)!;
    close(r.loadings[0].beta, 1, 1e-6, "market beta of buy-and-hold");
    close(r.alpha, 0, 1e-9, "alpha of buy-and-hold");
    assert.ok(r.idiosyncraticShare < 1e-6, `residual should vanish: ${r.idiosyncraticShare}`);
  });

  it("factors are causal — adding future bars does not change past values", () => {
    // The strongest available test for look-ahead, and the reason the volatility
    // threshold is an expanding mean rather than a full-sample median: with a
    // full-sample statistic, every value on the prefix shifts when the suffix
    // arrives, and this fails on the first factor it checks.
    const rand = lcg(19);
    const n = 600;
    const full = new Float64Array(n);
    for (let i = 0; i < n; i++) full[i] = (rand() - 0.5) * 0.05;
    const prefix = full.slice(0, 400);

    const withFuture = buildFactors(full);
    const withoutFuture = buildFactors(prefix);

    for (let f = 0; f < withFuture.values.length; f++) {
      for (let i = 0; i < prefix.length; i++) {
        assert.equal(
          withFuture.values[f][i],
          withoutFuture.values[f][i],
          `${withFuture.names[f]} at bar ${i} moved when 200 future bars were appended`,
        );
      }
    }
  });

  it("returns null rather than Infinity on a perfectly collinear factor set", () => {
    const n = 500;
    const x = new Float64Array(n);
    const dup = new Float64Array(n);
    const y = new Float64Array(n);
    const rand = lcg(3);
    for (let i = 0; i < n; i++) {
      x[i] = rand();
      dup[i] = x[i]; // exactly the same regressor twice
      y[i] = 2 * x[i];
    }
    assert.equal(regress(y, [{ name: "x", values: x }, { name: "x2", values: dup }], 365), null);
  });

  it("refuses to estimate when there are fewer observations than parameters", () => {
    const y = new Float64Array([1, 2, 3]);
    const f = [{ name: "a", values: new Float64Array([1, 2, 3]) }];
    assert.equal(regress(y, f, 365), null);
  });

  it("reports the pairwise correlations that make a loading unstable", () => {
    const rand = lcg(5);
    const n = 800;
    const a = new Float64Array(n);
    const b = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = rand() - 0.5;
      b[i] = a[i] * 0.95 + (rand() - 0.5) * 0.05; // near-duplicate
      y[i] = a[i];
    }
    const r = regress(y, [{ name: "a", values: a }, { name: "b", values: b }], 365)!;
    assert.equal(r.collinearity.length, 1);
    assert.ok(Math.abs(r.collinearity[0].corr) > 0.9, "high collinearity was not surfaced");
  });
});

// --------------------------------------------------------------------------
// Parameter stability
// --------------------------------------------------------------------------

describe("stability separates a plateau from a cliff", () => {
  /** A 5×5 grid where every cell shares one Sharpe — the definition of a plateau. */
  const flat = () => {
    const out: ParamResult[] = [];
    for (let f = 5; f <= 25; f += 5) for (let s = 30; s <= 70; s += 10) out.push(paramResult(f, s, 1.2));
    return out;
  };

  it("a uniform grid classifies its interior as plateau", () => {
    const report = parameterStability(flat());
    assert.equal(report.best!.kind, "plateau");
    close(report.best!.retention!, 1, 1e-9, "retention on a flat grid");
    assert.equal(report.verdict.level, "pass");
    assert.equal(report.cliffCount, 0);
  });

  it("a lone spike among dead neighbours is a cliff, and the verdict says so", () => {
    const cells = flat().map((c) => paramResult(c.fast, c.slow, 0.01));
    const spike = cells.find((c) => c.fast === 15 && c.slow === 50)!;
    spike.sharpe = 3;
    const report = parameterStability(cells);
    assert.equal(report.best!.fast, 15);
    assert.equal(report.best!.kind, "cliff");
    assert.equal(report.verdict.level, "fail");
    assert.match(report.verdict.headline, /cliff/i);
  });

  it("adjacency is by grid index, not parameter distance", () => {
    // Steps of 5: 20 and 30 are the neighbours of 25. A distance-in-units rule
    // would look for 24 and 26, which were never tested, and every cell would
    // report zero neighbours.
    const report = parameterStability(flat());
    const interior = report.cells.find((c) => c.fast === 15 && c.slow === 50)!;
    assert.equal(interior.neighbours, 8, "interior cell should see all eight neighbours");
    const corner = report.cells.find((c) => c.fast === 5 && c.slow === 30)!;
    assert.equal(corner.neighbours, 3, "corner cell should see three");
  });

  it("a grid-edge winner is called out rather than judged", () => {
    const cells = [paramResult(5, 30, 2), paramResult(10, 30, 0.1)];
    const report = parameterStability(cells);
    assert.equal(report.best!.kind, "isolated");
    assert.equal(report.verdict.level, "marginal");
    assert.match(report.verdict.detail, /edge|boundary/i);
  });

  it("a grid with no profitable cell says so instead of ranking losses", () => {
    const cells = flat().map((c) => paramResult(c.fast, c.slow, -0.5));
    const report = parameterStability(cells);
    assert.equal(report.verdict.level, "fail");
    assert.match(report.verdict.headline, /not profitable/i);
  });
});

// --------------------------------------------------------------------------
// Walk-forward efficiency
// --------------------------------------------------------------------------

describe("walk-forward efficiency refuses to flatter a losing fold", () => {
  const fasts = [5, 10, 15];
  const slows = [30, 40, 50];

  it("efficiency is 1 when out-of-sample matches in-sample", () => {
    const r = walkForwardReport([fold(1, 1.5, 1.5), fold(2, 2, 2)], fasts, slows);
    close(r.medianEfficiency!, 1, 1e-12, "median efficiency");
    assert.equal(r.verdict.level, "pass");
  });

  it("a fold that lost in BOTH windows reports no efficiency at all", () => {
    // -0.5 / -1.0 = +0.5, which would read as "kept half its edge" for a fold
    // that lost money twice. It must be excluded, not included.
    const r = walkForwardReport([fold(1, -1, -0.5)], fasts, slows);
    assert.equal(r.folds[0].efficiency, null);
    assert.equal(r.medianEfficiency, null);
    assert.equal(r.positiveFolds, 0);
  });

  it("counts parameter drift in grid steps between consecutive folds", () => {
    const r = walkForwardReport(
      [fold(1, 1, 1, 5, 30), fold(2, 1, 1, 5, 30), fold(3, 1, 1, 15, 50)],
      fasts,
      slows,
    );
    assert.equal(r.folds[0].paramDrift, null, "the first fold has nothing to drift from");
    assert.equal(r.folds[1].paramDrift, 0);
    assert.equal(r.folds[2].paramDrift, 4, "two steps on each axis");
    close(r.parameterPersistence!, 0.5, 1e-12, "one of two transitions held");
  });

  it("decay is marginal; collapse is a failure", () => {
    const decay = walkForwardReport([fold(1, 2, 0.6), fold(2, 2, 0.5)], fasts, slows);
    assert.equal(decay.verdict.level, "marginal");
    const collapse = walkForwardReport([fold(1, 2, -0.4), fold(2, 2, -0.9)], fasts, slows);
    assert.equal(collapse.verdict.level, "fail");
  });

  it("no folds is a failure, not a pass by absence of evidence", () => {
    const r = walkForwardReport([], fasts, slows);
    assert.equal(r.verdict.level, "fail");
    assert.equal(r.medianEfficiency, null);
  });
});

// --------------------------------------------------------------------------
// Tail risk
// --------------------------------------------------------------------------

describe("tail statistics describe the loss side honestly", () => {
  const bars = syntheticBars("BTCUSDT", "1d", 800);
  const rand = lcg(23);
  const returns = Float64Array.from({ length: bars.length }, () => (rand() - 0.48) * 0.03);
  const equity = (() => {
    const e = new Float64Array(returns.length);
    let eq = 1;
    for (let i = 0; i < returns.length; i++) {
      eq *= 1 + returns[i];
      e[i] = eq;
    }
    return e;
  })();

  const report = tailReport(returns, equity, bars, "1d", 42);

  it("CVaR is at least as bad as VaR at every confidence", () => {
    assert.ok(report.cvar95 <= report.var95, `CVaR95 ${report.cvar95} > VaR95 ${report.var95}`);
    assert.ok(report.cvar99 <= report.var99, `CVaR99 ${report.cvar99} > VaR99 ${report.var99}`);
  });

  it("the 99% threshold is deeper than the 95% one", () => {
    assert.ok(report.var99 <= report.var95, "VaR99 should be at least as deep as VaR95");
  });

  it("CVaR selects the tail by RANK, not by value — a mass of flat bars must not dilute it", () => {
    // The failure this pins: a strategy that is flat most of the time earns
    // exactly 0 on those bars, so the 5th percentile lands on that atom. Taking
    // "everything at or below the threshold" then averages ~99% of the sample.
    // Measured on a real default RSI run it understated CVaR95 by 19.8x and
    // CVaR99 by 99x, and printed both as the same number.
    const flatBars = 1900;
    const losses = Array.from({ length: 45 }, () => -0.02);
    const gains = Array.from({ length: 55 }, () => 0.03);
    const stream = Float64Array.from([...losses, ...new Array(flatBars).fill(0), ...gains]);
    const eq = new Float64Array(stream.length).fill(1);
    const synthetic = syntheticBars("BTCUSDT", "1d", stream.length);

    const r = tailReport(stream, eq, synthetic, "1d", 0);
    const sorted = [...stream].sort((a, b) => a - b);
    const es = (p: number) => {
      const k = Math.max(1, Math.ceil((p / 100) * sorted.length));
      return sorted.slice(0, k).reduce((s, v) => s + v, 0) / k;
    };

    close(r.cvar95, es(5), 1e-15, "CVaR95 is the mean of the worst 5%");
    close(r.cvar99, es(1), 1e-15, "CVaR99 is the mean of the worst 1%");
    assert.ok(
      r.cvar99 < r.cvar95,
      `CVaR99 (${r.cvar99}) must be strictly worse than CVaR95 (${r.cvar95}) here — equality means the tail was picked by value`,
    );
    assert.ok(r.cvar95 <= r.var95, "CVaR must still sit at or below VaR");
  });

  it("worst and best bars bound the whole distribution", () => {
    for (let i = 0; i < returns.length; i++) {
      assert.ok(returns[i] >= report.worstBar && returns[i] <= report.bestBar, `bar ${i} outside range`);
    }
  });

  it("the Ulcer index is non-negative and zero only on a curve that never falls", () => {
    assert.ok(report.ulcerIndex >= 0);
    const rising = Float64Array.from({ length: 50 }, (_, i) => 1 + i * 0.01);
    const flatUlcer = tailReport(new Float64Array(50).fill(0.01), rising, bars.slice(0, 50), "1d", 0);
    close(flatUlcer.ulcerIndex, 0, 1e-12, "ulcer on a monotonically rising curve");
  });

  it("annualised turnover scales the raw sum by the sample length", () => {
    // 800 daily bars ≈ 2.19 years; 42 units of turnover over that is ~19.2/yr.
    close(report.annualisedTurnover, 42 / (800 / 365), 1e-9, "annualised turnover");
  });

  it("monthly returns compound back to the total return", () => {
    const monthly = monthlyReturns(returns, bars);
    const compounded = monthly.reduce((g, m) => g * (1 + m.return), 1) - 1;
    const total = equity[equity.length - 1] - 1;
    close(compounded, total, 1e-9, "monthly compounding");
  });

  it("every bar lands in exactly one month bucket", () => {
    const monthly = monthlyReturns(returns, bars);
    assert.equal(
      monthly.reduce((n, m) => n + m.bars, 0),
      returns.length,
      "bars were lost or double-counted between buckets",
    );
  });
});

// --------------------------------------------------------------------------
// ADV and promotion
// --------------------------------------------------------------------------

describe("the promotion gate is a veto list, not a score", () => {
  const passing = {
    deflatedSharpe: 0.97,
    walkForwardOosSharpe: 0.8,
    medianEfficiency: 0.7,
    stability: "plateau" as const,
    alphaTStat: 3.1,
    maxDrawdown: -0.15,
    trades: 60,
  };

  it("every gate must clear for eligibility", () => {
    assert.equal(promotionGate(passing).eligible, true);
  });

  it("one failing gate blocks promotion regardless of the others", () => {
    for (const override of [
      { deflatedSharpe: 0.5 },
      { walkForwardOosSharpe: -0.1 },
      { medianEfficiency: 0.2 },
      { stability: "cliff" as const },
      { alphaTStat: 0.4 },
      { trades: 5 },
    ]) {
      const gate = promotionGate({ ...passing, ...override });
      assert.equal(gate.eligible, false, `${Object.keys(override)[0]} did not veto`);
      assert.equal(gate.passed, gate.total - 1);
    }
  });

  it("shows every check whether it passed or failed", () => {
    const gate = promotionGate({ ...passing, deflatedSharpe: 0 });
    assert.equal(gate.checks.length, gate.total);
    assert.ok(gate.checks.every((c) => c.why.length > 20), "every gate must explain itself");
  });

  it("a missing measurement fails closed rather than passing by default", () => {
    const gate = promotionGate({
      ...passing,
      walkForwardOosSharpe: null,
      medianEfficiency: null,
      stability: null,
      alphaTStat: null,
    });
    assert.equal(gate.eligible, false);
    assert.equal(gate.passed, 2, "only DSR and trade count should survive");
  });
});

describe("average daily volume is quote-denominated and interval-aware", () => {
  it("scales with the number of bars per day", () => {
    const bars: Bar[] = Array.from({ length: 100 }, (_, i) => ({
      t: i * 3_600_000, o: 100, h: 100, l: 100, c: 100, v: 10,
    }));
    // 10 units × $100 = $1000 per bar; 24 hourly bars per day = $24,000/day.
    close(averageDailyVolume(bars, "1h"), 24_000, 1e-9, "hourly ADV");
    close(averageDailyVolume(bars, "4h"), 6_000, 1e-9, "4h ADV");
  });

  it("an empty series has no volume rather than NaN", () => {
    assert.equal(averageDailyVolume([], "1h"), 0);
  });
});

// --------------------------------------------------------------------------
// Cost summary contract
// --------------------------------------------------------------------------

describe("the cost summary reports what was actually charged", () => {
  it("flags a flat-only run so a reader knows the gateway would agree", () => {
    const summary: CostSummary = {
      flatBps: 8,
      averageDailyVolume: 1e7,
      impactBps: 0,
      participation: 0,
      fundingBpsPer8h: 0,
      borrowBpsAnnual: 0,
      flatOnly: true,
    };
    assert.equal(summary.flatOnly, true);
    assert.equal(summary.impactBps, 0);
  });
});
