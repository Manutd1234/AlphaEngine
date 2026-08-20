/**
 * The Positions and Allocation splits, and the explanation that makes a
 * truthful panel stop looking broken.
 *
 * Overview and Performance were split the same way afterwards; the assertions
 * specific to those two live in `portfolio-section-panes.test.ts`. What is
 * shared — that there is one rail and that every pane is a conditional render —
 * is pinned here, over the whole file.
 *
 * Positions was eight cards in one scroll and Allocation four. Splitting them
 * has two failure modes worth pinning: a nested `<WorkspaceSubtabs>`, which
 * would put a second ResizeObserver on `--rail-h` and break every sticky offset
 * in the app; and `hidden` instead of a conditional render, which keeps the
 * switched-away charts observing and the working-orders poll hitting the
 * gateway behind a pane nobody is looking at.
 *
 * The second half is about the one-position book the deployment actually holds.
 * Every method returns 100%, drift is exactly zero, and the band slider and
 * model selector genuinely cannot change anything — which is indistinguishable
 * from a broken panel unless the panel says so, with the arithmetic.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const workspace = read("../components/PortfolioWorkspace.tsx");
/**
 * The five sections are five components now — see the note at the top of
 * `PortfolioWorkspace.tsx`. Every assertion below points at the file holding
 * the code it names; the workspace itself is still read, because the rail, the
 * panel order and the visibility a poll gates on are all still its.
 */
const positionsSection = read("../components/portfolio/PositionsSection.tsx");
const allocationSection = read("../components/portfolio/AllocationSection.tsx");
const overviewSection = read("../components/portfolio/OverviewSection.tsx");
const performanceSection = read("../components/portfolio/PerformanceSection.tsx");
const chart = read("../components/portfolio/DriftBars.tsx");
const panel = read("../components/portfolio/AllocationPanel.tsx");

/** Each split section, with the switcher it is expected to carry. */
const SPLITS: Array<{ id: string; component: string; source: string; label: string; state: string }> = [
  { id: "overview", component: "OverviewSection", source: overviewSection, label: "Overview view", state: "useState<OverviewPane>" },
  { id: "positions", component: "PositionsSection", source: positionsSection, label: "Positions view", state: "useState<PositionsPane>" },
  { id: "allocation", component: "AllocationSection", source: allocationSection, label: "Allocation view", state: "useState<AllocationPane>" },
  { id: "performance", component: "PerformanceSection", source: performanceSection, label: "Performance view", state: "useState<PerformancePane>" },
];

/** Comments describe the traps by name; a scan that cannot tell them apart
 *  reads the explanation as the offence. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");

describe("the split uses the house in-panel pattern, not a second rail", () => {
  it("mounts exactly one WorkspaceSubtabs across the workspace and its sections", () => {
    // `WorkspaceSubtabs` publishes `--rail-h` from a ResizeObserver, so a
    // second rail anywhere under this tab fights the first over every sticky
    // offset in the app. Counted over the sections too, now that a section is
    // its own file and could grow one without the workspace changing.
    const rails = [workspace, ...SPLITS.map((split) => split.source)]
      .flatMap((source) => [...code(source).matchAll(/<WorkspaceSubtabs\b/g)]);
    assert.equal(rails.length, 1, "a second rail has appeared under the portfolio tab");
  });

  it("uses .seg role=group for every split, one per section, in rail order", () => {
    /**
     * The switcher now lives in the section it switches, so rail order is the
     * order the workspace mounts those sections in. Both halves are checked:
     * the panels appear in the order `lib/sections.ts` defines, and each one
     * mounts the component whose own seg carries that section's label. A
     * switcher rendered into the wrong section's panel fails the second half.
     */
    const stripped = code(workspace);
    const panels = [...stripped.matchAll(/tabId="([a-z]+)"/g)].map((match) => match[1]);
    assert.deepEqual(panels, ["overview", "equity", "positions", "allocation", "performance"]);

    for (const { id, component, source, label } of SPLITS) {
      assert.match(
        stripped,
        new RegExp(`tabId="${id}"[\\s\\S]{0,400}?<${component}\\b`),
        `the ${id} panel does not mount ${component}`,
      );
      const groups = [...code(source).matchAll(/<div className="seg" role="group" aria-label="([^"]+)"/g)]
        .map((match) => match[1]);
      assert.deepEqual(groups, [label], `${component} must carry exactly its own switcher`);
    }
  });

  it("keeps each split to three panes", () => {
    for (const [name, source] of [
      ["POSITIONS_PANES", positionsSection],
      ["ALLOCATION_PANES", allocationSection],
    ] as Array<[string, string]>) {
      const start = source.indexOf(`const ${name}`);
      assert.ok(start >= 0, `${name} is gone`);
      const block = source.slice(start);
      const list = block.slice(0, block.indexOf("];"));
      const ids = [...list.matchAll(/\{ id: "/g)].length;
      assert.equal(ids, 3, `${name} has ${ids} panes — a fourth is a second navigation`);
    }
  });

  it("declares every pane state above anything its own section could return", () => {
    /**
     * React throws "rendered more hooks than during the previous render" on the
     * first render that takes a different path from the last.
     *
     * This used to read "above `if (!book)`", because the pane states and the
     * book bail-out shared a function. The bail-out stayed in the workspace —
     * which is what lets every section be handed a non-null book — so each
     * state is now measured against the first return of the component that owns
     * it, which is the same property one file along. `workspace-routing`
     * carries the general form of this check over all six files.
     */
    assert.match(code(workspace), /if \(!book\) return fallback/, "the book bail-out has moved or been renamed");
    for (const { component, source, state } of SPLITS) {
      const body = source.slice(source.indexOf("export default function"));
      const at = body.indexOf(state);
      assert.ok(at >= 0, `${state} is gone from ${component}`);
      const firstReturn = body.search(/\breturn\b/);
      assert.ok(firstReturn >= 0, `${component} has no return to measure against`);
      assert.ok(at < firstReturn, `${state} is declared after ${component} can already have returned`);
    }
  });

  it("defaults each split to the pane that needs nothing to render", () => {
    assert.match(positionsSection, /useState<PositionsPane>\("holdings"\)/);
    assert.match(allocationSection, /useState<AllocationPane>\("mix"\)/);
  });
});

describe("panes are conditional renders, never hidden", () => {
  const panes = ["holdings", "shape", "exit", "mix", "targets", "composition"];

  it("every pane gates on ===, and none on a hidden attribute", () => {
    for (const pane of panes) {
      const source = code(pane === "mix" || pane === "targets" || pane === "composition"
        ? allocationSection
        : positionsSection);
      assert.match(source, new RegExp(`Pane === "${pane}" &&`), `${pane} is not a conditional render`);
    }
    assert.doesNotMatch(code(positionsSection), /hidden=\{positionsPane/);
    assert.doesNotMatch(code(allocationSection), /hidden=\{allocationPane/);
  });

  it("puts each card in exactly one pane", () => {
    const positions = code(positionsSection);
    assert.match(positions, /positionsPane === "holdings" && \(\s*<div className="card portfolio-positions-card">/);
    assert.match(positions, /positionsPane === "shape" && \(\s*<>\s*<ExposureHeatmap/);
    assert.match(positions, /positionsPane === "exit" && \(\s*<>\s*<LiquidityPanel/);
    const allocation = code(allocationSection);
    assert.match(allocation, /allocationPane === "mix" && \(\s*<AllocationDonut/);
    assert.match(allocation, /allocationPane === "targets" && \(\s*<AllocationPanel/);
    assert.match(allocation, /allocationPane === "composition" && \(\s*<AllocationMixes/);
  });

  it("only Targets consumes the covariance, so the other two survive without one", () => {
    /**
     * The reason this split is worth making: `AllocationDonut` and
     * `AllocationMixes` read notional alone. With the model null, one pane says
     * why it is quiet instead of a dead slab sitting between two live charts.
     */
    const stripped = code(allocationSection);
    const targets = stripped.slice(
      stripped.indexOf('allocationPane === "targets"'),
      stripped.indexOf('allocationPane === "composition"'),
    );
    assert.match(targets, /model=\{covarianceModel\}/);
    const mix = stripped.slice(
      stripped.indexOf('allocationPane === "mix"'),
      stripped.indexOf('allocationPane === "targets"'),
    );
    assert.doesNotMatch(mix, /covarianceModel/);
  });
});

describe("the order poll stops when its pane does", () => {
  it("requires the Exit pane as well as the Positions section and a visible tab", () => {
    /**
     * The section panel stays mounted when the reader moves to Allocation, so
     * the section alone left a gateway poll running behind another pane; and
     * the workspace itself persists hidden behind other tabs, so a hidden tab's
     * order poll must stop too.
     *
     * The condition is now written across the two files that own its halves,
     * and both are pinned: the workspace decides whether the SECTION is visible
     * on a visible tab, and the section decides whether the PANE is. Dropping
     * either half fails here, which is the whole of what the single-file regex
     * used to say.
     */
    assert.match(
      code(workspace),
      /sectionActive=\{active && section === "positions"\}/,
      "the workspace no longer tells the Positions section whether it is visible",
    );
    assert.match(
      code(positionsSection),
      /active=\{sectionActive && positionsPane === "exit"\}/,
      "the working-orders poll no longer stops with its pane",
    );
  });
});

describe("the drift legend is a worked reading, not a key", () => {
  const legend = chart.slice(chart.indexOf('className="legend'), chart.indexOf("</ul>"));

  it("quotes the live band rather than naming a fixed threshold", () => {
    assert.ok(
      (legend.match(/\{pct\(driftBand, 0\)\}/g) ?? []).length >= 3,
      "each rule must state the band that is actually on screen",
    );
    assert.doesNotMatch(legend, /\d+%/, "a hard-coded percentage would go stale the moment the slider moves");
  });

  it("names the counter-intuitive short case, where a blue add bar sells", () => {
    assert.match(legend, /adding to a short means selling more of it/);
    assert.match(legend, /SELL/);
    assert.match(legend, /BUY/);
  });

  it("states that the band colouring and the trade filter are the same number", () => {
    assert.match(chart, /A coloured bar and a trade row are therefore the same set/);
  });

  it("names the one state where colour and trade disagree", () => {
    assert.match(chart, /unbalancedSum != null && \(/);
    assert.match(chart, /the bars still colour but no trade is\s+composed/);
  });

  it("says a clipped marker changes neither colour nor length", () => {
    assert.match(chart, /changes neither the colour of a\s+bar nor its length/);
    // And keeps it distinct from the gross-cap condition, which is the other
    // thing on this chart with the word "cap" in it and does change what prints.
    assert.match(chart, /different condition from\s+the gross cap/);
  });
});

describe("a book of one says why it cannot move", () => {
  it("prints the arithmetic instead of asserting the conclusion", () => {
    assert.match(code(chart), /targets\.length === 1 \? targets\[0\] : null/);
    assert.match(chart, /trivially\s+100% of itself under every method offered/);
    assert.match(chart, /the drift-band slider has nothing to\s+add or remove/);
    assert.match(chart, /the\s+model selector produces identical output whichever one is picked/);
  });

  it("does not claim a zero drift it has not measured", () => {
    /**
     * A single position can still be clipped by its own symbol cap, and then
     * drift is NOT zero. The copy branches on the measurement rather than on
     * the position count, or it would state a falsehood on exactly the book
     * where a limit is binding.
     */
    assert.match(code(chart), /Math\.abs\(only\.drift\) < 1e-9/);
    assert.match(chart, /a risk limit clipped it/);
  });

  it("stops the panel calling a tautology a tolerance decision", () => {
    // "Close enough to target that trading it would cost more than the drift
    // does" credits the band for a result the arithmetic already fixed.
    assert.match(panel, /active\.targets\.length === 1 \? \(/);
    assert.match(panel, /there is nothing for it to suppress/);
  });
});
