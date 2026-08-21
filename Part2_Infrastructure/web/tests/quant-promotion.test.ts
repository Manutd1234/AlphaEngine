/**
 * The promotion gate is a veto list, not a score.
 *
 * Every check is a veto: one failure blocks promotion however good the others
 * are, because a strategy with a spectacular Sharpe and a cliff for a parameter
 * surface is not a strategy. A weighted score would let one strong number buy
 * off a failed gate, which is the exact behaviour a gate exists to prevent.
 *
 * The two quiet failures are asserted directly. A missing measurement must fail
 * closed — an absent walk-forward result is not a passed one, and defaulting it
 * to true promotes on evidence nobody produced. And every check must carry its
 * own explanation, so a blocked researcher reads a reason rather than a red
 * light, and the gate that is wrong can be argued with.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { promotionGate } from "../lib/quant";

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
