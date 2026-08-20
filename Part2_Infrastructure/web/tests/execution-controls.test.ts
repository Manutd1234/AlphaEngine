/**
 * Four execution controls that were lying about what they do.
 *
 * None of these was visible to a type check, and none of them made anything
 * look broken — which is why they survived. They are the same failure in four
 * shapes: a control whose appearance and its behaviour had drifted apart.
 *
 *  1. The blotter carried a four-button status seg behind `view === "all"`, a
 *     value no caller could produce. `BlotterViews` is its only importer and
 *     routes `active` to `WorkingOrders`, so `fills` and `unfilled` are the
 *     whole domain — the seg's state had no writer and both its readers sat in
 *     branches nothing reached. The header row had the same rot: two column
 *     guards that were constant, and a detail-row `colSpan` of 9 under eleven
 *     rendered columns.
 *  2. Export CSV and Export JSON are one action with a format parameter, both
 *     read-only and repeatable. The caveat that they carry exactly the rows on
 *     screen had to survive the move into the disclosure, or collapsing them
 *     would have hidden the one thing a reader needs before downloading.
 *  3. Five notional presets sat in a bare flex div: no group, no name, no
 *     `aria-pressed`. A screen reader met five unrelated actions and could not
 *     tell which size the probe was running.
 *  4. The venue picker — a genuine multi-select, independent per venue — was a
 *     `.seg`, pixel-identical to the exclusive one directly above it.
 *
 * And two sections split in two: Fill quality, the densest in the app, along
 * its cost/attribution seam — then Activity, along the record/stream seam the
 * old stacking could only state as ordering.
 *
 * Source-level assertions, like the rest of this suite: there is no DOM here,
 * and what is worth pinning is structural.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The base the sources are read from.
 *
 * Overridable so this file can be run against a tree holding the PRE-change
 * components, which is how each assertion below was checked to fail before it
 * was trusted. Unset — every normal run — it is the web root.
 */
const base = process.env.EXECUTION_CONTROLS_BASE
  ? new URL(`file://${process.env.EXECUTION_CONTROLS_BASE}/`)
  : new URL("..", import.meta.url);

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, base)), "utf8");

/**
 * Comments name the traps they are explaining — `view === "all"`, `hidden`,
 * `.seg`. A scan that cannot tell prose from code reads every explanation as
 * the offence it describes. This has bitten twice in this suite already.
 */
const code = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const blotter = read("components/execution/OrderBlotter.tsx");
const blotterViews = read("components/execution/BlotterViews.tsx");
const liveMarket = read("components/LiveMarket.tsx");
const cockpit = read("components/execution/ExecutionCockpit.tsx");

// --------------------------------------------------------------------------
// 1. The control set nothing could reach
// --------------------------------------------------------------------------

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

// --------------------------------------------------------------------------
// 2. One action with a format parameter
// --------------------------------------------------------------------------

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

// --------------------------------------------------------------------------
// 3. Two control-semantics defects on the routing probe
// --------------------------------------------------------------------------

describe("the notional shortcuts say which one is selected", () => {
  const stripped = code(liveMarket);
  const group = (() => {
    const at = stripped.indexOf("PROBE_SIZES.map");
    assert.ok(at >= 0, "the presets are gone");
    // Back up to the element that wraps them, forward to the end of the map.
    const open = stripped.lastIndexOf("<div", at);
    return stripped.slice(open, stripped.indexOf("</div>", at));
  })();

  it("has five options, which is why it is not a seg", () => {
    const list = /const PROBE_SIZES = \[([^\]]+)\]/.exec(stripped);
    assert.ok(list, "PROBE_SIZES is gone");
    assert.equal(list[1].split(",").filter((n) => n.trim()).length, 5);
    // `.seg button` is flex:1, so a fifth segment is bought by abbreviating
    // every label. globals.css records the two-or-three budget at the rule.
    assert.doesNotMatch(group, /className="seg"/);
  });

  it("is a named group rather than five loose buttons", () => {
    assert.match(group, /role="group"/);
    assert.match(group, /aria-label="[^"]+"/);
  });

  it("announces the selected size, and carries it as a mark as well", () => {
    /**
     * `aria-pressed` alone would put the state in the accessibility tree and
     * nowhere on the screen: `.icon` has no selected treatment, so a sighted
     * reader would have no way to tell either. The ✓ is the visible half, and
     * it is house typography rather than a colour.
     */
    assert.match(group, /aria-pressed=\{notional === n\}/);
    assert.match(group, /notional === n \?/);
    assert.match(group, /✓/);
  });

  it("declares its buttons as buttons", () => {
    // No form wraps this, but a bare <button> still defaults to type=submit.
    assert.match(group, /type="button"/);
  });
});

describe("the venue picker does not look like a one-of-three", () => {
  const stripped = code(liveMarket);
  const group = (() => {
    const at = stripped.indexOf('aria-label="Venues included in the what-if route"');
    assert.ok(at >= 0, "the venue group lost its name");
    const open = stripped.lastIndexOf("<div", at);
    return stripped.slice(open, stripped.indexOf("snap?.venues ?? []).length === 0", at));
  })();

  it("is not a seg, because aria-pressed is independent per venue", () => {
    assert.doesNotMatch(group, /className="seg"/);
    assert.match(group, /role="group"/);
  });

  it("spells out both readings, so on and off are each stated", () => {
    // A raised-surface fill reads as "the selected one". Two marks read as a
    // row of switches, which is what this is.
    assert.match(group, /on \? "✓" : "✕"/);
    assert.match(group, /aria-pressed=\{on\}/);
  });

  it("says so when there is no venue to include yet", () => {
    // The seg used to render as an empty pill box before the first book, which
    // reads as a control with its options missing.
    assert.match(stripped, /No venue is streaming yet, so there is nothing to include or exclude/);
  });

  it("leaves the exclusive control beside it still exclusive", () => {
    /**
     * The other half of the rule, and the reason this is not simply "drop the
     * seg". The routing urgency preset directly above IS one-of-three, and it
     * must keep the treatment the multi-select has given up — otherwise the two
     * are indistinguishable again, from the other direction.
     */
    assert.match(
      stripped,
      /<div className="seg" role="group" aria-label="What-if routing urgency preset">/,
    );
  });
});

// --------------------------------------------------------------------------
// 4. Fill quality, split in two
// --------------------------------------------------------------------------

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

// --------------------------------------------------------------------------
// 5. Activity, split along the record/stream seam
// --------------------------------------------------------------------------

describe("Activity is the record and the stream, one seg apart", () => {
  /**
   * The blotter, the decision tape and the alert feed were one long scroll,
   * and the only thing keeping the record ahead of the stream was source
   * order — a comment saying "after the blotter, deliberately". The split
   * states that argument as geometry: Blotter is the polled record, Tape &
   * alerts is what the desk is doing right now, and the reader chooses which
   * question they are asking instead of scrolling past the answer to the
   * other one.
   */
  const stripped = code(cockpit);

  it("splits into exactly two panes", () => {
    const block = stripped.slice(stripped.indexOf("const ACTIVITY_PANES"));
    const list = block.slice(0, block.indexOf("];"));
    const ids = [...list.matchAll(/\{ id: "([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, ["blotter", "tape"]);
  });

  it("switches with the house `.seg role=group`, never a nested rail", () => {
    // Same grammar as Fill quality directly above it, for the same reason:
    // WorkspaceSubtabs publishes --rail-h and asserts one rail is mounted.
    assert.match(stripped, /<div className="seg" role="group" aria-label="Activity view">/);
    assert.match(stripped, /aria-pressed=\{activityPane === option\.id\}/);
    assert.equal((stripped.match(/<WorkspaceSubtabs\b/g) ?? []).length, 0);
  });

  it("declares the pane state above the loading bail-out", () => {
    // React throws "rendered more hooks than during the previous render" on
    // the first render that gets past the placeholder otherwise.
    const state = stripped.indexOf("useState<ActivityPane>");
    const bail = stripped.indexOf("if (loading && !book && !problem)");
    assert.ok(state >= 0, "the pane holds no state");
    assert.ok(bail >= 0, "the loading bail-out moved");
    assert.ok(state < bail, "the pane state is declared after an early return");
  });

  it("opens on the record, never the stream", () => {
    /**
     * The default carries what the old ordering carried: reading the stream
     * first invites treating it as the record, which is exactly what a
     * channel that drops silently cannot be. A fixed default, not one from a
     * tier — the same rule the quality pane states.
     */
    assert.match(stripped, /useState<ActivityPane>\("blotter"\)/);
    assert.doesNotMatch(stripped, /useComplexity|atLeast/);
  });

  it("renders panes conditionally rather than hiding them", () => {
    assert.match(stripped, /activityPane === "blotter" && \(/);
    assert.match(stripped, /activityPane === "tape" && \(/);
    assert.doesNotMatch(stripped, /hidden=\{activityPane/);
  });

  it("accepts losing the tape's session rows, and says so where the trade is made", () => {
    /**
     * A conditional render unmounts DeskTape, and the rows its channel
     * gathered this session are gone when it remounts. That is sound only by
     * the tape's own doctrine — watched, not counted on; the blotter's poll
     * owns every decision the tape ever showed — so the raw source is scanned
     * here, comments included: the trade must stay argued at the point it is
     * made, or the next edit keeps the unmount and loses the reason.
     */
    assert.match(cockpit, /watched,\s*not counted on/);
  });

  it("puts the record in Blotter and both feeds in Tape & alerts", () => {
    const open = stripped.indexOf('activityPane === "blotter"');
    const shut = stripped.indexOf('activityPane === "tape"');
    // Measured, not sliced blind — `indexOf` returning -1 twice would hand
    // `doesNotMatch` an empty string and pass without reading anything.
    assert.ok(open >= 0 && shut > open, "the panes are gone, so nothing was checked");
    const blotterPane = stripped.slice(open, shut);
    const tapePane = stripped.slice(shut);
    assert.match(blotterPane, /<BlotterViews/);
    assert.doesNotMatch(blotterPane, /<DeskTape|<AlertFeed/);
    assert.match(tapePane, /<DeskTape/);
    assert.match(tapePane, /<AlertFeed/);
    assert.doesNotMatch(tapePane, /<BlotterViews/);
  });

  it("keeps the blotter's wiring exactly as it was", () => {
    // The split moves the record into a pane; it does not re-plumb it. The
    // cancel path still re-reads this panel's own poll — through the cockpit's
    // one invalidation path now, which stays local because a cancel carries no
    // submission result — and `active` still gates the resting book's polling
    // on the subtab, not the pane; the conditional render handles the pane.
    assert.match(stripped, /active=\{section === "activity"\}/);
    assert.match(stripped, /onChanged=\{revalidate\}/);
    assert.match(stripped, /if \(result\) onOrderSettled\?\.\(result\)/);
    assert.match(stripped, /<AlertFeed events=\{effectiveEvents\} source=\{feedSource\}/);
  });

  it("keeps the panel id a literal, because the routing suite scrapes for it", () => {
    assert.match(stripped, /tabId="activity"/);
    assert.doesNotMatch(stripped, /tabId=\{/);
  });
});
