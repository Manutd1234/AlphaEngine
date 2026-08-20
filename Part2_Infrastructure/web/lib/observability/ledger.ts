import { isDataQualityView, type DataQualityViewWire } from "@/lib/data-quality-ledger";
import { instanceId } from "./identity";
import { LatencySample } from "./latency";
import { SimulatedOutage, outages } from "./outages";
import { redact } from "./redaction";

// --------------------------------------------------------------------------
// Shared operational state — the gateway-backed ledger sync
// --------------------------------------------------------------------------
//
// The mechanics live in `lib/ops-sync.ts` (server-only, since it talks to the
// gateway); this module owns the two data structures the sync moves between:
// the *pending queues* of deltas this instance has produced since its last
// successful push, and the *overlay* — the merged cross-instance view the
// gateway returned. Reads above consult the overlay while it is fresh and fall
// back to the local buckets when it is not, so a gateway outage degrades to
// exactly the per-instance behaviour this file always had.

/** Overlay older than this stops being believed. Two health polls' worth. */
export const SHARED_STALE_MS = 90_000;

const PENDING_SAMPLE_CAP = 480;

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

/** Findings queued since the last successful push; the cap bounds a long-lived instance. */
const PENDING_FINDINGS_CAP = 200;
/** This instance's monotonic finding counter — the de-duplication key the gateway uses. */
export let findingSeq = 0;

export const pending = {
  samples: [] as Array<{ key: string; ts: number; ms: number; ok: boolean }>,
  findings: [] as SharedContractFindingWire[],
  /** Delta spend per `${provider}|${window}` since the last successful push. */
  quota: new Map<string, number>(),
  quotaResets: [] as Array<{ provider: string; window: string }>,
  outageSet: [] as SimulatedOutage[],
  outageCleared: [] as string[],
};

export let shared: {
  fetchedAtMs: number;
  /** When the request body now inside the overlay was drained locally. */
  drainedAtMs: number;
  observedAtMs: number;
  windowSeconds: number;
  instances: string[];
  latency: Map<string, LatencySample[]>;
  outages: Map<string, SimulatedOutage>;
  /** The durable quality ledger, when the gateway sent one it could vouch for. */
  dataQuality: DataQualityViewWire | null;
} | null = null;

export function sharedFresh(now: number): boolean {
  return shared !== null && now - shared.fetchedAtMs <= SHARED_STALE_MS;
}

export function queuePendingSample(key: string, sample: LatencySample): void {
  pending.samples.push({ key, ...sample });
  if (pending.samples.length > PENDING_SAMPLE_CAP) {
    pending.samples.splice(0, pending.samples.length - PENDING_SAMPLE_CAP);
  }
}

/** Called by the quota ledger (`providers/runtime.ts`) on every spend. */
export function recordQuotaSpend(provider: string, window: string, spent = 1): void {
  const key = `${provider}|${window}`;
  pending.quota.set(key, (pending.quota.get(key) ?? 0) + spent);
}

/** Called by the quota ledger when an operator resets a window. */
export function recordQuotaReset(provider: string, window: string): void {
  pending.quota.delete(`${provider}|${window}`);
  if (!pending.quotaResets.some((r) => r.provider === provider && r.window === window)) {
    pending.quotaResets.push({ provider, window });
  }
}

/**
 * Drain every pending queue into a sync request body. The caller owns the
 * result: on a failed push it hands the body to {@link restorePendingOps} so
 * nothing is lost, on a successful one the returned overlay supersedes it.
 */
export function takePendingOps(): SharedOpsSyncBody {
  const byKey = new Map<string, SharedLatencySampleWire[]>();
  for (const { key, ts, ms, ok } of pending.samples) {
    const bucket = byKey.get(key) ?? [];
    bucket.push({ ts, ms, ok });
    byKey.set(key, bucket);
  }
  const body: SharedOpsSyncBody = {
    schema_version: 1,
    instance: instanceId,
    latency: [...byKey.entries()].map(([key, samples]) => ({ key, samples })),
    quota: [...pending.quota.entries()].map(([key, spent]) => {
      const [provider, window] = key.split("|");
      return { provider, window, spent };
    }),
    quota_reset: pending.quotaResets.slice(),
    outages_set: pending.outageSet.map((o) => ({
      provider: o.provider,
      expires_at: o.expiresAt,
      note: o.note,
    })),
    outages_cleared: pending.outageCleared.slice(),
    findings: pending.findings.slice(),
  };
  pending.samples = [];
  pending.quota.clear();
  pending.quotaResets = [];
  pending.outageSet = [];
  pending.outageCleared = [];
  pending.findings = [];
  return body;
}

/**
 * Queue one contract evaluation for the gateway ledger.
 *
 * Called by dispatch beside the per-instance record, so the ring buffer and
 * the durable ledger see the same event. Messages are redacted here, before
 * they are stored: a vendor's error text can quote the URL that carried the
 * key. The seq is this instance's own counter; the gateway keys on
 * (instance, seq), so a batch restored and re-pushed after a failed sync is
 * absorbed rather than counted twice.
 */
export function queueContractFinding(input: {
  capability: string;
  provider: string;
  symbol: string | null;
  key: string;
  passed: boolean;
  violations: Array<{ check: string; severity: "fatal" | "warn" | "drift"; message: string }>;
  notEvaluated: number;
  at?: number;
}): void {
  findingSeq += 1;
  const checks = input.violations.slice(0, 32).map((v) => ({
    check: v.check.slice(0, 64),
    severity: v.severity,
    message: redact(v.message).slice(0, 200),
  }));
  pending.findings.push({
    seq: findingSeq,
    observed_at: input.at ?? Date.now(),
    capability: input.capability.slice(0, 32),
    provider: input.provider.slice(0, 64),
    symbol: input.symbol ? input.symbol.slice(0, 24) : null,
    key: input.key.slice(0, 160),
    passed: input.passed,
    fatal: checks.filter((c) => c.severity === "fatal").length,
    warn: checks.filter((c) => c.severity === "warn").length,
    drift: checks.filter((c) => c.severity === "drift").length,
    not_evaluated: input.notEvaluated,
    checks,
  });
  if (pending.findings.length > PENDING_FINDINGS_CAP) {
    pending.findings.splice(0, pending.findings.length - PENDING_FINDINGS_CAP);
  }
}

/** The merged ledger, when the overlay is fresh and the gateway sent one. */
export function sharedDataQuality(now = Date.now()): DataQualityViewWire | null {
  if (!shared || !sharedFresh(now)) return null;
  return shared.dataQuality;
}

/**
 * Put a drained body back after a failed push.
 *
 * Anything the instance did *after* the drain wins over what is being
 * restored: a provider the operator has since re-outaged must not be
 * re-queued as cleared, and vice versa.
 */
export function restorePendingOps(body: SharedOpsSyncBody): void {
  const restored = body.latency.flatMap(({ key, samples }) =>
    samples.map((s) => ({ key, ...s })),
  );
  pending.samples = [...restored, ...pending.samples].slice(-PENDING_SAMPLE_CAP);
  for (const { provider, window, spent } of body.quota) {
    const key = `${provider}|${window}`;
    // A reset queued since the drain supersedes the older spend.
    if (pending.quotaResets.some((r) => r.provider === provider && r.window === window)) continue;
    pending.quota.set(key, (pending.quota.get(key) ?? 0) + spent);
  }
  for (const reset of body.quota_reset) {
    if (!pending.quotaResets.some((r) => r.provider === reset.provider && r.window === reset.window)) {
      pending.quotaResets.push(reset);
    }
  }
  const clearedAll = pending.outageCleared.includes("*");
  for (const o of body.outages_set) {
    if (clearedAll || pending.outageCleared.includes(o.provider)) continue;
    if (pending.outageSet.some((p) => p.provider === o.provider)) continue;
    pending.outageSet.push({ provider: o.provider, expiresAt: o.expires_at, note: o.note });
  }
  for (const provider of body.outages_cleared) {
    if (provider !== "*" && pending.outageSet.some((p) => p.provider === provider)) continue;
    if (!pending.outageCleared.includes(provider)) pending.outageCleared.push(provider);
  }
  // Findings are keyed by seq, so a restore cannot duplicate one already queued.
  const queued = new Set(pending.findings.map((f) => f.seq));
  const restoredFindings = body.findings.filter((f) => !queued.has(f.seq));
  pending.findings = [...restoredFindings, ...pending.findings].slice(-PENDING_FINDINGS_CAP);
}

/** Install the gateway's merged view as the read overlay. */
export function applySharedOpsState(view: SharedOpsViewWire, drainedAtMs: number, now = Date.now()): void {
  const observedAtMs = Date.parse(view.observed_at);
  shared = {
    fetchedAtMs: now,
    drainedAtMs,
    observedAtMs: Number.isFinite(observedAtMs) ? observedAtMs : now,
    windowSeconds: view.window_seconds,
    instances: view.instances,
    latency: new Map(
      view.latency.map(({ key, samples }) => [
        key,
        samples.map((s) => ({ ts: s.ts, ms: s.ms, ok: s.ok })),
      ]),
    ),
    outages: new Map(
      view.outages
        .filter((o) => o.expires_at > now)
        .map((o) => [o.provider, { provider: o.provider, expiresAt: o.expires_at, note: o.note }]),
    ),
    // Guarded, not trusted: a gateway on the previous build sends no ledger,
    // and the fallback is this instance's own window, disclosed as such.
    dataQuality: isDataQualityView(view.data_quality) ? view.data_quality : null,
  };
}

export interface SharedOpsStatus {
  /** True while the merged overlay is fresh enough to be the read model. */
  backed: boolean;
  instances: string[];
  observedAt: string | null;
  ageMs: number | null;
  windowSeconds: number | null;
}

export function sharedOpsStatus(now = Date.now()): SharedOpsStatus {
  if (!shared) return { backed: false, instances: [], observedAt: null, ageMs: null, windowSeconds: null };
  return {
    backed: sharedFresh(now),
    instances: shared.instances,
    observedAt: new Date(shared.observedAtMs).toISOString(),
    ageMs: now - shared.fetchedAtMs,
    windowSeconds: shared.windowSeconds,
  };
}


/**
 * Forget the overlay and every pending delta.
 *
 * Lives here rather than in `capture.ts`, which is what calls it, because
 * `shared` and `findingSeq` are module state of THIS file and an ES module
 * cannot assign to an imported binding. Reaching across for a `let` was legal
 * while both were in one 1,133-line file and became a compile error the moment
 * the file was split — which is the split surfacing a coupling that was always
 * there, not creating one.
 */
export function resetShared(): void {
  shared = null;
  pending.samples = [];
  pending.quota.clear();
  pending.quotaResets = [];
  pending.outageSet = [];
  pending.outageCleared = [];
  pending.findings = [];
  findingSeq = 0;
}
