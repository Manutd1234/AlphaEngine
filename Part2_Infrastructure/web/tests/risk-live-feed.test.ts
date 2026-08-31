/**
 * "The risk tab doesn't show the live feed for any."
 *
 * WHAT WAS ACTUALLY WRONG
 * ------------------------------------------------------------------------
 * Nothing was frozen. The chrome's claim was true — `useBook` memoises the
 * view on the payload, `lazy-panels.tsx` memoises `RiskWorkspace` on that
 * identity, so a new snapshot does re-render every panel on this tab, and
 * `risk-stability.test.ts` already pins that a failed poll cannot blank it.
 *
 * The defect was that nothing on the tab SAID a value had moved. Every other
 * book-fed surface counts its live figures through `NumberTicker` — the
 * Portfolio overview and performance sections, Execution's P&L strip, the
 * Overview KPI deck, the header's latency chip — and the Risk tab wired none
 * at all, so a figure that changed and a figure that did not looked identical.
 * Worse, the two simulation cards deliberately quantise equity to $1,000
 * buckets so they do not re-simulate on the 15s poll (correct, documented, and
 * pinned in `risk-stability.test.ts`) and never mentioned it, so their figures
 * genuinely held still for minutes under a chrome reading "live-pushed".
 *
 * So the fix is two-sided and this suite pins both sides: the tab now counts
 * the book-fed figures it is safe to count, AND the two cards that hold still
 * on purpose say which live figure they are standing on and what moves them.
 * The restraint itself must survive — a test that let it be removed would
 * trade this defect for a worse one.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readSource, stripCode } from "./helpers/source-files";

const SURFACES = [
  "components/RiskWorkspace.tsx",
  // The limits subtab's body, extracted from the workspace when it hit the
  // line ceiling. It is where the concentration tile is mounted now, so the
  // workspace alone would no longer see the mount this suite exists to pin.
  "components/risk/LimitsPanel.tsx",
  "components/risk/BookConcentration.tsx",
  "components/risk/MonteCarloDistribution.tsx",
  "components/portfolio/OracleVarPanel.tsx",
] as const;

const code = new Map(SURFACES.map((path) => [path, stripCode(readSource(path))]));
const at = (path: (typeof SURFACES)[number]) => code.get(path) as string;

describe("the tab's sources are actually being read", () => {
  it("every file loads with content", () => {
    // Without this, every doesNotMatch below would pass by scanning nothing.
    for (const path of SURFACES) {
      assert.ok(at(path).length > 200, `${path} is empty once stripped`);
    }
  });
});

describe("the Risk tab counts the live figures it is safe to count", () => {
  it("the limits subtab's concentration figures move visibly", () => {
    const tile = at("components/risk/BookConcentration.tsx");
    assert.match(tile, /NumberTicker value=\{largestShare \* 100\}/);
    assert.match(tile, /NumberTicker value=\{effectivePositions\}/);
    assert.match(at("components/risk/LimitsPanel.tsx"), /<BookConcentration/,
      "the limits panel must mount it, or the tab is exactly as still as it was");
  });

  it("both simulation cards count the live book equity beside their figures", () => {
    for (const path of ["components/risk/MonteCarloDistribution.tsx", "components/portfolio/OracleVarPanel.tsx"] as const) {
      assert.match(at(path), /NumberTicker value=\{equity\}/,
        `${path} shows no live value at all, which is what the tab was reported for`);
    }
  });

  it("no nullable metric was coerced to zero on the way to a ticker", () => {
    // The failure mode this whole tab is alert to, in its motion form: `?? 0`
    // feeding a ticker turns "we do not know" into "it is fine", animated.
    for (const path of SURFACES) {
      assert.doesNotMatch(at(path), /NumberTicker value=\{[^}]*\?\? 0/, `${path} coerces into a ticker`);
    }
  });
});

describe("the cards that hold still on purpose say why", () => {
  it("the bootstrap card names the completed result's equity bucket while a replacement runs", () => {
    const card = at("components/risk/MonteCarloDistribution.tsx");
    assert.match(card, /const displayedEquityForRun = result\?\.equity \?\? equityForRun/,
      "the label must follow the retained result, not a newly requested equity bucket");
    assert.match(card, /this run holds the \{usd\(displayedEquityForRun, 0\)\} bucket/);
    assert.match(card, /crosses into the next \$1,000/,
      "the reader is told what makes it re-simulate, not merely that it has not");
  });

  it("the GBM card says when the next simulation runs", () => {
    assert.match(at("components/portfolio/OracleVarPanel.tsx"),
      /the next\s+simulation runs when it crosses into the next \$1,000/);
  });

  it("the restraint itself is untouched — this is a sentence, not a re-wiring", () => {
    // `risk-stability.test.ts` owns the full quantisation contract. Repeated
    // here in its weakest form on purpose: a future edit that "fixes" the
    // liveness complaint by deleting the bucket would make both cards
    // re-simulate on every 15s poll, which is a worse defect than the silence
    // this pass was fixing.
    for (const path of ["components/risk/MonteCarloDistribution.tsx", "components/portfolio/OracleVarPanel.tsx"] as const) {
      assert.match(at(path), /Math\.round\(equity \/ 1_000\) \* 1_000 \|\| equity/,
        `${path} stopped quantising: every book poll now re-simulates`);
    }
  });
});

describe("no risk panel invents its own feed", () => {
  it("nothing added here polls, fetches or ticks on a timer", () => {
    // The tab reads one book. A panel that started its own interval to look
    // livelier would be a second source of truth for equity — and a second
    // chance to flap, which is what `risk-stability.test.ts` opens by pinning.
    for (const path of SURFACES) {
      for (const banned of ["setInterval(", "usePolling(", "useBook(", "/api/gateway/portfolio"]) {
        assert.ok(!at(path).includes(banned), `${path} contains ${banned}`);
      }
    }
  });
});
