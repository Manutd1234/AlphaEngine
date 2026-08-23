/**
 * The shape an absorption estimator consumes, whichever venue produced it.
 *
 * This is the seam between the coherence engine and the information-diffusion
 * work, and it exists so the two can be built independently against one
 * contract rather than against each other.
 *
 * The idea both sides share: something arrives that the market has not priced,
 * and there is a measurable interval before it has. On Kalshi that interval is
 * a **coherence violation episode** — the prices admitted a Dutch book, then
 * they did not — and the episode's lifetime is the absorption time. On an
 * equity or a crypto pair it is the window after an earnings print or a rate
 * decision. Different instruments, same measurement, so the same estimator
 * should run over both and the comparison between them is the interesting part.
 *
 * Two fields carry the honesty. `half_life_s` is nullable, and when it is null
 * `reason` says which of the several different "we cannot say" cases applies —
 * too few samples, the episode never closed, the window was not captured. A
 * null with no reason is indistinguishable from a bug.
 */

import type { CoherenceEpisode } from "./types";

/** Which market produced the sample. Widened past Kalshi deliberately: the
 *  comparison across venues is the point of sharing this shape. */
export type AbsorptionVenue = "kalshi" | "equity" | "crypto";

export interface AbsorptionPoint {
  ts: number;
  /** The quantity being absorbed: coherence distance here, a return elsewhere. */
  value: number | null;
}

export interface AbsorptionSample {
  venue: AbsorptionVenue;
  /** What this sample is about: an event ticker, a symbol, a meeting. */
  key: string;
  /** When the information arrived, in epoch milliseconds. */
  event_ts: number;
  path: AbsorptionPoint[];
  /** Time to half the initial dislocation, or null with a reason. */
  half_life_s: number | null;
  reason: string | null;
}

/** Nanoseconds to epoch milliseconds. The tape stores ns; charts want ms. */
function toMs(ns: number): number {
  return Math.round(ns / 1_000_000);
}

/**
 * Half-life within one episode: how long until the dislocation halved.
 *
 * Interpolated between the two samples that bracket the crossing rather than
 * snapped to the later one — at a fifteen-second poll, snapping quantises every
 * half-life to a multiple of the poll interval and makes the distribution look
 * like the sampler rather than like the market.
 *
 * Null when the episode never halved, which is a real outcome: it can close by
 * jumping straight to coherent, and calling that a half-life of the final
 * interval would be inventing a decay that was not observed.
 */
export function halfLifeOf(episode: CoherenceEpisode): { seconds: number | null; reason: string | null } {
  const points = episode.samples
    .map((sample) => ({ ts: sample.ts_ns, value: sample.ci == null ? null : Number(sample.ci) }))
    .filter((point): point is { ts: number; value: number } => point.value != null && Number.isFinite(point.value));

  if (points.length < 2) {
    return { seconds: null, reason: "fewer than two measured points in this episode" };
  }
  const start = points[0];
  if (start.value <= 0) {
    return { seconds: null, reason: "the episode opened with no measurable dislocation" };
  }
  const target = start.value / 2;

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (current.value > target) continue;
    const span = current.value - previous.value;
    const fraction = span === 0 ? 0 : (target - previous.value) / span;
    const crossing = previous.ts + (current.ts - previous.ts) * fraction;
    return { seconds: Number(((crossing - start.ts) / 1_000_000_000).toFixed(3)), reason: null };
  }
  return { seconds: null, reason: "the dislocation never halved before the episode closed" };
}

/** Episodes from the tape into the shape the estimator reads. */
export function episodesToSamples(episodes: CoherenceEpisode[]): AbsorptionSample[] {
  return episodes.map((episode) => {
    const { seconds, reason } = halfLifeOf(episode);
    return {
      venue: "kalshi" as const,
      key: episode.event_ticker,
      event_ts: toMs(episode.opened_ts_ns),
      path: episode.samples.map((sample) => ({
        ts: toMs(sample.ts_ns),
        value: sample.ci == null ? null : Number(sample.ci),
      })),
      half_life_s: seconds,
      reason,
    };
  });
}
