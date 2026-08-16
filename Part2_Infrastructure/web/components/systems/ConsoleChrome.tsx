"use client";

/** Shared status header for the operational console. */

import type { ReactNode } from "react";

import FreshnessStamp from "@/components/workspace/FreshnessStamp";
import PageHead, { type PageMetric, type PageStatus } from "@/components/workspace/PageHead";
import type { SystemHealthView } from "@/lib/use-system-health";

export interface ConsoleTile {
  label: string;
  /** ReactNode so a poll-fed figure can count through NumberTicker. */
  value: ReactNode;
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
  status = null,
}: {
  view: SystemHealthView;
  tiles: ConsoleTile[];
  kicker: string;
  title: string;
  description: React.ReactNode;
  /** The one-word verdict, when the console has one. */
  status?: PageStatus | null;
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
      status={status}
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

/* latencyTile() and providerTile() used to live here, claiming to be shared
   by the console strips. Nothing imported either — leftovers of the tile
   consolidation data-reliability-consolidation.test.ts pins. */
