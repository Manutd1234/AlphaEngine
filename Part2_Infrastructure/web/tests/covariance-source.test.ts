/**
 * The risk maths accepts bars from every real source, and only real sources.
 *
 * THE REGRESSION THIS PINS
 *
 * The covariance guard in `use-book.ts` was written as `source !== "binance"`
 * when Binance was the only venue serving crypto bars. It MEANT "no synthetic
 * prices"; it SAID "no venue but this one". The day the venue chain put Bybit
 * first, `/api/ohlcv` began answering `source: "bybit"` and the Risk tab
 * silently dropped every crypto symbol from the covariance — "not enough
 * price history to estimate a covariance" rendered against a book with 400
 * real daily observations behind it, permanently, with 1,200 tests green.
 *
 * It was found because a user asked why VaR was still pending and the answer
 * "give it time" was checked against the code instead of repeated. The check
 * is now a named predicate over the closed DATA_SOURCES union, and this file
 * is what fails if anyone narrows it back to a venue.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { DATA_SOURCES, isMeasuredSource } from "@/lib/types";

/**
 * The guard travelled to `lib/book-bars.ts` on 2026-08-21, when the per-symbol
 * OHLCV fetch left `use-book`'s effect body for a plain async function. The
 * check follows the code: left on `use-book.ts` the regex below would match
 * nothing and the `doesNotMatch` beside it would pass against a file that no
 * longer contains a source check at all.
 */
const useBook = readFileSync(
  fileURLToPath(new URL("../lib/book-bars.ts", import.meta.url)),
  "utf8",
);

/**
 * Comments stripped, so assertions bind to code and not to the comment that
 * retells the bug — which necessarily contains the forbidden pattern. Same
 * lesson as research-symbols.test.ts, learned twice now: to a regex, a file
 * documenting the mistake it fixed reads exactly like the mistake.
 */
const useBookCode = useBook
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("isMeasuredSource", () => {
  it("accepts every real source in the union", () => {
    for (const source of DATA_SOURCES) {
      if (source === "synthetic") continue;
      assert.ok(isMeasuredSource(source), `${source} serves real bars and was rejected`);
    }
  });

  it("rejects synthetic — the one distinction risk maths may care about", () => {
    assert.ok(!isMeasuredSource("synthetic"));
  });

  it("rejects sources that are not in the union at all", () => {
    // An unknown label is not evidence of real data; it is evidence of a new
    // code path nobody has classified yet. Fail closed until someone does.
    for (const junk of ["", "bitfinex", "BINANCE", undefined, null, 42]) {
      assert.ok(!isMeasuredSource(junk), `${String(junk)} was accepted`);
    }
  });

  it("stays total over the union — a new DATA_SOURCES member is auto-classified", () => {
    // The property that fixes the bug's root cause: adding a venue to
    // DATA_SOURCES makes it measured HERE with no second edit. The original
    // defect was precisely a second site that did not learn about the first's
    // new member.
    const classified = DATA_SOURCES.filter((s) => isMeasuredSource(s) || s === "synthetic");
    assert.equal(classified.length, DATA_SOURCES.length);
  });
});

describe("the covariance guard uses the predicate, not a venue literal", () => {
  it("book-bars.ts calls isMeasuredSource", () => {
    assert.match(useBookCode, /!isMeasuredSource\(body\.source\)/);
  });

  it("never again compares the source to a venue name", () => {
    // The exact line that caused the outage — asserted against comment-stripped
    // source, because the comment above the fix retells it verbatim.
    assert.doesNotMatch(
      useBookCode,
      /source\s*[!=]==\s*"(binance|bybit)"/,
      "a venue literal is back in the source check",
    );
    // And the stripper itself is proven live, or every assertion above is prose.
    assert.ok(useBookCode.length < useBook.length, "the comment stripper removed nothing");
  });
});
