/**
 * Two properties of the Research workspace, both about one control per job.
 *
 * Attribution answers two different questions — *what explains this return* and
 * *does it hold up* — and it used to answer them on one four-card surface. It
 * is two panes now, and the seg that switches them may never grow a third
 * option: `.seg button { flex: 1 }` means a fourth forces abbreviated labels.
 * The hidden pane is not rendered at all rather than hidden with CSS, which is
 * what keeps a screen reader's reading of the panel the same as the screen's.
 *
 * The sweep is the mirror image: one job, and for a while three visible buttons
 * that started it. Exactly one survives, on the sticky rail where it survives
 * scrolling, and commit and run stay two different signals — `onCommit` is the
 * DOM's native `change`, and a component that collapsed the two would put a
 * request on every tick of a slider drag.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { attributionCode, controls, researchCode } from "./helpers/desk-shell-sources";

describe("Research ▸ Attribution splits into Explain and Robustness", () => {
  it("keeps the section id a literal, because it is a public deep link", () => {
    assert.match(researchCode, /tabId="attribution"/);
  });

  it("is a two-option seg, never four", () => {
    // `.seg button { flex: 1 }`: a fourth option forces abbreviated labels.
    const start = attributionCode.indexOf("const ATTRIBUTION_PANES");
    assert.notEqual(start, -1, "the panes are gone");
    const block = attributionCode.slice(start, attributionCode.indexOf("];", start));
    const ids = [...block.matchAll(/id:\s*"(\w+)"/g)].map((match) => match[1]);
    assert.deepEqual(ids, ["explain", "robustness"]);
    assert.match(attributionCode, /<div className="seg" role="group" aria-label="Attribution view">/);
    assert.match(attributionCode, /aria-pressed=\{attributionPane === option\.id\}/);
    assert.match(attributionCode, /title=\{option\.hint\}/, "a pane switcher with no hint on either option");
  });

  it("renders the hidden pane not at all, rather than hiding it", () => {
    assert.match(attributionCode, /\{attributionPane === "explain" && \(/);
    assert.match(attributionCode, /\{attributionPane === "robustness" && \(/);
    assert.doesNotMatch(attributionCode, /attributionPane[^\n]*hidden=/);
  });

  it("declares the pane state above the render", () => {
    // AttributionSection IS on workspace-routing's hook-order list now, but
    // that check only proves no hook follows a bail-out. This one proves the
    // pane state is inside the component and above its render at all.
    const component = attributionCode.indexOf("export default function AttributionSection(");
    assert.notEqual(component, -1, "the attribution component is gone");
    const declared = attributionCode.indexOf("useState<AttributionPane>", component);
    const renders = attributionCode.indexOf("\n  return (", component);
    assert.ok(declared > component, "the pane state is declared outside the component");
    assert.ok(declared < renders, "the pane state is declared below a return");
  });

  it("puts the two panels that answer the same question together", () => {
    const start = attributionCode.indexOf('{attributionPane === "explain" && (');
    const explain = attributionCode.slice(start, attributionCode.indexOf('{attributionPane === "robustness"', start));
    assert.match(explain, /<FactorPanel/);
    assert.match(explain, /<BenchmarkPanel/);
    const robustness = attributionCode.slice(attributionCode.indexOf('{attributionPane === "robustness" && ('));
    assert.match(robustness.slice(0, 800), /<RegimePanel/);
    assert.match(robustness.slice(0, 800), /<TearSheet/);
  });
});

// --------------------------------------------------------------------------
// One visible control starts the sweep
// --------------------------------------------------------------------------

describe("the research sweep has one button, not three", () => {
  it("the setup panel no longer closes with its own run button", () => {
    assert.doesNotMatch(controls, /Run sweep now/);
    assert.doesNotMatch(controls, /onClick=\{onRun\}/);
  });

  it("the sticky rail keeps the one that survives scrolling", () => {
    assert.match(researchCode, /\{running \? "Running…" : "Run now"\}/);
    assert.match(researchCode, /onClick=\{pinRun\}/, "the rail lost its Pin control with the Run one");
  });

  it("commit and run stay two different signals", () => {
    // The distinction is the mechanism, not the button: `onCommit` is the DOM's
    // native `change`, and a component that collapsed the two would put a
    // request on every tick of a slider drag.
    assert.match(controls, /onCommit:\s*\(\)\s*=>\s*void/);
    assert.match(controls, /onRun:\s*\(\)\s*=>\s*void/);
  });
});
