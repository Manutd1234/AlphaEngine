/**
 * The wire shapes of `POST /api/ops/web-state/sync`.
 *
 * Split out of `ledger.ts` when the ledger's state gained an owner: the request
 * and response contracts are shared with the gateway and change only when that
 * route changes, while the class beside them changes whenever the merge policy
 * does. Keeping them in one file meant every edit to either had to be read
 * against both, and it is the contract half a reader almost always wants.
 *
 * `snake_case` throughout, deliberately — these are the gateway's field names,
 * not this codebase's, and renaming them at the boundary would hide which side
 * owns the spelling.
 */

import { type DataQualityViewWire } from "@/lib/data-quality-ledger";

export interface SharedLatencySampleWire {
  ts: number;
  ms: number;
  ok: boolean;
}

/** One contract evaluation, as the gateway ledger stores it. */
export interface SharedContractFindingWire {
  /** This instance's monotonic counter — the gateway de-duplicates on (instance, seq). */
  seq: number;
  observed_at: number;
  capability: string;
  provider: string;
  symbol: string | null;
  key: string;
  passed: boolean;
  fatal: number;
  warn: number;
  drift: number;
  not_evaluated: number;
  checks: Array<{ check: string; severity: "fatal" | "warn" | "drift"; message: string }>;
}

/** Request body of `POST /api/ops/web-state/sync` — the gateway's wire shape. */
export interface SharedOpsSyncBody {
  schema_version: 1;
  instance: string;
  latency: Array<{ key: string; samples: SharedLatencySampleWire[] }>;
  quota: Array<{ provider: string; window: string; spent: number }>;
  quota_reset: Array<{ provider: string; window: string }>;
  outages_set: Array<{ provider: string; expires_at: number; note: string }>;
  outages_cleared: string[];
  findings: SharedContractFindingWire[];
}

/** Response body of the same route. */
export interface SharedOpsViewWire {
  schema_version: 1;
  observed_at: string;
  window_seconds: number;
  instances: string[];
  latency: Array<{ key: string; samples: SharedLatencySampleWire[] }>;
  outages: Array<{ provider: string; expires_at: number; note: string }>;
  quota: Array<{ provider: string; window: string; spent: number }>;
  /**
   * The durable quality ledger, merged. Required by the contract; a gateway
   * still on the previous build omits it, so readers go through
   * `sharedDataQuality()`, which guards the shape rather than trusting it.
   */
  data_quality: DataQualityViewWire;
}
