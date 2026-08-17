/**
 * Symbol classification — its own module because both the registry (routing)
 * and individual adapters (endpoint choice, ticker spelling) need it, and the
 * registry imports every adapter, so anything an adapter needs must live below
 * both to avoid an import cycle.
 */

import { AssetClass } from "./types";

const CRYPTO_QUOTES = ["USDT", "USDC", "BUSD", "USD", "BTC", "ETH"];
const CRYPTO_BASES = new Set([
  "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "MATIC", "POL",
  "DOT", "LINK", "LTC", "TRX", "ATOM", "ARB", "OP", "SUI", "APT", "NEAR",
]);

/**
 * Guess the asset class from the ticker.
 *
 * Deliberately conservative in one direction: `BTCUSDT` is unambiguous, but a
 * bare `BTC` on an equity venue is a real NYSE listing (Bitcoin Depot), so a
 * base symbol only counts as crypto when it carries a recognised quote asset.
 * Getting this wrong routes an equity lookup to Binance and returns "unknown
 * symbol" for a ticker that trades — a confusing failure for a user who typed
 * a valid ticker.
 */
export function classify(symbol: string): AssetClass {
  const s = symbol.toUpperCase();
  for (const q of CRYPTO_QUOTES) {
    if (s.length > q.length && s.endsWith(q) && CRYPTO_BASES.has(s.slice(0, -q.length))) {
      return "crypto";
    }
  }
  if (/^[A-Z]{3}\/?[A-Z]{3}$/.test(s) && !CRYPTO_BASES.has(s.slice(0, 3))) return "fx";
  return "equity";
}

/** Equity tickers are 1–5 letters with an optional class suffix (`BRK.B`). */
export const EQUITY_SYMBOL_RE = /^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$/;
/** Crypto pairs as the rest of the app writes them. */
export const PAIR_SYMBOL_RE = /^[A-Z0-9]{5,20}$/;

export function isValidSymbol(symbol: string): boolean {
  const s = symbol.toUpperCase();
  return EQUITY_SYMBOL_RE.test(s) || PAIR_SYMBOL_RE.test(s);
}

/**
 * The base asset of a crypto pair — `BTCUSDT` → `BTC`, `SOLUSDC` → `SOL` — or
 * null for anything `classify` does not call crypto. Alpha Vantage's news
 * endpoint wants `CRYPTO:BTC`, YFinance wants `BTC-USD`; both start here.
 */
export function cryptoBase(symbol: string): string | null {
  const s = symbol.toUpperCase();
  for (const q of CRYPTO_QUOTES) {
    if (s.length > q.length && s.endsWith(q) && CRYPTO_BASES.has(s.slice(0, -q.length))) {
      return s.slice(0, -q.length);
    }
  }
  return null;
}

/** `BTCUSDT` → `BTCUSD`: most equity-first vendors quote crypto against USD. */
export function usdPair(symbol: string): string {
  const s = symbol.toUpperCase();
  return s.endsWith("USDT") ? `${s.slice(0, -4)}USD` : s;
}
