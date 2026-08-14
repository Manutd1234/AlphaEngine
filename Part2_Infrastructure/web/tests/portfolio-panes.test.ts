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
const chart = read("../components/portfolio/DriftBars.tsx");
const panel = read("../components/portfolio/AllocationPanel.tsx");

/** Comments describe the traps by name; a scan that cannot tell them apart
 *  reads the explanation as the offence. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");

describe("the split uses the house in-panel pattern, not a second rail", () => {
  it("mounts exactly one WorkspaceSubtabs", () => {
    // `WorkspaceSubtabs` publishes `--rail-h` from a ResizeObserver and its own
    // header states that exactly one rail is mounted at a time.
    assert.equal((code(workspace).match(/<WorkspaceSubtabs\b/g) ?? []).length, 1);
  });

  it("uses .seg role=group for every split, in rail order", () => {
    // Rail order, because the list is read off the source top to bottom and a
    // group appearing out of order means a switcher has been rendered into the
    // wrong section's panel.
    const groups = [...workspace.matchAll(/<div className="seg" role="group" aria-label="([^"]+)"/g)]
      .map((match) => match[1]);
    assert.deepEqual(groups, ["Overview view", "Positions view", "Allocation view", "Performance view"]);
  });

  it("keeps each split to three panes", () => {
    for (const name of ["POSITIONS_PANES", "ALLOCATION_PANES"]) {
      const block = workspace.slice(workspace.indexOf(`const ${name}`));
      const list = block.slice(0, block.indexOf("];"));
      const ids = [...list.matchAll(/\{ id: "/g)].length;
      assert.equal(ids, 3, `${name} has ${ids} panes — a fourth is a second navigation`);
    }
  });

  it("declares the pane state above the book bail-out", () => {
    // React throws "rendered more hooks than during the previous render" on the
    // first snapshot that gets past `if (!book)` otherwise.
    const stripped = code(workspace);
    assert.ok(stripped.indexOf("useState<PositionsPane>") < stripped.indexOf("if (!book) return fallback"));
    assert.ok(stripped.indexOf("useState<AllocationPane>") < stripped.indexOf("if (!book) return fallback"));
  });

  it("defaults each split to the pane that needs nothing to render", () => {
    assert.match(workspace, /useState<PositionsPane>\("holdings"\)/);
    assert.match(workspace, /useState<AllocationPane>\("mix"\)/);
  });
});

describe("panes are conditional renders, never hidden", () => {
  const panes = ["holdings", "shape", "exit", "mix", "targets", "composition"];

  it("every pane gates on ===, and none on a hidden attribute", () => {
    const stripped = code(workspace);
    for (const pane of panes) {
      assert.match(stripped, new RegExp(`Pane === "${pane}" &&`), `${pane} is not a conditional render`);
    }
    assert.doesNotMatch(stripped, /hidden=\{(positionsPane|allocationPane)/);
  });

  it("puts each card in exactly one pane", () => {
    const stripped = code(workspace);
    assert.match(stripped, /positionsPane === "holdings" && \(\s*<div className="card portfolio-positions-card">/);
    assert.match(stripped, /positionsPane === "shape" && \(\s*<>\s*<ExposureHeatmap/);
    assert.match(stripped, /positionsPane === "exit" && \(\s*<>\s*<LiquidityPanel/);
    assert.match(stripped, /allocationPane === "mix" && \(\s*<AllocationDonut/);
    assert.match(stripped, /allocationPane === "targets" && \(\s*<AllocationPanel/);
    assert.match(stripped, /allocationPane === "composition" && \(\s*<AllocationMixes/);
  });

  it("only Targets consumes the covariance, so the other two survive without one", () => {
    /**
     * The reason this split is worth making: `AllocationDonut` and
     * `AllocationMixes` read notional alone. With the model null, one pane says
     * why it is quiet instead of a dead slab sitting between two live charts.
     */
    const stripped = code(workspace);
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
  it("requires the Exit pane as well as the Positions section", () => {
    // The section panel stays mounted when the reader moves to Allocation, so
    // the section alone left a gateway poll running behind another tab.
    // `active && ` first: the workspace itself persists hidden behind other
    // tabs now, and a hidden tab's order poll must stop with its pane's.
    assert.match(workspace, /active=\{active && section === "positions" && positionsPane === "exit"\}/);
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
    assert.match(chart, /the drift-band slider has nothing to add or remove/);
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
