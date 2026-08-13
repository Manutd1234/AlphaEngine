/**
 * The limit-pressure chart, and the four ways it would read better than the truth.
 *
 * Every one of these is a way a reader ends up believing there is more room
 * than there is: a withheld limit drawn as an empty bar, an axis that ends at
 * the largest observed value instead of at the limit, a status hidden behind a
 * disclosure, or an over-limit position silently clamped without saying so.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { exposureCells } from "../lib/portfolio-analytics";
import type { PortfolioPosition } from "../lib/portfolio";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const source = read("../components/portfolio/ExposureHeatmap.tsx");

const position = (over: Partial<PortfolioPosition> = {}): PortfolioPosition =>
  ({
    symbol: "BTCUSDT",
    side: "LONG",
    notional: 10_000,
    share_of_gross: 0.4,
    unrealized_pnl: 0,
    symbol_limit: { utilisation: 0.5, remaining: 5_000 },
    ...over,
  }) as unknown as PortfolioPosition;

describe("a limit nobody published is not a limit nobody used", () => {
  it("keeps utilisation null rather than coercing it to zero", () => {
    const [cell] = exposureCells([
      position({ symbol_limit: undefined as unknown as PortfolioPosition["symbol_limit"] }),
    ]);
    assert.equal(cell.utilisation, null);
  });

  it("draws the withheld row dashed and labelled, never as a zero-width bar", () => {
    // The house convention: a hollow dashed track plus the word, so the gap
    // reads as a measurement nobody took rather than a limit nobody touched.
    assert.match(source, /strokeDasharray="3 3"/);
    assert.match(source, /n\/a/);
    assert.doesNotMatch(
      source,
      /utilisation\s*(\?\?|\|\|)\s*0/,
      "a withheld utilisation was coerced to zero",
    );
  });
});

describe("the axis ends at the limit", () => {
  it("uses a fixed 0 to 1 domain rather than the observed extent", () => {
    /**
     * `extent` would end the axis at the largest observed utilisation, so a book
     * whose worst position sits at 40% of its cap would draw that bar full.
     * That is the single most flattering mistake available here.
     */
    assert.match(source, /linearScale\(0,\s*1,/);
    assert.doesNotMatch(source, /extent\(/, "the limit axis is scaled to the data");
  });

  it("marks the limit and says so when a position runs past it", () => {
    assert.match(source, /Math\.min\(u,\s*1\)/, "an over-limit bar must be clamped");
    assert.match(source, /u > 1/, "and the overflow must be stated rather than hidden");
  });
});

describe("a status is never collapsed", () => {
  it("keeps the tight-position names outside every disclosure", () => {
    // P1: hiding which positions are pressed against a stop changes what a
    // reader believes. Methodology collapses; a limit status does not.
    const firstDisclosure = source.indexOf("<details");
    assert.ok(firstDisclosure > 0, "the panel grew no disclosure at all");
    const beforeDisclosure = source.slice(0, firstDisclosure);
    // Both branches of the status — the named tight positions and the "none"
    // case — must render above the first disclosure.
    assert.match(beforeDisclosure, /symbol limit:/);
    assert.match(beforeDisclosure, /tight\.map\(\(cell\) => cell\.symbol\)\.join/);
    assert.match(beforeDisclosure, /No position is above/);
  });

  it("names what is inside each disclosure", () => {
    const summaries = [...source.matchAll(/<summary>([\s\S]*?)<\/summary>/g)].map((m) => m[1].trim());
    assert.ok(summaries.length >= 2, "expected the methodology and the table to collapse");
    for (const summary of summaries) {
      assert.ok(summary.length > 12, `a summary is too vague to act on: "${summary}"`);
      assert.doesNotMatch(summary, /^(Advanced|More|Details)$/i);
    }
  });
});

describe("the chart keeps its table twin", () => {
  it("still renders the classes the table owns", () => {
    /**
     * Deleting the table would orphan `.exposure-heatmap__bar` and `.is-tight`
     * — rules declared in CSS and rendered nowhere — which pushes
     * `dead-css.test.ts` over its baseline. Collapsing it keeps them referenced.
     */
    assert.match(source, /exposure-heatmap__bar/);
    assert.match(source, /is-tight/);
    assert.match(source, /<table className="exposure-heatmap">/);
  });

  it("does not reorder exposureCells itself", () => {
    // `portfolio-analytics.test.ts` pins the share ordering; the chart's own
    // ranking is local so that contract stays untouched.
    const cells = exposureCells([
      position({ symbol: "A", share_of_gross: 0.2, symbol_limit: { utilisation: 0.9 } as never }),
      position({ symbol: "B", share_of_gross: 0.8, symbol_limit: { utilisation: 0.1 } as never }),
    ]);
    assert.deepEqual(cells.map((c) => c.symbol), ["B", "A"], "exposureCells stopped ranking by share");
  });
});
