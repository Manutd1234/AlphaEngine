/**
 * The fill gate, and the tolerance convention it decides on.
 *
 * `fillable` is the pre-trade answer to "can this book take this order", asked on
 * both sides of the port: this file's cases mirror
 * `Part2_Infrastructure/tests/test_tca_engine.py`, and `venues-parity.test.ts`
 * pins the two declarations of the tolerance itself against each other. A portal
 * that says routable where the gateway says not is worse than either answer alone.
 *
 * What this file defends is that the boundary scales with the order rather than
 * sitting on the dollar, in both directions — and that what a walk reports is what
 * it measured, never the request copied back over the measurement.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  absorbs,
  FILL_TOLERANCE,
  smartRoute,
  walkBook,
  type Level,
} from "../lib/venues";
import { book, close } from "./helpers/venue-books";

/**
 * The fill tolerance.
 *
 * `fillable` is a pre-trade risk gate, so it has to survive the arithmetic that
 * produces it. A ladder walk reaches the request by subtracting one level at a
 * time, so the total lands a few ULPs either side of it and never exactly on it.
 * The gateway's reported failure was a SELL of 99.95002498750625 at a limit of
 * 101 refused with "only $10,095 of $10,095 routable" — the two figures
 * identical to the dollar — while the same order at a quantity of exactly 99.95
 * went through.
 *
 * The half of that defect which came from summing cent-rounded legs was never
 * reachable here; this file has always compared against the raw walk. What was
 * wrong on this side was the *convention*: a fixed `1e-6` epsilon, which is a
 * different boundary from the gateway's relative one at every order size except
 * $1,000. Two engines answering the same question about the same book with
 * different boundaries is worse than either boundary alone.
 *
 * Both directions are pinned below, and the second is the one that matters:
 * a false *reject* is a cosmetic annoyance, a false *accept* releases an order
 * into a book that cannot fill it.
 */
describe("the fill tolerance is relative to the order", () => {
  // The reported book: 50 levels a cent apart, 5000 units each — ~$24.9M a side.
  const DEEP_BIDS: Level[] = Array.from(
    { length: 50 },
    (_, i) => [99.95 - i * 0.01, 5000] as Level,
  );
  const DEEP_DEPTH = DEEP_BIDS.reduce((sum, [p, q]) => sum + p * q, 0);
  const DEEP_MID = 100;
  /** The reported order, one level deep in that book. */
  const RAGGED = 99.95002498750625 * 101;

  it("absorbs an order that lands off a cent boundary", () => {
    const e = walkBook(DEEP_BIDS, "SELL", RAGGED, DEEP_MID);
    assert.ok(e.fillable, "one level of a $24.9M book covers a $10k order");
    assert.equal(e.levelsConsumed, 1);
    // Equal to the cent because the walk really did take it, not because the
    // request was copied over the measurement.
    close(e.filledNotional, RAGGED, 0.005, "measured fill");
  });

  it("still refuses an order larger than the whole book", () => {
    const e = walkBook(DEEP_BIDS, "SELL", DEEP_DEPTH * 10, DEEP_MID);
    assert.equal(e.fillable, false);
  });

  it("takes an order for exactly the whole book", () => {
    const e = walkBook(DEEP_BIDS, "SELL", DEEP_DEPTH, DEEP_MID);
    assert.ok(e.fillable, "the book holds precisely this much and no less");
    close(e.filledNotional, DEEP_DEPTH, 0.01, "measured fill");
  });

  it("refuses the whole book plus one meaningful unit", () => {
    // $1 short on a $24.9M book is 4e-8 of the order — below any absolute
    // epsilon you would plausibly pick, and still a real shortfall the gate
    // has to catch.
    assert.equal(walkBook(DEEP_BIDS, "SELL", DEEP_DEPTH + 1, DEEP_MID).fillable, false);
  });

  it("reports the measured walk, never the request", () => {
    // The cheap way to make the comparison pass is to clamp the measurement to
    // the request. That turns every partial fill into a full one.
    const e = walkBook(DEEP_BIDS, "SELL", DEEP_DEPTH * 10, DEEP_MID);
    close(e.filledNotional, DEEP_DEPTH, 0.01, "all the book had");
    assert.ok(e.filledNotional < DEEP_DEPTH * 10, "and nothing like what was asked");
  });

  it("moves the boundary with the order size, not with the dollar", () => {
    // A cent-scale instrument: $1.00 of bids. Half a thousandth of a cent short
    // is 5e-5% of a $10,000 order and pure noise, but on this order it is
    // 5e-5% of a dollar — and the absolute 1e-6 epsilon this replaced ACCEPTED
    // it. That is the false accept the gate exists to prevent.
    const penny: Level[] = [[0.01, 100]];
    assert.ok(walkBook(penny, "SELL", 1, 0.0105).fillable);
    assert.equal(walkBook(penny, "SELL", 1.0000005, 0.0105).fillable, false);

    // The same absolute epsilon at the other end of the range: a $10,000 order
    // that came up 5e-6 short was refused outright, which is arithmetic noise
    // being reported as a book that cannot fill.
    const deepEnough: Level[] = [[1, 9999.999995]];
    assert.ok(
      walkBook(deepEnough, "BUY", 10_000, null).fillable,
      "half a thousandth of a cent on $10k is noise, not a partial fill",
    );
  });

  it("forgives exactly the tolerance and not a hair more", () => {
    assert.ok(absorbs(10_000 - 10_000 * FILL_TOLERANCE, 10_000));
    assert.equal(absorbs(10_000 - 2 * 10_000 * FILL_TOLERANCE, 10_000), false);
  });

  it("does not consume an extra level for a sub-tolerance remainder", () => {
    // Without the dust exit the walk takes a 2e-6 bite out of the level below,
    // which costs nothing but reports `levelsConsumed: 2` and a `worstPrice` of
    // 2 — a price this order never reaches, on a screen a trader reads.
    const e = walkBook([[1, 9999.999998], [2, 100]], "BUY", 10_000, null);
    assert.equal(e.levelsConsumed, 1);
    assert.equal(e.worstPrice, 1);
  });

  it("the router does not emit a phantom venue leg for the same remainder", () => {
    // Same failure one layer up, and louder: the second venue's leg rounds to
    // $0.00 at 0.00% share, so the routing instruction names a venue the order
    // has no business touching.
    const a = book("BINANCE", [[0.9, 100]], [[1, 9999.999998]]);
    const b = book("BYBIT", [[0.8, 100]], [[2, 100]]);
    const { legs } = smartRoute([a, b], "BUY", 10_000);
    assert.equal(legs.length, 1);
    assert.equal(legs[0].venue, "BINANCE");
  });

  it("labels a route capped only when the walk really fell short", () => {
    // Fully routed: 5e-6 of drift on $10,000 is not a liquidity shortage, and
    // saying so sends a trader hunting for depth that is already there.
    const full = smartRoute([book("BINANCE", [[0.9, 100]], [[1, 9999.999995]])], "BUY", 10_000);
    assert.equal(full.cappedBy, undefined);

    // Genuinely short, and the display rounding hides it: $0.9999995 of asks
    // against a $1.00 order reports `filledNotional: 1` to the cent. The verdict
    // is decided on the unrounded walk, so it still says liquidity — this is the
    // "$X of $X" shape, caught rather than rendered as a full fill.
    const short = smartRoute([book("BINANCE", [[0.009, 100]], [[0.01, 99.99995]])], "BUY", 1);
    assert.equal(short.filledNotional, 1, "the display rounds up to the request");
    assert.equal(short.cappedBy, "liquidity", "the verdict does not");
  });
});
