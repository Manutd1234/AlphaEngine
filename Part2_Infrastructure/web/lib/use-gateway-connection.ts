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
import { usePolling } from "@/lib/use-polling";

/**
 * 2500ms, from the brief.
 *
 * Long enough that a cold Cloud Run-style start or a loaded VM is not called
 * dead, short enough that nobody watches a spinner wondering. It bounds the
 * *response*, not the connection: a gateway that accepts and then hangs is the
 * case this exists for.
 */
export const GATEWAY_DEADLINE_MS = 2500;

/**
 * Backoff floor and ceiling. Doubling between, reset on any success.
 *
 * The floor is deliberately independent of the caller's poll interval: a
 * gateway that has just come back has to be noticed in seconds whatever the
 * refresh rate is. `PollingController` takes it as `firstRetryMs`, which is the
 * option it gained so this loop could move onto it without changing its curve.
 */
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
  /**
   * Seconds until the next automatic attempt, or null when not backing off.
   *
   * Rendered by `DataTierBadge` ("Retrying automatically in about 8s."), which
   * is why the loop below reports the delay it committed to rather than letting
   * the badge compute a second copy of the curve.
   */
  retryInSeconds: number | null;
  /** Resolves true when the probe landed. The poll's backoff rides on it. */
  refresh: (quiet?: boolean) => Promise<boolean>;
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

  const alive = useRef(true);

  const apply = useCallback((outcome: FetchOutcome<T>) => {
    if (!alive.current) return;
    const cached = cache.get(resource) ?? null;
    if (outcome.ok) {
      setPayload(outcome.payload);
      setFailure(null);
      setTier("live");
      setCause(null);
      setLastGoodAt(cached?.observedAt ?? new Date());
      setRetryInSeconds(null);
      return;
    }
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

  const refresh = useCallback(async (quiet = false): Promise<boolean> => {
    if (!quiet) setLoading(true);
    const outcome = await probeGateway<T>(resource, deadlineMs);
    apply(outcome);
    if (alive.current) setLoading(false);
    return outcome.ok;
  }, [resource, deadlineMs, apply]);

  useEffect(() => {
    alive.current = true;
    // A paused caller has chosen the sandbox: nothing will ever land here, so
    // the spinner must not be left running behind a loop that is not polling.
    if (paused) setLoading(false);
    return () => { alive.current = false; };
  }, [paused]);

  /**
   * A changed resource is a different question, and it must not wait for the
   * next tick to be asked.
   *
   * Keyed on the question, not on `refresh` as the old effect was: `refresh`
   * follows `apply`, which follows the `fallback` prop, so a caller defining
   * that inline changed its identity on every render — and the old effect tore
   * its own timer down and re-probed on each one. That is the defect
   * `usePolling` exists to prevent, and it was in the loop being replaced. The
   * first question is asked by the loop's own immediate tick below, so this
   * fires only on a change to it.
   */
  const asked = useRef(`${resource}|${deadlineMs}`);
  useEffect(() => {
    const question = `${resource}|${deadlineMs}`;
    if (asked.current === question) return;
    asked.current = question;
    void refresh();
  }, [resource, deadlineMs, refresh]);

  /**
   * The self-rescheduling loop, now the shared controller's.
   *
   * Same four decisions as before, none of them re-made here: skip while the
   * tab is hidden, do not stack a slow probe, schedule the next attempt from
   * the outcome of the last (the interval while healthy, 2.5s doubling to 30s
   * while not), and stop on unmount. `immediate` is what keeps the first
   * attempt inside that curve — a mount fetch outside the loop is a failure the
   * controller never hears about, so the retry after it would wait the healthy
   * interval instead of the floor.
   *
   * Three things differ from the hand-rolled version, all deliberate: the
   * hidden gate now covers the first attempt too, so a tab that mounts in the
   * background spends nothing until it is looked at; the loop revalidates when
   * the reader comes back to it; and the countdown below is the delay the loop
   * actually committed to rather than a second evaluation, beside it, of the
   * same arithmetic.
   */
  usePolling({
    tick: async () => { if (!(await refresh(true))) throw new Error(`${resource} probe failed`); },
    intervalMs,
    firstRetryMs: RETRY_MIN_MS,
    maxBackoffMs: RETRY_MAX_MS,
    immediate: true,
    enabled: !paused,
    onSchedule: (delayMs, failures) => {
      setRetryInSeconds(failures === 0 ? null : Math.round(delayMs / 1000));
    },
  });

  return { tier, cause, lastGoodAt, payload, failure, loading, retryInSeconds, refresh };
}

/** Test seam: the module-level cache outlives a component, so tests must clear it. */
export function __resetGatewayCache() {
  cache.clear();
  inFlight.clear();
}
