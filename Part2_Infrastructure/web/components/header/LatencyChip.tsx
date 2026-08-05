"use client";

/**
 * The header's p99 chip. One number, one dot, and — load-bearing — the caveat:
 * these are per-instance upstream REST percentiles over a 15-minute window,
 * and a p99 over a handful of calls is not a p99, so small samples render as
 * an em dash with a "warming up" note rather than a confident figure.
 *
 * A button, not a badge: the number is a doorway to the Reliability tab where
 * the full percentile table lives. No tooltip component exists in this app —
 * the caveat rides the native title and the aria-label.
 */

import { Gauge } from "lucide-react";

import type { LatencyStats } from "@/components/systems/types";
import { formatLatencyChip, latencyTone } from "@/lib/overview-state";

const DOT_CLASS: Record<string, string> = {
  good: "bg-status-good",
  warn: "bg-status-warning",
  bad: "bg-status-critical",
  muted: "bg-axis",
};

export default function LatencyChip({
  latency,
  onOpenReliability,
}: {
  latency: LatencyStats | null;
  onOpenReliability: () => void;
}) {
  const stats = latency ? { p99: latency.p99, n: latency.n, errorRate: latency.errorRate } : null;
  const tone = latencyTone(stats?.p99 ?? null, stats?.n ?? 0, stats?.errorRate ?? 0);
  const chip = formatLatencyChip(stats);

  return (
    <button
      type="button"
      onClick={onOpenReliability}
      title={chip.caveat}
      aria-label={`Open reliability. Upstream ${chip.value} — ${chip.caveat}`}
      className="inline-flex items-center gap-1.5 rounded-[9px] border border-transparent bg-transparent px-2 py-1.5 font-mono text-[11px] font-semibold text-text-secondary hover:border-border hover:bg-surface-2 max-[520px]:hidden"
    >
      <Gauge size={14} aria-hidden />
      <span className="max-[900px]:hidden">{chip.value}</span>
      <span className="hidden max-[900px]:inline">
        {chip.value.replace(/^p99 /, "")}
      </span>
      <i aria-hidden className={`h-[7px] w-[7px] rounded-full ${DOT_CLASS[tone.tone]}`} />
    </button>
  );
}
