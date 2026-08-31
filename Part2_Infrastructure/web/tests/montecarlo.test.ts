import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { monteCarloBands, stationaryBootstrapIndices } from "../lib/montecarlo";
import { gbmTerminalVar99, Z99 } from "../lib/portfolio-risk/risk";
import { mulberry32 } from "../lib/random";
import { runSweep } from "../lib/engine";
import { syntheticBars } from "./helpers/synthetic-bars";
import { DEFAULT_REQUEST } from "../lib/types";

const constantReturns = (n: number, r: number) => new Float64Array(n).fill(r);
const everyIndex = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("stationary bootstrap", () => {
  it("covers [0, n) with exactly n draws", () => {
    const idx = stationaryBootstrapIndices(500, 22, mulberry32(7));
    assert.equal(idx.length, 500);
    for (const i of idx) assert.ok(i >= 0 && i < 500);
  });

  it("continuation frequency matches the mean block length", () => {
    const n = 5000;
    const L = 5;
    const idx = stationaryBootstrapIndices(n, L, mulberry32(11));
    let continues = 0;
    for (let i = 1; i < n; i++) {
      if (idx[i] === (idx[i - 1] + 1) % n) continues++;
    }
    const rate = continues / (n - 1);
    // Expected 1 − 1/L = 0.8, plus a ~1/n sliver where a fresh block happens
    // to land on the successor.
    assert.ok(Math.abs(rate - 0.8) < 0.03, `continuation rate ${rate}`);
  });

  it("mean block length 1 degenerates to iid (no forced continuation)", () => {
    const n = 2000;
    const idx = stationaryBootstrapIndices(n, 1, mulberry32(3));
    let continues = 0;
    for (let i = 1; i < n; i++) {
      if (idx[i] === (idx[i - 1] + 1) % n) continues++;
    }
    // Under iid the successor is hit with probability 1/n.
    assert.ok(continues / (n - 1) < 0.01);
  });
});

describe("monte carlo bands", () => {
  it("is deterministic in the seed and sensitive to it", () => {
    const returns = Float64Array.from({ length: 400 }, (_, i) => Math.sin(i) * 0.01);
    const sample = everyIndex(400).filter((i) => i % 4 === 0);
    const a = monteCarloBands(returns, sample, 42, { paths: 50 });
    const b = monteCarloBands(returns, sample, 42, { paths: 50 });
    const c = monteCarloBands(returns, sample, 43, { paths: 50 });
    assert.deepEqual(a, b);
    assert.notDeepEqual(a.p50, c.p50);
  });

  it("percentiles are ordered at every sampled bar", () => {
    const returns = Float64Array.from({ length: 600 }, (_, i) => ((i * 37) % 11 - 5) * 0.004);
    const sample = everyIndex(600).filter((i) => i % 3 === 0);
    const bands = monteCarloBands(returns, sample, 9, { paths: 120 });
    for (let j = 0; j < sample.length; j++) {
      assert.ok(bands.p05[j] <= bands.p25[j]);
      assert.ok(bands.p25[j] <= bands.p50[j]);
      assert.ok(bands.p50[j] <= bands.p75[j]);
      assert.ok(bands.p75[j] <= bands.p95[j]);
    }
    assert.ok(bands.terminal.p05 <= bands.terminal.p50);
    assert.ok(bands.terminal.p50 <= bands.terminal.p95);
  });

  it("a constant return has a degenerate cone: every band is the curve itself", () => {
    const r = 0.002;
    const n = 100;
    const bands = monteCarloBands(constantReturns(n, r), everyIndex(n), 1, { paths: 20 });
    for (let i = 0; i < n; i++) {
      const expected = (1 + r) ** (i + 1);
      for (const band of [bands.p05, bands.p50, bands.p95]) {
        assert.ok(Math.abs(band[i] - expected) < 1e-12, `bar ${i}`);
      }
    }
    assert.equal(bands.terminal.probLoss, 0);
  });

  it("all-zero returns give flat bands at 1", () => {
    const bands = monteCarloBands(constantReturns(50, 0), everyIndex(50), 5, { paths: 10 });
    for (let i = 0; i < 50; i++) {
      assert.equal(bands.p05[i], 1);
      assert.equal(bands.p95[i], 1);
    }
  });

  it("runSweep attaches bands aligned with the thinned series, JSON-safe", () => {
    const bars = syntheticBars("BTCUSDT", "4h", 1500);
    const out = runSweep(bars, { ...DEFAULT_REQUEST, walkForward: false }, "synthetic");
    assert.equal(out.monteCarlo.p05.length, out.series.length);
    assert.equal(out.monteCarlo.p95.length, out.series.length);
    assert.ok(out.monteCarlo.paths > 0);
    const round = JSON.parse(JSON.stringify(out.monteCarlo));
    assert.ok(Array.isArray(round.p50), "typed array leaked into the payload");
    assert.deepEqual(round, out.monteCarlo);
    // Same sweep, same cone.
    const again = runSweep(bars, { ...DEFAULT_REQUEST, walkForward: false }, "synthetic");
    assert.deepEqual(again.monteCarlo.p50, out.monteCarlo.p50);
  });
});

describe("closed-form GBM terminal VaR — the Oracle panel's parametric check", () => {
  /**
   * The defect these pin shut: the Risk tab's Oracle panel sent an 8% annual
   * drift into the in-database simulation and then compared the result with
   * z99·σ·√t — the ZERO-drift normal shortcut. At 30 days the drift term
   * alone (≈ equity·μ·T) is a −22% "divergence", which the panel's caption
   * blamed on the inputs. The comparison must price the SAME model the
   * procedure simulates: the lognormal quantile with the same μ, σ and
   * 365-day T, floored at zero as `oracle/02_monte_carlo.sql` floors it.
   */

  it("agrees with a large independent simulation of the same model, drift included", () => {
    // The test's own GBM — Box–Muller normals over the procedure's
    // S_T = S0·exp((μ − σ²/2)T + σ√T·Z), T = days/365 — not the code under
    // test run twice. Simulated and closed-form VaR are the same quantity,
    // so at 200,000 paths they differ by sampling error alone.
    const equity = 1_000_000;
    const mu = 0.08;
    const sigma = 0.45;
    const days = 30;
    const t = days / 365;
    const rand = mulberry32(2026);
    const paths = 200_000;
    const terminal = new Float64Array(paths);
    for (let i = 0; i < paths; i += 1) {
      const u1 = 1 - rand(); // (0, 1]: log(0) is the corner Box–Muller has
      const u2 = rand();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      terminal[i] = equity * Math.exp((mu - 0.5 * sigma * sigma) * t + sigma * Math.sqrt(t) * z);
    }
    const sorted = [...terminal].sort((a, b) => a - b);
    const simulated = equity - sorted[Math.floor(paths * 0.01)];
    const closed = gbmTerminalVar99(equity, mu, sigma, days);
    assert.ok(
      Math.abs(simulated - closed) / closed < 0.02,
      `simulated ${simulated} vs closed form ${closed} — the two no longer price one model`,
    );
  });

  it("differs from the zero-drift shortcut by more than the panel's own 15% alarm", () => {
    // The observed book (2026-08-20): σ ≈ 0.044 annualised, 30 days, a $1M
    // book — Oracle $22,868 against a $29,497 shortcut, −22.5%. Right
    // volatility, wrong model: the gap is the drift, so the fix had to
    // change the formula, not widen a tolerance.
    const equity = 1_000_000;
    const sigma = 0.0442;
    const days = 30;
    const closed = gbmTerminalVar99(equity, 0.08, sigma, days);
    const shortcut = Z99 * sigma * Math.sqrt(days / 365) * equity;
    assert.ok(closed < shortcut, "a positive drift must lower the terminal loss quantile");
    assert.ok(
      (shortcut - closed) / shortcut > 0.15,
      "the two formulae genuinely disagree at the observed inputs — if this fails, the "
        + "shortcut would have been inside the alarm and the defect invisible",
    );
  });

  it("reduces to the shortcut exactly where the shortcut was valid: zero drift, short horizon", () => {
    const equity = 1_000_000;
    const sigma = 0.0442;
    const closed = gbmTerminalVar99(equity, 0, sigma, 1);
    const shortcut = Z99 * sigma * Math.sqrt(1 / 365) * equity;
    assert.ok(
      Math.abs(closed - shortcut) / shortcut < 0.005,
      `zero-drift one-day closed form ${closed} should approach ${shortcut}`,
    );
  });

  it("floors at zero as the procedure does, never a negative loss", () => {
    // A rich drift with negligible volatility lifts the whole 1st percentile
    // above the starting equity; `p_var_99` GREATESTs at zero and so must
    // this, or the divergence tile would divide by a negative number.
    assert.equal(gbmTerminalVar99(1_000_000, 1, 0.001, 365), 0);
  });

  it("the Oracle panel prices its comparison from the echoed assumptions with this function", () => {
    // Echoed, not re-asserted: the route clamps its inputs, so a comparison
    // built from the request would report the clamp as method disagreement.
    // And no hand-spelled z — that is how the zero-drift shortcut crept in.
    const panel = readFileSync(
      fileURLToPath(new URL("../components/portfolio/OracleVarPanel.tsx", import.meta.url)),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    assert.match(panel, /gbmTerminalVar99\(assumptions\./);
    assert.doesNotMatch(panel, /2\.32/, "a hand-spelled z99 bypasses the shared closed form");
  });
});
