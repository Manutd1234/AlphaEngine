/**
 * The hand-computed ladders and book fixtures the venue suites share.
 *
 * `tests/venues-book-maths.test.ts` was 596 lines and became five files on 2026-08-21, one
 * per concern: `venues-book-maths`, `venues-routing`, `venues-fill-tolerance`,
 * `venues-host-failover` and `venues-parity`. These fixtures were declared once
 * at the top of that file and are read by more than one successor, so they live
 * here rather than in copies. Two files walking ladders that have quietly drifted
 * apart prove nothing in either, and the whole point of the ladders is that they
 * are the same ones `Part2_Infrastructure/tests/test_tca_engine.py` uses.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  depthUsd,
  spreadBps,
  type Level,
  type VenueBook,
  type VenueName,
} from "../../lib/venues";

/**
 * The venues module, as one string.
 *
 * It was `lib/venues.ts` and is now a package. The assertions that use this were
 * always about "somewhere in the venues module", so concatenating its files keeps
 * the question identical rather than guessing which part now holds each constant —
 * and it does not go stale when a declaration moves between them.
 */
export const readVenues = () => {
  const dir = fileURLToPath(new URL("../../lib/venues", import.meta.url));
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => readFileSync(join(dir, entry), "utf8"))
    .join("\n");
};

export const close = (a: number, b: number, tol = 1e-9, what = "") =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} !== ${b}`);

export function book(
  venue: VenueName,
  bids: Level[],
  asks: Level[],
  symbol = "BTCUSDT",
): VenueBook {
  const bestBid = bids[0]?.[0] ?? null;
  const bestAsk = asks[0]?.[0] ?? null;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : null;
  return {
    venue,
    symbol,
    ok: true,
    latencyMs: 0,
    bids,
    asks,
    bestBid,
    bestAsk,
    mid,
    spreadBps: spreadBps(bestBid, bestAsk),
    depthUsdBid: depthUsd(bids),
    depthUsdAsk: depthUsd(asks),
    imbalance: null,
  };
}

// Same ladder as the Python suite: bids 100/99/98, asks 101/102/103.
export const STANDARD_BIDS: Level[] = [
  [100, 10],
  [99, 20],
  [98, 30],
];
export const STANDARD_ASKS: Level[] = [
  [101, 10],
  [102, 20],
  [103, 30],
];
export const MID = 100.5;
