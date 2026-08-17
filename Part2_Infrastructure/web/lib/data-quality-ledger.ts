/**
 * The gateway's durable data-quality ledger, as the web reads it.
 *
 * Every instance pushes its contract findings through the ops-sync round trip
 * and receives the merged, SQLite-persisted view back in the same response
 * (`modules/data_quality.py`). This module is the isomorphic half: the wire
 * types (kept structurally identical to the generated gateway contract, which
 * `tests/gateway-contract.test.ts` checks at compile time), the runtime guard
 * for a payload from an older gateway, and the projection into the
 * `validation` block the Data tab already renders.
 *
 * Importable from the browser bundle: no gateway client, no fs.
 */

import type { ValidationTelemetry } from "@/components/systems/types";

export type DataQualitySeverity = "fatal" | "warn" | "drift" | "clean";
export type DataQualitySource = "web" | "replay" | "backfill";
export type DataQualityRule = "fatal_burst" | "fail_rate";
export type DataQualityChannel = "telegram" | "log";

export interface DataQualityCountsWire {
  evaluated: number;
  passed: number;
  fatal: number;
  warn: number;
  drift: number;
  not_evaluated: number;
}

export interface DataQualityProviderRowWire extends DataQualityCountsWire {
  provider: string;
  /** null when nothing was evaluated — never 0. */
  fail_rate: number | null;
}

export interface DataQualityCapabilityRowWire extends DataQualityCountsWire {
  capability: string;
}

export interface DataQualityFindingWire {
  id: number;
  observed_at: string;
  instance: string;
  source: DataQualitySource;
  capability: string;
  provider: string;
  symbol: string | null;
  key: string;
  passed: boolean;
  severity: DataQualitySeverity;
  checks: string[];
}

export interface DataQualityEscalationWire {
  id: number;
  rule: DataQualityRule;
  provider: string;
  opened_at: string;
  window_minutes: number;
  count: number;
  evaluated: number | null;
  detail: string;
  notified_at: string | null;
  channel: DataQualityChannel | null;
  resolved_at: string | null;
}

export interface DataQualityViewWire {
  schema_version?: 1;
  backend: "sqlite";
  retention_days: number;
  window_minutes: number;
  observed_at: string;
  first_observed_at: string | null;
  last_observed_at: string | null;
  instances: number;
  total: DataQualityCountsWire;
  by_provider: DataQualityProviderRowWire[];
  by_capability: DataQualityCapabilityRowWire[];
  recent: DataQualityFindingWire[];
  escalations: DataQualityEscalationWire[];
}

function counts(value: unknown): value is DataQualityCountsWire {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return ["evaluated", "passed", "fatal", "warn", "drift", "not_evaluated"]
    .every((k) => typeof c[k] === "number" && Number.isFinite(c[k] as number));
}

/** Structural guard: an older gateway omits the block entirely; a newer one must not lie about its shape. */
export function isDataQualityView(payload: unknown): payload is DataQualityViewWire {
  if (typeof payload !== "object" || payload === null) return false;
  const v = payload as Record<string, unknown>;
  return (
    v.backend === "sqlite"
    && typeof v.retention_days === "number"
    && typeof v.window_minutes === "number"
    && typeof v.observed_at === "string"
    && Number.isFinite(Date.parse(v.observed_at))
    && typeof v.instances === "number"
    && counts(v.total)
    && Array.isArray(v.by_provider)
    && Array.isArray(v.by_capability)
    && Array.isArray(v.recent)
    && Array.isArray(v.escalations)
  );
}

function toCounts(c: DataQualityCountsWire) {
  return {
    evaluated: c.evaluated,
    passed: c.passed,
    fatal: c.fatal,
    warn: c.warn,
    drift: c.drift,
    notEvaluated: c.not_evaluated,
  };
}

/**
 * The ledger projected into the shape the Data tab already renders, with the
 * scope word changed so every panel says whose numbers these are. `capacity`
 * is null on purpose: a retention window is not a ring buffer, and printing
 * "N / 500" against a durable store would claim a bound that does not exist.
 */
export function ledgerValidation(view: DataQualityViewWire): ValidationTelemetry {
  return {
    scope: "gateway-ledger",
    ...toCounts(view.total),
    windowStart: view.first_observed_at,
    lastValidationAt: view.last_observed_at,
    retained: view.total.evaluated,
    capacity: null,
    byCapability: Object.fromEntries(view.by_capability.map((row) => [row.capability, toCounts(row)])),
    byProvider: Object.fromEntries(view.by_provider.map((row) => [row.provider, toCounts(row)])),
    ledger: {
      backend: view.backend,
      retentionDays: view.retention_days,
      windowMinutes: view.window_minutes,
      observedAt: view.observed_at,
      instances: view.instances,
      escalations: view.escalations,
      recent: view.recent,
      byProviderFailRate: Object.fromEntries(view.by_provider.map((row) => [row.provider, row.fail_rate])),
    },
  };
}
