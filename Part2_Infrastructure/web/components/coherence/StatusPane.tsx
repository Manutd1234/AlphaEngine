"use client";

/**
 * The compact, actionable remainder of engine status.
 *
 * Transport state, freshness, schema and read-only posture already live in the
 * engine top bar and its bounded detail sheet. Repeating the gateway's raw note
 * list and a four-column shard table below every analytical view made a
 * deterministic fallback look like a second incident console. This component
 * therefore reports only a real live-state trading halt, without a disclosure.
 */

import type { CoherenceStatus } from "@/lib/coherence/types";

export default function StatusPane({ status }: { status: CoherenceStatus }) {
  const halted = status.shards.filter((shard) => !shard.exchange_active || !shard.trading_active);

  return (
    <p className="console-empty" role="status">
      <span aria-hidden="true">▲</span>{" "}
      Trading is paused on {halted.length} of {status.shards.length} exchange shards.
    </p>
  );
}
