"use client";

/** Shared status header for the operational console. */

import { fmt } from "@/lib/format";
import type { SystemHealthView } from "@/lib/use-system-health";

export interface ConsoleTile {
  label: string;
  value: string;
  note: string;
  tone: "good" | "warn" | "bad" | "neutral";
  actionLabel?: string;
  onClick?: () => void;
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
          {tiles.map((tile) => {
            const content = (
              <>
                <span>{tile.label}</span>
                <strong className="num">{tile.value}</strong>
                <small>{tile.note}</small>
                {tile.actionLabel && <em>{tile.actionLabel} →</em>}
              </>
            );
            return tile.onClick ? (
              <button
                type="button"
                key={tile.label}
                className={`console-stat is-${tile.tone} is-action`}
                onClick={tile.onClick}
                aria-label={`${tile.actionLabel ?? "Open details"}. ${tile.label}: ${tile.value}. ${tile.note}`}
              >
                {content}
              </button>
            ) : (
              <div key={tile.label} className={`console-stat is-${tile.tone}`}>
                {content}
              </div>
            );
          })}
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
