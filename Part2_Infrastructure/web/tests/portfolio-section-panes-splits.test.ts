/**
 * The mechanics every in-panel split in Portfolio has to obey.
 *
 * This is the structural half of the pane work: where the pane state is
 * declared, who carries the null branch, which pane a reader lands on, how
 * many buttons the switcher can hold, and whether a pane is a conditional
 * render or a hidden one. Its siblings take the three properties that fail
 * silently — `-overview` (the Standing pane cannot be blank, and the bands it
 * quotes are the bands it tests), `-performance` (the split is a time base and
 * says so) and `-cross-link` (the tile names its destination).
 *
 * Source-level assertions, like the rest of this suite: there is no DOM here,
 * and the properties worth pinning are structural enough that a future edit
 * has to break them deliberately.
 *
 * ── Where these assertions now point ────────────────────────────────────────
 * `PortfolioWorkspace.tsx` was one 1,105-line file holding all five sections
 * and reached the point where the panel a reader wanted could only be found by
 * scrolling past the four they did not. It is now the wiring, and each section
 * is a component under `components/portfolio/`. Every assertion below was
 * re-pointed at the file that holds the code it names — none was relaxed, and
 * several are stricter than the versions that scanned one file, because a
 * property that used to be "this string appears somewhere in 1,105 lines" is
 * now "this string appears in the pane it belongs to and NOT in its sibling".
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allocationSection,
  overviewBook,
  overviewSection,
  performance,
  positionsSection,
  standing,
  workspace,
} from "./helpers/portfolio-sources";

/**
 * The four section components that carry an in-panel split, with the pane state
 * each one owns. The workspace mounts them and holds none of this itself.
 */
const SPLIT_SECTIONS: Array<{ name: string; source: string; hook: string }> = [
  { name: "OverviewSection.tsx", source: overviewSection, hook: "useState<OverviewPane>" },
  { name: "PositionsSection.tsx", source: positionsSection, hook: "useState<PositionsPane>" },
  { name: "AllocationSection.tsx", source: allocationSection, hook: "useState<AllocationPane>" },
  { name: "PerformanceSection.tsx", source: performance, hook: "useState<PerformancePane>" },
];

// --------------------------------------------------------------------------
// The two new splits
// --------------------------------------------------------------------------

describe("Overview and Performance split the house way", () => {
  it("declares every pane state above anything that could return early", () => {
    /**
     * The crash this prevents is "rendered more hooks than during the previous
     * render", on the first render that takes a different path from the last.
     *
     * It used to be checkable as "before `if (!book)`", because the pane states
     * and the book bail-out were in one function. The bail-out stayed in the
     * workspace — which is what lets every section be handed a non-null book
     * and carry no null branch of its own — so the states are now checked
     * against the first return of the component that owns them, which is the
     * same property one file along.
     */
    for (const { name, source, hook } of SPLIT_SECTIONS) {
      const start = source.indexOf("export default function");
      assert.ok(start > 0, `${name} has no default-exported component`);
      const body = source.slice(start);
      const at = body.indexOf(hook);
      // Found, THEN placed. `indexOf` returns -1 for a hook that is not there
      // at all, which is less than every offset — so an ordering check on its
      // own passes most loudly when the thing it is checking does not exist.
      assert.ok(at >= 0, `${hook} is gone from ${name}`);
      // The FIRST return keyword of any shape, not the render's own `return (`
      // at the left margin: `if (!x) return null;` is the bail-out this is
      // about, and it does not sit at the start of a line.
      const firstReturn = body.search(/\breturn\b/);
      assert.ok(firstReturn >= 0, `${name} has no return to measure against`);
      assert.ok(at < firstReturn, `${hook} is declared after ${name} can already have returned`);
    }
  });

  it("keeps the book bail-out in the workspace, so no section carries a null branch", () => {
    // The other half of the same arrangement: one bail-out, in the file that
    // owns the snapshot, and five sections whose props cannot be null.
    assert.match(workspace, /if \(!book\) return fallback/, "the book bail-out has moved or been renamed");
    for (const { name, source } of SPLIT_SECTIONS) {
      assert.match(
        source,
        /book: PortfolioPayload;/,
        `${name} does not take a non-null book, so the workspace's single bail-out no longer covers it`,
      );
    }
  });

  it("opens each split on the pane that answers the arriving question", () => {
    // Standing, not Book: a reader landing on Portfolio is asking whether
    // anything is wrong before they are asking what is in it. Flow, not Trend:
    // the equity track is empty on the first render of every session.
    assert.match(overviewSection, /useState<OverviewPane>\("standing"\)/);
    assert.match(performance, /useState<PerformancePane>\("flow"\)/);
  });

  it("keeps every split inside the two-or-three the seg can carry", () => {
    // `.seg button` is `flex: 1`, so a fourth button forces abbreviated labels;
    // globals.css records this at the rule itself.
    const lists: Array<[string, string, string]> = [
      ["OVERVIEW_PANES", overviewSection, "OverviewSection.tsx"],
      ["POSITIONS_PANES", positionsSection, "PositionsSection.tsx"],
      ["ALLOCATION_PANES", allocationSection, "AllocationSection.tsx"],
      ["PERFORMANCE_PANES", performance, "PerformanceSection.tsx"],
    ];
    for (const [name, source, file] of lists) {
      const start = source.indexOf(`const ${name}`);
      assert.ok(start >= 0, `${name} is not declared in ${file}`);
      const block = source.slice(start);
      const list = block.slice(0, block.indexOf("];"));
      const ids = [...list.matchAll(/\{ id: "/g)].length;
      assert.ok(ids === 2 || ids === 3, `${name} has ${ids} panes; the seg carries two or three`);
    }
  });

  it("renders every new pane conditionally, never behind a hidden attribute", () => {
    // A pane left mounted keeps its charts' ResizeObservers running behind the
    // pane on screen, which is what `hidden` would do.
    for (const id of ["standing", "book"]) {
      assert.match(overviewSection, new RegExp(`overviewPane === "${id}" &&`), `${id} is not a conditional render`);
    }
    for (const id of ["flow", "trend"]) {
      assert.match(performance, new RegExp(`performancePane === "${id}" &&`), `${id} is not a conditional render`);
    }
    assert.doesNotMatch(overviewSection, /hidden=\{overviewPane/);
    assert.doesNotMatch(performance, /hidden=\{performancePane/);
  });

  it("puts each card in exactly one pane", () => {
    /**
     * Two claims now, because Overview's panes are two files: the switcher
     * mounts the right component, and that component opens on the card the
     * pane is for. The Performance panes are still two branches in one file and
     * are checked exactly as they were.
     */
    assert.match(overviewSection, /overviewPane === "standing" && \(\s*<OverviewStanding/);
    assert.match(standing, /return \(\s*<>\s*\{alerts\.length > 0 && \(/);
    assert.match(overviewSection, /overviewPane === "book" && \(\s*<OverviewBook/);
    assert.match(overviewBook, /return \(\s*<>\s*<div className="card portfolio-glance">/);
    assert.match(performance, /performancePane === "flow" && \(\s*<>\s*<div className="card portfolio-attribution-card">/);
    assert.match(performance, /performancePane === "trend" && \(\s*<RiskAdjustedTrend/);
  });

  it("leaves the largest-exposures table and the risk tile on the Book side", () => {
    // Stricter than it could be when both panes shared a file: the Standing
    // pane must not merely lack them at the top, it must not contain them.
    assert.match(overviewBook, /<h2>Largest exposures<\/h2>/);
    assert.match(overviewBook, /<CrossLinkTile<RiskSection>/);
    assert.doesNotMatch(standing, /Largest exposures/);
    assert.doesNotMatch(standing, /CrossLinkTile/);
  });
});
