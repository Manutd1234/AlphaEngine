/**
 * Failover with provenance: try candidates in order, and say what was skipped.
 * ============================================================================
 *
 * `candidates` arrives pre-ranked and pre-filtered for asset class by the
 * registry. Everything this file adds is the reliability policy — cache,
 * breaker, licence, quota — and the record of what it refused to ask and why.
 * A failover the user cannot see is a failover they will trust wrongly, so the
 * skipped list travels with every answer rather than being logged and dropped.
 *
 * The cache is a quota defence first and a latency optimisation second; TTL is
 * per capability, because a fundamentals record is good for a day and a quote
 * is good for seconds.
 */

import {
  emit,
  outageFor,
  recordCacheLookup,
  recordLatency,
  redact,
} from "../observability";
import { DEFAULT_BASE_URL } from "./base-urls";
import { breakerOpen, recordFailure, recordSuccess } from "./breaker";
import type { ContractResult } from "./contracts";
import {
  evaluateContract,
  recordContractFinding,
  reportContractViolations,
} from "./contract-gate";
import { httpJson } from "./http-json";
import { describeLicenceSkip, licenceBlock, markUnlicensed } from "./licence";
import { emitQuotaThreshold, quotaBlock, quotaState, spendQuota } from "./quota";
import { withRawChecks } from "./raw-sink";
import { store, type Store } from "./store";
import {
  Adapter,
  Attempt,
  Capability,
  FetchCtx,
  Priority,
  ProviderError,
  type ProviderErrorKind,
  Provenance,
  Sourced,
} from "./types";

/** Cache lifetimes, chosen by how fast the underlying fact changes. */
export const TTL_MS: Record<Capability, number> = {
  quote: 15_000,
  bars: 300_000,
  news: 180_000,
  fundamentals: 86_400_000,
  search: 900_000,
  scrape: 3_600_000,
};

export function isConfigured(adapter: Adapter, env: NodeJS.ProcessEnv = process.env): boolean {
  // An empty `keyEnv` declares a keyless public API (Binance). Without this the
  // whole registry would be unusable on a fresh clone with no secrets set, and
  // "works after you obtain seven API keys" is not a working system.
  if (!adapter.meta.keyEnv) return true;
  return Boolean(env[adapter.meta.keyEnv]?.trim());
}

function ctxFor(adapter: Adapter, env: NodeJS.ProcessEnv): FetchCtx {
  const { id, keyEnv, baseUrlEnv } = adapter.meta;
  return {
    key: env[keyEnv]?.trim() ?? "",
    baseUrl: (baseUrlEnv ? env[baseUrlEnv]?.trim() : "") || DEFAULT_BASE_URL[id] || "",
    json: (url, init) => httpJson(id, url, init),
  };
}

export interface DispatchOptions<T = unknown> {
  capability: Capability;
  cacheKey: string;
  priority?: Priority;
  /** Explicit provider id, e.g. `?provider=tiingo`. Skips ranked selection. */
  pin?: string | null;
  env?: NodeJS.ProcessEnv;
  store?: Store;
  /** The instrument the request was about, for the ledger's finding rows. */
  symbol?: string | null;
  /**
   * Expectations the normalised payload must meet before it is believed.
   *
   * Supplied by the capability façade, which is the only layer that knows the
   * shape. A `fatal` violation is treated exactly like a thrown error — the
   * provider is failed and the chain moves on — because a payload that is
   * internally impossible is not a better answer than no answer. Warnings and
   * drift travel with the provenance instead, so a stale-but-usable price is
   * shown *and* labelled rather than silently dropped.
   */
  contract?: (data: T, provider: string) => ContractResult;
}

/**
 * Try candidates in order; return the first success with full provenance.
 *
 * `candidates` arrives pre-ranked and pre-filtered for asset class by the
 * registry. Everything this function adds is the reliability policy: cache,
 * breaker, quota, and the record of what it skipped.
 */
export async function dispatch<T>(
  candidates: Adapter[],
  run: (adapter: Adapter, ctx: FetchCtx) => Promise<T>,
  opts: DispatchOptions<T>,
): Promise<Sourced<T>> {
  const env = opts.env ?? process.env;
  const s = opts.store ?? store;
  const priority = opts.priority ?? "interactive";
  const attempts: Attempt[] = [];

  const cached = s.get<Sourced<T>>(opts.cacheKey);
  // A pin is an operator instruction, not a ranking hint.  Never satisfy it
  // with a response another provider placed in a shared/wildcard cache key.
  const cacheMatchesPin = Boolean(
    cached && (!opts.pin || cached.provenance.provider === opts.pin),
  );
  recordCacheLookup(opts.capability, cacheMatchesPin);
  if (cached && cacheMatchesPin) {
    emit({
      level: "debug",
      source: "Cache",
      message: `hit ${opts.cacheKey} (served by ${cached.provenance.provider})`,
      fields: {
        capability: opts.capability,
        key: opts.cacheKey,
        provider: cached.provenance.provider,
        ttlRemainingMs: s.ttl(opts.cacheKey),
      },
    });
    return { ...cached, provenance: { ...cached.provenance, cached: true } };
  }

  const pool = opts.pin ? candidates.filter((a) => a.meta.id === opts.pin) : candidates;

  for (const adapter of pool) {
    const { id } = adapter.meta;

    // Operator-simulated outages are checked first so the reason shown is the
    // one the operator caused. A provider knocked out on purpose reporting
    // "quota spent" would send someone reading the failover graph after a
    // problem that does not exist.
    const outage = outageFor(id);
    if (outage) {
      attempts.push({
        provider: id,
        reason: "simulated_outage",
        detail: `${outage.note}; restores in ${Math.ceil((outage.expiresAt - Date.now()) / 1000)}s`,
      });
      continue;
    }
    if (!isConfigured(adapter, env)) {
      attempts.push({ provider: id, reason: "not_configured", detail: adapter.meta.keyEnv });
      continue;
    }
    if (breakerOpen(id, s)) {
      attempts.push({ provider: id, reason: "circuit_open", detail: "recent consecutive failures" });
      continue;
    }
    // A capability-scoped breaker sits after the provider-scoped one and before
    // the quota checks: there is no point reporting reserve arithmetic for a
    // call the vendor would refuse. Applies to a pinned dispatch too, like the
    // breaker; the operator clears it with the same "Close circuit".
    const licence = licenceBlock(id, opts.capability, s);
    if (licence) {
      attempts.push({ provider: id, reason: "unlicensed", detail: describeLicenceSkip(licence) });
      continue;
    }
    const blocked = quotaBlock(adapter, priority, s);
    if (blocked) {
      const st = quotaState(adapter, s)!;
      attempts.push({
        provider: id,
        reason: blocked,
        detail: `${st.used}/${st.limit} used this ${st.window}`,
      });
      continue;
    }

    const startedAt = Date.now();
    // Counted before the call, not after: a request that times out still hit the
    // vendor's meter. Counting on success only under-counts exactly when we are
    // failing most, which is when the count matters.
    spendQuota(adapter, s);
    emitQuotaThreshold(adapter, s);

    try {
      const raw = await withRawChecks(opts.capability, () => run(adapter, ctxFor(adapter, env)));
      const data = raw.result;
      const latencyMs = Date.now() - startedAt;

      // Expectations run after normalisation and before anything is recorded,
      // cached or returned. Order matters: `recordSuccess` *deletes* the
      // breaker's failure count, so evaluating the contract afterwards would
      // clear the counter on every broken response and the breaker could never
      // reach its threshold — a vendor emitting duplicated bar timestamps would
      // be retried forever, burning quota, while the health matrix showed a 0%
      // error rate. That ordering is why these four calls stay here, inline and
      // visible, rather than folding into one helper: `contract-gate.ts` owns
      // what each step does, this loop owns when.
      const contract: ContractResult | undefined =
        evaluateContract(opts.contract, data, id, opts.capability, raw);
      if (contract) {
        recordContractFinding(contract, {
          capability: opts.capability,
          provider: id,
          symbol: opts.symbol ?? null,
          cacheKey: opts.cacheKey,
        });
      }
      const contractFailed = Boolean(contract && !contract.passed);

      // One sample per *dispatch*, not per HTTP hop, so the health matrix's p50
      // answers "what did the registry pay for an answer from this provider".
      // A contract failure counts as a failed sample: an answer that cannot be
      // used is not a success however fast it arrived.
      recordLatency(id, latencyMs, !contractFailed);
      if (!contractFailed) recordSuccess(id, s);

      // The RAW body reaches the quarantine, not `data` — see contract-gate.ts.
      if (contract && contract.violations.length) {
        reportContractViolations(contract, opts.cacheKey, raw, data);
      }

      if (contractFailed) {
        // Failed like any other bad answer, so the breaker and the failover
        // chain treat a provider that returns broken data exactly as they
        // treat one that returns nothing.
        recordFailure(id, s);
        attempts.push({
          provider: id,
          reason: "failed",
          detail: `contract: ${(contract?.violations ?? []).filter((v) => v.severity === "fatal")
            .map((v) => v.check).join(", ")}`,
        });
        continue;
      }

      const q = quotaState(adapter, s);
      const provenance: Provenance = {
        provider: id,
        label: adapter.meta.label,
        fetchedAt: new Date().toISOString(),
        latencyMs,
        cached: false,
        delayed: DELAYED_TIERS.has(id),
        quotaRemaining: q?.remaining ?? null,
        quotaLimit: q?.limit ?? null,
        quotaWindow: q?.window ?? null,
        ...(contract
          ? { contract: {
              passed: contract.passed,
              violations: contract.violations,
              notEvaluated: contract.notEvaluated,
            } }
          : {}),
      };
      const out: Sourced<T> = { data, provenance, attempts };
      s.set(opts.cacheKey, out, TTL_MS[opts.capability]);
      emit({
        level: attempts.length ? "warn" : "info",
        source: "Dispatch",
        message: attempts.length
          ? `${opts.capability} served by ${id} in ${latencyMs}ms after ${attempts.length} skipped`
          : `${opts.capability} served by ${id} in ${latencyMs}ms`,
        fields: {
          capability: opts.capability,
          provider: id,
          ms: latencyMs,
          key: opts.cacheKey,
          skipped: attempts.map((a) => `${a.provider}:${a.reason}`).join(",") || null,
        },
      });
      return out;
    } catch (err) {
      const ms = Date.now() - startedAt;
      const kind: ProviderErrorKind = err instanceof ProviderError ? err.kind : "failed";
      // Redacted before it is stored, not before it is rendered. Alpha Vantage
      // and FMP carry the key in the query string, and both answer an auth
      // failure with an HTML page that echoes the request URL — which
      // `httpJson` then quotes into this message. Without this, a 401 puts a
      // live credential into the attempts list of a public API response.
      const detail = redact(err instanceof Error ? err.message : String(err)).slice(0, 200);

      // Not every thrown error is a provider failing. The taxonomy on
      // ProviderErrorKind decides what each one costs the vendor's record:
      //   failed      — breaker + error sample, as before
      //   no_data     — the vendor answered correctly that there is nothing
      //                 here; a healthy round trip that fails over. Recorded
      //                 as an OK sample (an answer was paid for and received),
      //                 never as a failure. Before this, four "no profile"
      //                 answers made four healthy vendors read as degraded.
      //   unlicensed  — a refusal, not an answer: no sample either way (ok:false
      //                 would make an unlicensed feature look like an outage,
      //                 ok:true would claim a success). Remembered so the
      //                 next dispatch skips without a call.
      //   quota       — a decline; no sample, no breaker.
      if (kind === "failed") {
        recordLatency(id, ms, false);
        recordFailure(id, s);
        attempts.push({ provider: id, reason: "failed", detail });
      } else if (kind === "no_data") {
        recordLatency(id, ms, true);
        attempts.push({ provider: id, reason: "no_data", detail });
      } else if (kind === "unlicensed") {
        markUnlicensed(id, opts.capability, err instanceof ProviderError ? err.status : null, detail, s);
        attempts.push({ provider: id, reason: "unlicensed", detail });
      } else {
        attempts.push({ provider: id, reason: "rate_limited", detail });
      }
    }
  }

  // When every provider that was actually asked answered "nothing here", the
  // request is a 404, not a 503: the pool is healthy and the symbol is the
  // problem. Any real failure, licence refusal or rate limit in the list keeps
  // the 503, because then a retry or a different key could change the answer.
  const asked = attempts.filter((a) => a.reason === "failed" || a.reason === "no_data"
    || a.reason === "unlicensed" || a.reason === "rate_limited");
  const onlyNoData = asked.length > 0 && asked.every((a) => a.reason === "no_data");
  const message = onlyNoData
    ? `no provider has ${opts.capability} data for this request`
    : `no provider could serve ${opts.capability}`;
  emit({
    level: onlyNoData ? "warn" : "error",
    source: "Dispatch",
    message,
    fields: {
      capability: opts.capability,
      key: opts.cacheKey,
      skipped: attempts.map((a) => `${a.provider}:${a.reason}`).join(",") || null,
    },
  });
  const err = new ProviderError("registry", message, onlyNoData ? 404 : 503, false);
  (err as ProviderError & { attempts: Attempt[] }).attempts = attempts;
  throw err;
}

/** Tiers we know serve delayed or end-of-day data, flagged on every response. */
const DELAYED_TIERS = new Set(["alphavantage", "massive"]);
