/**
 * The venue-status flip, pinned.
 *
 * `useLiveBook` recomputed each venue's status 3.3 times a second as a pure
 * function of `now - lastUpdate > STALE_AFTER_MS`, while `onBook` set it
 * straight back to "live" on any arriving update. A venue updating at roughly
 * the threshold therefore alternated — and because the merged book takes only
 * the venues currently called live, the consolidated mid, spread and depth
 * moved with the badge.
 *
 * The suite that should have caught it — the former `venues.test.ts`, since
 * split — asserted nothing about staleness at all, which is how it survived. Everything below is driven by a clock the test owns.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROMOTION_UPDATES, VenueLiveness } from "../lib/venue-liveness";

const STALE_MS = 8_000;

/** A venue plus the clock it is read against. */
function venue(options: { staleAfterMs?: number; promotionUpdates?: number } = {}) {
  const v = new VenueLiveness({ staleAfterMs: STALE_MS, ...options });
  let now = 100_000;
  return {
    v,
    now: () => now,
    tick: (ms: number) => { now += ms; },
    /** A book arrives at the current instant. */
    book: () => v.update(now),
    status: () => v.statusAt(now),
  };
}

describe("a venue updating near the threshold does not alternate", () => {
  it("the exact flip: silence, a late frame, silence, a late frame", () => {
    const d = venue();
    d.v.transport("live");
    d.book();
    assert.equal(d.status(), "live");

    const seen: string[] = [];
    // Eight cycles of "just past the threshold, then one update".
    for (let i = 0; i < 8; i += 1) {
      d.tick(STALE_MS + 500);
      seen.push(d.status());   // silent -> stale
      d.book();
      seen.push(d.status());   // one late frame -> must NOT read live
    }
    assert.ok(
      !seen.slice(1).includes("live"),
      `venue returned to live on a single late frame: ${seen.join(" → ")}`,
    );
    // It settles on stale and stays there, which is the honest reading of a
    // feed you hear from every eight seconds.
    assert.equal(seen[seen.length - 1], "stale");
  });

  it("a healthy venue is live throughout and never blinks", () => {
    const d = venue();
    d.v.transport("live");
    const seen: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      d.book();
      d.tick(250);            // comfortably inside the window
      seen.push(d.status());
    }
    assert.deepEqual([...new Set(seen)], ["live"]);
  });
});

describe("demotion is immediate, promotion is not", () => {
  it("silence past the threshold reads stale at once", () => {
    const d = venue();
    d.v.transport("live");
    d.book();
    d.tick(STALE_MS + 1);
    assert.equal(d.status(), "stale", "a stale ladder must not keep pricing");
  });

  it("one update short of the streak is still stale", () => {
    const d = venue();
    d.v.transport("live");
    d.book();
    d.tick(STALE_MS + 1);
    assert.equal(d.status(), "stale");
    for (let i = 1; i < PROMOTION_UPDATES; i += 1) {
      d.book();
      assert.equal(d.status(), "stale", `promoted after only ${i} update(s)`);
    }
    d.book();
    assert.equal(d.status(), "live");
  });

  it("a genuinely recovered venue comes back", () => {
    const d = venue();
    d.v.transport("live");
    d.book();
    d.tick(STALE_MS + 1);
    assert.equal(d.status(), "stale");
    // A real recovery sends books at its normal rate.
    for (let i = 0; i < 5; i += 1) { d.book(); d.tick(200); }
    assert.equal(d.status(), "live");
  });

  it("going silent again after recovery demotes again, and re-arms the streak", () => {
    const d = venue({ promotionUpdates: 3 });
    d.v.transport("live");
    for (let i = 0; i < 4; i += 1) { d.book(); d.tick(100); }
    assert.equal(d.status(), "live");
    d.tick(STALE_MS + 1);
    assert.equal(d.status(), "stale");
    d.book(); d.book();
    assert.equal(d.status(), "stale", "the streak must count from this demotion");
    d.book();
    assert.equal(d.status(), "live");
  });
});

describe("nothing flashes before the first book", () => {
  it("a venue that has never sent a book is not stale, however long it waits", () => {
    const d = venue();
    d.v.transport("live");
    d.tick(STALE_MS * 10);
    // The old inline rule guarded this with `updates > 0`; keeping it is the
    // difference between "no ladder yet" and "a ladder that stopped".
    assert.notEqual(d.status(), "stale");
  });

  it("a connecting venue reports connecting, not stale", () => {
    const d = venue();
    d.v.transport("connecting");
    d.tick(STALE_MS * 3);
    assert.equal(d.status(), "connecting");
  });
});

describe("transport states are not liveness", () => {
  it("a silent reconnect underneath a working stream does not downgrade it", () => {
    const d = venue();
    d.v.transport("live");
    d.book();
    d.v.transport("connecting");
    assert.equal(d.status(), "live", "a live venue is not downgraded by a background reconnect");
  });

  it("an operator-requested restart does downgrade it", () => {
    const d = venue();
    d.v.transport("live");
    d.book();
    d.v.restart();
    assert.equal(d.status(), "connecting", "someone asked for this and is watching");
  });

  it("a restart clears a pending promotion streak", () => {
    const d = venue({ promotionUpdates: 3 });
    d.v.transport("live");
    d.book();
    d.tick(STALE_MS + 1);
    assert.equal(d.status(), "stale");
    d.book();                       // one towards the streak
    d.v.restart();                  // stream rebuilt: that progress is void
    d.v.transport("live");
    d.book();
    assert.equal(d.status(), "live", "a rebuilt stream starts clean");
  });

  it("an error is reported, never masked by a recent book", () => {
    const d = venue();
    d.v.transport("live");
    d.book();
    d.v.transport("error");
    assert.equal(d.status(), "error");
  });
});

describe("isLiveAt is what decides whether a ladder prices an order", () => {
  it("agrees with statusAt", () => {
    const d = venue();
    d.v.transport("live");
    d.book();
    assert.equal(d.v.isLiveAt(d.now()), true);
    d.tick(STALE_MS + 1);
    assert.equal(d.v.isLiveAt(d.now()), false, "a stale ladder must not price");
  });

  it("a venue oscillating at the threshold never re-enters pricing on one frame", () => {
    const d = venue();
    d.v.transport("live");
    d.book();
    d.tick(STALE_MS + 1);
    d.book();
    assert.equal(d.v.isLiveAt(d.now()), false,
      "the merged book must not gain and lose a side of liquidity on one late frame");
  });
});
