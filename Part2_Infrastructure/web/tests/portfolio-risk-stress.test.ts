/**
 * A stress total may not contain exposure nobody measured.
 *
 * A scenario shocks a handful of names and asks what the rest of the book does.
 * The honest answer for an instrument with no shared history is "we cannot
 * say", and this file exists because the convenient answer is beta 1: an
 * instrument whose beta cannot be measured must move by nothing rather than by
 * a default of 1, because a stress total inflated by invented exposure is worse
 * than one that admits a gap.
 *
 * The rest of the block pins the arithmetic either side of that rule — an
 * explicit shock is used verbatim rather than routed through a beta, an
 * unshocked position moves by its *measured* beta, a short gains when the
 * market falls, and the flat scenario moves nothing at all.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SCENARIOS,
  applyScenario,
  beta,
  manualShocks,
  type ReturnsBySymbol,
} from "../lib/portfolio-risk";
import { close, correlatedSeries } from "./helpers/risk-series";

describe("stress testing never invents exposure", () => {
  const [a, b] = correlatedSeries(300, 0.8, 3);
  const returns: ReturnsBySymbol = { BTCUSDT: a, ETHUSDT: b };

  it("an explicitly shocked position uses the shock, not a beta", () => {
    const r = applyScenario(
      [{ symbol: "BTCUSDT", signedNotional: 1_000_000 }],
      10_000_000,
      [{ symbol: "BTCUSDT", move: -0.2 }],
      returns,
      "BTCUSDT",
    );
    close(r.totalPnl, -200_000, 1e-9, "1M long, -20%");
    assert.equal(r.perPosition[0].viaBeta, false);
  });

  it("an unshocked position moves by its MEASURED beta", () => {
    const r = applyScenario(
      [{ symbol: "ETHUSDT", signedNotional: 1_000_000 }],
      10_000_000,
      [{ symbol: "BTCUSDT", move: -0.1 }],
      returns,
      "BTCUSDT",
    );
    const measured = beta("ETHUSDT", "BTCUSDT", returns)!;
    assert.ok(measured > 0, "these series are positively related");
    close(r.perPosition[0].appliedMove, measured * -0.1, 1e-12, "move = beta x shock");
    assert.equal(r.perPosition[0].viaBeta, true);
  });

  it("an unmeasurable position is held FLAT, not defaulted to beta 1", () => {
    // Defaulting to 1 is how a stress total quietly becomes fiction.
    const r = applyScenario(
      [{ symbol: "UNKNOWN", signedNotional: 5_000_000 }],
      10_000_000,
      [{ symbol: "BTCUSDT", move: -0.3 }],
      returns,
      "BTCUSDT",
    );
    assert.equal(beta("UNKNOWN", "BTCUSDT", returns), null, "no history means no beta");
    assert.equal(r.perPosition[0].appliedMove, 0, "no measurable beta must mean no assumed move");
    assert.equal(r.totalPnl, 0);
  });

  it("a short profits from a down shock", () => {
    const r = applyScenario(
      [{ symbol: "BTCUSDT", signedNotional: -2_000_000 }],
      10_000_000,
      [{ symbol: "BTCUSDT", move: -0.25 }],
      returns,
      "BTCUSDT",
    );
    assert.ok(r.totalPnl > 0, `a short should gain when the market falls, got ${r.totalPnl}`);
    close(r.totalPnl, 500_000, 1e-9, "2M short, -25%");
  });

  it("the no-shock baseline moves nothing", () => {
    const flat = SCENARIOS.find((s) => s.id === "flat")!;
    const r = applyScenario(
      [{ symbol: "BTCUSDT", signedNotional: 1_000_000 }, { symbol: "ETHUSDT", signedNotional: -500_000 }],
      10_000_000,
      flat.shocks,
      returns,
      "BTCUSDT",
    );
    close(r.totalPnl, 0, 1e-9, "a zero shock must produce zero P&L");
  });

  it("both hand sliders change a one-position book, independent of order", () => {
    const positions = [{ symbol: "BTCUSDT", signedNotional: 25_346 }];
    const score = (manual: Record<string, number>) => applyScenario(
      positions,
      1_000_000,
      manualShocks(manual, positions.map((position) => position.symbol)),
      returns,
      "BTCUSDT",
    );

    close(score({ BTCUSDT: 22 }).totalPnl, 5_576.12, 1e-9, "BTC overlay");
    close(score({ "*": -12 }).totalPnl, -3_041.52, 1e-9, "broad book");
    const combined = score({ BTCUSDT: 22, "*": -12 });
    close(combined.perPosition[0].appliedMove, 0.10, 1e-12, "broad + BTC overlay");
    close(combined.totalPnl, 2_534.60, 1e-9, "both sliders");
    close(score({ "*": -12, BTCUSDT: 22 }).totalPnl, combined.totalPnl, 1e-9, "slider order");
    close(score({ "*": -12, BTCUSDT: 0 }).totalPnl, -3_041.52, 1e-9, "zero overlay");
  });

  it("manual broad-book overlays do not change named-scenario precedence", () => {
    const cascade = SCENARIOS.find((scenario) => scenario.id === "crypto_cascade")!;
    const result = applyScenario(
      [{ symbol: "BTCUSDT", signedNotional: 1_000 }],
      10_000,
      cascade.shocks,
      returns,
      "BTCUSDT",
    );
    close(result.perPosition[0].appliedMove, -0.2, 1e-12, "preset BTC move");
  });
});
