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
import { formatLatencyChip, LATENCY_MIN_SAMPLES, latencyTone } from "@/lib/overview-state";

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
  const sampleCount = stats?.n ?? 0;
  const warmingUp = sampleCount < LATENCY_MIN_SAMPLES || stats?.p99 == null;
  const visibleValue = warmingUp ? "P99 collecting" : chip.value.replace(/^p99 /, "P99 ");
  const visibleState = warmingUp ? `${sampleCount}/${LATENCY_MIN_SAMPLES} samples` : tone.label;

  return (
    <button
      type="button"
      onClick={onOpenReliability}
      title={chip.caveat}
      aria-label={`Open reliability tail-latency evidence. ${visibleValue}; ${visibleState}. ${chip.caveat}`}
      className={`latency-chip is-${tone.tone}`}
    >
      <span className="latency-chip__icon" aria-hidden>
        <Gauge size={15} />
      </span>
      <span className="latency-chip__copy">
        <small>Tail latency</small>
        <strong>{visibleValue}</strong>
      </span>
      <span className="latency-chip__state">
        <i aria-hidden className={DOT_CLASS[tone.tone]} />
        {warmingUp ? `${sampleCount}/${LATENCY_MIN_SAMPLES}` : tone.label}
      </span>
    </button>
  );
}
