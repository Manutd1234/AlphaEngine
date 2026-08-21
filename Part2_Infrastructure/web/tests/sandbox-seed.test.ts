/**
 * Per-visitor sandboxes, and the invariant they must not break.
 *
 * `sandbox-desk-reconciliation.test.ts` already pins that the generated blotter reconciles with
 * the generated book's attribution table — per sleeve, the same order counts,
 * fill counts, total notional and total fees — because a PM reading attribution
 * on one tab and a trader reading execution quality on another are looking at
 * the same generated desk, and two generated desks that disagree are worse than
 * either.
 *
 * That test checks one seed: the default. This file checks the property across
 * several, because a seed is now derived from whoever is looking, and a
 * reconciliation that holds only for 0xa1fae would be a desk that silently
 * disagrees with itself for every visitor but the first. That is precisely the
 * class of defect this repo keeps rediscovering — it passes every build and
 * returns plausible output.
 *
 * The seeds are fixed literals rather than random, so a failure is reproducible
 * from the file alone.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sandboxBlotter } from "../lib/blotter";
import { sandboxBook } from "../lib/portfolio";
import { seedFromString } from "../lib/random";

/** Stand-ins for a Supabase user id and a guest id. */
const SEEDS = [
  undefined, // the default — must stay byte-identical
  seedFromString("2f1c9a44-0000-4000-8000-000000000001"),
  seedFromString("guest:9f3a1c"),
  seedFromString("ian@example.com"),
  1,
  0, // mulberry32 remaps 0 to 1 rather than degenerating; worth pinning here too
];

describe("every seeded desk reconciles with itself", () => {
  for (const seed of SEEDS) {
    const label = seed === undefined ? "default" : String(seed);

    it(`seed ${label}: blotter covers exactly the attribution's sleeves`, () => {
      const rows = sandboxBlotter(undefined, seed);
      const attribution = sandboxBook(undefined, seed).attribution.by_strategy ?? [];
      assert.deepEqual(
        [...new Set(rows.map((r) => r.strategy))].sort(),
        attribution.map((s) => s.strategy).sort(),
      );
    });

    it(`seed ${label}: counts, notional and fees match to the cent`, () => {
      const rows = sandboxBlotter(undefined, seed);
      const attribution = sandboxBook(undefined, seed).attribution.by_strategy ?? [];
      assert.ok(attribution.length > 0, "the book has no sleeves to reconcile against");

      for (const sleeve of attribution) {
        const mine = rows.filter((r) => r.strategy === sleeve.strategy);
        const fills = mine.filter((r) => r.accepted);
        assert.equal(mine.length, sleeve.orders, `${sleeve.strategy} order count`);
        // `filled`, which is what the attribution block calls it. Reading
        // `sleeve.fills` gave undefined and every seed failed identically —
        // including the default, which is the tell that the assertion was wrong
        // rather than the code.
        assert.equal(fills.length, sleeve.filled, `${sleeve.strategy} fill count`);
        const notional = fills.reduce((acc, r) => acc + (r.notional ?? 0), 0);
        const fees = fills.reduce((acc, r) => acc + (r.feeUsd ?? 0), 0);
        // To the cent, not approximately: the last fill in each sleeve takes the
        // remainder rather than its weighted share, which is what makes this
        // exact for any seed.
        assert.equal(notional, sleeve.notional, `${sleeve.strategy} notional`);
        assert.equal(Math.round(fees * 100) / 100, sleeve.fees, `${sleeve.strategy} fees`);
      }
    });

    it(`seed ${label}: the session block agrees with the rows it was folded from`, () => {
      const book = sandboxBook(undefined, seed);
      const fills = sandboxBlotter(undefined, seed).filter((r) => r.status === "FILLED");
      const session = book.attribution.session;
      assert.ok(session, "no session attribution");
      assert.equal(session.fills, fills.length);
      assert.equal(
        session.notional,
        Math.round(fills.reduce((acc, r) => acc + (r.notional ?? 0), 0) * 100) / 100,
      );
    });
  }
});

describe("a seed is deterministic and actually changes the desk", () => {
  it("the same seed twice is the same desk", () => {
    const a = sandboxBlotter(undefined, 12345);
    const b = sandboxBlotter(undefined, 12345);
    assert.deepEqual(a, b);
    assert.deepEqual(sandboxBook(undefined, 12345), sandboxBook(undefined, 12345));
  });

  it("the default is untouched by the new argument", () => {
    // The whole point of defaulting rather than requiring: every existing
    // caller, and every expectation pinned in sandbox-desk-reconciliation.test.ts, must see
    // exactly what it saw before.
    assert.deepEqual(sandboxBlotter(), sandboxBlotter(undefined, 0xa1fae));
  });

  it("two visitors get two distinguishable desks", () => {
    // Otherwise the seed is decoration: isolation you cannot observe is
    // indistinguishable from shared state.
    const mine = sandboxBlotter(undefined, seedFromString("user-a"));
    const theirs = sandboxBlotter(undefined, seedFromString("user-b"));
    assert.equal(mine.length, theirs.length, "the shape is fixed, only the detail varies");
    const differs = mine.some((row, i) =>
      row.symbol !== theirs[i].symbol
      || row.side !== theirs[i].side
      || row.notional !== theirs[i].notional);
    assert.ok(differs, "two seeds produced identical rows — the seed is not reaching the stream");
  });

  it("the positions stay the worked example whatever the seed", () => {
    /**
     * Deliberate: the sandbox book's positions carry the concentration warning
     * and the symbol sitting at 90% of its cap, which is what makes the risk
     * panels worth looking at. Randomising them would sometimes generate a desk
     * with nothing to see, and a reviewer would have no way to know they had
     * drawn the boring one.
     */
    const a = sandboxBook(undefined, seedFromString("user-a"));
    const b = sandboxBook(undefined, seedFromString("user-b"));
    assert.deepEqual(a.exposure.positions, b.exposure.positions);
    assert.equal(a.equity.current, b.equity.current);
  });
});
