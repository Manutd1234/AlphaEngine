/**
 * The part that makes seven flaky upstreams behave like one dependable one.
 * =========================================================================
 *
 * Writing seven `fetch` wrappers is an afternoon. Making them safe to put in
 * front of a trading desk is this layer, and it is four mechanisms:
 *
 *   1. **Quota ledger.**   Alpha Vantage's free plan is 25 calls *per day* and
 *      Firecrawl's is 1,000 credits *per month*. Nothing about a naive
 *      integration warns you before you spend a day's allowance on a dashboard
 *      that auto-refreshes. Calls are counted before they are made, and
 *      background polling is fenced out of a reserve so a human lookup still
 *      works at 4pm.                                            → `quota.ts`
 *
 *   2. **Circuit breaker.** A dead provider that times out costs every request
 *      its full timeout. After N consecutive failures the provider is skipped
 *      outright until a probe succeeds, so one broken vendor cannot add 8s to
 *      the latency of a route that has three working alternatives.
 *                                             → `breaker.ts`, `licence.ts`
 *
 *   3. **Cache.**          A quota defence first and a latency optimisation
 *      second. TTL is per capability, because a fundamentals record is good for
 *      a day and a quote is good for seconds.        → `store.ts`, `dispatch.ts`
 *
 *   4. **Failover with provenance.** Try providers in ranked order; return the
 *      first success *along with the list of everything skipped and why*. A
 *      failover the user cannot see is a failover they will trust wrongly.
 *                                → `dispatch.ts`, `contract-gate.ts`
 *
 * ── An honest limitation ────────────────────────────────────────────────────
 * On Vercel this state lives in module scope, which is per *function instance*.
 * Two concurrent instances keep two ledgers, so the quota count is a floor, not
 * an exact figure, and the breaker opens per instance. That is the correct
 * trade for a case study — no external dependency to stand up — but it is a real
 * limitation and it is stated rather than hidden. `Store` is an interface with
 * one in-memory implementation precisely so that swapping in Vercel KV or Redis
 * is a single new class and no changes anywhere else.
 *
 * ── This file is a façade, and the split is load-bearing ────────────────────
 * The mechanisms above now live one per file; this re-exports them so the
 * dozen call sites across `lib/`, `app/` and the tests keep one import path.
 * Two of those files hold an invariant that is invisible from here and silent
 * when broken, so they are named rather than left to be discovered:
 *
 *   • `http-json.ts` is the ONLY place a RAW vendor body exists. The raw
 *     contract check runs inside it. Moved out, it would check the normalised
 *     object instead and report green against a shape no vendor ever sent.
 *   • `breaker.ts` emits `fields.state` as the literals `"open"` and
 *     `"closed"`, which `lib/remediation.ts` filters on to build the
 *     remediation ring. A mismatch renders a full ring as empty.
 */

// Side-effecting import: installs the AsyncLocalStorage-backed capture resolver
// that `recordUpstream` consults. `http-json.ts` imports it too, where it is
// actually used; it is repeated here so that importing this façade for `store`
// alone still installs the resolver, exactly as it did before the split. A
// re-export a bundler decides is unused is not a guarantee.
import "./trace";

export { MemoryStore, store, type Store } from "./store";

export {
  hydrateQuotaLedger,
  type QuotaState,
  quotaBlock,
  quotaState,
  resetQuota,
  spendQuota,
  windowKey,
} from "./quota";

export {
  BREAKER_COOLDOWN_MS,
  BREAKER_THRESHOLD,
  breakerOpen,
  type BreakerSnapshot,
  breakerSnapshot,
  recordFailure,
  recordSuccess,
  resetBreaker,
} from "./breaker";

export {
  clearLicence,
  LICENCE_TTL_MS,
  type LicenceBlock,
  licenceBlock,
  licenceBlocks,
  markUnlicensed,
} from "./licence";

export { httpJson } from "./http-json";

export { type DispatchOptions, dispatch, isConfigured, TTL_MS } from "./dispatch";

export { DEFAULT_BASE_URL } from "./base-urls";  // callers import it from here
