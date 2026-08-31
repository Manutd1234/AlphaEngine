import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NAMED_WINDOWS, regimeReport } from "../lib/regimes";
import { runSweep } from "../lib/engine";
import { syntheticBars } from "./helpers/synthetic-bars";
import { BARS_PER_YEAR, DEFAULT_REQUEST, type Bar } from "../lib/types";

const HOUR4 = 144e5;

/** Bars from a close series, timestamped backwards from a fixed anchor. */
function barsFrom(closes: number[], endMs = Date.UTC(2026, 0, 1)): Bar[] {
  return closes.map((c, i) => ({
    t: endMs - (closes.length - i) * HOUR4,
    o: c,
    h: c,
    l: c,
    c,
    v: 1e6,
  }));
}

const f64 = (xs: number[]) => Float64Array.from(xs);
const zeros = (n: number) => new Float64Array(n);

describe("trend classification", () => {
  it("monotone paths land in the expected regime once the SMA fills", () => {
    const n = 400;
    const up = barsFrom(Array.from({ length: n }, (_, i) => 100 * 1.01 ** i));
    const upClose = f64(up.map((b) => b.c));
    const upReport = regimeReport(up, upClose, zeros(n), zeros(n), "4h");
    const bull = upReport.trend.find((r) => r.regime === "bull")!;
    assert.equal(bull.bars, upReport.classifiedBars, "up-path bars must all be bull");

    const down = barsFrom(Array.from({ length: n }, (_, i) => 100 * 0.99 ** i));
    const downClose = f64(down.map((b) => b.c));
    const downReport = regimeReport(down, downClose, zeros(n), zeros(n), "4h");
    const bear = downReport.trend.find((r) => r.regime === "bear")!;
    assert.equal(bear.bars, downReport.classifiedBars);

    const flat = barsFrom(Array.from({ length: n }, () => 100));
    const flatReport = regimeReport(flat, f64(flat.map((b) => b.c)), zeros(n), zeros(n), "4h");
    const side = flatReport.trend.find((r) => r.regime === "sideways")!;
    assert.equal(side.bars, flatReport.classifiedBars);
  });

  it("the deadband holds a small oscillation in sideways", () => {
    const n = 400;
    const closes = Array.from({ length: n }, (_, i) => 100 * (1 + 0.01 * Math.sin(i / 5)));
    const bars = barsFrom(closes);
    const report = regimeReport(bars, f64(closes), zeros(n), zeros(n), "4h");
    const side = report.trend.find((r) => r.regime === "sideways")!;
    assert.equal(side.bars, report.classifiedBars, "±1% wiggle must stay inside the ±2% band");
  });

  it("shares reconcile within each basis", () => {
    const bars = syntheticBars("BTCUSDT", "4h", 1000);
    const close = f64(bars.map((b) => b.c));
    const rets = Float64Array.from(bars, (_, i) => (i ? close[i] / close[i - 1] - 1 : 0));
    const report = regimeReport(bars, close, rets, zeros(1000), "4h");
    const trendShare = report.trend.reduce((s, r) => s + r.share, 0);
    const trendBars = report.trend.reduce((s, r) => s + r.bars, 0);
    assert.ok(Math.abs(trendShare - 1) < 1e-9);
    assert.equal(trendBars, report.classifiedBars);
    const volShare = report.vol.reduce((s, r) => s + r.share, 0);
    assert.ok(Math.abs(volShare - 1) < 1e-9);
    // Median split: neither half smaller than a third of the classified bars.
    const volBars = report.vol.map((r) => r.bars);
    assert.ok(Math.min(...volBars) > (volBars[0] + volBars[1]) / 3);
  });
});

describe("per-regime statistics", () => {
  it("constructed returns produce exact per-regime totals", () => {
    const n = 400;
    const closes = Array.from({ length: n }, (_, i) => 100 * 1.01 ** i); // all bull
    const bars = barsFrom(closes);
    const close = f64(closes);
    const returns = new Float64Array(n).fill(0.01);
    const position = new Float64Array(n).fill(1);
    const report = regimeReport(bars, close, returns, position, "4h");
    const bull = report.trend.find((r) => r.regime === "bull")!;
    assert.ok(Math.abs(bull.totalReturn - (1.01 ** bull.bars - 1)) < 1e-9);
    assert.equal(bull.winRate, 1);
    assert.equal(bull.exposure, 1);
    assert.equal(bull.maxDrawdown, 0);
    assert.ok((bull.sharpe ?? 0) > 0);
    // Constant positive returns annualise to mean/sd·√ann with sd → 0 guard:
    // just assert the sign and the annualisation constant is respected.
    assert.equal(BARS_PER_YEAR["4h"], 2190);
  });

  it("concatenated drawdown matches a hand computation", () => {
    // Monotone +1% climb with a single −30% shock: whatever subset of bars the
    // classifier keeps, the path into the shock is rising, so the worst
    // peak-to-trough is exactly the shock itself.
    const n = 200;
    const closes = Array.from({ length: n }, () => 100); // all sideways
    const bars = barsFrom(closes);
    const returns = Float64Array.from({ length: n }, (_, i) => (i === 120 ? -0.3 : 0.01));
    const report = regimeReport(bars, f64(closes), returns, zeros(n), "4h");
    const side = report.trend.find((r) => r.regime === "sideways")!;
    assert.ok(Math.abs(side.maxDrawdown - -0.3) < 1e-9, `got ${side.maxDrawdown}`);
  });

  it("tiny regimes report a null Sharpe instead of noise", () => {
    const n = 60;
    const closes = Array.from({ length: n }, (_, i) => 100 * 1.01 ** i);
    const bars = barsFrom(closes);
    const report = regimeReport(bars, f64(closes), zeros(n), zeros(n), "4h");
    for (const row of [...report.trend, ...report.vol]) {
      if (row.bars < 20) assert.equal(row.sharpe, null);
    }
  });
});

describe("named stress windows", () => {
  it("bars spanning Nov 2022 cover the FTX window", () => {
    const n = 800; // 800 4h bars ≈ 133 days ending Jan 2023 — spans Nov 2022
    const closes = Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 9));
    const bars = barsFrom(closes, Date.UTC(2023, 0, 15));
    const report = regimeReport(bars, f64(closes), zeros(n), zeros(n), "4h");
    const ftx = report.windows.find((w) => w.id === "ftx")!;
    assert.equal(ftx.covered, true);
    assert.ok(ftx.coverage > 0.99);
    assert.ok(ftx.stat && ftx.stat.bars >= 30);
    const covid = report.windows.find((w) => w.id === "covid")!;
    assert.equal(covid.covered, false);
    assert.equal(covid.stat, null);
  });

  it("recent-only data lists every window as uncovered, never omits one", () => {
    const bars = syntheticBars("BTCUSDT", "4h", 500);
    const close = f64(bars.map((b) => b.c));
    const report = regimeReport(bars, close, zeros(500), zeros(500), "4h");
    assert.equal(report.windows.length, NAMED_WINDOWS.length);
    for (const w of report.windows) {
      assert.equal(w.covered, false);
      assert.equal(w.stat, null);
    }
  });
});

describe("engine integration", () => {
  it("runSweep attaches a JSON-safe regime report", () => {
    const bars = syntheticBars("ETHUSDT", "4h", 1200);
    const out = runSweep(bars, { ...DEFAULT_REQUEST, symbol: "ETHUSDT", walkForward: false }, "synthetic");
    assert.equal(out.regimes.totalBars, 1200);
    assert.equal(out.regimes.trend.length, 3);
    assert.equal(out.regimes.vol.length, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(out.regimes)), out.regimes);
    // Determinism.
    const again = runSweep(bars, { ...DEFAULT_REQUEST, symbol: "ETHUSDT", walkForward: false }, "synthetic");
    assert.deepEqual(again.regimes, out.regimes);
  });
});
