/**
 * A price path with no randomness in it.
 *
 * Every reproducibility claim needs a series two runs can be given, and a
 * generator that reached for `Math.random` would make every failure a coin
 * toss — the opposite of what the suites reading this are for. The path is a
 * closed-form function of the index and the seed, so a failure is a real
 * change, and two calls with the same arguments are the same bars down to the
 * last close.
 *
 * The seed shifts the phase without moving a single timestamp, which is what
 * lets the fingerprint suite build two different series over one window.
 */

import type { Bar } from "../../lib/types";

export function bars(count: number, seed = 1): Bar[] {
  let price = 100;
  const out: Bar[] = [];
  for (let i = 0; i < count; i++) {
    price *= 1 + Math.sin((i + seed) / 17) * 0.004 + Math.cos((i + seed) / 43) * 0.002;
    out.push({
      t: Date.UTC(2026, 0, 1) + i * 3_600_000,
      o: price, h: price * 1.002, l: price * 0.998, c: price, v: 1000,
    });
  }
  return out;
}
