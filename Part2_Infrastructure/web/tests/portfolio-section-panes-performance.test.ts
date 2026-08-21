/**
 * PERFORMANCE IS SPLIT ALONG A TIME BASE, AND THE LABELS SAY SO.
 *
 * The flow tables and the execution-quality tiles come from
 * `execution_stats()`, which is `FROM orders` with no session filter —
 * lifetime. The drawdown and rolling-Sharpe plots are measured from the equity
 * track, which starts empty on every load. The card in the first pane already
 * warned in prose that mixing the two subtracts a lifetime fee bill from one
 * day's P&L; a split that put a lifetime card and a session card in the same
 * pane would have left the boundary the warning is about inside a pane, and
 * the warning still a paragraph nobody reads.
 *
 * That is why the pane bodies are read out by their guards below rather than
 * scanned as one file: the claim is about which side of the boundary a card
 * falls on, and a whole-file search cannot tell.
 *
 * Source-level assertions, like the rest of this suite: there is no DOM here,
 * and the code now lives in `components/portfolio/PerformanceSection.tsx`
 * rather than in the 1,105-line workspace these checks were first written
 * against.
 *
 * Siblings: `-splits` (the split mechanics), `-overview` (the Standing pane
 * and its bands), `-cross-link` (the tile's destination).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { performance, performanceSource } from "./helpers/portfolio-sources";

/** The body of one pane, from its own guard to the next thing at panel level. */
function pane(source: string, guard: string, until: string): string {
  const start = source.indexOf(guard);
  assert.ok(start >= 0, `no pane guarded by ${guard}`);
  const end = source.indexOf(until, start);
  assert.ok(end > start, `${guard} is not followed by ${until}`);
  return source.slice(start, end);
}

// --------------------------------------------------------------------------
// The Performance boundary is a time base
// --------------------------------------------------------------------------

describe("Performance is split along its time base, and says so", () => {
  it("names the time base in the visible label, not only in the hint", () => {
    const block = performance.slice(performance.indexOf("const PERFORMANCE_PANES"));
    const list = block.slice(0, block.indexOf("];"));
    assert.match(list, /label: "Flow, lifetime"/);
    assert.match(list, /label: "Trend, this session"/);
  });

  it("keeps the lifetime cards together and the session card alone", () => {
    /**
     * `execution_stats()` on the gateway is `FROM orders` with no session
     * filter, so the execution-quality tiles are measured over the same window
     * as the flow tables — they are those tables' totals row. Putting them with
     * the session chart would have reproduced, inside one pane, exactly the mix
     * the attribution card warns against.
     */
    const flow = pane(performance, 'performancePane === "flow"', 'performancePane === "trend"');
    assert.match(flow, /<h2>Strategy flow<\/h2>/);
    assert.match(flow, /<h2>Flow by instrument<\/h2>/);
    assert.match(flow, /<h2>Execution quality<\/h2>/);
    assert.doesNotMatch(flow, /<RiskAdjustedTrend/);
  });

  it("says on the quality card itself that its tiles are lifetime", () => {
    // The fee tile said so; the other three did not, and the kicker said
    // "desk-wide", which is a scope rather than a window.
    assert.match(performance, /page-kicker">Desk-wide and lifetime, computed by the gateway</);
  });

  it("keeps the warning prose that the switcher now makes visible", () => {
    // It explains the boundary rather than substituting for it, so splitting
    // the panel — into panes, and then into a file of its own — is not licence
    // to delete it.
    // Shortened in the copy-reduction pass; the claim is unchanged, so the
    // assertion follows the sentence rather than the other way round.
    assert.match(
      performanceSource,
      /mixing the two subtracts a lifetime fee bill from one day&apos;s P&amp;L/,
    );
  });
});
