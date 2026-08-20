/**
 * The adapter roster, and how a capability/asset pair is ranked into a chain.
 *
 * Split out of `registry.ts` when that file passed 630 lines. It sits at the
 * bottom of the provider layer on purpose: `./facades`, `./consensus` and
 * `./status` all need the roster, and putting it here is what stops the three
 * of them importing each other in a circle to reach it.
 *
 * Nothing in this module decides whether a vendor is CALLED — that is
 * `isConfigured` in `./dispatch`, and the failover graph in `./status` copies
 * dispatch's check order rather than restating it.
 */

import { alphavantage } from "./alphavantage";
import { binance } from "./binance";
import { bybit } from "./bybit";
import { firecrawl } from "./firecrawl";
import { fmp } from "./fmp";
import { massive } from "./massive";
import { openbb } from "./openbb";
import { Store } from "./runtime";
import { tiingo } from "./tiingo";
import { Adapter, AssetClass, Capability, Priority } from "./types";

export const ADAPTERS: Adapter[] = [
  bybit,
  binance,
  fmp,
  tiingo,
  massive,
  alphavantage,
  firecrawl,
  openbb,
];

export const BY_ID = new Map(ADAPTERS.map((a) => [a.meta.id, a]));

// --------------------------------------------------------------------------
// Candidate selection
// --------------------------------------------------------------------------

export function candidatesFor(capability: Capability, asset: AssetClass): Adapter[] {
  return ADAPTERS.filter(
    (a) => a.meta.capabilities.includes(capability)
      && (a.meta.capabilityAssets?.[capability] ?? a.meta.assets).includes(asset),
  ).sort((a, b) => (a.meta.rank[capability] ?? 99) - (b.meta.rank[capability] ?? 99));
}

export interface Options {
  priority?: Priority;
  provider?: string | null;
  env?: NodeJS.ProcessEnv;
  store?: Store;
}
