/**
 * Which capabilities apply to which asset class — one table, consulted before
 * anything is spent.
 * ============================================================================
 *
 * Fundamentals describe an issuer. A crypto pair has no issuer, so asking four
 * providers for BTCUSDT's profile can only end one way: FMP and Alpha Vantage
 * answer "no profile", Massive 404s, OpenBB has nothing — and the desk has spent
 * a call at each, one of them from Alpha Vantage's twenty-five a day, to learn a
 * fact this table already knew. Worse, each of those honest "nothing here"
 * answers was recorded as a provider failure, so the health matrix showed four
 * healthy vendors as degraded because someone traced fundamentals on a coin.
 *
 * So the façades consult this table first and refuse a request the capability
 * cannot answer, before dispatch, with no provider contacted, no quota spent and
 * no breaker touched. `ROUTE_MATRIX` — the routes the failover graph draws — is
 * derived from the same table, so the diagram and the gate can never disagree.
 *
 * Client-safe: imports only types.
 */

import type { AssetClass, Capability } from "./types";

/**
 * Asset classes each symbol-keyed capability accepts. `search` and `scrape`
 * take a query or a URL, not a symbol, so they do not appear: applicability
 * is not a question they can be asked.
 *
 * `fx` stays applicable for quote, bars and news: `classify("EURUSD")` is
 * `"fx"` and `/api/quote?symbol=EURUSD` reaches Massive and Alpha Vantage
 * today. Gating fx out here would be a regression dressed as tidiness.
 */
export const CAPABILITY_ASSETS = {
  quote: ["equity", "crypto", "fx"],
  bars: ["equity", "crypto", "fx"],
  news: ["equity", "crypto", "fx"],
  fundamentals: ["equity"],
} as const satisfies Partial<Record<Capability, readonly AssetClass[]>>;

export type SymbolCapability = keyof typeof CAPABILITY_ASSETS;

export function isSymbolCapability(capability: Capability): capability is SymbolCapability {
  return capability in CAPABILITY_ASSETS;
}

/** The asset classes a capability answers for; empty for the symbol-less two. */
export function applicableAssets(capability: Capability): readonly AssetClass[] {
  return isSymbolCapability(capability) ? CAPABILITY_ASSETS[capability] : [];
}

/** True for `search`/`scrape` (nothing to gate) and for any listed pair. */
export function isApplicable(capability: Capability, asset: AssetClass): boolean {
  if (!isSymbolCapability(capability)) return true;
  return (CAPABILITY_ASSETS[capability] as readonly AssetClass[]).includes(asset);
}

const CAPABILITY_SUBJECT: Record<SymbolCapability, string> = {
  quote: "A quote",
  bars: "A bar series",
  news: "News",
  fundamentals: "Fundamentals",
};

const CAPABILITY_WHY: Record<SymbolCapability, string> = {
  quote: "is a price for a traded instrument",
  bars: "is a price history for a traded instrument",
  news: "is written about a traded instrument",
  fundamentals: "describe an issuer",
};

function assetWord(asset: AssetClass): string {
  return asset === "fx" ? "an FX pair" : asset;
}

function listAssets(assets: readonly AssetClass[]): string {
  const words = assets.map((a) => (a === "fx" ? "FX" : a));
  if (words.length <= 1) return words[0] ?? "nothing";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * One sentence for callouts and lineage, e.g.
 * "Fundamentals describe an issuer, so the capability is equity-only; BTCUSDT
 * is classified as crypto, so no provider is asked and nothing is spent."
 */
export function inapplicableReason(capability: Capability, symbol: string, asset: AssetClass): string {
  if (!isSymbolCapability(capability)) {
    return `${capability} takes no symbol, so applicability does not arise.`;
  }
  const assets = CAPABILITY_ASSETS[capability];
  const scope = assets.length === 1 ? `${assets[0]}-only` : `for ${listAssets(assets)} only`;
  return `${CAPABILITY_SUBJECT[capability]} ${CAPABILITY_WHY[capability]}, so the capability is ${scope}; `
    + `${symbol} is classified as ${assetWord(asset)}, so no provider is asked and nothing is spent.`;
}

/**
 * The asset classes the desk actually routes on. fx pairs are accepted by the
 * façades but no route is drawn for them — the desk has no fx instrument.
 */
export const DESK_ASSETS: readonly AssetClass[] = ["crypto", "equity"];

const CAPABILITY_ORDER: readonly Capability[] = ["quote", "bars", "news", "fundamentals", "search", "scrape"];

/**
 * The asset classes each capability is actually asked for — the routes the
 * failover graph draws.
 *
 * Not the cross product. Derived from `CAPABILITY_ASSETS` so a routing diagram
 * can never show a route the gate refuses, nor hide one it admits. `search`
 * and `scrape` take no symbol; they are drawn once, under the equity pool
 * their façades dispatch with, because a chain must be drawn under something.
 */
export const ROUTE_MATRIX: { capability: Capability; assets: AssetClass[] }[] = CAPABILITY_ORDER.map(
  (capability) => ({
    capability,
    assets: isSymbolCapability(capability)
      ? DESK_ASSETS.filter((asset) => isApplicable(capability, asset))
      : ["equity"],
  }),
);
