/**
 * Fill quality, split along its cost/attribution seam.
 *
 * The densest section in the app, cut in two. Where the four control defects
 * this suite's siblings pin were controls whose appearance and behaviour had
 * drifted apart, this is the same argument applied to a section: one long
 * scroll answers two different questions — what the execution cost, and where
 * it went — and stating that as a seg makes the reader choose the question
 * instead of scrolling past the answer to the other one.
 *
 * What has to hold for the split to be an improvement rather than a rearrange:
 * the pane state is declared above the loading bail-out (React throws otherwise
 * on the first render past the placeholder), the default is fixed rather than
 * derived from a tier, panes are rendered conditionally rather than hidden, the
 * decomposition/mix pair is not cut through, and both panes still have
 * something to say when the feed is degraded — which is what stops a split from
 * turning one thin section into two empty ones.
 *
 * Source-level assertions, like the rest of this suite: there is no DOM here,
 * and what is worth pinning is structural.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { code, read } from "./helpers/execution-controls-sources";

const cockpit = read("components/execution/ExecutionCockpit.tsx");

describe("Fill quality is two readings, not one scroll", () => {
  const stripped = code(cockpit);

  it("splits into exactly two panes", () => {
    const block = stripped.slice(stripped.indexOf("const QUALITY_PANES"));
    const list = block.slice(0, block.indexOf("];"));
    const ids = [...list.matchAll(/\{ id: "([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, ["cost", "where"]);
  });

  it("switches with the house `.seg role=group`, never a nested rail", () => {
    // WorkspaceSubtabs publishes --rail-h from a ResizeObserver and asserts one
    // rail is mounted at a time; a second would fight the first on every resize.
    assert.match(stripped, /<div className="seg" role="group" aria-label="Fill quality view">/);
    assert.equal((stripped.match(/<WorkspaceSubtabs\b/g) ?? []).length, 0);
    assert.match(stripped, /title=\{option\.hint\}/);
    assert.match(stripped, /aria-pressed=\{qualityPane === option\.id\}/);
  });

  it("declares the pane state above the loading bail-out", () => {
    // React throws "rendered more hooks than during the previous render" on the
    // first render that gets past the placeholder otherwise.
    const state = stripped.indexOf("useState<QualityPane>");
    const bail = stripped.indexOf("if (loading && !book && !problem)");
    assert.ok(state >= 0, "the pane holds no state");
    assert.ok(bail >= 0, "the loading bail-out moved");
    assert.ok(state < bail, "the pane state is declared after an early return");
  });

  it("defaults to a fixed pane, never one derived from a tier", () => {
    assert.match(stripped, /useState<QualityPane>\("cost"\)/);
    assert.doesNotMatch(stripped, /useComplexity|atLeast/);
  });

  it("renders panes conditionally rather than hiding them", () => {
    // A hidden pane keeps its charts measuring their own width behind something
    // nobody is reading.
    assert.match(stripped, /qualityPane === "cost" && \(/);
    assert.match(stripped, /qualityPane === "where" && \(/);
    assert.doesNotMatch(stripped, /hidden=\{qualityPane/);
  });

  it("puts the cost reading in Cost and the attribution in Where", () => {
    const cost = stripped.slice(
      stripped.indexOf('qualityPane === "cost"'),
      stripped.indexOf('qualityPane === "where"'),
    );
    const where = stripped.slice(stripped.indexOf('qualityPane === "where"'));
    assert.match(cost, /<ExecutionQuality/);
    assert.doesNotMatch(cost, /<SpreadDecomposition|<VenueMixDonut|<FillQualityHeatmap/);
    for (const panel of ["SpreadDecomposition", "VenueMixDonut", "FillQualityHeatmap"]) {
      assert.match(where, new RegExp(`<${panel}`), `${panel} is not in the Where pane`);
    }
    assert.doesNotMatch(where, /<ExecutionQuality/);
  });

  it("cuts above the decomposition and mix pair, never through it", () => {
    /**
     * The file's own comment argues they answer one question between them: the
     * decomposition says how much, the mix says where. They stay in one grid.
     */
    const where = stripped.slice(stripped.indexOf('qualityPane === "where"'));
    assert.match(
      where,
      /<div className="cockpit-grid">\s*<SpreadDecomposition[\s\S]*?<VenueMixDonut[\s\S]*?<\/div>/,
    );
  });

  it("keeps the heatmap out of the primary metric's way", () => {
    // It self-suppresses below its sample floor, so on a short window it was a
    // paragraph sitting between a trader and their fill rate.
    const open = stripped.indexOf('qualityPane === "cost"');
    const shut = stripped.indexOf('qualityPane === "where"');
    // Measured, not sliced blind: `indexOf` returning -1 twice would hand
    // `doesNotMatch` an empty string and pass without reading anything.
    assert.ok(open >= 0 && shut > open, "the panes are gone, so nothing was checked");
    assert.doesNotMatch(stripped.slice(open, shut), /FillQualityHeatmap/);
  });

  it("keeps the panel id a literal, because the routing suite scrapes for it", () => {
    assert.match(stripped, /tabId="quality"/);
    assert.doesNotMatch(stripped, /tabId=\{/);
  });

  it("leaves both panes with something to say on a degraded feed", () => {
    /**
     * Every panel in both panes takes `source`, and each renders prose for the
     * unavailable case rather than going blank — which is what stops a split
     * from turning one thin section into two empty ones.
     */
    const panels = ["ExecutionQuality", "SpreadDecomposition", "VenueMixDonut", "FillQualityHeatmap"];
    for (const panel of panels) {
      assert.match(stripped, new RegExp(`<${panel}[^>]*source=\\{feedSource\\}`, "s"), panel);
    }
    for (const file of [
      "components/execution/ExecutionQuality.tsx",
      "components/execution/SpreadDecomposition.tsx",
      "components/execution/VenueMixDonut.tsx",
    ]) {
      assert.match(read(file), /=== "unavailable"/, `${file} stopped handling the outage state`);
    }
  });
});
