/**
 * Latency tone, latency chip copy, and the client-side latency ring.
 *
 * Split out of `lib/overview-state.ts` when that file passed 585 lines. One
 * rule holds all of it together and it is the reason these pieces are one
 * module rather than three: a latency number is only allowed on screen when
 * enough samples exist to have produced it. `LATENCY_MIN_SAMPLES` gates the
 * tone, gates both chip strings, and `appendLatencyHistory` refuses to append
 * an interval nobody measured.
 *
 * Re-exported by `lib/overview-state.ts`; importers still say
 * `@/lib/overview-state`.
 */

import { formatDuration } from "@/lib/format";

/**
 * Nearest-rank p99 at n = 20 is exactly the max — the weakest p99 that is
 * still a distinct observation. Below that the number is theatre ("a p99 over
 * four calls is not a p99" — HealthMatrix).
 */
export const LATENCY_MIN_SAMPLES = 20;
/** Serverless-to-vendor REST hops sit in low hundreds of ms when healthy. */
export const LATENCY_WARN_MS = 400;
/** HealthMatrix's own canonical slow example: "answers but at p99 1.2s". */
export const LATENCY_BAD_MS = 1200;

export type LatencyToneKind = "good" | "warn" | "bad" | "muted";

export interface LatencyToneResult {
  tone: LatencyToneKind;
  label: string;
}

export function latencyTone(p99: number | null, n: number, errorRate = 0): LatencyToneResult {
  if (p99 == null || n < LATENCY_MIN_SAMPLES) {
    return { tone: "muted", label: `warming up, n=${n}` };
  }
  if (errorRate >= 0.25 || p99 >= LATENCY_BAD_MS) return { tone: "bad", label: "slow" };
  if (errorRate > 0.05 || p99 >= LATENCY_WARN_MS) return { tone: "warn", label: "elevated" };
  return { tone: "good", label: "healthy" };
}

/**
 * The network plane, in words, for a title or a tile note.
 *
 * The pool is split by `latencyByClass`: `network` here is the upstream vendor
 * and venue REST the desk routes on, `hop` is the web→gateway round trip the
 * health poll itself pays. Naming them apart is the point — the blended figure
 * was ~92% the hop, so a single "upstream p99" over the union was really the
 * poller timing itself. Always says "network, polled" so it can sit beside the
 * in-process decision figure without being mistaken for it. With no hop figure
 * (an older snapshot passes the blended pool) it still reads "upstream", which
 * is honest — the blend is mostly network anyway.
 */
export function formatNetworkCaveat(
  network: { p99: number | null; n: number; errorRate: number } | null,
  hop?: { p99: number | null; n: number } | null,
): string {
  const parts: string[] = [];
  if (hop && hop.p99 != null && hop.n >= LATENCY_MIN_SAMPLES) {
    parts.push(`desk hop p99 ${formatDuration(hop.p99, "ms")}`);
  }
  if (!network || network.p99 == null || network.n < LATENCY_MIN_SAMPLES) {
    parts.push(`upstream p99 collecting n=${network?.n ?? 0}/${LATENCY_MIN_SAMPLES}`);
  } else {
    parts.push(`upstream p99 ${formatDuration(network.p99, "ms")}`);
    parts.push(`error rate ${Math.round(network.errorRate * 100)}%`);
  }
  parts.push("15-min pool");
  return `network, polled — ${parts.join(", ")}`;
}

/** The pre-decision chip's copy; retired when the chip headlines the decision plane. */
export function formatLatencyChip(
  latency: { p99: number | null; n: number; errorRate: number } | null,
): { value: string; caveat: string } {
  if (!latency || latency.p99 == null || latency.n < LATENCY_MIN_SAMPLES) {
    return {
      value: "p99 —",
      caveat:
        `warming up — needs ${LATENCY_MIN_SAMPLES}+ measured samples in the shared 15-minute pool `
        + `(n=${latency?.n ?? 0}); every instance's health polls feed the gateway-merged ledger, so this fills`,
    };
  }
  return {
    value: `p99 ${Math.round(latency.p99)}ms`,
    caveat:
      `upstream p99 ${Math.round(latency.p99)}ms, error rate ${Math.round(latency.errorRate * 100)}%; `
      + `rolling 15-minute window, n=${latency.n}`,
  };
}

// ---------------------------------------------------------------------------
// Latency history (client-side ring fed by the health poll)
// ---------------------------------------------------------------------------

export interface LatencyHistoryPoint {
  /** When this tab observed the sample (poll time). */
  t: number;
  p99: number | null;
  errorRate: number;
  n: number;
  /** Server-side timestamp of the newest underlying sample. */
  lastAt: number | null;
}

export const LATENCY_HISTORY_CAP = 64;

/**
 * Append rules keep the sparkline honest:
 *  - n === 0 is "no traffic in the window", not zero latency — skip.
 *  - an unchanged `lastAt` means no new upstream samples since the last poll;
 *    appending would draw measured-looking stability nobody measured — skip.
 * Failed polls append nothing (the hook retains its last snapshot behind a
 * visible error); fabricating a null observation would be an invented number.
 */
export function appendLatencyHistory(
  history: LatencyHistoryPoint[],
  point: LatencyHistoryPoint,
  cap = LATENCY_HISTORY_CAP,
): LatencyHistoryPoint[] {
  if (point.n === 0) return history;
  const prev = history[history.length - 1];
  if (prev && prev.lastAt != null && prev.lastAt === point.lastAt) return history;
  const next = [...history, point];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

// ---------------------------------------------------------------------------
// Sparkline prep
// ---------------------------------------------------------------------------

/**
 * Stride-sample preserving first and last elements. Picks real points rather
 * than aggregating, so every drawn value is one that actually occurred.
 */
export function downsample(values: number[], maxPoints: number): number[] {
  if (maxPoints < 2 || values.length <= maxPoints) return [...values];
  const out: number[] = [];
  const stride = (values.length - 1) / (maxPoints - 1);
  for (let k = 0; k < maxPoints - 1; k++) out.push(values[Math.round(k * stride)]);
  out.push(values[values.length - 1]);
  return out;
}
