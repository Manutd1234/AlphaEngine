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
  token: string;
  setToken: (token: string) => void;
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
        const response = await fetch("/api/system/health?priority=interactive", { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        // A stale response racing a newer request must not win the state.
        if (current !== sequence.current) return;
        if (!response.ok) {
          if (!quiet) setHealthError((body as { error?: string }).error ?? `HTTP ${response.status}`);
          return;
        }
        setHealth(body as SystemHealth);
        setUpdatedAt(new Date());
        setHealthError(null);
      } catch (err) {
        // A quiet refresh keeps the last good snapshot and lets the timestamp go
        // stale. Only an interactive load raises a banner.
        if (current === sequence.current && !quiet) {
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
        await refresh(true);
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
    guard: health?.guard.mode ?? "locked",
    tokenEnv: health?.guard.tokenEnv ?? "ALPHAENGINE_OPERATOR_TOKEN",
    token,
    setToken,
    busyAction,
    actionResult,
    runAction,
    sockets,
    onReconnectSockets,
    logLocal,
    degraded,
    cacheHitRate: summary?.cache.hitRate ?? null,
  };
}
