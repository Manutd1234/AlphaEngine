/**
 * Manual target weights.
 *
 * The one place on this surface where a number comes from a person rather than
 * a solver. What matters is that the panel never quietly edits it: a typed
 * weight that does not add up has to be reported, not rescaled.
 *
 * That is the same honesty rule the rest of the risk maths obeys, pointed at
 * the reader's own input. Rescaling a book that sums to 1.12 back down to 1
 * would produce a proposal nobody typed and no error anybody could see, so the
 * over-allocation is carried through to `balanced: false` and the remainder is
 * simply left unfunded. The clip a symbol cap imposes is reported the other way
 * round — the gateway's opinion is named as such, and the pre-clip sum still
 * tells the reader whether *their* numbers balanced.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyManualWeights,
  buildCovariance,
  proposeAllocation,
  rebalanceTrades,
  type ReturnsBySymbol,
} from "../lib/portfolio-risk";

function _threeAssetProposal() {
  const base = Array.from({ length: 80 }, (_, i) => 0.004 * (i % 2 ? 1 : -1) + 0.0006 * ((i % 7) - 3));
  const swing = Array.from({ length: 80 }, (_, i) => 0.0015 * ((i % 5) - 2) + 0.0004 * (i % 3 ? 1 : -1));
  const history: ReturnsBySymbol = {
    AAA: base,
    BBB: base.map((b, i) => 0.6 * b + 2 * swing[i]),
    CCC: base.map((b, i) => -0.4 * b + 0.5 * swing[i]),
  };
  const model = buildCovariance(Object.keys(history), history);
  assert.ok(model);
  const positions = [
    { symbol: "BBB", signedNotional: 180_000 },
    { symbol: "AAA", signedNotional: 120_000 },
    { symbol: "CCC", signedNotional: -60_000 },
  ];
  const proposal = proposeAllocation(positions, model, "inverse_vol");
  assert.ok(proposal);
  return { proposal, positions, model };
}

describe("a manual override honours what was typed", () => {
  it("holds a pinned weight exactly and spreads the rest pro-rata to the model", () => {
    const { proposal } = _threeAssetProposal();
    const modelWeights = new Map(proposal.targets.map((t) => [t.symbol, t.targetWeight]));

    const manual = applyManualWeights(proposal, { AAA: 0.5 });
    const weights = new Map(manual.targets.map((t) => [t.symbol, t.targetWeight]));

    assert.ok(Math.abs(weights.get("AAA")! - 0.5) < 1e-9, "the typed weight was edited");
    assert.deepEqual(manual.pinned, ["AAA"]);
    assert.equal(manual.balanced, true);

    // The remaining 50% is split in the model's own proportions, so the ratio
    // between two untouched names survives. Splitting it equally would override
    // rows nobody touched.
    const modelRatio = modelWeights.get("BBB")! / modelWeights.get("CCC")!;
    const manualRatio = weights.get("BBB")! / weights.get("CCC")!;
    assert.ok(
      Math.abs(modelRatio - manualRatio) < 1e-9,
      `untouched rows were re-ordered: ${modelRatio} vs ${manualRatio}`,
    );
  });

  it("reports an over-allocation rather than rescaling it away", () => {
    const { proposal, positions } = _threeAssetProposal();
    const manual = applyManualWeights(proposal, { AAA: 0.7, BBB: 0.42 });

    assert.equal(manual.balanced, false);
    assert.ok(Math.abs(manual.weightSum - 1.12) < 1e-9, `weightSum was ${manual.weightSum}`);

    const weights = new Map(manual.targets.map((t) => [t.symbol, t.targetWeight]));
    assert.ok(Math.abs(weights.get("AAA")! - 0.7) < 1e-9, "a typed weight was rescaled to fit");
    assert.ok(Math.abs(weights.get("BBB")! - 0.42) < 1e-9, "a typed weight was rescaled to fit");
    assert.equal(weights.get("CCC"), 0, "an over-allocated book cannot fund the remainder");

    // The panel withholds trades in this state; the engine still has to produce
    // a coherent object rather than throwing or emitting negatives.
    assert.ok(rebalanceTrades(manual, positions, 0.05).every((t) => t.notional >= 0));
  });

  it("clamps a typed weight into the long-only range every solver uses", () => {
    const { proposal } = _threeAssetProposal();
    const manual = applyManualWeights(proposal, { AAA: -0.3, BBB: 4 });
    const weights = new Map(manual.targets.map((t) => [t.symbol, t.targetWeight]));
    assert.equal(weights.get("AAA"), 0);
    assert.ok(Math.abs(weights.get("BBB")! - 1) < 1e-9);
  });

  it("still names the limit that capped a typed weight", () => {
    const { proposal } = _threeAssetProposal();
    // 90% of a 360k book is 324k, well past a 150k symbol cap.
    const manual = applyManualWeights(proposal, { AAA: 0.9 }, { maxSymbolNotional: 150_000 });
    const capped = manual.targets.find((t) => t.symbol === "AAA");
    assert.ok(capped);
    assert.equal(capped.clippedBy, "max_symbol_notional_usd");
    assert.equal(manual.clipped, true);
    assert.ok(capped.targetNotional <= 150_000 + 1e-6);
    // The pre-clip sum is what tells the reader their own numbers balanced —
    // the clip is the gateway's opinion, not theirs.
    assert.equal(manual.balanced, true);
  });

  it("returns the typed weights verbatim when every row is pinned and balances", () => {
    const { proposal } = _threeAssetProposal();
    const manual = applyManualWeights(proposal, { AAA: 0.2, BBB: 0.3, CCC: 0.5 });
    const weights = new Map(manual.targets.map((t) => [t.symbol, t.targetWeight]));
    assert.equal(manual.balanced, true);
    assert.ok(Math.abs(weights.get("AAA")! - 0.2) < 1e-9);
    assert.ok(Math.abs(weights.get("BBB")! - 0.3) < 1e-9);
    assert.ok(Math.abs(weights.get("CCC")! - 0.5) < 1e-9);
  });

  it("keeps the seed method visible instead of renaming itself", () => {
    // `method` names what was solved. A manual proposal is discriminated by its
    // own flag, so a reader can always see which model they started from.
    const { proposal } = _threeAssetProposal();
    const manual = applyManualWeights(proposal, { AAA: 0.5 });
    assert.equal(manual.method, "inverse_vol");
    assert.equal(manual.manual, true);
  });

  it("is a no-op when nothing has been pinned", () => {
    const { proposal } = _threeAssetProposal();
    const manual = applyManualWeights(proposal, {});
    assert.deepEqual(manual.pinned, []);
    assert.equal(manual.balanced, true);
    for (const target of manual.targets) {
      const original = proposal.targets.find((t) => t.symbol === target.symbol);
      assert.ok(original);
      assert.ok(Math.abs(target.targetWeight - original.targetWeight) < 1e-9, target.symbol);
    }
  });
});
