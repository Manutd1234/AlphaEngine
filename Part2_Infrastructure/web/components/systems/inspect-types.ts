/**
 * Trace, wire-tap and single-symbol inspection payloads.
 *
 * Split out of `types.ts` when that file passed the length ceiling. Same wire
 * contract, same rule: hand-written mirrors of what `/api/system/*` promises,
 * optional-tolerant wherever a rolling deploy could serve an older shape.
 * `types.ts` re-exports every name below, so no import path changed.
 */

export interface TraceEvent {
  seq: number;
  ts: number;
  level: "debug" | "info" | "warn" | "error";
  source: string;
  message: string;
  fields: Record<string, string | number | boolean | null>;
  origin: "server" | "browser";
}

export interface EventsResponse {
  fetchedAt: string;
  instance: string;
  cursor: { latest: number; oldest: number; retained: number; capacity: number };
  dropped: boolean;
  events: TraceEvent[];
}

export interface UpstreamCall {
  provider: string;
  method: string;
  url: string;
  status: number | null;
  ms: number;
  ok: boolean;
  error?: string;
  body?: { value: unknown; bytes: number; truncated: boolean };
}

export interface InspectResponse {
  fetchedAt: string;
  ok: boolean;
  /**
   * Set when the registry refused before dispatch: the capability does not
   * apply to the symbol's asset class. No provider was contacted, so
   * `attempts` and `upstream.calls` are empty and `provenance` is null.
   */
  reason?: "not_applicable";
  /** The asset classes the capability does answer for, when refused. */
  applicable?: string[];
  symbol: string;
  asset: string;
  capability: string;
  totalMs: number;
  cache: {
    key: string;
    state: "hit" | "miss";
    configuredTtlMs: number;
    ttlRemainingMs: number | null;
    ageMs: number;
    refreshed: boolean;
  };
  lineage: { stage: string; detail: string; providers?: string[] }[];
  provenance: {
    provider: string;
    label: string;
    fetchedAt: string;
    latencyMs: number;
    cached: boolean;
    delayed: boolean;
    quotaRemaining: number | null;
    /** Optional: an older instance's cached provenance predates it. */
    quotaLimit?: number | null;
    quotaWindow: string | null;
    /** Contract result attached to this exact cached or upstream payload. */
    contract?: {
      passed: boolean;
      violations: Array<{ check: string; severity: string; message: string }>;
      notEvaluated: string[];
    };
  } | null;
  attempts: { provider: string; reason: string; detail?: string }[];
  upstream: { captured: boolean; calls: UpstreamCall[]; note: string };
  data: unknown;
  error: string | null;
}

/** Human-readable labels for the reasons dispatch records against a skip. */
export const SKIP_LABEL: Record<string, string> = {
  not_configured: "no key",
  circuit_open: "circuit open",
  quota_exhausted: "quota spent",
  quota_reserved: "reserved for interactive",
  simulated_outage: "simulated outage",
  asset_unsupported: "asset unsupported",
  no_capability: "capability unsupported",
  no_data: "no data for this symbol",
  unlicensed: "not licensed on this key",
  rate_limited: "rate-limited by the vendor",
  failed: "failed",
};
