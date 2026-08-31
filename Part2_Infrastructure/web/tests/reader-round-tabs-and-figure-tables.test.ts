/**
 * Three reader-requested changes of 2026-08-23, each pinned from both ends.
 *
 * 1. The destination strip is content-led: one invariant inset, 6px gaps,
 *    and no flex growth that turns spare viewport width into oversized boxes.
 *    The selected underline stays the width of the word and the trailing
 *    pseudo-element creates no item, so Diffusion is one row gap from Telegram.
 *
 * 2. Research ▸ Summary: the verdict's six figures are one `<table>` — the
 *    labels a header band, each figure and note a cell in the house frame —
 *    instead of six free-standing columns whose wrapping labels pushed their
 *    figures to different heights.
 *
 * 3. Research ▸ Attribution ▸ Explain: the benchmark card's six readings are
 *    one `<table>` — a measure per row: name, figure, reading — in both the
 *    loaded and the empty state, in the frame the factor table beside it wears.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { globalsCss, readGlobalsPartial } from "./globals-css";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

/** Comment bodies blanked, newlines kept, so prose is never read as a rule. */
const css = globalsCss.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));

/** The first rule block for a selector written at the start of a line. */
function block(selector: string, text = css): string {
  const head = `\n${selector} {`;
  const start = text.indexOf(head);
  assert.notEqual(start, -1, `no rule for ${selector}`);
  return text.slice(start + head.length, text.indexOf("\n}", start));
}

describe("the tabs fill available surplus without manufacturing a spacer", () => {
  const button = block(".workspace-tabs button");

  it("shares the available row while retaining label-led minimums", () => {
    assert.match(button, /flex: 1 1 auto;/);
    assert.doesNotMatch(button, /flex: 1 1 0/);
  });

  it("uses one compact inset and never lets the responsive ladder mutate it", () => {
    assert.match(button, /min-width: 0;/);
    assert.match(button, /min-height: 42px;/);
    assert.match(button, /padding: 7px 6px;/);
    assert.match(button, /border: 0;/);
    assert.match(button, /border-radius: 6px;/);
    assert.doesNotMatch(readGlobalsPartial("app/globals/14-symbol-combobox.css"), /\.workspace-tabs button/);
    for (const property of ["width", "margin"]) {
      assert.doesNotMatch(button, new RegExp(`(^|[;\\s])${property}:`), `${property} on a tab widens the row's minimum`);
    }
  });

  it("the separation from the chip cluster has no pseudo item or flex spacer", () => {
    const spare = block(".workspace-tabs::after");
    assert.match(spare, /content: none;/);
    assert.doesNotMatch(spare, /flex:|width:|padding:|margin:/,
      "a generated flex item would add a second gap after Diffusion even at zero width");
    assert.doesNotMatch(read("components/WorkspaceHeader.tsx"), /header-spacer/,
      "a real flex spacer would make the seam viewport-dependent again");
    // 01, 12 and 14 are all at the file-length ceiling; the rule carries no
    // box metric, which is what lets it live outside the tabs' three homes.
    assert.match(readGlobalsPartial("app/globals/14o-header-tabs-surplus.css"), /\n\.workspace-tabs::after \{/);
    // 14o comes after 14 and before 15, and 15 stays last. It gained a
    // neighbour on 2026-08-24 — 14p, the tenth tab's ladder rung — so the
    // check is the ORDER rather than adjacency, which was only ever a proxy
    // for it.
    const globalsCssSource = read("app/globals.css");
    const order = (name: string) => globalsCssSource.indexOf(`./globals/${name}`);
    assert.ok(order("14-symbol-combobox.css") < order("14o-header-tabs-surplus.css"), "14o must come after 14");
    assert.ok(order("14o-header-tabs-surplus.css") < order("15-navigator-and-trailing-layer.css"), "14o must come before 15");
    assert.match(globalsCssSource, /15-navigator-and-trailing-layer\.css";\s*$/, "15 must stay last");
    // No narrow restatement: below 900 the strip is display: none (14) and the
    // <select> switcher stands in, so a generated trailing item never exists.
    assert.match(css, /@media \(max-width: 900px\) \{\n  \.workspace-tabs \{\n    display: none;/);
  });

  it("the underline is the word's width at every surplus: both share one content-sized grid cell", () => {
    assert.match(button, /display: grid;/);
    assert.match(button, /grid-template-columns: auto;/);
    assert.match(button, /justify-content: center;/, "a stretched track would be the box's width again");
    const underline = block(".workspace-tabs button::after");
    const word = block(".workspace-tabs button span");
    assert.match(underline, /grid-area: 1 \/ 1;/);
    assert.match(word, /grid-area: 1 \/ 1;/, "auto-placement puts the word in a second row, under the bar");
    assert.match(underline, /align-self: end;/);
    // The old mechanism, retired: an absolute bar inset by the pad was the
    // word's width only while the button hugged the word.
    assert.doesNotMatch(underline, /position: absolute|left: 8px|right: 8px/);
  });
});

describe("the verdict's six figures are one table", () => {
  const verdict = read("components/Verdict.tsx");

  it("renders a real <table> in a focusable .table-wrap, with a caption for the reader who cannot see the band", () => {
    assert.match(verdict, /<div key=\{data\.dataHash \?\? "metrics"\} className="table-wrap verdict-metrics" tabIndex=\{0\}>/);
    assert.match(verdict, /<table className="verdict-table">/);
    assert.match(verdict, /<caption className="sr-only">/);
    assert.doesNotMatch(verdict, /<dl|<ul/, "the metrics are cells, not a list");
  });

  it("the six labels are the header band and each figure sits over its note in one cell", () => {
    assert.match(verdict, /<th key=\{metric\.label\} scope="col" className="verdict-metric__label">/);
    assert.match(verdict, /<td className="stagger-reveal verdict-metric" style=\{\{ "--stagger-i": index \}/);
    assert.match(verdict, /<div className="num verdict-metric__value" data-tone=\{tone\}>/);
    assert.match(verdict, /<div className="verdict-metric__note">\{note\}<\/div>/);
    const labels = [...verdict.matchAll(/label: (?:"[^"]+"|`[^`]+`),/g)].length;
    assert.equal(labels, 6, `the verdict carries ${labels} metrics, not six`);
  });

  it("six equal columns that wrap, a floor under which the wrap scrolls, and the figure still at its rung", () => {
    const table = block(".verdict-table");
    assert.match(table, /table-layout: fixed;/, "auto layout would size each column by its note's length");
    assert.match(table, /min-width: 940px;/, "six of the widest real figure (\"~15.2 yr\", 132px) plus their pads");
    const cells = block(".verdict-table th,\n.verdict-table td");
    assert.match(cells, /text-align: left;/);
    assert.match(cells, /white-space: normal;/);
    assert.match(block(".verdict-table .verdict-metric__note"), /font-family: var\(--sans\);/, "the note is a sentence, not a figure");
    // type-role-map.test.ts anchors the figure rung here; restated so a
    // resize cannot be paid for by stepping the figure down.
    assert.match(css, /\.verdict-metric__value \{ font-size: var\(--fs-figure\); \}/);
  });

  it("the grid it replaced is gone from every partial", () => {
    assert.doesNotMatch(block(".verdict-metrics"), /display: grid|grid-template-columns/);
    const trailing = readGlobalsPartial("app/globals/15-navigator-and-trailing-layer.css");
    assert.doesNotMatch(trailing, /\.verdict-metrics \{/, "15 still carries the two-column narrow override");
  });
});

describe("the benchmark card's readings are one table, in both states", () => {
  const panel = read("components/research/BenchmarkPanel.tsx");
  const empty = panel.slice(panel.indexOf("if (!comparison)"), panel.indexOf("const alphaSignificant"));
  const loaded = panel.slice(panel.indexOf("const alphaSignificant"));

  it("a measure per row — name as the row header, figure, reading — in a focusable wrap with a caption", () => {
    for (const [name, state] of [["empty", empty], ["loaded", loaded]] as const) {
      assert.match(state, /<div className="table-wrap" tabIndex=\{0\}>\s*<table className="benchmark-table">/, `${name} state`);
      assert.match(state, /<caption className="sr-only">/, `${name} state has no caption`);
      assert.match(state, /<th scope="col">Measure<\/th>\s*<th scope="col">Value<\/th>\s*<th scope="col">Reading<\/th>/, `${name} state`);
      assert.doesNotMatch(state, /<dl|<dt|<dd/, `${name} state is still a definition list`);
    }
    assert.equal((loaded.match(/<th scope="row">/g) ?? []).length, 6, "six measures, six row headers");
    assert.equal((empty.match(/<th scope="row">/g) ?? []).length, 2, "the empty state keeps alpha and beta, dashed");
    assert.equal((loaded.match(/className="benchmark-table__reading"/g) ?? []).length, 6);
  });

  it("only a distinguishable alpha is emphasised, as a class on its figure cell", () => {
    assert.match(loaded, /<td className=\{`num\$\{alphaSignificant \? " is-emphasis" : ""\}`\}>/);
    assert.match(block(".benchmark-table td.is-emphasis"), /color: var\(--success-text\);/);
  });

  it("the reading is the one column that departs from the ledger: a sentence, left, free to wrap", () => {
    const reading = block(".benchmark-table__reading");
    assert.match(reading, /font-family: var\(--sans\);/);
    assert.match(reading, /text-align: left;/);
    assert.match(reading, /white-space: normal;/);
    // Its header agrees with it; the base `th` rule right-aligns.
    assert.match(block(".benchmark-table thead th:last-child"), /text-align: left;/);
    // And the old grid is gone, not overridden: no partial styles `.benchmark-grid`.
    assert.doesNotMatch(css, /\.benchmark-grid/);
    assert.doesNotMatch(panel, /benchmark-grid/);
  });
});
