/**
 * Operator actions — the console's only write path.
 * =================================================
 *
 * Everything else in the systems surface reads. This file is the part that
 * *changes* the running instance: purge a cache, close a breaker, knock a
 * provider out to watch failover happen, re-probe a service, reset a counter.
 *
 * Three rules shape it.
 *
 * **1. Reject, do not coerce.** An unrecognised field is a 400 and nothing is
 * touched. The grammar and its validator are in `./operator-actions`, which
 * holds the full argument.
 *
 * **2. Closed by default in production.** Every action costs something real, so
 * the route is disabled unless `ALPHAENGINE_OPERATOR_TOKEN` is set. The guard
 * is in `./operator-guard`, which holds the full argument.
 *
 * **3. Nothing here is permanent.** Simulated outages expire. Purged caches
 * refill. There is no action that can leave the deployment worse off after the
 * operator closes the tab, which is the property that makes it safe to hand a
 * "break the data plane" button to someone evaluating the system. That rule is
 * about the executor below, which is why the executor stayed in this file.
 *
 * The logic lives here rather than in the route so it can be tested the way the
 * rest of this codebase is tested: with an injected `MemoryStore` and an
 * explicit `env`, never over HTTP.
 *
 * The guard and the grammar were lifted into siblings when this file passed 610
 * lines, and are re-exported below name by name — sixteen modules import
 * `@/lib/operator` and none of them changed. `export *` would have swept them up
 * in one line and made a later rename in a sibling silent here, which is the
 * opposite of what a write path wants.
 */

import {
  activeOutages,
  clearAllOutages,
  clearOutage,
  emit,
  OUTAGE_MAX_MS,
  resetTelemetry,
  simulateOutage,
} from "./observability";
import { CACHE_PREFIXES, type OperatorAction, type OperatorActionName } from "./operator-actions";
import { resetOpenBBHealthCache } from "./providers/openbb-health";
import { BY_ID, cacheKeys, getQuote, searchWeb } from "./providers/registry";
import { registerEnvSecrets } from "./providers/trace";
import { clearLicence, resetBreaker, resetQuota, store, Store } from "./providers/runtime";
import type { Capability } from "./providers/types";

export {
  authorise,
  authorisePaperOrder,
  guardMode,
  OPERATOR_OPEN_ENV,
  OPERATOR_TOKEN_ENV,
  operatorIdentity,
  PAPER_ORDER_DEFAULT_ENV,
  paperOrderDefaultAvailable,
  tokenOverrideAvailable,
} from "./operator-guard";
export type { GuardMode, GuardRejection } from "./operator-guard";

export { CACHE_PREFIXES, OPERATOR_ACTIONS, parseAction } from "./operator-actions";
export type { OperatorAction, OperatorActionName, ParseResult } from "./operator-actions";

// --------------------------------------------------------------------------
// Execution
// --------------------------------------------------------------------------

export interface ActionResult {
  action: OperatorActionName;
  /** One line an operator can read without expanding anything. */
  summary: string;
  /** What the caller should understand about the *limits* of what just happened. */
  caveat?: string;
  data?: Record<string, unknown>;
}

export interface ActionContext {
  env?: NodeJS.ProcessEnv;
  store?: Store;
}

/** Keys a purge would remove, given a scope. Exported so the UI can preview a count. */
export function cacheKeysInScope(scope: string, s: Store = store): string[] {
  const live = s.keys();
  const symbolMatch = /^symbol:(.+)$/.exec(scope);
  return live.filter((key) => {
    const [namespace, subject] = key.split(":");
    if (!(CACHE_PREFIXES as string[]).includes(namespace)) return false;
    if (scope === "all") return true;
    if (!symbolMatch) return namespace === scope;
    // News keys hold a comma-joined symbol list; quote/bars/fundamentals hold
    // one symbol. Splitting on comma covers both without a per-capability branch.
    return (subject ?? "").split(",").includes(symbolMatch[1]);
  });
}

export async function applyAction(
  action: OperatorAction,
  ctx: ActionContext = {},
): Promise<ActionResult> {
  const s = ctx.store ?? store;
  const env = ctx.env ?? process.env;

  switch (action.action) {
    case "purge_cache": {
      const scope = action.scope ?? "all";
      const doomed = cacheKeysInScope(scope, s);
      for (const key of doomed) s.del(key);
      log(action, `purged ${doomed.length} cache entries (${scope})`);
      return {
        action: action.action,
        summary: `Purged ${doomed.length} cached ${doomed.length === 1 ? "entry" : "entries"} (scope: ${scope}).`,
        caveat: doomed.length
          ? "The next request for each key goes upstream and spends real quota."
          : "Nothing matched — the cache was already cold for that scope.",
        data: { scope, purged: doomed.length, keys: doomed.slice(0, 40) },
      };
    }

    case "reset_breaker": {
      const targets = action.provider === "all" ? [...BY_ID.keys()] : [action.provider!];
      const reopened = targets.filter((id) => resetBreaker(id, s));
      // Learned licence blocks are capability-scoped breakers; "Close circuit"
      // is their retry affordance too, so the next request re-probes a
      // capability that answered 401/403.
      const forgotten = targets.reduce((n, id) => n + clearLicence(id, s), 0);
      log(action, `reset breakers: ${reopened.join(", ") || "none were open"}; forgot ${forgotten} licence blocks`);
      const circuits = reopened.length
        ? `Closed ${reopened.length} open ${reopened.length === 1 ? "circuit" : "circuits"}: ${reopened.join(", ")}.`
        : "No circuit was open — nothing to reset.";
      const licences = forgotten
        ? ` Forgot ${forgotten} learned licence ${forgotten === 1 ? "block" : "blocks"}.`
        : "";
      return {
        action: action.action,
        summary: circuits + licences,
        caveat: reopened.length || forgotten
          ? [
              reopened.length ? "If the provider is still failing, three more consecutive failures reopen it." : null,
              forgotten ? "The next request re-probes any capability that answered 401 or 403." : null,
            ].filter(Boolean).join(" ")
          : undefined,
        data: { reset: reopened, licencesForgotten: forgotten },
      };
    }

    case "simulate_outage": {
      const record = simulateOutage(action.provider!, action.ttlMs ?? OUTAGE_MAX_MS);
      const seconds = Math.round((record.expiresAt - Date.now()) / 1000);
      log(action, `simulated outage on ${action.provider} for ${seconds}s`);
      return {
        action: action.action,
        summary: `${action.provider} is held out of routing for ${seconds}s.`,
        caveat:
          "Requests now fail over to the next-ranked provider and report reason `simulated_outage` — on every instance, once each syncs the shared ledger. It restores itself — no cleanup required.",
        data: { provider: action.provider, expiresAt: record.expiresAt },
      };
    }

    case "clear_outage": {
      const cleared = action.provider === "all"
        ? clearAllOutages()
        : (clearOutage(action.provider!) ? 1 : 0);
      log(action, `cleared ${cleared} simulated outage(s)`);
      return {
        action: action.action,
        summary: cleared
          ? `Restored ${cleared} ${cleared === 1 ? "provider" : "providers"} to routing.`
          : "No simulated outage was active.",
        data: { cleared, remaining: activeOutages().map((o) => o.provider) },
      };
    }

    case "reset_quota": {
      const adapter = BY_ID.get(action.provider!)!;
      if (!adapter.meta.quota) {
        return {
          action: action.action,
          summary: `${action.provider} has no quota ledger — nothing to reset.`,
          caveat: "This provider is either keyless or metered by weight rather than by call count.",
        };
      }
      const cleared = resetQuota(adapter, s);
      log(action, `reset ${action.provider} quota ledger (was ${cleared})`);
      return {
        action: action.action,
        summary: `Cleared ${action.provider}'s local counter (was ${cleared}/${adapter.meta.quota.calls} this ${adapter.meta.quota.window}).`,
        // The single most important sentence in this file.
        caveat:
          "This resets OUR ledger (the deployment-shared counter, via the gateway), not the vendor's meter. The provider still believes it has served those calls, and further requests may be rejected upstream or billed.",
        data: { provider: action.provider, cleared },
      };
    }

    case "probe_provider":
      return probeProvider(action.provider!, { env, store: s });

    case "reload_providers": {
      const registered = registerEnvSecrets(env);
      resetOpenBBHealthCache();
      log(action, "re-evaluated provider configuration");
      return {
        action: action.action,
        summary: "Re-read provider configuration from the process environment and dropped the cached OpenBB verdict.",
        // Said plainly because the obvious reading of "hot reload" is wrong.
        caveat:
          "Next.js loads .env files once at boot: this re-evaluates the environment the process already has, it does not import new values from disk. A changed .env still needs a restart or a redeploy.",
        data: { secretsRegistered: registered },
      };
    }

    case "clear_telemetry": {
      resetTelemetry({ events: true, latency: true, cache: true });
      // Emitted after the clear so the log is never empty — the first line an
      // operator sees explains why everything above it disappeared.
      log(action, "telemetry buffers cleared");
      return {
        action: action.action,
        summary: "Cleared this instance's event ring, latency buffers and cache counters.",
        caveat:
          "Simulated outages and circuit-breaker state are untouched — those are behaviour, not observation. The gateway-merged ledger keeps other instances' samples, so pooled numbers return on the next sync.",
      };
    }
  }
}

function log(action: OperatorAction, message: string): void {
  emit({
    level: "warn",
    source: "Operator",
    message,
    fields: {
      action: action.action,
      provider: action.provider ?? null,
      scope: action.scope ?? null,
    },
  });
}

/**
 * Ask a provider for one real answer and time it.
 *
 * The cache entry is deleted first, on purpose. A probe that a cached value can
 * satisfy tests nothing — it would report a dead vendor as healthy for as long
 * as the TTL, which is exactly the window in which someone is standing there
 * asking whether it is dead.
 */
async function probeProvider(
  providerId: string,
  ctx: { env: NodeJS.ProcessEnv; store: Store },
): Promise<ActionResult> {
  const adapter = BY_ID.get(providerId)!;
  const capabilities = adapter.meta.capabilities;
  const startedAt = Date.now();

  const run = async (): Promise<{ capability: Capability; detail: string }> => {
    if (capabilities.includes("quote")) {
      // Pick a symbol whose asset class actually reaches this adapter: a crypto
      // symbol against an equity-only provider would be filtered out of the
      // candidate pool and "probe" would silently measure nothing.
      const symbol = adapter.meta.assets.includes("equity") ? "AAPL" : "BTCUSDT";
      ctx.store.del(cacheKeys.quote(symbol, providerId));
      const result = await getQuote(symbol, { provider: providerId, priority: "interactive", ...ctx });
      return { capability: "quote", detail: `${symbol} @ ${result.data.price} ${result.data.currency}` };
    }
    if (capabilities.includes("search")) {
      const query = "AlphaEngine provider health probe";
      ctx.store.del(cacheKeys.search(query, 1));
      const result = await searchWeb(query, 1, { provider: providerId, priority: "interactive", ...ctx });
      return { capability: "search", detail: `${result.data.length} document(s) returned` };
    }
    throw new Error(`${providerId} exposes no probeable capability`);
  };

  try {
    const { capability, detail } = await run();
    const ms = Date.now() - startedAt;
    emit({
      level: "info",
      source: "Operator",
      message: `probe ${providerId} ok in ${ms}ms`,
      fields: { provider: providerId, capability, ms },
    });
    return {
      action: "probe_provider",
      summary: `${providerId} answered a live ${capability} in ${ms}ms — ${detail}.`,
      // Precise rather than reassuring. Our own cache is bypassed, but Binance's
      // keyless endpoints additionally sit behind Next's fetch cache, so a
      // sub-5s repeat can be answered without leaving the process — and a 1ms
      // "probe" presented as proof the vendor is up would be exactly the kind of
      // false confidence this console exists to remove.
      caveat:
        "A real registry request with this provider pinned and our cache bypassed; it spent one unit of the provider's allowance. Binance's public endpoints also sit behind Next's 5s fetch cache, so a repeat inside that window may not have left the process.",
      data: { provider: providerId, capability, ms, ok: true },
    };
  } catch (err) {
    const ms = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    // A probe can fail two very different ways, and reporting them identically
    // is a lie in the more common one. If the single pinned candidate was
    // *skipped* — circuit open, quota spent, key missing — then no request was
    // sent, nothing was spent, and nothing counted toward the breaker. Saying
    // "counts toward the circuit breaker exactly as a real request would" there
    // would have an operator chasing a provider that was never contacted.
    const attempts = (err as { attempts?: { provider: string; reason: string; detail?: string }[] }).attempts ?? [];
    // Reasons that mean the request WAS sent and the vendor answered — a 404,
    // a licence refusal, a 429 — are not skips: quota was spent, so the probe
    // must report them as a real answer, not as "not contacted".
    const sent = new Set(["failed", "no_data", "unlicensed", "rate_limited"]);
    const skipped = attempts.find((a) => a.provider === providerId && !sent.has(a.reason));
    emit({
      level: "error",
      source: "Operator",
      message: skipped
        ? `probe ${providerId} not sent — ${skipped.reason}`
        : `probe ${providerId} failed after ${ms}ms`,
      fields: { provider: providerId, ms, reason: skipped?.reason ?? "failed", error: message.slice(0, 160) },
    });
    if (skipped) {
      return {
        action: "probe_provider",
        summary: `${providerId} was not contacted — the registry skipped it (${skipped.reason}).`,
        caveat:
          "No request left this process, so nothing was spent and nothing counted toward the circuit breaker. Clear the condition above and probe again.",
        data: { provider: providerId, ms, ok: false, sent: false, reason: skipped.reason, detail: skipped.detail },
      };
    }
    return {
      action: "probe_provider",
      summary: `${providerId} did not answer (${ms}ms).`,
      caveat: "A failed probe counts toward the circuit breaker exactly as a real request would.",
      // `dispatch` already redacts provider messages before they reach here.
      data: { provider: providerId, ms, ok: false, sent: true, error: message.slice(0, 300) },
    };
  }
}
