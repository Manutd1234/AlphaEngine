"use client";

/**
 * The header's latency chip. Its headline is the gateway's own in-process
 * pre-trade decision p99 — the µs figure pushed on the ops snapshot, and when
 * a compiled core is running, its nanosecond timing beside it. A browser never
 * sees microseconds over the wire; it prints the gateway's clock, which is why
 * the caveat says so and keeps the two apart.
 *
 * The network figures — the web→gateway hop and the upstream vendor REST tail,
 * both physically milliseconds and both polled — live in the title and on the
 * Reliability tab, demoted but never dropped. The model decides every word;
 * this component only paints it. No tooltip component exists in this app, so
 * the caveat rides the native title and the aria-label.
 *
 * A button, not a badge: it is the doorway to the Reliability latency evidence.
 */

import { Gauge } from "lucide-react";

import NumberTicker from "@/components/common/NumberTicker";
import type { LatencyStats } from "@/components/systems/types";
import { formatDuration } from "@/lib/format";
import { formatDecisionChip, type DecisionLatencySource } from "@/lib/overview-state";

const DOT_CLASS: Record<string, string> = {
  good: "bg-status-good",
  warn: "bg-status-warning",
  bad: "bg-status-critical",
  muted: "bg-axis",
};

export default function LatencyChip({
  decision,
  network,
  gatewayHop,
  onOpenReliability,
}: {
  decision: DecisionLatencySource;
  network: LatencyStats | null;
  /** Reserved for the slice that splits the hop out of the pool; unused until then. */
  gatewayHop?: LatencyStats | null;
  onOpenReliability: () => void;
}) {
  const net = network ? { p99: network.p99, n: network.n, errorRate: network.errorRate } : null;
  const hop = gatewayHop ? { p99: gatewayHop.p99, n: gatewayHop.n } : null;
  const chip = formatDecisionChip(decision, net, hop);
  const { headline } = chip;

  return (
    <button
      type="button"
      onClick={onOpenReliability}
      title={chip.caveat}
      aria-label={chip.ariaLabel}
      className={`latency-chip is-${chip.tone}`}
    >
      <span className="latency-chip__icon" aria-hidden>
        <Gauge size={15} />
      </span>
      <span className="latency-chip__copy">
        <small>Decision p99</small>
        <strong>
          {headline.kind === "measured" ? (
            <NumberTicker value={headline.p99Us} format={(v) => formatDuration(v, "us")} />
          ) : headline.kind === "collecting" ? (
            "collecting"
          ) : (
            "—"
          )}
          {headline.kind === "measured" && headline.coreP99Ns != null && (
            <em className="latency-chip__core">
              core <NumberTicker value={headline.coreP99Ns} format={(v) => formatDuration(v, "ns")} />
            </em>
          )}
        </strong>
      </span>
      <span className="latency-chip__state">
        <i aria-hidden className={DOT_CLASS[chip.tone]} />
        {chip.state}
      </span>
    </button>
  );
}
