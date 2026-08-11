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
 * and `runAction` re-fetches rather than patching a local copy — the server
 * decides what happened, not the button that asked.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { routeKey } from "@/components/systems/FailoverGraph";
import type { ActionOptions } from "@/components/systems/OperatorPanel";
import type { ActionResponse, GuardMode, SystemHealth } from "@/components/systems/types";
import { useWireTap, type SocketSummary } from "@/lib/livebook";
import { emit } from "@/lib/observability";
import { appendLatencyHistory, type LatencyHistoryPoint } from "@/lib/overview-state";

/** Quota-fenced and slow enough to be free. */
export const DEFAULT_POLL_MS = 30_000;

export interface SystemHealthView {
  health: SystemHealth | null;
  healthError: string | null;
  updatedAt: Date | null;
  refresh: (quiet: boolean) => Promise<void>;

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
   * sparkline's memory lives here. Per-tab by design (the server's stats are
   * already per-instance); a fresh tab starts empty and the "warming up" tone
   * covers it.
   */
  latencyHistory: LatencyHistoryPoint[];
}

export function useSystemHealth(workspaceSymbol: string): SystemHealthView {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [pollMs, setPollMs] = useState(DEFAULT_POLL_MS);
  const [paused, setPaused] = useState(false);
  const [route, setRoute] = useState<string>("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<ActionResponse | null>(null);
  const [token, setToken] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [latencyHistory, setLatencyHistory] = useState<LatencyHistoryPoint[]>([]);
  const sequence = useRef(0);
  const { sockets, reconnectAll } = useWireTap();

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

  const refresh = useCallback(
    async (quiet: boolean) => {
      const current = ++sequence.current;
      try {
        const priority = quiet ? "background" : "interactive";
        const response = await fetch(`/api/system/health?priority=${priority}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        // A stale response racing a newer request must not win the state.
        if (current !== sequence.current) return;
        if (!response.ok) {
          setHealthError((body as { error?: string }).error ?? `HTTP ${response.status}`);
          return;
        }
        setHealth(body as SystemHealth);
        setUpdatedAt(new Date());
        setHealthError(null);
        // Every successful read — the poll, the mount fetch and runAction's
        // re-read — feeds the ring; appendLatencyHistory drops observations
        // that carry no new upstream samples. Failed polls append nothing.
        const latency = (body as SystemHealth).summary?.latency;
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
      } catch (err) {
        // Retain the last good snapshot, but never leave stale values painted as
        // current. A later successful tick clears this visible stale state.
        if (current === sequence.current) {
          setHealthError(err instanceof Error ? err.message : "health check failed");
        }
      }
    },
    [],
  );

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  useEffect(() => {
    if (paused || !pollMs) return;
    const tick = () => {
      if (!document.hidden) void refresh(true);
    };
    const timer = setInterval(tick, pollMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [paused, pollMs, refresh]);

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
          body: JSON.stringify({ action, ...options }),
        });
        const body = (await response.json().catch(() => ({}))) as ActionResponse;
        setActionResult({ ...body, ok: response.ok && body.ok !== false });
        if (!response.ok) logLocal("error", body.error ?? `action failed (HTTP ${response.status})`);
        // The action changed server state; re-read it rather than guessing.
        await refresh(false);
      } catch (err) {
        setActionResult({ ok: false, error: err instanceof Error ? err.message : "action failed" });
      } finally {
        setBusyAction(null);
      }
    },
    [token, refresh, logLocal],
  );

  const onReconnectSockets = useCallback(() => {
    const cycled = reconnectAll();
    logLocal("warn", `forced re-handshake on ${cycled} exchange socket${cycled === 1 ? "" : "s"}`, {
      sockets: cycled,
    });
  }, [reconnectAll, logLocal]);

  const summary = health?.summary;
  const degraded = useMemo(
    () => (summary?.degraded.length ?? 0) + (summary?.exhausted.length ?? 0),
    [summary],
  );

  const guardMode = health?.guard.mode ?? "locked";
  const operatorReady =
    guardMode === "open-demo" || guardMode === "open-dev"
    || (guardMode === "token" && token.trim() !== "");

  return {
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
    busyAction,
    actionResult,
    runAction,
    sockets,
    onReconnectSockets,
    logLocal,
    degraded,
    cacheHitRate: summary?.cache.hitRate ?? null,
    latencyHistory,
  };
}
