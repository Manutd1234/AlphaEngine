/**
 * The blotter control set nothing could reach.
 *
 * One of four execution controls that were lying about what they do. None of
 * them was visible to a type check, and none of them made anything look broken
 * — which is why they survived. They are the same failure in four shapes: a
 * control whose appearance and its behaviour had drifted apart.
 *
 * This one: the blotter carried a four-button status seg behind `view ===
 * "all"`, a value no caller could produce. `BlotterViews` is its only importer
 * and routes `active` to `WorkingOrders`, so `fills` and `unfilled` are the
 * whole domain — the seg's state had no writer and both its readers sat in
 * branches nothing reached. The header row had the same rot: two column guards
 * that were constant, and a detail-row `colSpan` of 9 under eleven rendered
 * columns, which is exactly the kind of defect that renders without complaint.
 *
 * Three things are argued below, and they are separable: the deleted view
 * cannot come back through the prop type, the unreachability is a property of
 * the call graph rather than an assumption, and the detail row is measured off
 * the header it spans instead of asserted as a literal.
 *
 * Source-level assertions, like the rest of this suite: there is no DOM here,
 * and what is worth pinning is structural.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { code, read } from "./helpers/execution-controls-sources";

const blotter = read("components/execution/OrderBlotter.tsx");
const blotterViews = read("components/execution/BlotterViews.tsx");

describe("the blotter's status filter is gone, and cannot come back by accident", () => {
  it("names the two reachable views in the prop type, so the compiler holds the proof", () => {
    // A comment claiming `all` is unreachable rots the moment someone adds a
    // caller. A union that does not contain it cannot.
    const view = /\n\s+view:\s*([^;]+);/.exec(code(blotter));
    assert.ok(view, "OrderBlotter no longer declares a `view` prop");
    const members = view[1].split("|").map((m) => m.trim().replace(/"/g, "")).sort();
    assert.deepEqual(members, ["fills", "unfilled"]);
  });

  it("keeps the prop required, so no caller can fall back into the deleted view", () => {
    assert.doesNotMatch(code(blotter), /view\?:/, "an optional `view` reintroduces a default");
    assert.doesNotMatch(code(blotter), /view = "all"/);
  });

  it("branches on `all` nowhere at all", () => {
    assert.doesNotMatch(code(blotter), /view === "all"/);
    assert.doesNotMatch(code(blotter), /"all"/);
  });

  it("holds no status state, because nothing was ever able to write one", () => {
    assert.doesNotMatch(code(blotter), /useState<BlotterStatusFilter>/);
    assert.doesNotMatch(code(blotter), /setFilter/);
    assert.doesNotMatch(code(blotter), /const FILTERS/);
  });

  it("renders no segmented control of its own", () => {
    // The choice is made one level up in BlotterViews; a second seg saying the
    // same thing is how the two get to disagree.
    assert.doesNotMatch(code(blotter), /className="seg"/);
  });

  it("still fixes the status from the view, for both surviving views", () => {
    const stripped = code(blotter);
    assert.match(stripped, /view === "fills" \? "accepted" : "unfilled"/);
    // And the export filename still records which view produced the file.
    assert.match(stripped, /"alphaengine-blotter", source, view/);
  });
});

describe("the unreachability is a property of the call graph, not an assumption", () => {
  it("has exactly one importer", () => {
    // If a second one appears, the union above has to be re-argued rather than
    // silently widened.
    const importers = ["components/execution/BlotterViews.tsx"];
    for (const file of importers) {
      assert.match(read(file), /import OrderBlotter from/);
    }
    assert.equal(importers.length, 1);
  });

  it("routes the third view away before OrderBlotter is reached", () => {
    const stripped = code(blotterViews);
    const declared = /type View = ([^;]+);/.exec(stripped);
    assert.ok(declared, "BlotterViews no longer declares its View union");
    const members = declared[1].split("|").map((m) => m.trim().replace(/"/g, "")).sort();
    assert.deepEqual(members, ["active", "fills", "unfilled"]);

    // `active` goes to WorkingOrders, so only the other two reach the blotter.
    const ternary = stripped.slice(stripped.indexOf('view === "active" ? ('));
    const mid = ternary.indexOf(") : (");
    assert.ok(mid > 0, "BlotterViews no longer branches the active view away");
    assert.match(ternary.slice(0, mid), /<WorkingOrders/);
    assert.doesNotMatch(ternary.slice(0, mid), /<OrderBlotter/);
    assert.match(ternary.slice(mid), /<OrderBlotter/);
    assert.match(ternary.slice(mid), /view=\{view\}/);
  });
});

describe("the detail row spans the table it explains", () => {
  /**
   * Counted off the header rather than asserted as a literal. The fills arm
   * carried `colSpan={9}` against eleven rendered columns, which is exactly the
   * kind of defect that renders without complaint: the check vector simply
   * stopped two columns short, and nothing in the suite was measuring width.
   */
  const thead = (() => {
    const stripped = code(blotter);
    const open = stripped.indexOf("<thead>");
    const shut = stripped.indexOf("</thead>");
    assert.ok(open >= 0 && shut > open, "the blotter has no <thead>");
    return stripped.slice(open, shut);
  })();

  const count = (fragment: string) =>
    (fragment.match(/<th scope="col"/g) ?? []).length;

  const split = (() => {
    const at = thead.indexOf('{view === "unfilled" ? (');
    assert.ok(at >= 0, "the column set no longer branches on the view");
    const shared = thead.slice(0, at);
    const rest = thead.slice(at);
    const mid = rest.indexOf(") : (");
    const end = rest.indexOf(")}", mid);
    return {
      shared: count(shared) + count(rest.slice(end)),
      unfilled: count(rest.slice(0, mid)),
      fills: count(rest.slice(mid, end)),
    };
  })();

  const colSpan = /colSpan=\{view === "unfilled" \? (\d+) : (\d+)\}/.exec(code(blotter));

  it("declares a width for each view", () => {
    assert.ok(colSpan, "the detail row no longer sizes itself per view");
  });

  it("matches the unfilled header exactly", () => {
    assert.equal(Number(colSpan![1]), split.shared + split.unfilled);
  });

  it("matches the fills header exactly", () => {
    assert.equal(Number(colSpan![2]), split.shared + split.fills);
  });

  it("has no third width left over from the deleted view", () => {
    assert.doesNotMatch(code(blotter), /colSpan=\{[^}]*\?[^}]*\?/);
  });
});
