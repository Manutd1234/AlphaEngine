/**
 * The registry — one façade over seven vendors.
 * =============================================
 *
 * Routes call `getQuote("AAPL")`. They do not name a vendor, do not know which
 * one answered, and do not change when a key is added or a provider goes down.
 * Selection is by *capability and asset class*, in a ranked order, with the
 * reliability policy in `runtime.ts` applied to every attempt.
 *
 * `consensusQuote` is the piece that exists because this is a trading tool
 * rather than a data viewer. Given more than one configured price source it
 * queries all of them and reports the dispersion, because the failure mode that
 * actually costs money is not an outage — an outage is loud. It is one feed
 * quietly going stale while still returning HTTP 200 with a plausible price. A
 * single source cannot detect that about itself; two can.
 *
 * ── The shape of this file ──────────────────────────────────────────────────
 * It was 635 lines. It is now the public face and nothing else, over four
 * modules that stack rather than circle:
 *
 *   ./adapters   the roster, and ranking a capability/asset pair into a chain
 *   ./facades    getQuote and its five siblings, and the applicability gate
 *   ./consensus  the fan-out that catches a stale feed answering 200
 *   ./status     provider state, and the failover graph dispatch would walk
 *
 * Every name below is spelled out rather than swept up by `export *`. Nineteen
 * modules import this path; a rename in a sibling should be a compile error
 * here, not a name that silently stops existing at the path callers use.
 */

// --------------------------------------------------------------------------
// Symbol classification — lives in symbols.ts (adapters need it too, and the
// registry imports every adapter, so it must sit below both). Re-exported here
// because this module is the public face of the provider layer.
// --------------------------------------------------------------------------

export { classify, EQUITY_SYMBOL_RE, isValidSymbol, PAIR_SYMBOL_RE } from "./symbols";
export { applicableAssets, CAPABILITY_ASSETS, inapplicableReason, isApplicable, ROUTE_MATRIX } from "./capabilities";

export { ADAPTERS, BY_ID, candidatesFor } from "./adapters";
export type { Options } from "./adapters";

export {
  cacheKeys,
  getBars,
  getFundamentals,
  getNews,
  getQuote,
  scrapeUrl,
  searchWeb,
} from "./facades";

export { consensusQuote } from "./consensus";
export type { Consensus, ConsensusLeg } from "./consensus";

export {
  capabilityMatrix,
  failoverGraph,
  failoverRoute,
  providerStatus,
} from "./status";
export type {
  FailoverNode,
  FailoverRoute,
  ProviderStatus,
  ReadinessOverlay,
  RouteState,
} from "./status";
