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
  ALLOCATION_METHODS,
  applyScenario,
  buildCovariance,
  portfolioVariance,
  proposeAllocation,
  rebalanceTrades,
  rollingVarBacktest,
  type AllocationMethod,
  type AllocationProposal,
  type ReturnsBySymbol,
  type RiskPosition,
} from "../lib/portfolio-risk";

interface ExpectedProposal {
  method: string;
  grossBefore: number;
  grossAfter: number;
  clipped: boolean;
  targets: Array<{
    symbol: string;
    targetWeight: number;
    targetNotional: number;
    clippedBy: string | null;
  }>;
}

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
      history: ReturnsBySymbol;
      positions: RiskPosition[];
      limits: { maxSymbolNotional: number; maxGrossNotional: number };
      methods: Record<string, ExpectedProposal>;
      clipped: ExpectedProposal;
      trades: Array<{ symbol: string; side: string; notional: number }>;
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

// --------------------------------------------------------------------------
// Allocation
//
// The allocation methods run on their own book. The VaR history above is
// exactly collinear by design — ETHUSDT is 1.5x BTCUSDT so the measured beta is
// a known quantity — which makes its covariance singular, and a minimum-variance
// objective on a singular covariance is flat along a direction. Two correct
// implementations would wander apart there for reasons that say nothing about
// either of them.
// --------------------------------------------------------------------------

const allocation = fixture.expected.allocation;
const allocationModel = buildCovariance(Object.keys(allocation.history), allocation.history);

/** Compared per symbol, never per index — see the note in make_risk_fixture.py. */
function assertTargets(
  proposal: AllocationProposal | null,
  expected: ExpectedProposal,
  label: string,
): void {
  // `assert.fail` rather than `assert.ok`: it returns `never`, so the narrowing
  // is ordinary control flow. An assertion signature inside a named function
  // whose own type is still being inferred makes the narrowing circular, and
  // every field below silently degrades to `any`.
  if (!proposal) assert.fail(`${label}: the TypeScript engine declined where the Python one did not`);
  const actual: AllocationProposal = proposal;

  assert.equal(actual.method, expected.method, `${label}: method`);
  assert.equal(actual.targets.length, expected.targets.length, `${label}: target count`);

  for (const want of expected.targets) {
    const found = actual.targets.find((t) => t.symbol === want.symbol);
    if (!found) assert.fail(`${label}: ${want.symbol} missing from the TypeScript proposal`);
    const got = found;
    assert.ok(
      Math.abs(got.targetWeight - want.targetWeight) < 1e-4,
      `${label}/${want.symbol}: weight ${got.targetWeight} vs ${want.targetWeight}`,
    );
    // Python rounds notionals to 2dp with banker's rounding and JavaScript does
    // not round at all, so a cent of disagreement here is the rounding rule, not
    // the solver. The weight above is the assertion that matters.
    assert.ok(
      Math.abs(got.targetNotional - want.targetNotional) < 0.01,
      `${label}/${want.symbol}: notional ${got.targetNotional} vs ${want.targetNotional}`,
    );
    assert.equal(got.clippedBy, want.clippedBy, `${label}/${want.symbol}: clippedBy`);
  }

  assert.ok(
    Math.abs(actual.grossBefore - expected.grossBefore) < 1e-6,
    `${label}: grossBefore ${actual.grossBefore} vs ${expected.grossBefore}`,
  );
  assert.ok(
    Math.abs(actual.grossAfter - expected.grossAfter) < 0.01,
    `${label}: grossAfter ${actual.grossAfter} vs ${expected.grossAfter}`,
  );
  assert.equal(actual.clipped, expected.clipped, `${label}: clipped flag`);
}

for (const method of ALLOCATION_METHODS) {
  describe(`the ${method} solve agrees with the Python reference`, () => {
    it("reaches the same weights, notionals and gross", () => {
      assert.ok(allocationModel, "the allocation covariance failed to build");
      const expected = allocation.methods[method];
      assert.ok(expected, `the fixture carries no ${method} block — regenerate it`);
      assertTargets(
        proposeAllocation(allocation.positions, allocationModel, method),
        expected,
        method,
      );
    });
  });
}

describe("a clipped allocation names the limit that bound it", () => {
  it("reproduces the Python answer under the gateway's own limits", () => {
    assert.ok(allocationModel);
    assertTargets(
      proposeAllocation(allocation.positions, allocationModel, "min_variance", {
        maxSymbolNotional: allocation.limits.maxSymbolNotional,
        maxGrossNotional: allocation.limits.maxGrossNotional,
      }),
      allocation.clipped,
      "min_variance/clipped",
    );
  });

  it("holds every target at or under the symbol cap", () => {
    assert.ok(allocationModel);
    const proposal = proposeAllocation(allocation.positions, allocationModel, "min_variance", {
      maxSymbolNotional: allocation.limits.maxSymbolNotional,
      maxGrossNotional: allocation.limits.maxGrossNotional,
    });
    assert.ok(proposal);
    assert.equal(proposal.clipped, true, "this book is meant to clip — the fixture is not exercising it");
    for (const target of proposal.targets) {
      assert.ok(
        target.targetNotional <= allocation.limits.maxSymbolNotional + 1e-6,
        `${target.symbol} exceeds the symbol cap`,
      );
    }
  });
});

describe("rebalance trades agree with the Python reference", () => {
  it("proposes the same side and size per symbol", () => {
    assert.ok(allocationModel);
    const proposal = proposeAllocation(allocation.positions, allocationModel, "min_variance");
    assert.ok(proposal);
    const trades = rebalanceTrades(proposal, allocation.positions, 0.05);

    assert.equal(trades.length, allocation.trades.length);
    for (const want of allocation.trades) {
      const got = trades.find((t) => t.symbol === want.symbol);
      assert.ok(got, `${want.symbol} missing from the TypeScript trade list`);
      assert.equal(got.side, want.side, `${want.symbol}: side`);
      assert.ok(
        Math.abs(got.notional - want.notional) < 0.01,
        `${want.symbol}: ${got.notional} vs ${want.notional}`,
      );
    }
    // `reason` is deliberately not compared: Python's percent formatting and
    // JavaScript's toFixed round half-way values in opposite directions, and a
    // prose string is not the property this fixture exists to pin.
  });
});

describe("the allocation methods hold their own definitions", () => {
  // These need no fixture — they are properties of the method, not of a
  // particular book, and they fail loudly if a solver is quietly rewired.
  it("equal weight is exactly 1/n regardless of volatility", () => {
    assert.ok(allocationModel);
    const proposal = proposeAllocation(allocation.positions, allocationModel, "equal_weight");
    assert.ok(proposal);
    const n = proposal.targets.length;
    for (const target of proposal.targets) {
      assert.ok(
        Math.abs(target.targetWeight - 1 / n) < 1e-9,
        `${target.symbol}: ${target.targetWeight} is not 1/${n}`,
      );
    }
  });

  it("minimum variance is no more volatile than inverse volatility", () => {
    assert.ok(allocationModel);
    const weightsOf = (method: AllocationMethod) => {
      const proposal = proposeAllocation(allocation.positions, allocationModel, method);
      assert.ok(proposal);
      return new Map(proposal.targets.map((t) => [t.symbol, t.targetWeight]));
    };
    const minimum = weightsOf("min_variance");
    const inverse = weightsOf("inverse_vol");
    assert.ok(
      portfolioVariance(allocationModel, minimum) <= portfolioVariance(allocationModel, inverse),
      "the minimum-variance solve returned a more volatile book than its own seed family",
    );
  });

  it("leaves unclipped weights summing to one", () => {
    assert.ok(allocationModel);
    for (const method of ALLOCATION_METHODS) {
      const proposal = proposeAllocation(allocation.positions, allocationModel, method);
      assert.ok(proposal);
      const total = proposal.targets.reduce((acc, t) => acc + t.targetWeight, 0);
      assert.ok(Math.abs(total - 1) < 1e-9, `${method}: weights sum to ${total}`);
    }
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

  it("allocates on a book the solvers can actually disagree about", () => {
    // The VaR book is exactly collinear on purpose. If the allocation book were
    // too, the covariance would be singular and every method above would be
    // asserting agreement about an arbitrary point on a flat objective.
    assert.ok(allocationModel, "the allocation covariance failed to build");
    const size = allocationModel.symbols.length;
    assert.ok(size >= 3, "two names cannot show a correlation structure worth solving");

    let worst = 0;
    let negative = false;
    for (let i = 0; i < size; i++) {
      for (let j = i + 1; j < size; j++) {
        worst = Math.max(worst, Math.abs(allocationModel.correlation[i][j]));
        if (allocationModel.correlation[i][j] < 0) negative = true;
      }
    }
    assert.ok(worst < 0.9, `the allocation book is near-collinear (worst |rho| ${worst})`);
    assert.ok(negative, "no negatively correlated pair — correlation-aware methods have nothing to do");
  });

  it("makes minimum variance a distinguishable answer", () => {
    // Without this the entire min_variance suite can pass while proving
    // nothing: if the solver silently degraded to inverse-vol, every weight
    // assertion above would still hold.
    const minimum = allocation.methods.min_variance;
    const inverse = allocation.methods.inverse_vol;
    assert.ok(minimum && inverse, "the fixture is missing a method block — regenerate it");

    const bySymbol = new Map(inverse.targets.map((t) => [t.symbol, t.targetWeight]));
    const spread = Math.max(
      ...minimum.targets.map((t) => Math.abs(t.targetWeight - (bySymbol.get(t.symbol) ?? 0))),
    );
    assert.ok(spread > 1e-3, `min_variance is indistinguishable from inverse_vol (max gap ${spread})`);
  });
});
