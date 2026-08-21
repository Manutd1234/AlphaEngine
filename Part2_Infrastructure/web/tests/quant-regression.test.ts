/**
 * OLS recovers what it was given, and the factors cannot see the future.
 *
 * Properties that can be checked without a golden file. A regression handed a
 * constructed series must recover the coefficients used to build it; a strategy
 * that IS buy-and-hold must load 1 on the market with an alpha and a residual
 * of essentially nothing. If either drifts, every factor attribution the
 * research surface prints is decoration.
 *
 * The causality test is the load-bearing one. It appends 200 future bars and
 * requires every value on the prefix to be unchanged — the strongest available
 * test for look-ahead, and the reason the volatility threshold is an expanding
 * mean rather than a full-sample median.
 *
 * The edges matter as much as the centre: a singular design must return null
 * rather than Infinity, too few observations must be refused rather than fitted
 * exactly, and near-duplicate regressors must surface their correlation instead
 * of reporting a confident loading that will not survive the next sample.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildFactors, regress } from "../lib/quant";

import { close, lcg } from "./helpers/quant-fixtures";

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
