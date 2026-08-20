/**
 * Section-level consolidation, pinned so it stays consolidated.
 *
 * Three shapes on the dense tabs were reduced to one control or one card per
 * question: two stacked fold tables on Walk-forward, two independent horizon
 * pickers on the Monte Carlo comparison, and an unnamed run of preset
 * buttons on the order ticket. Each is the kind of duplication that returns
 * one convenient copy-paste at a time, so the consolidated shape is asserted
 * here with the reasoning attached.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

describe("walk-forward shows one per-fold table", () => {
  it("the timeline's table absorbed the validation card's two extra columns", () => {
    // FoldEfficiency extends WalkForwardFold, so the train window and OOS
    // return the second table alone carried fit in the first — two tables
    // sharing five of seven columns for the same folds was a stack, not a
    // second reading.
    const timeline = code(read("../components/research/WalkForwardTimeline.tsx"));
    assert.match(timeline, /Train window/);
    assert.match(timeline, /OOS return/);
    assert.match(timeline, /Efficiency/);
  });

  it("the second fold table stays deleted", () => {
    assert.doesNotMatch(code(read("../components/Tables.tsx")), /WalkForwardTable/);
    // The walk-forward panel is mounted by ResearchWorkspace since page.tsx
    // was split; scanning the shell alone would find nothing either way.
    assert.doesNotMatch(code(read("../components/ResearchWorkspace.tsx")), /WalkForwardTable/);
  });
});

describe("the two Monte Carlos answer over one horizon", () => {
  const workspace = code(read("../components/RiskWorkspace.tsx"));

  it("the workspace owns one horizon state, rendered as a seg on each subtab", () => {
    // Each card used to carry its own Horizon select, so their stated
    // purpose — read the two loss estimates against each other — only held
    // after the reader synchronised two controls by hand. The split into
    // montecarlo/oraclevar subtabs kept the consolidation: ONE state in the
    // workspace, one seg helper called twice, each call setting the same
    // value. The aria-labels are distinct because two controls announcing
    // identically would read to a screen reader as one control twice.
    assert.equal((workspace.match(/const \[mcHorizonDays, setMcHorizonDays\]/g) ?? []).length, 1);
    assert.equal((workspace.match(/horizonDays=\{mcHorizonDays\}/g) ?? []).length, 2);
    assert.match(workspace, /horizonSeg\("Forward horizon for the bootstrap loss estimate"\)/);
    assert.match(workspace, /horizonSeg\("Forward horizon for the Oracle GBM loss estimate"\)/);
    assert.equal((workspace.match(/setMcHorizonDays\(/g) ?? []).length, 1,
      "the seg helper is the one writer of the shared horizon");
  });

  it("neither card keeps a horizon control of its own", () => {
    const mc = code(read("../components/risk/MonteCarloDistribution.tsx"));
    const oracle = code(read("../components/portfolio/OracleVarPanel.tsx"));
    assert.doesNotMatch(mc, /setHorizonDays/);
    assert.doesNotMatch(oracle, /setHorizonDays/);
    // The bootstrap still clamps a 1-day horizon to at least one bar.
    assert.match(mc, /Math\.max\(1, Math\.round\(horizonDays \* barsPerDay\)\)/);
    // The GBM card still states the horizon it ran over.
    assert.match(oracle, /\{horizonDays\}-day horizon/);
  });
});

describe("the ticket's demo presets are a named group", () => {
  it("carries group semantics without pretending to be a seg", () => {
    // Submit actions, not toggles — aria-pressed would be a lie, but three
    // unrelated-looking buttons with no stated relationship was the shape
    // LiveMarket's notional shortcuts were already corrected from.
    // The presets moved into `OrderTicketForm.tsx` with the rest of the
    // controls. `indexOf` is checked rather than trusted: on a miss it returns
    // -1 and the slice below would measure one character across both
    // assertions.
    const ticket = code(read("../components/execution/OrderTicketForm.tsx"));
    const start = ticket.indexOf("cockpit-ticket__presets");
    assert.notEqual(start, -1, "the preset group is gone — this check measures nothing");
    const presets = ticket.slice(start);
    assert.match(presets.slice(0, 200), /role="group"/);
    assert.match(presets.slice(0, 200), /aria-label="Gate demonstration presets"/);
  });
});
