/**
 * The names the rest of the telemetry kernel calls the ops ledger by.
 *
 * The state and the policy live in `ops-ledger.ts`; this file is the call-site
 * surface, one delegation deep. The split is the 400-line ceiling doing its job
 * — the owner and its façade were one 447-line file — and it lands on a real
 * seam: `index.ts` re-exports these names, `app/api/*` and `ops-sync.ts` import
 * them, and none of those callers has any business holding the ledger itself.
 *
 * Same arrangement as `EventRing`/`emit` next door: the class is the owner,
 * these are the verbs, and each is a single delegation so there is nowhere for
 * a second copy of the policy to grow.
 */

import { type DataQualityViewWire } from "@/lib/data-quality-ledger";
import { type LatencySample } from "./latency";
import type { SharedOpsSyncBody, SharedOpsViewWire } from "./ledger-wire";
import { OpsLedger, opsLedger, type SharedOpsStatus } from "./ops-ledger";

export { SHARED_STALE_MS, OpsLedger, opsLedger } from "./ops-ledger";
export type { SharedOpsStatus } from "./ops-ledger";
export type {
  SharedContractFindingWire,
  SharedLatencySampleWire,
  SharedOpsSyncBody,
  SharedOpsViewWire,
} from "./ledger-wire";

export function queuePendingSample(key: string, sample: LatencySample): void {
  opsLedger.queueSample(key, sample);
}

export function recordQuotaSpend(provider: string, window: string, spent = 1): void {
  opsLedger.queueQuotaSpend(provider, window, spent);
}

export function recordQuotaReset(provider: string, window: string): void {
  opsLedger.queueQuotaReset(provider, window);
}

export function takePendingOps(): SharedOpsSyncBody {
  return opsLedger.take();
}

export function restorePendingOps(body: SharedOpsSyncBody): void {
  opsLedger.restore(body);
}

export function queueContractFinding(input: Parameters<OpsLedger["queueFinding"]>[0]): void {
  opsLedger.queueFinding(input);
}

export function sharedDataQuality(now = Date.now()): DataQualityViewWire | null {
  return opsLedger.dataQuality(now);
}

export function applySharedOpsState(view: SharedOpsViewWire, drainedAtMs: number, now = Date.now()): void {
  opsLedger.applyShared(view, drainedAtMs, now);
}

export function sharedOpsStatus(now = Date.now()): SharedOpsStatus {
  return opsLedger.status(now);
}

export function resetShared(): void {
  opsLedger.reset();
}
