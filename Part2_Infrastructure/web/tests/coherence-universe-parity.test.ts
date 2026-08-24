/**
 * The desk still reads the universe the gateway builds.
 *
 * The other half of a cross-language contract. `tools/make_coherence_fixture.py`
 * records the payload the REAL `event_view` produces over payloads captured
 * from the live exchange; `tests/test_coherence_universe_parity.py` asserts the
 * gateway still reproduces it, and this asserts the browser still reads it.
 * One committed JSON, two languages held to it — which is the same mechanism
 * `gate-parity.test.ts` uses for the risk battery, pointed at this payload.
 *
 * WHAT THIS CATCHES THAT NOTHING ELSE DID. The gateway and the browser are two
 * separately deployed units that cannot call each other. A field renamed in
 * `views.py` and a field renamed in `lib/coherence/types.ts` were, until this
 * pair existed, two green suites and one blank panel. A failure here means the
 * wire moved: regenerate the fixture deliberately and expect the Python half to
 * fail in the same run.
 *
 * DERIVED, NEVER OBSERVED. This proves the desk's pure readers compute the
 * right figures off a real payload. It cannot prove a reader saw them — nothing
 * in this repository can (CLAUDE.md, fact 6).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { isCoherenceUniverse, type CoherenceUniverse } from "../lib/coherence/types";
import {
  activeContracts,
  basketValue,
  categoryShares,
  exposureBands,
  liquidityDepth,
} from "../lib/coherence/universe-metrics";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/coherence-universe-parity.json", import.meta.url)), "utf8"),
) as { version: number; universe: CoherenceUniverse };

const universe = fixture.universe;
const SIZE_FIELDS = ["open_interest", "liquidity", "volume", "notional_value"] as const;

describe("the recorded payload is one this desk accepts", () => {
  it("passes the guard the panels branch on", () => {
    assert.equal(fixture.version, 1);
    assert.ok(isCoherenceUniverse(universe), "the desk would reject the gateway's own payload");
  });

  it("every leg carries all four size fields, as strings or as nulls", () => {
    for (const event of universe.events) {
      for (const market of event.markets) {
        for (const field of SIZE_FIELDS) {
          const value = market[field];
          assert.ok(
            value === null || typeof value === "string",
            `${market.ticker}.${field} crossed as ${typeof value}; binary64 would round it`,
          );
        }
      }
    }
  });

  it("still covers the three shapes it was chosen for", () => {
    // Guards the corpus, not the code: a re-capture that lost the priced
    // basket or the never-traded ladder would leave everything below passing
    // over a payload that no longer exercises the branch it names.
    assert.equal(universe.events.length, 3);
    assert.equal(universe.events.filter((e) => e.mutually_exclusive).length, 1);
    assert.equal(universe.events.filter((e) => e.yes_ask_total === null).length, 2);
  });
});

describe("the KPI figures the Baskets view is built on", () => {
  it("totals the one family that is priced as a basket, and counts the rest", () => {
    const value = basketValue(universe);
    // $1.06 to buy a dollar — a real incoherent basket in the recorded book.
    assert.equal(value.totalCc, 10_600);
    assert.equal(value.counted, 1);
    // The two refusals are DIFFERENT facts and are counted apart: a family the
    // exchange does not call mutually exclusive has no basket to price, while
    // one with an unquoted leg has a basket nobody can price. A ring that put
    // them in one slice would be mixing "does not apply" with "cannot say".
    assert.equal(value.notExclusive, 2);
    assert.equal(value.unpriceable, 0);
  });

  it("sums open interest across the watchlist", () => {
    // 2112.64 + 21126.86 + 0.00, in centicent units.
    assert.deepEqual(activeContracts(universe), { totalCc: 232_395_000, counted: 3, absent: 0 });
  });

  it("reports a measured zero as zero, and never as a dash", () => {
    // Every family reports 0.0000 resting liquidity. That is the exchange
    // having looked and found nothing, which is a fact — not the absence a
    // dash is reserved for. Collapsing the two is `?? 0` in reverse.
    const depth = liquidityDepth(universe);
    assert.equal(depth.totalCc, 0);
    assert.equal(depth.counted, 3);
    assert.equal(depth.absent, 0);
    assert.notEqual(depth.totalCc, null, "a measured zero was rendered as an absence");
  });

  it("withholds the whole total when one family carries no figure", () => {
    const holed: CoherenceUniverse = {
      ...universe,
      events: universe.events.map((event, index) =>
        index === 1 ? { ...event, open_interest_total: null } : event,
      ),
    };
    const total = activeContracts(holed);
    assert.equal(total.totalCc, null, "a total was built from the families that answered");
    assert.equal(total.absent, 1, "the tile cannot say why it is dashing");
  });
});

describe("what the watchlist is made of", () => {
  it("groups by Kalshi's own category and keeps the unlabelled apart", () => {
    const shares = categoryShares(universe);
    const labelled = shares.find((share) => share.category === "Climate and Weather");
    assert.ok(labelled, "the one captured category is missing; it is read off the series, not the ticker");
    assert.equal(labelled.families, 1);
    // The other two series were never answered for. They are grouped as
    // uncategorised rather than guessed at from their ticker prefix.
    const unlabelled = shares.find((share) => share.category === null);
    assert.ok(unlabelled);
    assert.equal(unlabelled.families, 2);
  });
});

describe("where a family's size actually sits", () => {
  it("bands a real family's open interest by what its outcomes cost", () => {
    const fed = universe.events.find((event) => event.mutually_exclusive)!;
    const bands = exposureBands(fed);
    assert.equal(bands.length, 8);
    const placed = bands.reduce((sum, band) => sum + band.contractsCc, 0);
    assert.equal(placed, 21_126_400, "a leg's open interest was dropped between the bands");
    assert.ok(bands.some((band) => band.share !== null && band.share > 0), "every band came out empty");
  });

  it("refuses a share when the family's own total is zero", () => {
    // The never-traded crypto ladder: 60 legs, every one reporting 0.00. A
    // share is 0/0 there — undefined, not zero — so the band declines to draw
    // rather than printing a percentage of nothing.
    const crypto = universe.events.find((event) => event.event_ticker.startsWith("KXBTCD"))!;
    assert.equal(crypto.open_interest_total, "0.00");
    for (const band of exposureBands(crypto)) {
      assert.equal(band.share, null, "a share was computed against a zero denominator");
    }
  });
});
