/**
 * The two blotter exports are one action with a format parameter.
 *
 * One of four execution controls that were lying about what they do — invisible
 * to a type check, and nothing on screen looked broken.
 *
 * Export CSV and Export JSON are one action with a format parameter, both
 * read-only and repeatable, so they belong behind one disclosure rather than
 * spending two toolbar slots. The move is only safe on one condition: the
 * caveat that they carry exactly the rows on screen had to survive it, or
 * collapsing them would have hidden the one thing a reader needs before
 * downloading. That is why the count is carried in the disclosure's own label
 * and repeated on each format, and why both are asserted here rather than
 * assumed to have come along.
 *
 * Source-level assertions, like the rest of this suite: there is no DOM here,
 * and what is worth pinning is structural.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { code, read } from "./helpers/execution-controls-sources";

const blotter = read("components/execution/OrderBlotter.tsx");

describe("the two exports are one disclosure", () => {
  const stripped = code(blotter);
  const menu = (() => {
    const open = stripped.indexOf("<RowMenu");
    const shut = stripped.indexOf("</RowMenu>");
    assert.ok(open >= 0 && shut > open, "the exports are not behind a RowMenu");
    return stripped.slice(open, shut);
  })();

  it("uses the shared RowMenu rather than a second disclosure", () => {
    // RowMenu's own header records why it is a top-layer popover: every blotter
    // sits in a `.table-wrap` with `overflow: auto`, which clips at any depth.
    assert.match(stripped, /import RowMenu from "@\/components\/common\/RowMenu"/);
    assert.equal((stripped.match(/<RowMenu/g) ?? []).length, 1);
    assert.doesNotMatch(stripped, /popover=/, "OrderBlotter re-implements the disclosure");
    assert.doesNotMatch(stripped, /<details/);
  });

  it("puts both formats inside it, and leaves neither behind in the toolbar", () => {
    assert.match(menu, /Export CSV/);
    assert.match(menu, /Export JSON/);
    assert.equal((stripped.match(/Export CSV/g) ?? []).length, 1);
    assert.equal((stripped.match(/Export JSON/g) ?? []).length, 1);
    assert.equal((menu.match(/role="menuitem"/g) ?? []).length, 2);
  });

  it("names what is inside it, with the count it is about to write", () => {
    /**
     * The required `label` is what makes a collapsed disclosure legible: `···`
     * on its own says nothing about what it opens. Carrying `visible.length`
     * in that name is how the caveat survives the collapse — a reader who has
     * narrowed the table reads the narrowed number before opening the menu.
     */
    const label = /<RowMenu label=\{([\s\S]*?)\}>/.exec(stripped);
    assert.ok(label, "the RowMenu has no label expression");
    assert.match(label[1], /rows on screen/);
    assert.match(label[1], /visible\.length/);
  });

  it("keeps the caveat on each format too, not only on the menu", () => {
    // "the filtered rows" was ambiguous about which filter; both titles now say
    // it is the rows on screen, which is the claim the file can actually make.
    assert.equal((menu.match(/exactly the rows on screen/g) ?? []).length, 2);
  });

  it("still refuses to write a file with nothing in it", () => {
    assert.equal((menu.match(/disabled=\{!visible\.length\}/g) ?? []).length, 2);
  });
});
