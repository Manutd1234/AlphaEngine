"use client";

/** Shared status header for the operational console. */

import FreshnessStamp from "@/components/workspace/FreshnessStamp";
import PageHead, { type PageMetric } from "@/components/workspace/PageHead";
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

/** The console vocabulary predates the shared header's; `bad` is `critical`. */
function metricTone(tone: ConsoleTile["tone"]): PageMetric["tone"] {
  return tone === "bad" ? "critical" : tone;
}

/**
 * The operational console header.
 *
 * This used to be `.console-statusbar` — a sticky card of four oversized stats
 * with the instance line and the refresh control trailing it. It now renders
 * the same facts through `PageHead`, so Reliability and Developer open with the
 * identical shape as Research, Risk and every other tab: who the surface is
 * for, what it answers, the numbers that frame it, then the controls.
 */
export function ConsoleChrome({
  view,
  tiles,
  kicker,
  title,
  description,
}: {
  view: SystemHealthView;
  tiles: ConsoleTile[];
  kicker: string;
  title: string;
  description: React.ReactNode;
}) {
  const { health, healthError, updatedAt, paused, pollMs, refresh, busyAction } = view;

  const metrics: PageMetric[] = tiles.map((tile) => ({
    label: tile.label,
    value: tile.value,
    note: tile.note,
    tone: metricTone(tile.tone),
    onClick: tile.onClick,
    actionLabel: tile.actionLabel,
  }));

  return (
    <PageHead
      kicker={kicker}
      title={title}
      description={description}
      metrics={metrics}
      actions={
        <>
          <FreshnessStamp updatedAt={updatedAt} pollMs={pollMs} paused={paused} />
          <button type="button" onClick={() => void refresh(false)} disabled={busyAction !== null}>
            Refresh
          </button>
        </>
      }
    >
      {healthError && (
        <div className="banner error" role="alert">
          <span aria-hidden>✕</span>
          <div>
            <strong>System health is unreachable.</strong> {healthError}
          </div>
        </div>
      )}
    </PageHead>
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
