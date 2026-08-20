/**
 * The input frame: bars in, columns out — plus the fingerprint that says WHICH
 * bars and the timestamp format that says WHICH window.
 *
 * Split out of `lib/engine.ts` so the sweep and the walk-forward read the same
 * columns from the same code. Nothing here knows about a strategy.
 */

import { pctChange } from "../indicators";
import type { Bar } from "../types";

/**
 * A stable fingerprint of the bars a sweep ran on.
 *
 * Not a cryptographic hash — this runs in a serverless function on every sweep
 * and its only job is to answer "were these the same bars?". FNV-1a over the
 * closes plus the window bounds collides far too rarely to matter for a
 * comparison the researcher can also verify by eye, and costs one pass.
 *
 * Deliberately NOT expected to equal the Python `data_hash`: the two engines
 * fingerprint their own inputs, which arrive over different transports with
 * different float formatting. What each guarantees is internal consistency —
 * two runs *in the same engine* on the same bars agree.
 */
export function datasetFingerprint(bars: Bar[]): string {
  let hash = 0x811c9dc5;
  const mix = (value: number) => {
    hash ^= value >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (const bar of bars) {
    // Six decimals: enough to separate real revisions, coarse enough that a
    // float round-trip through JSON does not change the answer.
    mix(Math.round(bar.c * 1e6));
  }
  mix(bars.length);
  mix(bars[0]?.t ?? 0);
  mix(bars[bars.length - 1]?.t ?? 0);
  return hash.toString(16).padStart(8, "0");
}

export function columns(bars: Bar[]) {
  const n = bars.length;
  const close = new Float64Array(n);
  const high = new Float64Array(n);
  const low = new Float64Array(n);
  // Volume was carried on the Bar and dropped here. The volume-confirmation
  // family needs it, and a strategy silently reading zeros would look like a
  // model that never confirms rather than one that was never given the data.
  const volume = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    close[i] = bars[i].c;
    high[i] = bars[i].h;
    low[i] = bars[i].l;
    volume[i] = bars[i].v;
  }
  return { close, high, low, volume, pxRet: pctChange(close) };
}

export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}
