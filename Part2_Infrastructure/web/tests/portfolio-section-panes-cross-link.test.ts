/**
 * THE CROSS-LINK TILE NAMES ITS DESTINATION — and there is still only one of
 * it.
 *
 * `onNavigate` was a bare thunk, so both tiles could name the destination TAB
 * but not the panel — the reader landed on whichever section they last
 * visited, which for a tile quoting VaR and headroom could be the Monte Carlo
 * panel. The argument is optional in both directions, so a caller that cannot
 * route to a section still compiles and still works.
 *
 * The second describe is the ratchet that keeps the fix from being worth
 * copying: a hand-rolled fourth copy of the tile would get none of this, and
 * `globals.css` says so at `.cross-link-tile:hover`. The count may fall, not
 * rise.
 *
 * Source-level assertions, like the rest of this suite: there is no DOM here.
 * The tile itself is `components/portfolio/BookChrome.tsx`; its two callers
 * are the Overview Book pane and `components/risk/LimitsPanel.tsx` — the Risk
 * tile moved there with the rest of the limits subtab — and the scan for
 * hand-rolled copies walks `components/` for itself rather than trusting a
 * list.
 *
 * Siblings: `-splits` (the split mechanics), `-overview` (the Standing pane
 * and its bands), `-performance` (the time base).
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { bookChrome, code, limitsPanel, overviewBook, root } from "./helpers/portfolio-sources";

// --------------------------------------------------------------------------
// The cross-link tile knows where it is going
// --------------------------------------------------------------------------

describe("a cross-link tile lands on the panel that explains its numbers", () => {
  it("hands the target section to the caller's handler", () => {
    assert.match(bookChrome, /onClick=\{\(\) => onNavigate\(targetSection\)\}/);
  });

  it("keeps both halves optional, so a tab-only caller still works", () => {
    /**
     * The compatibility that makes this safe to land before `page.tsx` catches
     * up: a `() => void` handler is assignable to `(section?: Section) => void`,
     * so the existing wiring keeps compiling and keeps behaving exactly as it
     * did — it simply ignores the argument.
     */
    assert.match(bookChrome, /onNavigate: \(section\?: Section\) => void/);
    assert.match(bookChrome, /targetSection\?: Section/);
  });

  it("types the target against the destination workspace's own section ids", () => {
    // A loose `string` would let a typo compile and fall back to whatever
    // section the reader last had open — the defect this prop exists to end,
    // wearing a different cause.
    assert.match(overviewBook, /<CrossLinkTile<RiskSection>/);
    assert.match(limitsPanel, /<CrossLinkTile<PortfolioSection>/);
  });

  it("sends the Portfolio tile to Limits and the Risk tile to Positions", () => {
    /**
     * Three of the Portfolio tile's four metrics — gross headroom, the drawdown
     * cushion and the binding constraint — are rows of the limit table on
     * `risk/limits`; VaR 95 is the fourth and lives on `risk/model`. The Risk
     * tile's own comment has always said the full positions table is "one click
     * away", which was only true of the tab.
     */
    const portfolioTile = overviewBook.slice(overviewBook.indexOf("<CrossLinkTile<RiskSection>"));
    assert.match(portfolioTile.slice(0, 400), /targetSection="limits"/);
    // `indexOf` returns -1 when the tile has moved out of the file being
    // scanned, and `slice(-1)` then hands the assertion the last character —
    // a failure message about one byte rather than about the missing tile.
    const riskAt = limitsPanel.indexOf("<CrossLinkTile<PortfolioSection>");
    assert.notEqual(riskAt, -1, "the Risk tile is not in the file this suite reads");
    assert.match(limitsPanel.slice(riskAt, riskAt + 400), /targetSection="positions"/);
  });

  it("says on the button where the click lands", () => {
    // "Open Risk" named a tab. A destination the reader cannot predict before
    // clicking is the same navigation problem one step earlier.
    assert.match(overviewBook, /actionLabel="Open Risk limits"/);
    assert.match(limitsPanel, /actionLabel="Open Portfolio positions"/);
  });
});

// --------------------------------------------------------------------------
// The fourth copy
// --------------------------------------------------------------------------

describe("the hand-rolled copies of the tile do not multiply", () => {
  /**
   * globals.css says at `.cross-link-tile:hover` that a fourth copy is what
   * this consolidation exists to prevent. `DataConsole` still reimplements the
   * heading, the `.cross-link-metrics` grid and the `.text-action` by hand, and
   * folding it in needs its wrapper geometry moved too — a stylesheet change.
   * Until then this is a ratchet, not a pass: the count may fall, not rise.
   *
   * It measures the shared class, so it sees the copies that reuse the grid.
   * `ReliabilityOverview` is a third copy with its OWN class
   * (`.reliability-data-handoff__metrics`) and is therefore invisible here —
   * naming it in the list would be asserting something this scan does not
   * measure.
   */
  const sourceFiles = (dir: string): string[] => {
    let out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out = out.concat(sourceFiles(full));
      else if (full.endsWith(".tsx")) out.push(full);
    }
    return out;
  };

  it("stays at the two that predate the shared component", () => {
    const handRolled: string[] = [];
    for (const file of sourceFiles(join(root, "components"))) {
      const source = code(readFileSync(file, "utf8"));
      if (!source.includes("cross-link-metrics")) continue;
      if (source.includes("CrossLinkTile")) continue;
      handRolled.push(file.slice(root.length));
    }
    assert.deepEqual(
      handRolled.sort(),
      ["components/DataConsole.tsx"],
      "a surface is reimplementing CrossLinkTile by hand; it has a targetSection now, so use it",
    );
  });
});
