/**
 * The name of a route, in words.
 *
 * A route is a capability on an asset class — the failover graph draws nine
 * of them. They were labelled `quote · crypto`, which is a key, not a name:
 * two lower-case tokens and a separator a reader has to decode. "Crypto
 * quotes" is what the chip means. `search` and `scrape` take a query or a URL,
 * not a symbol, so their placeholder asset is dropped: "Web search".
 *
 * Client-safe: imports only types. Used by the failover graph, the supply
 * posture rows, the inspect route's lineage and every aria-label that names a
 * route, so the wording lives in one place.
 */

import type { AssetClass, Capability } from "./types";

const CAPABILITY_NOUN: Record<Capability, string> = {
  quote: "quotes",
  bars: "bars",
  news: "news",
  fundamentals: "fundamentals",
  search: "web search",
  scrape: "web scrape",
};

const ASSET_ADJECTIVE: Record<AssetClass, string> = {
  crypto: "crypto",
  equity: "equity",
  fx: "FX",
};

/** Symbol-less capabilities have no asset to name. */
const SYMBOL_LESS = new Set<Capability>(["search", "scrape"]);

/** Lower-case, for the middle of a sentence: "crypto quotes", "web search". */
export function routeNoun(capability: Capability | string, asset: AssetClass | string): string {
  const noun = CAPABILITY_NOUN[capability as Capability] ?? capability;
  if (SYMBOL_LESS.has(capability as Capability)) return noun;
  const adjective = ASSET_ADJECTIVE[asset as AssetClass] ?? asset;
  return `${adjective} ${noun}`;
}

/** Sentence case, for a chip or a row label: "Crypto quotes", "Web search". */
export function routeLabel(capability: Capability | string, asset: AssetClass | string): string {
  const noun = routeNoun(capability, asset);
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}
