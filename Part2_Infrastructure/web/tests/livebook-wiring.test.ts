/**
 * Which ladders are allowed to price an order.
 *
 * `lib/livebook.ts` decides this in two places — the publish tick's snapshot
 * merge and `liveTca` — and until now **no test in the tree read that file at
 * all**. Only `file-size.test.ts` and a throttle scan even named it. Delete
 * `&& s.book.ok` from either filter today and the whole suite stayed green.
 *
 * That is the same shape of invisibility that let the venue live/stale
 * oscillation survive: the former `venues.test.ts` sat at 596 lines guarding the
 * pure maths, `venue-liveness.test.ts` guards the `VenueLiveness` class in
 * isolation, and the WIRING between them — the filter that actually decides
 * which books reach `walkBook` and `consolidatedMid` — was guarded by neither.
 * A stale or unparsed ladder reaching the routing maths does not throw. It
 * quietly prices an order against a book that is not there.
 *
 * Found while splitting that file, which is the argument for splitting it: the
 * hole was invisible at 596 lines.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { liveTca, type LiveSnapshot, type LiveVenueState } from "../lib/livebook";
import { walkBook } from "../lib/venues/fill-tolerance";

const BIDS: [number, number][] = [[100, 5], [99.5, 5], [99, 5]];
const ASKS: [number, number][] = [[100.5, 5], [101, 5], [101.5, 5]];

function book(venue: string, { ok = true, mid = 100.25 as number | null } = {}) {
  return {
    venue, symbol: "BTCUSDT", ok, latencyMs: 1,
    bids: BIDS, asks: ASKS,
    bestBid: 100, bestAsk: 100.5, mid,
  } as unknown as LiveVenueState["book"];
}

function venue(
  name: string,
  status: LiveVenueState["status"],
  bookOk = true,
): LiveVenueState {
  return {
    venue: name as LiveVenueState["venue"],
    status,
    book: book(name, { ok: bookOk }),
    updates: 1, lastUpdate: 0, reconnects: 0, frames: 1, restarts: 0,
  } as LiveVenueState;
}

function snapshot(venues: LiveVenueState[]): LiveSnapshot {
  return {
    symbol: "BTCUSDT",
    venues,
    consolidatedMid: 100.25,
  } as unknown as LiveSnapshot;
}

describe("only a live, parsed ladder may price an order", () => {
  it("a venue whose book failed to parse is excluded, however live the socket is", () => {
    // `emptyBook()` returns `ok: false`, and that is what a venue carries
    // between handshake and first frame, and after a parse failure. The socket
    // is genuinely live; the ladder is not there.
    const both = liveTca(snapshot([venue("BINANCE", "live"), venue("BYBIT", "live", false)]), "BUY", 10_000);
    assert.ok(both, "a usable venue remains, so an estimate is expected");
    assert.deepEqual(
      both!.perVenue.map((row) => row.venue), ["BINANCE"],
      "a book with ok:false must not reach walkBook",
    );
  });

  it("a stale venue is excluded even though its last book parsed fine", () => {
    const both = liveTca(snapshot([venue("BINANCE", "live"), venue("BYBIT", "stale")]), "BUY", 10_000);
    assert.deepEqual(both!.perVenue.map((row) => row.venue), ["BINANCE"]);
  });

  it("connecting and errored venues are excluded", () => {
    for (const status of ["connecting", "error"] as const) {
      const out = liveTca(snapshot([venue("BINANCE", "live"), venue("BYBIT", status)]), "BUY", 10_000);
      assert.deepEqual(out!.perVenue.map((row) => row.venue), ["BINANCE"], `${status} reached the maths`);
    }
  });

  it("no usable ladder returns null rather than an estimate built on nothing", () => {
    // The honest answer. An estimate over zero books would render as a real
    // number with no book behind it.
    assert.equal(liveTca(snapshot([venue("BINANCE", "stale"), venue("BYBIT", "live", false)]), "BUY", 10_000), null);
    assert.equal(liveTca(snapshot([]), "BUY", 10_000), null);
  });

  it("a null snapshot is null, not an empty estimate", () => {
    assert.equal(liveTca(null, "BUY", 10_000), null);
  });
});

describe("the publish tick applies the same rule as liveTca", () => {
  /**
   * Source-pinned rather than behavioural: the merge lives inside
   * `useLiveBook`'s `setInterval`, which cannot be reached without a renderer.
   * The rule is one line, and one line is exactly what goes missing.
   */
  const source = readFileSync(fileURLToPath(new URL("../lib/livebook.ts", import.meta.url)), "utf8");

  it("the source actually loaded, so the assertions below mean something", () => {
    // Without this, a broken path makes every `match` below fail loudly but
    // every `doesNotMatch` pass silently.
    assert.ok(source.length > 2_000, "livebook.ts did not load");
  });

  it("the merged book takes only live, parsed ladders", () => {
    assert.match(
      source,
      /venueStates\s*\n?\s*\.?filter\(\(s\) => s\.status === "live" && s\.book\.ok\)|filter\(\(s\) => s\.status === "live" && s\.book\.ok\)/,
      "the snapshot merge lost its `&& s.book.ok` guard",
    );
  });

  it("the publish tick asks VenueLiveness rather than recomputing staleness", () => {
    /*
     * The gap this closes, found 2026-08-21: reverting this one line to the
     * original inline expression
     *     s.status === "live" && s.updates > 0 && now - s.lastUpdate > 8_000 ? "stale" : s.status
     * left the FULL suite green — 3180 tests, 0 failures. `venue-liveness.test.ts`
     * guards the class in isolation and the assertions above pin only the
     * `&& s.book.ok` merge guards, so the delegation was guarded by nobody.
     * A machine nothing is wired to is a machine that does not run.
     */
    assert.match(
      source,
      /status:\s*liveness\.get\(s\.venue\)!\.statusAt\(now\)/,
      "the publish tick stopped delegating to VenueLiveness — the hysteresis is bypassed "
        + "and venue status is a pure function of the last packet again",
    );
    assert.doesNotMatch(
      source,
      /now - s\.lastUpdate > /,
      "an inline staleness comparison is back in livebook.ts; the rule belongs in VenueLiveness",
    );
  });

  it("liveTca takes only live, parsed ladders", () => {
    assert.match(
      source,
      /filter\(\(v\) => v\.status === "live" && v\.book\.ok\)/,
      "liveTca lost its `&& v.book.ok` guard",
    );
  });

  it("the dislocation call deliberately delegates the ok rule, and findDislocation still applies it", () => {
    // livebook.ts passes the UNFILTERED list here on purpose, so the `ok` rule
    // is applied once by the detector rather than twice by two rules that could
    // drift. That is only safe while findDislocation actually filters on it.
    assert.match(source, /findDislocation\(\s*\n?\s*snap\.venues\.filter\(\(v\) => v\.status === "live"\)/);
    const report = readFileSync(fileURLToPath(new URL("../lib/venues/report.ts", import.meta.url)), "utf8");
    assert.ok(report.length > 500, "report.ts did not load");
    assert.match(report, /books\.filter\(\(b\) => b\.ok\b/,
      "findDislocation stopped filtering on ok, which makes livebook.ts's delegation unsafe");
  });
});

describe("a walk with no reference price reports no slippage, never zero", () => {
  /**
   * The null-honesty rule at its own source. `walkBook` guards this with
   * `if (vwap && mid)`, and nothing asserted it: coercing the result to 0 would
   * render "0.0 bps" — a perfect fill — against an order that had no mid to be
   * measured from, and pass every type check on the way through.
   */
  it("a null mid yields a null slippage", () => {
    const out = walkBook(ASKS, "BUY", 1_000, null);
    assert.equal(out.slippageBps, null);
    assert.notEqual(out.slippageBps, 0, "a missing reference price is not a perfect fill");
  });

  it("a mid of zero is not a reference price either", () => {
    assert.equal(walkBook(ASKS, "BUY", 1_000, 0).slippageBps, null);
  });

  it("an unfillable walk yields a null slippage even with a good mid", () => {
    // Nothing was filled, so there is no achieved price to compare.
    const out = walkBook([], "BUY", 1_000, 100.25);
    assert.equal(out.vwap, null);
    assert.equal(out.slippageBps, null);
  });

  it("a real walk against a real mid does produce a number", () => {
    // The negative control: the three nulls above must not be passing because
    // this function returns null for everything.
    const out = walkBook(ASKS, "BUY", 1_000, 100.25);
    assert.ok(typeof out.slippageBps === "number" && Number.isFinite(out.slippageBps));
  });
});
