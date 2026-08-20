import { isDataQualityView, type DataQualityViewWire } from "@/lib/data-quality-ledger";
import { instanceId } from "./identity";
import type { LatencySample } from "./latency";
import type {
  SharedContractFindingWire,
  SharedLatencySampleWire,
  SharedOpsSyncBody,
  SharedOpsViewWire,
} from "./ledger-wire";
import type { SimulatedOutage } from "./outages";
import { redact } from "./redaction";

// --------------------------------------------------------------------------
// Shared operational state — the gateway-backed ledger sync
// --------------------------------------------------------------------------
//
// The mechanics live in `lib/ops-sync.ts` (server-only, since it talks to the
// gateway); this module owns the two data structures the sync moves between:
// the *pending queues* of deltas this instance has produced since its last
// successful push, and the *overlay* — the merged cross-instance view the
// gateway returned. Reads consult the overlay while it is fresh and fall back
// to the local buckets when it is not, so a gateway outage degrades to exactly
// the per-instance behaviour this file always had.

/** Overlay older than this stops being believed. Two health polls' worth. */
export const SHARED_STALE_MS = 90_000;

const PENDING_SAMPLE_CAP = 480;

/** Findings queued since the last successful push; the cap bounds a long-lived instance. */
const PENDING_FINDINGS_CAP = 200;

/** The gateway's merged view, as this instance holds it between syncs. */
interface SharedOverlay {
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
}

export interface SharedOpsStatus {
  /** True while the merged overlay is fresh enough to be the read model. */
  backed: boolean;
  instances: string[];
  observedAt: string | null;
  ageMs: number | null;
  windowSeconds: number | null;
}

/**
 * The pending queues and the merged overlay, with one owner.
 *
 * ── What this replaces, and why it had to stop ──────────────────────────────
 * Three module-level bindings: `export let shared`, `export let findingSeq`, and
 * an `export const pending` object whose every field was reassigned from
 * outside. `latency.ts`, `outages.ts` and `capture.ts` all imported them and
 * wrote to them directly — `pending.outageSet = pending.outageSet.filter(...)`
 * sat in the outage module, `pending.samples = []` sat in the capture module,
 * and the overlay's inner maps were mutated from both.
 *
 * That arrangement had already produced one compile error in this repository.
 * The reset used to live in `capture.ts`, where it assigned `shared = null`;
 * legal while both were in one 1,133-line file, and `Cannot assign to 'shared'
 * because it is an import` the moment the file was split. The fix at the time
 * was to move one function back here. This is the same fix applied to the whole
 * surface rather than to the one binding that happened to break the build: the
 * state is private, the writes are methods, and the split that exposed the
 * coupling cannot expose another one.
 *
 * ── The second hazard, and why the singleton is never replaced ──────────────
 * `applySharedOpsState` swaps the overlay wholesale. Three modules read it, and
 * they were only safe because each re-read the live `shared` binding on every
 * call — a single `const s = shared` at module scope in any of them would have
 * pinned a stale overlay silently. Here the overlay is a private field behind
 * accessors, so a caller cannot hold it. `opsLedger` itself is created once and
 * never reassigned; `reset()` empties it in place, so every holder of the
 * reference sees the reset rather than continuing to write into an orphan.
 */
export class OpsLedger {
  private overlay: SharedOverlay | null = null;

  /** This instance's monotonic finding counter — the gateway's de-duplication key. */
  private findingSeq = 0;

  private samples: Array<{ key: string; ts: number; ms: number; ok: boolean }> = [];
  private findings: SharedContractFindingWire[] = [];
  /** Delta spend per `${provider}|${window}` since the last successful push. */
  private readonly quota = new Map<string, number>();
  private quotaResets: Array<{ provider: string; window: string }> = [];
  private outageSet: SimulatedOutage[] = [];
  private outageCleared: string[] = [];

  // ── Overlay reads ────────────────────────────────────────────────────────

  fresh(now: number): boolean {
    return this.overlay !== null && now - this.overlay.fetchedAtMs <= SHARED_STALE_MS;
  }

  /** The merged ledger, when the overlay is fresh and the gateway sent one. */
  dataQuality(now: number): DataQualityViewWire | null {
    if (!this.fresh(now)) return null;
    return this.overlay?.dataQuality ?? null;
  }

  status(now: number): SharedOpsStatus {
    if (!this.overlay) {
      return { backed: false, instances: [], observedAt: null, ageMs: null, windowSeconds: null };
    }
    return {
      backed: this.fresh(now),
      instances: this.overlay.instances,
      observedAt: new Date(this.overlay.observedAtMs).toISOString(),
      ageMs: now - this.overlay.fetchedAtMs,
      windowSeconds: this.overlay.windowSeconds,
    };
  }

  /** Copied: a caller holding the overlay's own array could append to it. */
  sharedSamples(key: string): LatencySample[] {
    return [...(this.overlay?.latency.get(key) ?? [])];
  }

  sharedLatencyKeys(): string[] {
    return [...(this.overlay?.latency.keys() ?? [])];
  }

  /**
   * When the body now inside the overlay was drained locally.
   *
   * `Infinity` with no overlay, not 0: callers use it as "everything after this
   * is missing from the merge", and a 0 would declare every local sample missing.
   */
  drainedAtMs(): number {
    return this.overlay?.drainedAtMs ?? Infinity;
  }

  /** Fresh-gated and expiry-pruned, so a stale block never survives a read. */
  sharedOutage(provider: string, now: number): SimulatedOutage | null {
    if (!this.fresh(now)) return null;
    const remote = this.overlay?.outages.get(provider);
    if (!remote) return null;
    if (remote.expiresAt > now) return remote;
    this.overlay?.outages.delete(provider);
    return null;
  }

  sharedOutageProviders(now: number): string[] {
    if (!this.fresh(now)) return [];
    return [...(this.overlay?.outages.keys() ?? [])];
  }

  // ── Pending writes ───────────────────────────────────────────────────────

  queueSample(key: string, sample: LatencySample): void {
    this.samples.push({ key, ...sample });
    if (this.samples.length > PENDING_SAMPLE_CAP) {
      this.samples.splice(0, this.samples.length - PENDING_SAMPLE_CAP);
    }
  }

  /** Called by the quota ledger (`providers/runtime.ts`) on every spend. */
  queueQuotaSpend(provider: string, window: string, spent = 1): void {
    const key = `${provider}|${window}`;
    this.quota.set(key, (this.quota.get(key) ?? 0) + spent);
  }

  /** Called by the quota ledger when an operator resets a window. */
  queueQuotaReset(provider: string, window: string): void {
    this.quota.delete(`${provider}|${window}`);
    if (!this.quotaResets.some((r) => r.provider === provider && r.window === window)) {
      this.quotaResets.push({ provider, window });
    }
  }

  /**
   * Mirror an operator-set outage into the overlay and queue the command.
   *
   * Both halves matter and both used to live in `outages.ts`, writing into this
   * module's structures: every other instance honours the block after its next
   * sync, and a clear queued earlier in the same batch must not cancel a newer
   * set — which is why the cleared list is filtered here rather than appended to.
   */
  queueOutage(record: SimulatedOutage): void {
    this.overlay?.outages.set(record.provider, record);
    this.outageCleared = this.outageCleared.filter((p) => p !== record.provider);
    this.outageSet = this.outageSet.filter((o) => o.provider !== record.provider);
    this.outageSet.push(record);
  }

  /** True when the overlay held a block for `provider`. */
  queueOutageCleared(provider: string): boolean {
    const knownShared = this.overlay?.outages.delete(provider) ?? false;
    this.outageSet = this.outageSet.filter((o) => o.provider !== provider);
    if (!this.outageCleared.includes(provider)) this.outageCleared.push(provider);
    return knownShared;
  }

  queueAllOutagesCleared(): void {
    this.overlay?.outages.clear();
    this.outageSet = [];
    this.outageCleared = ["*"];
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
  queueFinding(input: {
    capability: string;
    provider: string;
    symbol: string | null;
    key: string;
    passed: boolean;
    violations: Array<{ check: string; severity: "fatal" | "warn" | "drift"; message: string }>;
    notEvaluated: number;
    at?: number;
  }): void {
    this.findingSeq += 1;
    const checks = input.violations.slice(0, 32).map((v) => ({
      check: v.check.slice(0, 64),
      severity: v.severity,
      message: redact(v.message).slice(0, 200),
    }));
    this.findings.push({
      seq: this.findingSeq,
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
    if (this.findings.length > PENDING_FINDINGS_CAP) {
      this.findings.splice(0, this.findings.length - PENDING_FINDINGS_CAP);
    }
  }

  // ── Drain, restore, install ──────────────────────────────────────────────

  /**
   * Drain every pending queue into a sync request body. The caller owns the
   * result: on a failed push it hands the body back to {@link restore} so
   * nothing is lost, on a successful one the returned overlay supersedes it.
   */
  take(): SharedOpsSyncBody {
    const byKey = new Map<string, SharedLatencySampleWire[]>();
    for (const { key, ts, ms, ok } of this.samples) {
      const bucket = byKey.get(key) ?? [];
      bucket.push({ ts, ms, ok });
      byKey.set(key, bucket);
    }
    const body: SharedOpsSyncBody = {
      schema_version: 1,
      instance: instanceId,
      latency: [...byKey.entries()].map(([key, samples]) => ({ key, samples })),
      quota: [...this.quota.entries()].map(([key, spent]) => {
        const [provider, window] = key.split("|");
        return { provider, window, spent };
      }),
      quota_reset: this.quotaResets.slice(),
      outages_set: this.outageSet.map((o) => ({
        provider: o.provider,
        expires_at: o.expiresAt,
        note: o.note,
      })),
      outages_cleared: this.outageCleared.slice(),
      findings: this.findings.slice(),
    };
    this.clearPending();
    return body;
  }

  /**
   * Put a drained body back after a failed push.
   *
   * Anything the instance did *after* the drain wins over what is being
   * restored: a provider the operator has since re-outaged must not be
   * re-queued as cleared, and vice versa.
   */
  restore(body: SharedOpsSyncBody): void {
    const restored = body.latency.flatMap(({ key, samples }) =>
      samples.map((s) => ({ key, ...s })),
    );
    this.samples = [...restored, ...this.samples].slice(-PENDING_SAMPLE_CAP);
    for (const { provider, window, spent } of body.quota) {
      const key = `${provider}|${window}`;
      // A reset queued since the drain supersedes the older spend.
      if (this.quotaResets.some((r) => r.provider === provider && r.window === window)) continue;
      this.quota.set(key, (this.quota.get(key) ?? 0) + spent);
    }
    for (const reset of body.quota_reset) {
      if (!this.quotaResets.some((r) => r.provider === reset.provider && r.window === reset.window)) {
        this.quotaResets.push(reset);
      }
    }
    const clearedAll = this.outageCleared.includes("*");
    for (const o of body.outages_set) {
      if (clearedAll || this.outageCleared.includes(o.provider)) continue;
      if (this.outageSet.some((p) => p.provider === o.provider)) continue;
      this.outageSet.push({ provider: o.provider, expiresAt: o.expires_at, note: o.note });
    }
    for (const provider of body.outages_cleared) {
      if (provider !== "*" && this.outageSet.some((p) => p.provider === provider)) continue;
      if (!this.outageCleared.includes(provider)) this.outageCleared.push(provider);
    }
    // Findings are keyed by seq, so a restore cannot duplicate one already queued.
    const queued = new Set(this.findings.map((f) => f.seq));
    const restoredFindings = body.findings.filter((f) => !queued.has(f.seq));
    this.findings = [...restoredFindings, ...this.findings].slice(-PENDING_FINDINGS_CAP);
  }

  /** Install the gateway's merged view as the read overlay. */
  applyShared(view: SharedOpsViewWire, drainedAtMs: number, now: number): void {
    const observedAtMs = Date.parse(view.observed_at);
    this.overlay = {
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

  // ── Resets ───────────────────────────────────────────────────────────────

  /**
   * Forget what this instance can see of the latency pool.
   *
   * Its unpushed queue and its copy of the merged view — never the gateway's
   * record, which keeps other instances' history and the next sync re-reads.
   * Erasing the shared record from here would let one instance rewrite the
   * fleet's.
   */
  clearLatency(): void {
    this.samples = [];
    this.overlay?.latency.clear();
  }

  /** Forget the overlay and every pending delta. */
  reset(): void {
    this.overlay = null;
    this.clearPending();
    this.findingSeq = 0;
  }

  private clearPending(): void {
    this.samples = [];
    this.quota.clear();
    this.quotaResets = [];
    this.outageSet = [];
    this.outageCleared = [];
    this.findings = [];
  }
}

/**
 * The one ledger. Created once and never reassigned — see the class comment on
 * why replacing a singleton three modules hold is the hazard, not the fix.
 */
export const opsLedger = new OpsLedger();
