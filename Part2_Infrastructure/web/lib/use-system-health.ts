"use client";

/**
 * `/api/system/health`, once, for the three tabs that read it.
 *
 * Data, Reliability and Developer ask different questions of one snapshot — is
 * the data trustworthy, is the platform up, does the contract still hold — and
 * they used to be one console because they shared this poll, the operator token
 * and the action runner. Splitting the tabs without lifting the fetch would give
 * each of them its own idea of which breakers are open.
 *
 * Operator writes live here too, deliberately: the token is entered on the
 * Reliability tab but an action fired anywhere must re-read state the same way,
 * and `runAction` applies the snapshot embedded in the action response — the
 * server decides what happened, not the button that asked, and the embedded
 * read is the one guaranteed to come from the instance that applied it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { routeKey } from "@/components/systems/FailoverGraph";
import type { ActionOptions } from "@/components/systems/OperatorPanel";
import type { ActionResponse, GuardMode, SystemHealth } from "@/components/systems/types";
import { useWireTap, type SocketSummary } from "@/lib/livebook";
import { emit } from "@/lib/observability";
import {
  appendLatencyHistory,
  deriveDecisionLatency,
  type DecisionLatencySource,
  type LatencyHistoryPoint,
} from "@/lib/overview-state";
import { usePolling } from "@/lib/use-polling";
import { useThrottledValue } from "@/lib/use-throttled-value";

/** Quota-fenced and slow enough to be free. */
export const DEFAULT_POLL_MS = 30_000;

/**
 * Never longer than the gateway's own budget (`DEFAULT_TIMEOUT_MS`, 8s): once
 * the server has given up there is nothing left to wait for.
 */
const HEALTH_DEADLINE_CEILING_MS = 8_000;

/**
 * The floor exists because the console offers a 1s debugging cadence, and 80% of
 * one second is shorter than the round trip on a healthy deployment — a budget
 * that small would abort good requests and paint a permanent outage over a desk
 * that is fine. Overlap at that cadence is already harmless: `sequence` discards
 * a stale answer, so at worst two probes are in flight, whereas a deadline
 * shorter than the network is a lie the reader cannot correct.
 */
const HEALTH_DEADLINE_FLOOR_MS = 2_500;

/**
 * A poll's deadline has to fit inside its own interval, or a stalled request is
 * still in flight when the next tick fires and they queue up behind each other
 * until the tab dies. One fixed number cannot do that across the 1s/5s/30s
 * cadences the console offers, so it is derived: 80% of the interval leaves the
 * response room to land before the next tick.
 */
export function healthDeadlineMs(pollMs: number): number {
  return Math.round(
    Math.min(HEALTH_DEADLINE_CEILING_MS, Math.max(HEALTH_DEADLINE_FLOOR_MS, pollMs * 0.8)),
  );
}

/**
 * The credential badge is cosmetic — every action re-sends the header and the
 * server re-checks it — so this waits only as long as someone will watch a
 * spinner after typing, not as long as the catalogue might take.
 */
const TOKEN_CHECK_DEADLINE_MS = 6_000;

/** One retry, because a probe that gives up silently leaves a spinner behind. */
const TOKEN_CHECK_RETRY_MS = 3_000;

/** Half-typed credentials must not fire a request per keystroke. */
const TOKEN_CHECK_DEBOUNCE_MS = 500;

/**
 * An operator action is a WRITE, and the order ticket's reasoning applies
 * unchanged: aborting mid-flight says nothing about whether the breaker was
 * reset or the cache purged. Deliberately longer than the gateway's own 8s
 * budget so a slow-but-real verdict still lands rather than being discarded and
 * reported as a failure that did not happen.
 */
const ACTION_DEADLINE_MS = 20_000;

/** A timeout is a DOMException named TimeoutError; a dead network is not. */
function timedOut(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "TimeoutError";
}

/**
 * What a failed health read is allowed to claim.
 *
 * Rendered verbatim by three consoles ("System health is unreachable. {…}"), so
 * the distinction is user-visible: a request the server accepted and never
 * answered is not an unreachable server, and saying so sends the reader to the
 * network instead of to the snapshot builder that stalled.
 */
export function describeHealthFailure(cause: unknown, deadlineMs: number): string {
  if (timedOut(cause)) {
    return `No health snapshot within ${Math.round(deadlineMs / 1000)}s — the values shown are `
      + "from the last successful read, and the next poll may well succeed.";
  }
  return cause instanceof Error ? cause.message : "health check failed";
}

/**
 * What a failed operator action is allowed to claim.
 *
 * "Action failed" asserts nothing happened. An abort cannot know that — the
 * gateway may have applied it and been unable to say so — and an operator who
 * re-fires a kill switch on that basis is acting on a claim this code invented.
 */
export function describeActionFailure(cause: unknown): string {
  if (timedOut(cause)) {
    return `No answer within ${ACTION_DEADLINE_MS / 1000}s. The action may still have been applied — `
      + "re-read the snapshot before firing it again.";
  }
  return cause instanceof Error ? cause.message : "action failed";
}

export interface SystemHealthView {
  health: SystemHealth | null;
  healthError: string | null;
  updatedAt: Date | null;
  /** Resolves true when a snapshot landed: the poll's backoff rides on it. */
  refresh: (quiet: boolean) => Promise<boolean>;

  pollMs: number;
  setPollMs: (ms: number) => void;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  /** 0 while paused — the value panels should pass to their own pollers. */
  effectivePollMs: number;

  route: string;
  setRoute: (route: string) => void;

  guard: GuardMode;
  tokenEnv: string;
  /** A missing credential may use the server-held default for new paper orders only. */
  paperOrderDefaultAvailable: boolean;
  token: string;
  setToken: (token: string) => void;
  /**
   * Whether an operator action fired right now would carry a usable credential.
   * Open modes count as ready — only token mode without a token is not. Every
   * action button must gate on this, not on guard alone: an enabled button in
   * token mode without a token posts an unauthenticated request and lands in
   * the silent-401 class this codebase has already shipped twice.
   */
  operatorReady: boolean;
  /**
   * Server-checked state of the entered token, so the badge can say "checked
   * and valid" instead of guessing. Verified against GET /api/system/actions,
   * which validates without spending anything.
   */
  tokenStatus: "none" | "checking" | "valid" | "rejected";
  busyAction: string | null;
  actionResult: ActionResponse | null;
  runAction: (action: string, options?: ActionOptions) => Promise<void>;

  sockets: SocketSummary[];
  onReconnectSockets: () => void;
  logLocal: (
    level: "info" | "warn" | "error",
    message: string,
    fields?: Record<string, string | number | boolean | null>,
  ) => void;

  degraded: number;
  cacheHitRate: number | null;

  /**
   * Client-side ring of p99 observations, one per poll that actually carried
   * new upstream samples — the server keeps aggregates, not history, so the
   * sparkline's memory lives here. Per-tab by design; a fresh tab starts
   * empty and the "warming up" tone covers it. (The aggregates themselves are
   * gateway-merged across instances since the shared ledger sync.)
   */
  latencyHistory: LatencyHistoryPoint[];

  /**
   * Where the gateway's in-process decision figure stands — measured, or a
   * named reason it is not (no gateway, older build, no orders yet). Derived
   * once here so the header chip and the Reliability tiles never disagree
   * about why the same figure is a dash.
   */
  decisionLatency: DecisionLatencySource;
}

/** Per-tab by design: sessionStorage survives a reload, dies with the tab. */
const TOKEN_STORAGE_KEY = "alphaengine-operator-token";

export function useSystemHealth(workspaceSymbol: string): SystemHealthView {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [pollMs, setPollMs] = useState(DEFAULT_POLL_MS);
  const [paused, setPaused] = useState(false);
  const [route, setRoute] = useState<string>("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<ActionResponse | null>(null);
  const [token, setTokenState] = useState("");
  const [tokenStatus, setTokenStatus] = useState<"none" | "checking" | "valid" | "rejected">("none");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [latencyHistory, setLatencyHistory] = useState<LatencyHistoryPoint[]>([]);
  const sequence = useRef(0);
  const tokenCheckSequence = useRef(0);
  /** The live cadence, so the poll's deadline can fit inside its own interval. */
  const pollMsRef = useRef(pollMs);
  pollMsRef.current = pollMs;
  const { sockets, reconnectAll } = useWireTap();

  // Hydrate after mount, not in the initializer: the page is server-rendered
  // and the stored value must not create a hydration mismatch.
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
      if (stored) setTokenState(stored);
    } catch {
      // Blocked storage must not break the console; the token just starts empty.
    }
  }, []);

  const setToken = useCallback((next: string) => {
    setTokenState(next);
    try {
      if (next) window.sessionStorage.setItem(TOKEN_STORAGE_KEY, next);
      else window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // Still usable for this render's lifetime without persistence.
    }
  }, []);

  // Verify the entered token against the read-only actions catalogue, debounced
  // so half-typed credentials don't fire a request per keystroke. The result
  // drives the badge only — every action still sends and re-checks the header.
  useEffect(() => {
    const current = ++tokenCheckSequence.current;
    if (!token.trim()) {
      setTokenStatus("none");
      return;
    }
    setTokenStatus("checking");
    let timer: ReturnType<typeof setTimeout>;
    let retried = false;

    const probe = async () => {
      try {
        const response = await fetch("/api/system/actions", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: AbortSignal.timeout(TOKEN_CHECK_DEADLINE_MS),
        });
        const body = (await response.json().catch(() => ({}))) as { credential?: string };
        if (current !== tokenCheckSequence.current) return;
        setTokenStatus(body.credential === "valid" ? "valid" : "rejected");
      } catch {
        if (current !== tokenCheckSequence.current) return;
        /**
         * Neither a timeout nor a dead network says anything about the
         * credential, so this must never settle on "rejected" — that would
         * accuse an operator's good token of being bad because the wifi
         * dropped. "checking" is the honest answer, but left alone it is a
         * spinner that never resolves, so the probe is retried once before it
         * rests there. The status is advisory in any case: actions gate on
         * `operatorReady`, and the server re-checks the header on every send.
         */
        if (retried) return;
        retried = true;
        timer = setTimeout(() => void probe(), TOKEN_CHECK_RETRY_MS);
      }
    };

    timer = setTimeout(() => void probe(), TOKEN_CHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [token]);

  /** Browser-side log line. Merged into the trace console alongside server lines. */
  const logLocal = useCallback(
    (
      level: "info" | "warn" | "error",
      message: string,
      fields?: Record<string, string | number | boolean | null>,
    ) => {
      emit({ level, source: "Console", message, fields }, "browser");
    },
    [],
  );

  const applySnapshot = useCallback((snapshot: SystemHealth) => {
    setHealth(snapshot);
    setUpdatedAt(new Date());
    setHealthError(null);
    // Every successful read — the poll, the mount fetch and the snapshot an
    // action response carries — feeds the ring; appendLatencyHistory drops
    // observations with no new upstream samples. Failed polls append nothing.
    const latency = snapshot.summary?.latency;
    if (latency) {
      setLatencyHistory((current) =>
        appendLatencyHistory(current, {
          t: Date.now(),
          p99: latency.p99,
          errorRate: latency.errorRate,
          n: latency.n,
          lastAt: latency.lastAt,
        }));
    }
  }, []);

  const refresh = useCallback(async (quiet: boolean): Promise<boolean> => {
    const current = ++sequence.current;
    // Read through a ref so changing the cadence does not re-create `refresh`
    // and fire an extra request through the effects that depend on it.
    const deadlineMs = healthDeadlineMs(pollMsRef.current);
    try {
      const priority = quiet ? "background" : "interactive";
      const response = await fetch(`/api/system/health?priority=${priority}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(deadlineMs),
      });
      const body = await response.json().catch(() => ({}));
      // A stale response racing a newer request must not win the state — and
      // must not move a backoff either, so it is not counted as a failure.
      if (current !== sequence.current) return true;
      if (!response.ok) {
        setHealthError((body as { error?: string }).error ?? `HTTP ${response.status}`);
        return false;
      }
      applySnapshot(body as SystemHealth);
      return true;
    } catch (err) {
      // Retain the last good snapshot, but never leave stale values painted as
      // current. A timeout is a transient fact and is worded as one: this is
      // set, never latched, and `applySnapshot` clears it on the next tick
      // that succeeds, so one stalled poll cannot leave the console reading
      // degraded for the life of the tab.
      if (current === sequence.current) setHealthError(describeHealthFailure(err, deadlineMs));
      return false;
    }
  }, [applySnapshot]);

  useEffect(() => { void refresh(false); }, [refresh]);

  /**
   * The measured health surface's own loop, on the shared controller.
   *
   * It was a `setInterval` with an inline `document.hidden` check and a
   * `visibilitychange` listener beside it: the gate and the revalidate were
   * right, and there was no backoff at all, so a refusing health endpoint was
   * asked again every 30s — every second on the debugging cadence — for the
   * life of the tab. A minute's ceiling, not the five this codebase gives
   * append-only ledgers: this loop's job is to say whether the platform is up,
   * and one backed off further is reporting an outage it stopped checking.
   */
  usePolling({
    tick: async () => { if (!(await refresh(true))) throw new Error("health read failed"); },
    intervalMs: pollMs,
    maxBackoffMs: 60_000,
    enabled: !paused,
  });

  // Default the failover picker to the active symbol's asset class, so the chain
  // on screen is the one that serves the instrument the desk is looking at.
  useEffect(() => {
    if (route || !health?.routes.length) return;
    const asset = /^[A-Z0-9]{5,}$/.test(workspaceSymbol) ? "crypto" : "equity";
    const preferred = health.routes.find((r) => r.capability === "quote" && r.asset === asset);
    setRoute(routeKey(preferred ?? health.routes[0]));
  }, [health, route, workspaceSymbol]);

  const runAction = useCallback(
    async (action: string, options: ActionOptions = {}) => {
      setBusyAction(action);
      setActionResult(null);
      logLocal("warn", `operator action: ${action}${options.provider ? ` (${options.provider})` : ""}`, {
        action,
        provider: options.provider ?? null,
        scope: options.scope ?? null,
      });
      try {
        const response = await fetch("/api/system/actions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          // A deadline on a write, for the same reason the order ticket carries
          // one: waiting forever leaves the button spinning with no verdict and
          // no way back. See ACTION_DEADLINE_MS for why it outlasts the server.
          signal: AbortSignal.timeout(ACTION_DEADLINE_MS),
          body: JSON.stringify({ action, ...options }),
        });
        const body = (await response.json().catch(() => ({}))) as ActionResponse;
        setActionResult({ ...body, ok: response.ok && body.ok !== false });
        if (!response.ok) logLocal("error", body.error ?? `action failed (HTTP ${response.status})`);
        if (response.ok && body.health) {
          // The embedded snapshot comes from the instance that applied the
          // action; a re-poll could route to a lambda that never saw it.
          // Invalidate any in-flight poll so it cannot overwrite this read.
          ++sequence.current;
          applySnapshot(body.health);
        } else {
          // The action changed server state; re-read it rather than guessing.
          await refresh(false);
        }
      } catch (err) {
        setActionResult({ ok: false, error: describeActionFailure(err) });
      } finally {
        setBusyAction(null);
      }
    },
    [token, refresh, applySnapshot, logLocal],
  );

  const onReconnectSockets = useCallback(() => {
    const cycled = reconnectAll();
    logLocal("warn", `forced re-handshake on ${cycled} exchange socket${cycled === 1 ? "" : "s"}`, {
      sockets: cycled,
    });
  }, [reconnectAll, logLocal]);

  const summary = health?.summary;
  const degraded = useMemo(() => (summary?.degraded.length ?? 0) + (summary?.exhausted.length ?? 0), [summary]);
  // Throttled read figures, arriving in pairs when an action lands a snapshot
  // and then re-reads. `degraded`, the guard and `health` itself stay immediate.
  const decisionLatency = useThrottledValue(useMemo(() => deriveDecisionLatency(health), [health]));
  const cacheHitRate = useThrottledValue(summary?.cache.hitRate ?? null);

  const guardMode = health?.guard.mode ?? "locked";
  const operatorReady =
    guardMode === "open-demo" || guardMode === "open-dev"
    || (guardMode === "token" && token.trim() !== "");

  /**
   * One identity per set of facts — same contract as `useBook`'s view. The
   * persistent, memoised workspace panels compare this object by reference to
   * decide whether to re-render, so it must only change when a field does.
   */
  return useMemo(
    () => ({
      health,
      healthError,
      updatedAt,
      refresh,
      pollMs,
      setPollMs,
      paused,
      setPaused,
      effectivePollMs: paused ? 0 : pollMs,
      route,
      setRoute,
      guard: guardMode,
      tokenEnv: health?.guard.tokenEnv ?? "ALPHAENGINE_OPERATOR_TOKEN",
      paperOrderDefaultAvailable: health?.guard.paperOrderDefaultAvailable === true,
      token,
      setToken,
      operatorReady,
      tokenStatus,
      busyAction,
      actionResult,
      runAction,
      sockets,
      onReconnectSockets,
      logLocal,
      degraded,
      cacheHitRate,
      latencyHistory,
      decisionLatency,
    }),
    [
      health, healthError, updatedAt, refresh, pollMs, setPollMs, paused,
      setPaused, route, setRoute, guardMode, token, setToken, operatorReady,
      tokenStatus, busyAction, actionResult, runAction, sockets,
      onReconnectSockets, logLocal, degraded, cacheHitRate, latencyHistory,
      decisionLatency,
    ],
  );
}
