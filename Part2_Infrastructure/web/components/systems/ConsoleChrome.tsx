"use client";

/**
 * Shared header for the three console tabs.
 *
 * The per-instance caveat travels with it. These counters live in one function
 * instance's memory, so a reader who sees "3 breaker trips" on one tab and the
 * same strip on another must be told, on both, that the number is a floor.
 */

import { fmt } from "@/lib/format";
import type { SystemHealthView } from "@/lib/use-system-health";

export interface ConsoleTile {
  label: string;
  value: string;
  note: string;
  tone: "good" | "warn" | "bad" | "neutral";
}

export function humanUptime(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export function ConsoleChrome({
  view,
  tiles,
}: {
  view: SystemHealthView;
  tiles: ConsoleTile[];
}) {
  const { health, healthError, updatedAt, paused, pollMs, refresh, busyAction } = view;

  return (
    <>
      <div className={`console-statusbar${healthError ? " is-stale" : ""}`}>
        <div className="console-statusbar__metrics">
          {tiles.map((tile) => (
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
            {paused ? "polling paused" : pollMs ? `polling every ${pollMs / 1000}s` : "polling off"}
            {updatedAt && ` · updated ${updatedAt.toLocaleTimeString()}`}
          </span>
          <button type="button" onClick={() => void refresh(false)} disabled={busyAction !== null}>
            Refresh now
          </button>
        </div>
      </div>

      {health && (
        <details className="console-scope-note">
          <summary>Instance-local telemetry · counts are a floor</summary>
          <p>
            Counters, breakers and the event ring are <strong>per function instance</strong> —{" "}
            {health.instance.scope}. Two concurrent instances keep two ledgers, so these numbers are
            a floor, not an exact figure.
          </p>
        </details>
      )}

      {healthError && (
        <div className="banner error" role="alert">
          <span aria-hidden>✕</span>
          <div>
            <strong>System health is unreachable.</strong> {healthError}
          </div>
        </div>
      )}
    </>
  );
}

/** Latency tile shared by the Reliability and Developer strips. */
export function latencyTile(view: SystemHealthView): ConsoleTile {
  const latency = view.health?.summary.latency;
  return {
    label: "Upstream latency p50",
    value: latency?.n ? `${fmt(latency.p50 ?? 0, 0)}ms` : "—",
    note: latency?.n ? `p95 ${fmt(latency.p95 ?? 0, 0)}ms · n=${latency.n}` : "no attempts sampled yet",
    tone: "neutral",
  };
}

/** Provider-readiness tile shared by the Data and Reliability strips. */
export function providerTile(view: SystemHealthView): ConsoleTile {
  const summary = view.health?.summary;
  return {
    label: "Providers ready",
    value: summary ? `${summary.ready}/${summary.total}` : "—",
    note: summary
      ? view.degraded
        ? `${view.degraded} degraded`
        : `${summary.configured} configured`
      : "checking",
    tone: !summary ? "neutral" : view.degraded ? "warn" : "good",
  };
}
