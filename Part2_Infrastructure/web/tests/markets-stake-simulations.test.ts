import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { replayKellyScale } from "../lib/coherence/kelly-frontier";

const candidates = [
  { probability: 0.6, price: 0.5, fullFraction: 0.2 },
  { probability: 0.4, price: 0.5, fullFraction: 0.1 },
] as const;

describe("the Stake Kelly frontier", () => {
  it("starts at one dollar, all cash and zero expected log growth", () => {
    assert.deepEqual(replayKellyScale(candidates, 0), {
      scale: 0,
      growth: 0,
      floor: 1,
      cash: 1,
    });
  });

  it("uses the server's state-wealth equation at full Kelly", () => {
    const point = replayKellyScale(candidates, 1);
    assert.ok(point);
    assert.equal(point.cash, 0.7);
    assert.ok(Math.abs(point.floor - 0.9) < 1e-12);
    assert.ok(Math.abs(point.growth - (0.6 * Math.log(1.1) + 0.4 * Math.log(0.9))) < 1e-12);
  });

  it("withholds a scale once any terminal state reaches zero", () => {
    assert.equal(replayKellyScale([
      { probability: 0.5, price: 0.9, fullFraction: 1 },
      { probability: 0.5, price: 0.9, fullFraction: 1 },
    ], 2), null);
  });
});
