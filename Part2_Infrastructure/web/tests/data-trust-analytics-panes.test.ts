/**
 * The panes Trust Summary draws its analytics on, and the boundaries that keep
 * them truthful.
 *
 * The structural half of Trust Summary. Everything the two derivation suites
 * assert about honest numbers — `data-trust-analytics-supply.test.ts` for
 * capacity, `data-trust-analytics-throughput.test.ts` for what is arriving —
 * only reaches a reader if the panel holding it is mounted, visible, and drawn
 * from the half of the payload that is populated. Four ways that stops being
 * true, none of them visible to a type checker:
 *
 *  - A pane hidden with `hidden` rather than unmounted keeps observing and keeps
 *    measuring while nobody is looking at it.
 *  - A second `WorkspaceSubtabs` puts a second ResizeObserver on `--rail-h`,
 *    which every sticky offset in the app reads.
 *  - A chart pointed at ring-backed counters the health route never increments
 *    renders empty on a busy deployment, so it is asserted in the file that
 *    actually imports it rather than against the concatenation.
 *  - A hand-maintained claim block drifts. The assessment boundary did: it was
 *    still saying escalation reached one channel and that there was no rota,
 *    after both shipped.
 *
 * No DOM harness in this suite, so these read source. The distinction that
 * makes that safe is which file each assertion opens: a positive claim reads
 * the file its subject lives in, and every "must not appear" reads the whole
 * surface — scoped to the shell alone it would still pass with `p95 ?? 0` in a
 * pane file, which is a test agreeing with itself about a file that no longer
 * holds its subject.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readSource } from "./helpers/source-files";

// --------------------------------------------------------------------------
// Structure. No DOM harness in this suite, so these pin the boundaries that
// make the rendered panes truthful.
// --------------------------------------------------------------------------

describe("Trust Summary splits without hiding or double-mounting", () => {
  /**
   * The panes are files now, and this scan follows them.
   *
   * `DataTrustOverview` was 747 lines with five panes inline. It kept the pane
   * state, both segmented controls and the Verdict pane; the other four moved
   * to siblings, mounted by the same conditionals they were rendered behind.
   *
   * Every assertion below reads the file its subject actually lives in, and the
   * NEGATIVE ones read the whole surface. That distinction is the point: a
   * "must not appear" scoped to the shell alone would still pass with `p95 ?? 0`
   * or a resurrected boundary block sitting in a pane file, which is a test
   * agreeing with itself about a file that no longer holds its subject.
   */
  const overview = readSource("components/data/DataTrustOverview.tsx");
  const panes = {
    response: readSource("components/data/TrustResponsePane.tsx"),
    composition: readSource("components/data/TrustCompositionPane.tsx"),
    freshness: readSource("components/data/FeedsFreshnessPane.tsx"),
    contracts: readSource("components/data/FeedsContractsPane.tsx"),
  };
  const strip = (source: string) =>
    source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  /** The switcher's own file — where the pane state and both segs live. */
  const shell = strip(overview);
  /** Every file the surface is drawn from, for the assertions that forbid. */
  const code = [overview, ...Object.values(panes)].map(strip).join("\n");

  it("offers three panes, not four", () => {
    const declared = [...shell.matchAll(/\{\s*id: "(verdict|response|composition)"/g)];
    assert.equal(declared.length, 3, "a four-button seg forces abbreviated labels");
  });

  it("uses the house segmented control rather than a second tab rail", () => {
    // A nested WorkspaceSubtabs publishes `--rail-h` from a ResizeObserver and
    // asserts exactly one rail is mounted; a second fights the first over every
    // sticky offset in the app.
    assert.match(shell, /className="seg" role="group"/);
    assert.match(shell, /aria-pressed=\{pane === option\.id\}/);
    assert.ok(!code.includes("WorkspaceSubtabs"), "a nested rail would contend for --rail-h");
  });

  it("renders panes conditionally so a switched-away one stops observing", () => {
    for (const pane of ["verdict", "response", "composition"]) {
      assert.match(shell, new RegExp(`pane === "${pane}" &&`));
    }
    assert.ok(
      !/hidden=\{!summary\}/.test(code) && !/hidden=\{!feedsView\}/.test(code),
      "a hidden pane is still mounted and still measuring",
    );
  });

  it("does not render an assessment boundary block at all", () => {
    // This asserted the block stayed OUTSIDE the pane switcher, on the grounds
    // that a boundary which disappears when the reader changes view is one they
    // can miss entirely. That was a good argument for a block that should not
    // exist: it was asked for twice, and by the time it went it had drifted —
    // still claiming escalation reached one channel and that there was no rota,
    // after both shipped.
    //
    // A hand-maintained claim block is the failure mode, not its placement.
    assert.ok(!code.includes("data-trust-boundaries"), "the boundary block is back");
    assert.ok(!code.includes("Assessment boundary"), "the boundary block is back under another class");
  });

  it("lands on the verdict, which is what the tab is for", () => {
    assert.match(shell, /useState<TrustPane>\("verdict"\)/);
  });

  it("draws the analytics on the half of the payload that is populated", () => {
    // The ring-backed counters are incremented in the quote lambdas, not in the
    // health route, so charts over them are empty on a busy deployment too.
    // Each is asserted in the file that imports it. Left pointed at the shell,
    // the two that moved into the Response pane would have gone red — which is
    // how this re-anchor was found — and pointing them all at the concatenation
    // instead would stop noticing which file draws what.
    const owners: Array<[string, string, string]> = [
      ["InstanceScope", overview, "DataTrustOverview"],
      ["SupplyPosture", overview, "DataTrustOverview"],
      ["FeedThroughput", panes.response, "TrustResponsePane"],
      ["QuotaHeadroom", panes.response, "TrustResponsePane"],
    ];
    for (const [panel, source, owner] of owners) {
      assert.ok(source.includes(`<${panel} health={health} />`), `${panel} is imported but never rendered in ${owner}`);
    }
  });

  it("withholds an unpublished p95 instead of pattern-matching keys inline", () => {
    assert.ok(!code.includes('row.key.startsWith("venue:")'), "the key matcher that dropped plane:* is back");
    assert.match(panes.response, /"p95 n\/a"/);
    assert.ok(!/p95 \?\? 0/.test(code), "an unmeasured p95 must never render as instant");
  });
});
