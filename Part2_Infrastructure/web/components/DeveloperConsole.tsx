"use client";

/**
 * Systems console — observability first.
 *
 * This page used to be a market-data lookup with a provider table underneath it,
 * which put a *Research* question on a *Systems* tab: the price of BNBUSDT is
 * already on Execution, and a developer opening this tab is not asking for it.
 * They are asking whether the pipeline is healthy, where a request would be
 * routed right now, what it costs, and — when something is wrong — which leg
 * broke and when.
 *
 * The layout follows that. A status strip that answers "is the data plane
 * healthy" in three numbers; a wide left column for pipeline observability
 * (health matrix, failover chain, quota); a narrower right column for the live
 * debugging loop (inspect a symbol, read the trace, act on it). Reading is free
 * and always available; writing is gated and every control states its cost.
 *
 * Everything on screen is served by `/api/system/*`. Nothing is derived in the
 * browser, so what a developer reads here is what a curl would return — which is
 * the property that makes it worth trusting during an incident.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import CrossSourceCheck from "@/components/systems/CrossSourceCheck";
import FailoverGraph, { routeKey } from "@/components/systems/FailoverGraph";
import HealthMatrix from "@/components/systems/HealthMatrix";
import QuarantinePanel from "@/components/systems/QuarantinePanel";
import OperatorPanel, { type ActionOptions } from "@/components/systems/OperatorPanel";
import PipelineInspector from "@/components/systems/PipelineInspector";
import QuotaMeters from "@/components/systems/QuotaMeters";
import TraceConsole from "@/components/systems/TraceConsole";
import type { ActionResponse, SystemHealth } from "@/components/systems/types";
import { fmt } from "@/lib/format";
import { useWireTap } from "@/lib/livebook";
import { emit } from "@/lib/observability";

/** Matches the previous panel's cadence — quota-fenced and slow enough to be free. */
const DEFAULT_POLL_MS = 30_000;

const API_SURFACES = [
  { method: "GET", path: "/api/system/health", purpose: "Providers, breakers, latency percentiles, failover graph, cache" },
  { method: "GET", path: "/api/system/events?since=", purpose: "Structured trace, cursored by sequence" },
  { method: "GET", path: "/api/system/inspect?symbol=&raw=1", purpose: "One lookup taken apart, with raw upstream payloads" },
  { method: "POST", path: "/api/system/actions", purpose: "Operator actions — purge, breaker, outage, probe" },
  { method: "GET", path: "/api/quote?symbols=", purpose: "Normalised quote with provider provenance" },
  { method: "GET", path: "/api/ohlcv?symbol=&interval=&bars=", purpose: "Historical bars and source warnings" },
  { method: "GET", path: "/api/depth?symbol=", purpose: "Cross-venue L2 snapshot" },
  { method: "GET", path: "/api/tca?symbol=&side=&notional=", purpose: "Pre-trade cost and routing estimate" },
  { method: "POST", path: "/api/backtest", purpose: "Synchronous research sweep" },
  { method: "GET", path: "/api/providers", purpose: "Provider, quota and circuit health" },
  { method: "GET", path: "/api/gateway/portfolio", purpose: "Authoritative portfolio and risk state" },
] as const;

interface DeveloperConsoleProps {
  workspaceSymbol: string;
  onWorkspaceSymbolChange: (symbol: string) => void;
  onOpenResearch: () => void;
  onOpenLive: () => void;
}

export default function DeveloperConsole({
  workspaceSymbol,
  onWorkspaceSymbolChange,
  onOpenResearch,
  onOpenLive,
}: DeveloperConsoleProps) {
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
  const cacheHitRate = summary?.cache.hitRate ?? null;
  const degraded = (summary?.degraded.length ?? 0) + (summary?.exhausted.length ?? 0);

  const statusTiles = useMemo(
    () => [
      {
        label: "Providers ready",
        value: summary ? `${summary.ready}/${summary.total}` : "—",
        note: summary
          ? degraded
            ? `${degraded} degraded`
            : `${summary.configured} configured`
          : "checking",
        tone: summary && degraded ? "warn" : "good",
      },
      {
        label: "Global latency p50",
        value: summary?.latency.n ? `${fmt(summary.latency.p50 ?? 0, 0)}ms` : "—",
        note: summary?.latency.n
          ? `p95 ${fmt(summary.latency.p95 ?? 0, 0)}ms · n=${summary.latency.n}`
          : "no calls sampled yet",
        tone: "good",
      },
      {
        label: "Cache hit rate",
        value: cacheHitRate === null ? "—" : `${fmt(cacheHitRate * 100, 1)}%`,
        note: summary ? `${summary.cache.hits} hits · ${summary.cache.misses} misses` : "",
        tone: "good",
      },
      {
        label: "Open sockets",
        value: String(sockets.length),
        note: sockets.length ? sockets.map((s) => s.venue).join(" · ") : "wire tap idle",
        tone: "good",
      },
    ],
    [summary, cacheHitRate, degraded, sockets],
  );

  return (
    <>
      {/* ---- status strip ------------------------------------------------ */}
      <div className="console-statusbar">
        <div className="console-statusbar__metrics">
          {statusTiles.map((tile) => (
            <div key={tile.label} className={`console-stat is-${tile.tone}`}>
              <span>{tile.label}</span>
              <strong className="num">{tile.value}</strong>
              <small>{tile.note}</small>
            </div>
          ))}
        </div>
        <div className="console-statusbar__meta">
          <span className="muted">
            {health
              ? `instance ${health.instance.id} · up ${humanUptime(health.instance.uptimeMs)}`
              : "connecting"}
          </span>
          <span className="muted">
            {paused
              ? "polling paused"
              : pollMs
                ? `polling every ${pollMs / 1000}s`
                : "polling off"}
            {updatedAt && ` · updated ${updatedAt.toLocaleTimeString()}`}
          </span>
          <button type="button" onClick={() => void refresh(false)} disabled={busyAction !== null}>
            Refresh now
          </button>
        </div>
      </div>

      {health && (
        <p className="console-scope-note">
          Counters, breakers and the event ring are <strong>per function instance</strong> —{" "}
          {health.instance.scope}. Two concurrent instances keep two ledgers, so these numbers are a
          floor, not an exact figure.
        </p>
      )}

      {healthError && (
        <div className="banner error" role="alert">
          <span aria-hidden>✕</span>
          <div>
            <strong>System health is unreachable.</strong> {healthError}
          </div>
        </div>
      )}

      {/* ---- two-column body --------------------------------------------- */}
      <div className="console-layout">
        <div className="console-column console-column--wide">
          <HealthMatrix
            providers={health?.providers ?? null}
            routes={health?.routes ?? []}
            venues={health?.venues ?? []}
            guard={health?.guard.mode ?? "locked"}
            busyAction={busyAction}
            onAction={runAction}
          />

          <FailoverGraph
            routes={health?.routes ?? []}
            selected={route}
            onSelect={setRoute}
            cacheByCapability={health?.cache.byCapability ?? {}}
            priority={health?.routePriority ?? "interactive"}
            guard={health?.guard.mode ?? "locked"}
            busyAction={busyAction}
            onAction={runAction}
          />

          <QuotaMeters
            providers={health?.providers ?? null}
            cacheByCapability={health?.cache.byCapability ?? {}}
            cacheEntries={health?.cache.entries ?? 0}
          />

          <CrossSourceCheck symbol={workspaceSymbol} />

          {/* Transport health and data health are different questions: a
              provider can answer quickly, from a closed breaker, with a bar
              series that halves the volatility a backtest measures. */}
          <QuarantinePanel
            size={health?.quarantine?.size ?? 0}
            byProvider={health?.quarantine?.byProvider ?? []}
            recent={health?.quarantine?.recent ?? []}
          />
        </div>

        <div className="console-column console-column--narrow">
          <PipelineInspector
            symbol={workspaceSymbol}
            onSymbolChange={onWorkspaceSymbolChange}
            pollMs={paused ? 0 : pollMs}
            onEvent={logLocal}
          />

          <TraceConsole
            pollMs={pollMs || DEFAULT_POLL_MS}
            paused={paused}
            onTogglePause={() => setPaused((current) => !current)}
          />

          <OperatorPanel
            guard={health?.guard.mode ?? "locked"}
            tokenEnv={health?.guard.tokenEnv ?? "ALPHAENGINE_OPERATOR_TOKEN"}
            providers={health?.providers ?? null}
            symbol={workspaceSymbol}
            pollMs={paused ? 0 : pollMs}
            onPollMsChange={(ms) => {
              setPaused(ms === 0);
              if (ms > 0) setPollMs(ms);
            }}
            socketCount={sockets.length}
            onReconnectSockets={onReconnectSockets}
            busyAction={busyAction}
            lastResult={actionResult}
            token={token}
            onTokenChange={setToken}
            onAction={runAction}
          />
        </div>
      </div>

      {/* ---- handoff + api surface --------------------------------------- */}
      <div className="workflow-handoff data-handoff">
        <div>
          <span className="page-kicker">Shared desk instrument</span>
          <strong className="num">{workspaceSymbol}</strong>
          <small>The inspector above traces this symbol; Research and Execution use the same context.</small>
        </div>
        <div>
          <button className="primary-action" onClick={onOpenResearch}>Research {workspaceSymbol}</button>
          <button onClick={onOpenLive}>Open live book</button>
        </div>
      </div>

      <div className="card api-surface-card">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Developer surface</span>
            <h2>Desk-facing APIs</h2>
          </div>
          <span className="section-note">Same contracts that power this workspace.</span>
        </div>
        <div className="api-surface-list">
          {API_SURFACES.map((surface) => (
            <div className="api-surface-row" key={`${surface.method}-${surface.path}`}>
              <span className={`method-badge method-${surface.method.toLowerCase()}`}>{surface.method}</span>
              <code>{surface.path}</code>
              <span>{surface.purpose}</span>
            </div>
          ))}
        </div>
        <p className="api-note">
          Live browser books are market-data signals, not an execution authority. Order submission,
          portfolio risk and kill-switch actions stay behind the authenticated gateway.
        </p>
      </div>
    </>
  );
}

function humanUptime(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}
