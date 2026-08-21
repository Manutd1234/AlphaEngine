/**
 * The payload fixtures the data-contract suites share.
 *
 * `contracts-quotes.test.ts` became six files on 2026-08-21, and three of them build
 * the same healthy quote before breaking exactly one field of it. A fixture
 * body copied into three suites is how they drift into asserting different
 * things under the same name — the quote that is "healthy" in one file grows a
 * field the others never gained — so it lives here once and every caller reads
 * it.
 */

import type { Quote } from "../../lib/providers/types";

/**
 * A fixed clock. Freshness is the whole point of several of these checks, so
 * "now" must be a property of the fixture rather than of the minute the suite
 * happened to run in.
 */
export const NOW = Date.UTC(2026, 7, 5, 12, 0, 0);

/** A quote with nothing wrong with it, so a test can break one field at a time. */
export function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: "BTCUSDT",
    price: 67_500,
    change: 420,
    changePct: 0.0063,
    open: 67_000,
    high: 68_000,
    low: 66_800,
    prevClose: 67_080,
    volume: 12_345,
    currency: "USD",
    asOf: new Date(NOW - 30_000).toISOString(),
    ...overrides,
  } as Quote;
}
