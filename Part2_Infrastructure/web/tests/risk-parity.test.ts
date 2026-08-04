/**
 * One risk engine, two implementations, one test that proves it.
 *
 * `modules/quant_risk.py` and `lib/portfolio-risk.ts` compute the same
 * quantities because neither can reach the other: the Telegram companion is a
 * Python process that cannot call a browser bundle, and the browser cannot call
 * into the gateway's memory. Two implementations of one calculation is two
 * chances to be wrong, and the failure mode is the worst kind — a trader reads
 * one VaR on their phone and a different one on the screen, and neither is
 * flagged as suspect.
 *
 * So the Python side is the reference, `tools/make_risk_fixture.py` records its
 * answers, and this asserts the TypeScript reproduces them. Regenerate the
 * fixture only when the maths is deliberately changed on both sides.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyScenario,
  buildCovariance,
  proposeAllocation,
  rollingVarBacktest,
  type ReturnsBySymbol,
  type RiskPosition,
} from "../lib/portfolio-risk";

interface Fixture {
  window: number;
  history: ReturnsBySymbol;
  positions: RiskPosition[];
  expected: {
    varBacktest: {
      observations: number;
      exceptions: number;
      expectedExceptions: number;
      exceptionRate: number;
      kupiecStatistic: number;
      zone: string;
    };
    historicalVar: { var95: number; cvar95: number; observations: number };
    allocation: {
      method: string;
      grossBefore: number;
      targets: Array<{ symbol: string; targetWeight: number; targetNotional: number }>;
    };
    scenario: {
      totalPnl: number;
      usedBeta: boolean;
      legs: Array<{ symbol: string; appliedMove: number; pnl: number; viaBeta: boolean }>;
    };
  };
}

const fixture: Fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/risk-parity.json", import.meta.url)), "utf8"),
);

describe("the VaR backtest agrees with the Python reference", () => {
  const result = rollingVarBacktest(fixture.positions, fixture.history, fixture.window);

  it("scores the same number of observations", () => {
    assert.ok(result);
    assert.equal(result.observations, fixture.expected.varBacktest.observations);
  });

  it("counts the same exceptions", () => {
    // The exception count is the whole test: it depends on the rolling window,
    // the sigma convention (ddof=1) and the Z95 constant all matching.
    assert.equal(result!.exceptions, fixture.expected.varBacktest.exceptions);
    assert.equal(result!.expectedExceptions, fixture.expected.varBacktest.expectedExceptions);
  });

  it("computes the same Kupiec statistic", () => {
    assert.ok(
      Math.abs(result!.kupiecStatistic - fixture.expected.varBacktest.kupiecStatistic) < 1e-3,
      `${result!.kupiecStatistic} vs ${fixture.expected.varBacktest.kupiecStatistic}`,
    );
  });

  it("reaches the same verdict", () => {
    // The p-value uses an error-function approximation in TypeScript and an
    // exact erfc in Python, so the two can differ in the sixth decimal. The
    // *zone* is what a risk manager acts on, and it must not.
    assert.equal(result!.zone, fixture.expected.varBacktest.zone);
  });
});

describe("scenario propagation agrees with the Python reference", () => {
  const result = applyScenario(
    fixture.positions,
    1_000_000,
    [{ symbol: "BTCUSDT", move: -0.2 }],
    fixture.history,
    "BTCUSDT",
  );

  it("produces the same book-level loss", () => {
    assert.ok(Math.abs(result.totalPnl - fixture.expected.scenario.totalPnl) < 1e-6);
  });

  it("measures the same beta and applies the same move per leg", () => {
    for (const expected of fixture.expected.scenario.legs) {
      const leg = result.perPosition.find((p) => p.symbol === expected.symbol);
      assert.ok(leg, `${expected.symbol} missing from the TypeScript result`);
      assert.ok(
        Math.abs(leg.appliedMove - expected.appliedMove) < 1e-6,
        `${expected.symbol}: ${leg.appliedMove} vs ${expected.appliedMove}`,
      );
      assert.equal(leg.viaBeta, expected.viaBeta);
      assert.ok(Math.abs(leg.pnl - expected.pnl) < 1e-6);
    }
  });

  it("agrees that a beta was measurable at all", () => {
    // If one engine measures a beta and the other does not, they are stressing
    // different books — and the one that could not measure reports a smaller
    // loss, which is the dangerous direction.
    assert.equal(result.usedBeta, fixture.expected.scenario.usedBeta);
  });
});

describe("the allocation solve agrees with the Python reference", () => {
  const model = buildCovariance(Object.keys(fixture.history), fixture.history);
  const proposal = model ? proposeAllocation(fixture.positions, model, "equal_risk") : null;

  it("produces a proposal at all", () => {
    assert.ok(proposal, "the TypeScript engine declined where the Python one did not");
    assert.equal(proposal.method, fixture.expected.allocation.method);
  });

  it("converges on the same weights", () => {
    // Both sides run the same fixed-point iteration toward equal risk
    // contribution. Two solvers that stop at slightly different points would
    // hand a PM two different books to trade toward.
    for (const expected of fixture.expected.allocation.targets) {
      const target = proposal!.targets.find((t) => t.symbol === expected.symbol);
      assert.ok(target, `${expected.symbol} missing from the TypeScript proposal`);
      assert.ok(
        Math.abs(target.targetWeight - expected.targetWeight) < 1e-4,
        `${expected.symbol}: ${target.targetWeight} vs ${expected.targetWeight}`,
      );
    }
  });

  it("sizes the same gross book", () => {
    assert.ok(Math.abs(proposal!.grossBefore - fixture.expected.allocation.grossBefore) < 1e-6);
  });
});

describe("the fixture itself stays honest", () => {
  it("contains a book with both a long and a short", () => {
    // A same-signed book would hide sign errors in the propagation: every
    // engine agrees on the direction of a loss when everything points one way.
    assert.ok(fixture.positions.some((p) => p.signedNotional > 0));
    assert.ok(fixture.positions.some((p) => p.signedNotional < 0));
  });

  it("has enough history for the rolling window to score anything", () => {
    const shortest = Math.min(...Object.values(fixture.history).map((s) => s.length));
    assert.ok(shortest >= fixture.window + 20);
  });
});
