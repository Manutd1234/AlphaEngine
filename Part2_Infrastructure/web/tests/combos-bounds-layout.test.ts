/**
 * The Bounds view is one selectable plot plus one selected-row explanation.
 * These source contracts guard the compact layout without duplicating its
 * probability arithmetic in a test-only renderer.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read } from "./helpers/workspace-sources";

const bounds = read("../components/coherence/CombosBounds.tsx");
const layout = read("../components/coherence/CombosBounds.module.css");
const markReadout = read("../lib/coherence/use-mark-readout.ts");

describe("Bounds is a compact, selectable cost-to-bound instrument", () => {
  it("keeps the complete legend in wrapping HTML instead of the SVG edge", () => {
    assert.match(bounds, /caption="Bound versus portfolio cost"/);
    assert.match(bounds, /<ul className=\{styles\.legend\} aria-label="Figure legend">/);
    assert.ok(bounds.indexOf("className={styles.legend}") < bounds.indexOf("<Plot"));
    for (const label of ["Bound", "Cost", "Room"]) {
      assert.match(bounds, new RegExp(`>${label}<`));
    }
    assert.doesNotMatch(bounds, /coh-slack__key/);
    assert.match(layout, /\.legend\s*\{[^}]*flex-wrap:\s*wrap/s);
  });

  it("persists one identity-based selection for hover, tap and keyboard activation", () => {
    const identity = bounds.slice(bounds.indexOf("function rowKey"), bounds.indexOf("function RowLegs"));
    assert.match(identity, /row\.scope/);
    assert.match(identity, /row\.because/);
    assert.match(identity, /row\.legs\.map/);
    assert.doesNotMatch(identity, /row\.(?:cost|slack)/);
    assert.match(bounds, /useStableSelectionKey\([\s\S]*shown\.map\(rowKey\)/);
    assert.match(bounds, /onPointerEnter=\{\(\) => onSelect\(cell\.key\)\}/);
    assert.match(bounds, /<Plot[\s\S]*height=\{height\}[\s\S]*onSelect=/);
    assert.match(bounds, /data-selected=\{cell\.key === selectedKey\}/);
    assert.match(markReadout, /onClick[\s\S]*select\(index\)/);
    assert.match(markReadout, /event\.key === "Enter" \|\| event\.key === " "/);
  });

  it("publishes each selected fact once and folds the proving legs", () => {
    for (const label of ["Bound", "Portfolio cost", "Slack", "Scope", "Reason"]) {
      assert.match(bounds, new RegExp(`>${label}<`));
    }
    assert.match(bounds, /<details key=\{rowKey\(row\)\} className=\{styles\.legsDisclosure\}>/);
    assert.match(bounds, /Tested legs \(\$\{row\.legs\.length\}\)/);
    assert.equal((bounds.match(/<RowLegs /g) ?? []).length, 1);
    assert.doesNotMatch(bounds, /function RowFacts|function RowBlock|testable rows violated/);
  });

  it("keeps nulls explicit, the caveat visible and the true empty state intact", () => {
    assert.match(bounds, /row\.cost != null && row\.slack != null/);
    assert.match(bounds, /priceLabel\(row\.cost\)/);
    assert.match(bounds, /priceLabel\(row\.slack\)/);
    assert.match(bounds, /A dash means untested\./);
    assert.match(bounds, /<strong>No testable bounds<\/strong>/);
  });

  it("contains long content locally without widening the page", () => {
    assert.match(layout, /\.root[\s\S]*max-inline-size:\s*100%/);
    assert.match(layout, /\.legScrollport\s*\{[^}]*max-inline-size:\s*100%[^}]*overflow-x:\s*auto/s);
    assert.match(layout, /overflow-wrap:\s*anywhere/);
    assert.doesNotMatch(layout, /overflow-x:\s*(?:hidden|clip)/);
  });

  it("uses a two-column workbench without the empty shared interaction rail", () => {
    assert.match(bounds, /<div className=\{styles\.workbench\}>[\s\S]*<SlackStrip[\s\S]*<SelectedRowSummary/s);
    assert.match(bounds, /reserveInteractionRow=\{false\}/);
    assert.match(bounds, /minWidth=\{560\}/);
    assert.doesNotMatch(bounds, /notes=\{/);
    assert.match(layout, /\.workbench\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.45fr\)\s+minmax\(20rem,\s*0\.8fr\)/s);
    assert.match(layout, /@media \(max-width:\s*1080px\)[\s\S]*\.workbench\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    assert.match(layout, /\.facts\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
  });
});
