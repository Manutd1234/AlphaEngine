/**
 * The bar contract — the defects a backtest cannot see.
 *
 * A duplicated timestamp double-counts a return and makes a strategy look
 * calmer than the market. A hole in the middle of a series is traded straight
 * through. Neither throws, neither renders oddly, and both change the number a
 * researcher takes a decision on.
 *
 * The hard part is not detection, it is the threshold. A gap rule tight enough
 * to catch a missing week fires on every weekend and every public holiday, and
 * a warning that appears on every well-formed equity series is one a reader
 * learns to scroll past. So the thresholds here are MEASURED against real
 * vendor series, and the tests that pin them say what they were measured on.
 *
 * The same contract exists a second time in Python for backfilled bars, and
 * the last suite here holds the two to one fixture.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkBars } from "../lib/providers/contracts";
import type { OhlcvBar } from "../lib/providers/types";

import { NOW } from "./helpers/contract-fixtures";

function bars(count: number, stepMs = 3_600_000): OhlcvBar[] {
  return Array.from({ length: count }, (_, i) => ({
    t: NOW - (count - i) * stepMs,
    o: 100, h: 101, l: 99, c: 100.5, v: 1000,
  }));
}

describe("bar series are checked for the defects a backtest cannot see", () => {
  it("passes a clean, evenly spaced series", () => {
    const result = checkBars("binance", bars(200), 200);
    assert.equal(result.passed, true);
    assert.deepEqual(result.violations, []);
  });

  it("rejects a duplicated timestamp, which double-counts a return", () => {
    const series = bars(50);
    series[20] = { ...series[20], t: series[19].t };
    const result = checkBars("binance", series, 50);
    assert.equal(result.passed, false);
    // This is the defect that makes a strategy look calmer than the market.
    assert.ok(result.violations.some((v) => v.check === "bars.unique_timestamps"));
  });

  it("rejects bars that arrive out of order", () => {
    const series = bars(50);
    [series[10], series[11]] = [series[11], series[10]];
    const result = checkBars("binance", series, 50);
    assert.equal(result.passed, false);
    assert.ok(result.violations.some((v) => v.check === "bars.monotonic"));
  });

  it("rejects an inverted bar", () => {
    const series = bars(50);
    series[5] = { ...series[5], h: 90, l: 110 };
    const result = checkBars("binance", series, 50);
    assert.equal(result.passed, false);
    assert.ok(result.violations.some((v) => v.check === "bars.high_ge_low"));
  });

  it("warns about a short window without refusing it", () => {
    // A young instrument legitimately has less history; the researcher needs to
    // know their window shrank, not to be denied the data.
    const result = checkBars("binance", bars(40), 200);
    assert.equal(result.passed, true);
    assert.ok(result.violations.some((v) => v.check === "bars.coverage"));
  });

  it("warns about missing bars a strategy would trade straight through", () => {
    const series = bars(100);
    // Drop a stretch of the middle, leaving a hole in the spacing.
    const holed = [...series.slice(0, 40), ...series.slice(55)];
    const result = checkBars("binance", holed, holed.length);
    const gap = result.violations.find((v) => v.check === "bars.no_gaps");
    assert.ok(gap, "a 15-bar hole must be reported");
    // Usable, but the researcher must know the two sides are not consecutive.
    assert.equal(result.passed, true);
    assert.equal(gap.severity, "warn");
  });

  it("does not mistake a weekend for missing data", () => {
    // Daily equity bars gap 3x every Friday-to-Monday and are complete. A rule
    // that counted gaps would fire on every well-formed equity series there is.
    const day = 86_400_000;
    const series: OhlcvBar[] = [];
    let t = Date.UTC(2026, 0, 5); // a Monday
    for (let week = 0; week < 8; week++) {
      for (let d = 0; d < 5; d++) {
        series.push({ t, o: 100, h: 101, l: 99, c: 100.5, v: 1000 });
        t += day;
      }
      t += 2 * day; // the weekend
    }
    const result = checkBars("tiingo", series, series.length);
    assert.ok(!result.violations.some((v) => v.check === "bars.no_gaps"));
  });

  it("does not mistake an exchange holiday for missing data either", () => {
    // MEASURED, not theorised. The threshold was 3x, which passes the weekend
    // test above and then fires on every real US equity series: AAPL from
    // Massive reports a largest gap of exactly 4.0x the median, because a
    // holiday Monday makes a four-day weekend and there are about nine of those
    // a year. A warning that appears on every complete equity series is one a
    // reader learns to scroll past.
    const day = 86_400_000;
    const series: OhlcvBar[] = [];
    let t = Date.UTC(2026, 0, 5); // a Monday
    for (let week = 0; week < 10; week++) {
      // Week 4 loses its Monday to a public holiday: Thursday close to the
      // following Tuesday open is four days.
      const sessions = week === 4 ? 4 : 5;
      if (week === 4) t += day;
      for (let d = 0; d < sessions; d++) {
        series.push({ t, o: 100, h: 101, l: 99, c: 100.5, v: 1000 });
        t += day;
      }
      t += 2 * day;
    }
    const result = checkBars("massive", series, series.length);
    const gap = result.violations.find((v) => v.check === "bars.no_gaps");
    assert.equal(gap, undefined, `a public holiday was reported as missing data: ${gap?.message}`);
  });

  it("still catches a hole a holiday cannot explain", () => {
    // The threshold has to stay useful. A full missing week is 7x on daily
    // bars, comfortably above the 4.5x a long weekend reaches.
    const day = 86_400_000;
    const series: OhlcvBar[] = [];
    let t = Date.UTC(2026, 0, 5);
    for (let i = 0; i < 60; i++) {
      series.push({ t, o: 100, h: 101, l: 99, c: 100.5, v: 1000 });
      t += i === 30 ? 9 * day : day;
    }
    const result = checkBars("massive", series, series.length);
    assert.ok(
      result.violations.some((v) => v.check === "bars.no_gaps"),
      "a nine-day hole in a daily series was not reported",
    );
  });

  it("treats an empty series as a failure with nothing evaluated", () => {
    const result = checkBars("binance", [], 100);
    assert.equal(result.passed, false);
    assert.equal(result.violations[0].check, "bars.non_empty");
    assert.ok(result.notEvaluated.length > 0);
  });
});

describe("the bar contract exists twice and the two agree", () => {
  // checkBars here; check_bars_rows in modules/data_jobs.py for backfilled
  // bars. Both suites evaluate the same fixture and must report the same
  // check ids and the same verdict — the discipline gate-parity.json applies
  // to the pre-trade arithmetic, applied to the data contract.
  it("checkBars reports the fixture's check ids and verdicts", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/bars-contract-parity.json", import.meta.url)), "utf8")) as {
      cases: Array<{ name: string; requested: number; bars: number[][]; passed: boolean; checks: string[] }>;
    };
    assert.ok(fixture.cases.length >= 5);
    for (const testCase of fixture.cases) {
      const bars: OhlcvBar[] = testCase.bars.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));
      const result = checkBars("fixture", bars, testCase.requested);
      assert.equal(result.passed, testCase.passed, testCase.name);
      assert.deepEqual(result.violations.map((v) => v.check).sort(), [...testCase.checks].sort(), testCase.name);
    }
  });
});
