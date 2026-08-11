/**
 * The gateway-backed ledger sync — the serverless repair for per-instance
 * telemetry.
 *
 * One POST per health snapshot: push every delta this instance has queued
 * (latency samples, quota spend, outage commands) and receive the merged
 * cross-instance view in the same round trip. `lib/observability.ts` owns the
 * queues and the overlay; this module owns the network hop, which is why it is
 * a separate file — observability must stay importable from the browser bundle
 * and `lib/gateway.ts` must not be.
 *
 * Failure is a first-class outcome: the drained body is restored to the queues,
 * the overlay ages into staleness, and every read falls back to the local
 * per-instance ledger — exactly the behaviour this deployment had before the
 * shared ledger existed, disclosed via `instance.scope` in the health payload.
 */

import { callGateway } from "@/lib/gateway";
import {
  applySharedOpsState,
  recordLatency,
  restorePendingOps,
  takePendingOps,
  type SharedOpsViewWire,
} from "@/lib/observability";
import { hydrateQuotaLedger } from "@/lib/providers/runtime";

/** Short on purpose: the health poll pays this serially before its probes. */
export const OPS_SYNC_TIMEOUT_MS = 1_500;

export function isSharedOpsView(payload: unknown): payload is SharedOpsViewWire {
  if (typeof payload !== "object" || payload === null) return false;
  const view = payload as Record<string, unknown>;
  return (
    view.schema_version === 1
    && typeof view.observed_at === "string"
    && Number.isFinite(Date.parse(view.observed_at))
    && typeof view.window_seconds === "number"
    && view.window_seconds > 0
    && Array.isArray(view.instances)
    && Array.isArray(view.latency)
    && Array.isArray(view.outages)
    && Array.isArray(view.quota)
  );
}

let inflight: Promise<void> | null = null;

/**
 * Sync once; concurrent snapshot builds share the same round trip. Never
 * throws — an unreachable gateway must degrade the ledger, not the poll.
 */
export function syncSharedOpsState(): Promise<void> {
  inflight ??= doSync().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doSync(): Promise<void> {
  const drainedAtMs = Date.now();
  const body = takePendingOps();
  const result = await callGateway<SharedOpsViewWire>("/api/ops/web-state/sync", {
    method: "POST",
    body,
    timeoutMs: OPS_SYNC_TIMEOUT_MS,
    subject: "the shared operations ledger",
    validate: isSharedOpsView,
  });
  // A real round trip this instance just paid for — the same house rule as the
  // ops-snapshot probe. Recorded after the drain, so it rides the next sync.
  recordLatency("plane:gateway", Date.now() - drainedAtMs, result.ok);
  if (!result.ok) {
    restorePendingOps(body);
    return;
  }
  applySharedOpsState(result.data, drainedAtMs);
  hydrateQuotaLedger(result.data.quota);
}
