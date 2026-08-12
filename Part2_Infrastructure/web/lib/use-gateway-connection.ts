"use client";

/**
 * One probe per gateway resource, for every surface that reads it.
 * ===============================================================
 *
 * Before this, each surface fetched its own route with its own error handling
 * and its own idea of what failure meant. That produced three distinct defects,
 * and none of them looked like a bug in review:
 *
 *  1. **No deadline.** `useBook`'s fetch had no AbortController, so a gateway
 *     that accepted the connection and then stopped answering left "book
 *     connecting" on screen forever. A refused connection fails in
 *     milliseconds and looks fine in testing; a hung one never resolves, and
 *     that is the state a redeploying container is actually in.
 *  2. **No retry.** Recovery required the user to reload. The poll interval
 *     kept firing, but each attempt inherited the same missing deadline.
 *  3. **N polls for one answer.** Five components reading the book meant five
 *     requests to the same route on every tick, and five independent opinions
 *     about whether it had failed.
 *
 * So: one deadline (2.5s), one backoff, one in-flight request per resource, one
 * last-known-good cache. The cache and the in-flight map are module-level
 * rather than per-hook because sharing them is the entire point — two callers
 * on the same resource must not be able to disagree about it.
 *
 * What this hook does NOT decide: whether the user asked for the sandbox. That
 * is a human choice, it lives in the caller, and no probe result may override
 * it. See `useBook`'s `chose` ref.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { type DataTier, type Provenance, type TierCause } from "@/lib/data-tier";

/**
 * 2500ms, from the brief.
 *
 * Long enough that a cold Cloud Run-style start or a loaded VM is not called
 * dead, short enough that nobody watches a spinner wondering. It bounds the
 * *response*, not the connection: a gateway that accepts and then hangs is the
 * case this exists for.
 */
export const GATEWAY_DEADLINE_MS = 2500;

/** Backoff floor and ceiling. Doubling between, reset on any success. */
const RETRY_MIN_MS = 2500;
const RETRY_MAX_MS = 30_000;

export interface GatewayFailure {
  /** The typed code from the route, when it sent one. */
  code?: string;
  message: string;
  hint?: string;
  /** True when we gave up on the deadline rather than being refused. */
  timedOut: boolean;
}

interface CacheEntry {
  payload: unknown;
  observedAt: Date;
}

/** Last known good payload per resource, shared by every caller of that resource. */
const cache = new Map<string, CacheEntry>();

/** In-flight request per resource, so N callers make one call. */
const inFlight = new Map<string, Promise<FetchOutcome<unknown>>>();

type FetchOutcome<T> =
  | { ok: true; payload: T }
  | { ok: false; failure: GatewayFailure };

/**
 * Fetch with a deadline, coalesced by resource.
 *
 * Exported for the tests, which need to drive it against a black-hole port
 * without mounting React.
 */
export async function probeGateway<T>(
  resource: string,
  deadlineMs = GATEWAY_DEADLINE_MS,
): Promise<FetchOutcome<T>> {
  const existing = inFlight.get(resource);
  if (existing) return existing as Promise<FetchOutcome<T>>;

  const attempt = (async (): Promise<FetchOutcome<T>> => {
    const controller = new AbortController();
    // A plain timer rather than AbortSignal.timeout so the reason for the abort
    // is knowable: "timed out" and "the component unmounted" produce the same
    // DOMException otherwise, and only one of them is worth reporting.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, deadlineMs);

    try {
      const response = await fetch(resource, { cache: "no-store", signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const typed = body as { code?: string; error?: string; hint?: string };
        return {
          ok: false,
          failure: {
            code: typed.code,
            message: typed.error ?? `${resource} failed with HTTP ${response.status}.`,
            hint: typed.hint,
            timedOut: false,
          },
        };
      }
      cache.set(resource, { payload: body, observedAt: new Date() });
      return { ok: true, payload: body as T };
    } catch {
      return {
        ok: false,
        failure: {
          message: timedOut
            ? `${resource} did not answer within ${deadlineMs}ms.`
            : `${resource} could not be reached.`,
          timedOut,
        },
      };
    } finally {
      clearTimeout(timer);
      inFlight.delete(resource);
    }
  })();

  inFlight.set(resource, attempt as Promise<FetchOutcome<unknown>>);
  return attempt;
}

/**
 * Which tier a result lands in.
 *
 * Split out and exported because it is the decision this whole module exists to
 * make, and it is worth being able to assert directly: a failure with a cache
 * is `cached`, a failure without one is `sandbox`, and a sandbox payload is
 * never reported as either of the measured tiers.
 */
export function resolveTier(
  ok: boolean,
  hasCache: boolean,
  failure: GatewayFailure | null,
): { tier: DataTier; cause: TierCause | null } {
  if (ok) return { tier: "live", cause: null };
  if (hasCache) return { tier: "cached", cause: null };
  // `gateway_not_configured` is the deployed workspace's normal state, not a
  // fault. Anything else — refused, timed out, 5xx — is an incident, and the
  // badge says so rather than implying this desk never had a gateway.
  const configured = failure?.code === "gateway_not_configured";
  return { tier: "sandbox", cause: configured ? "not-configured" : "incident" };
}

export interface GatewayConnection<T> extends Provenance {
  /** Never null once the fallback is supplied: that is the point of the ladder. */
  payload: T | null;
  failure: GatewayFailure | null;
  loading: boolean;
  /** Seconds until the next automatic attempt, or null when not backing off. */
  retryInSeconds: number | null;
  refresh: (quiet?: boolean) => Promise<void>;
}

export interface GatewayConnectionOptions<T> {
  /** Same-origin route, e.g. `/api/gateway/portfolio`. */
  resource: string;
  /** Steady-state poll while healthy. */
  intervalMs: number;
  /**
   * The generated stand-in. Called only when there is no cache to fall back to,
   * and given the caller's seed so two visitors get two self-consistent desks.
   */
  fallback?: (seed: string | null) => T;
  seed?: string | null;
  /** Skip polling entirely — used when the caller has chosen the sandbox. */
  paused?: boolean;
  deadlineMs?: number;
}

export function useGatewayConnection<T>(options: GatewayConnectionOptions<T>): GatewayConnection<T> {
  const { resource, intervalMs, fallback, seed = null, paused = false, deadlineMs } = options;

  const [payload, setPayload] = useState<T | null>(null);
  const [failure, setFailure] = useState<GatewayFailure | null>(null);
  const [tier, setTier] = useState<DataTier>("sandbox");
  const [cause, setCause] = useState<TierCause | null>(null);
  const [lastGoodAt, setLastGoodAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryInSeconds, setRetryInSeconds] = useState<number | null>(null);

  /** Consecutive failures, for the backoff. Reset by any success. */
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const apply = useCallback((outcome: FetchOutcome<T>) => {
    if (!alive.current) return;
    const cached = cache.get(resource) ?? null;
    if (outcome.ok) {
      failures.current = 0;
      setPayload(outcome.payload);
      setFailure(null);
      setTier("live");
      setCause(null);
      setLastGoodAt(cached?.observedAt ?? new Date());
      setRetryInSeconds(null);
      return;
    }
    failures.current += 1;
    const resolved = resolveTier(false, Boolean(cached), outcome.failure);
    setFailure(outcome.failure);
    setTier(resolved.tier);
    setCause(resolved.cause);
    if (resolved.tier === "cached" && cached) {
      setPayload(cached.payload as T);
      setLastGoodAt(cached.observedAt);
    } else if (fallback) {
      // Generated, and labelled generated. The alternative here is the dead end
      // this module exists to remove.
      setPayload(fallback(seed));
      setLastGoodAt(null);
    }
  }, [resource, fallback, seed]);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const outcome = await probeGateway<T>(resource, deadlineMs);
    apply(outcome);
    if (alive.current) setLoading(false);
  }, [resource, deadlineMs, apply]);

  useEffect(() => {
    alive.current = true;
    if (paused) {
      setLoading(false);
      return () => { alive.current = false; };
    }

    /**
     * One self-rescheduling timer rather than a fixed interval.
     *
     * A `setInterval` at the healthy cadence keeps hammering a gateway that is
     * down — the old behaviour cost four dead requests a minute during an
     * outage — and cannot back off. This schedules the next attempt from the
     * outcome of the last one: the poll interval while healthy, doubling from
     * 2.5s to a 30s ceiling while not.
     */
    const tick = async () => {
      if (!alive.current) return;
      if (typeof document !== "undefined" && document.hidden) {
        timer.current = setTimeout(tick, intervalMs);
        return;
      }
      await refresh(true);
      if (!alive.current) return;
      const backoff = failures.current === 0
        ? intervalMs
        : Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** (failures.current - 1));
      setRetryInSeconds(failures.current === 0 ? null : Math.round(backoff / 1000));
      timer.current = setTimeout(tick, backoff);
    };

    void refresh().then(() => {
      if (!alive.current) return;
      const backoff = failures.current === 0
        ? intervalMs
        : Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** (failures.current - 1));
      timer.current = setTimeout(tick, backoff);
    });

    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh, intervalMs, paused]);

  return { tier, cause, lastGoodAt, payload, failure, loading, retryInSeconds, refresh };
}

/** Test seam: the module-level cache outlives a component, so tests must clear it. */
export function __resetGatewayCache() {
  cache.clear();
  inFlight.clear();
}
