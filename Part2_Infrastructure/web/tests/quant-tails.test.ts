/**
 * Tail statistics describe the loss side honestly.
 *
 * Properties checkable without a golden file: CVaR must sit at or below its VaR
 * at every confidence, the 99% threshold must be at least as deep as the 95%
 * one, the worst and best bars must bound the whole distribution, the Ulcer
 * index must be zero only on a curve that never falls, and monthly returns must
 * compound back to the total with every bar in exactly one bucket.
 *
 * The rank-versus-value test is the one with a measured failure behind it. A
 * strategy that is flat most of the time earns exactly 0 on those bars, so the
 * 5th percentile lands on that atom; taking "everything at or below the
 * threshold" then averages ~99% of the sample. On a real default RSI run that
 * understated CVaR95 by 19.8x and CVaR99 by 99x and printed both as the same
 * number — a tail figure wrong by two orders of magnitude, in the reassuring
 * direction, that looks perfectly reasonable on the screen.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { monthlyReturns, tailReport } from "../lib/quant";
import { syntheticBars } from "../lib/marketdata";

import { close, lcg } from "./helpers/quant-fixtures";

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
