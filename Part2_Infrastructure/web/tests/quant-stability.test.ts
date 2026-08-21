/**
 * Stability separates a plateau from a cliff.
 *
 * A sweep reports the best cell of a grid, and the best cell of a noisy grid is
 * usually noise. The question worth answering is whether the winner's
 * neighbours agree with it: a plateau keeps its Sharpe one step in any
 * direction, a cliff is a lone spike among dead cells and will not survive
 * contact with a live market. Both look identical in a leaderboard.
 *
 * Two ways the classification goes quietly wrong. Adjacency measured in
 * parameter units rather than grid indices hunts for cells that were never
 * tested — every cell then reports zero neighbours and nothing is ever called a
 * cliff. And a grid where nothing was profitable must say so, rather than
 * ranking losses and handing back the least bad one dressed as a winner. A
 * winner on the grid edge is called out rather than judged, because its
 * neighbours were never sampled.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parameterStability } from "../lib/quant";
import type { ParamResult } from "../lib/types";

import { close, paramResult } from "./helpers/quant-fixtures";

describe("stability separates a plateau from a cliff", () => {
  /** A 5×5 grid where every cell shares one Sharpe — the definition of a plateau. */
  const flat = () => {
    const out: ParamResult[] = [];
    for (let f = 5; f <= 25; f += 5) for (let s = 30; s <= 70; s += 10) out.push(paramResult(f, s, 1.2));
    return out;
  };

  it("a uniform grid classifies its interior as plateau", () => {
    const report = parameterStability(flat());
    assert.equal(report.best!.kind, "plateau");
    close(report.best!.retention!, 1, 1e-9, "retention on a flat grid");
    assert.equal(report.verdict.level, "pass");
    assert.equal(report.cliffCount, 0);
  });

  it("a lone spike among dead neighbours is a cliff, and the verdict says so", () => {
    const cells = flat().map((c) => paramResult(c.fast, c.slow, 0.01));
    const spike = cells.find((c) => c.fast === 15 && c.slow === 50)!;
    spike.sharpe = 3;
    const report = parameterStability(cells);
    assert.equal(report.best!.fast, 15);
    assert.equal(report.best!.kind, "cliff");
    assert.equal(report.verdict.level, "fail");
    assert.match(report.verdict.headline, /cliff/i);
  });

  it("adjacency is by grid index, not parameter distance", () => {
    // Steps of 5: 20 and 30 are the neighbours of 25. A distance-in-units rule
    // would look for 24 and 26, which were never tested, and every cell would
    // report zero neighbours.
    const report = parameterStability(flat());
    const interior = report.cells.find((c) => c.fast === 15 && c.slow === 50)!;
    assert.equal(interior.neighbours, 8, "interior cell should see all eight neighbours");
    const corner = report.cells.find((c) => c.fast === 5 && c.slow === 30)!;
    assert.equal(corner.neighbours, 3, "corner cell should see three");
  });

  it("a grid-edge winner is called out rather than judged", () => {
    const cells = [paramResult(5, 30, 2), paramResult(10, 30, 0.1)];
    const report = parameterStability(cells);
    assert.equal(report.best!.kind, "isolated");
    assert.equal(report.verdict.level, "marginal");
    assert.match(report.verdict.detail, /edge|boundary/i);
  });

  it("a grid with no profitable cell says so instead of ranking losses", () => {
    const cells = flat().map((c) => paramResult(c.fast, c.slow, -0.5));
    const report = parameterStability(cells);
    assert.equal(report.verdict.level, "fail");
    assert.match(report.verdict.headline, /not profitable/i);
  });
});
