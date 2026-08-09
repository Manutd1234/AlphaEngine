/**
 * The instruments the research workspace offers.
 *
 * A list rather than a literal in the control, because two other things need
 * it: the benchmark picker draws from the same roster, and a test asserts that
 * every entry can actually be served — the roster carried AAPL, NVDA and MSFT
 * for months while `loadBars` sent them to a crypto venue, so "it is in the
 * dropdown" has already proved to be no evidence at all that it works.
 *
 * WHY THESE
 *
 * Sector spread, not size ranking. A backtest run across eight tickers that all
 * move with the Nasdaq has tested one thing eight times, and a strategy that
 * looks robust across them is robust to nothing but its own sample. The
 * equities below deliberately cover technology, communication services,
 * consumer discretionary and staples, financials, healthcare, energy and
 * industrials, because those are the sectors whose drawdowns do not line up.
 *
 * Every one is a large, liquid US listing with a long daily history — a
 * strategy needs a few thousand bars before walk-forward has anything to fold,
 * and a thin ticker's gaps are indistinguishable from a data outage in the bar
 * contract's `no_gaps` check.
 *
 * The symbol field remains free text. This is a datalist, not a whitelist:
 * anything the providers can serve will run, and the roster is a set of
 * suggestions that are known to work.
 */

export type SymbolSector =
  | "Crypto"
  | "Index"
  | "Technology"
  | "Communication"
  | "Consumer"
  | "Financials"
  | "Healthcare"
  | "Energy"
  | "Industrials";

export interface ResearchSymbol {
  symbol: string;
  /** The issuer or asset, as a human would say it. */
  name: string;
  sector: SymbolSector;
}

export const RESEARCH_SYMBOLS: ResearchSymbol[] = [
  // ── Crypto — served keyless by Binance, so these work in a fresh clone ────
  { symbol: "BTCUSDT", name: "Bitcoin", sector: "Crypto" },
  { symbol: "ETHUSDT", name: "Ethereum", sector: "Crypto" },
  { symbol: "SOLUSDT", name: "Solana", sector: "Crypto" },
  { symbol: "BNBUSDT", name: "BNB", sector: "Crypto" },
  { symbol: "XRPUSDT", name: "XRP", sector: "Crypto" },
  { symbol: "ADAUSDT", name: "Cardano", sector: "Crypto" },
  { symbol: "DOGEUSDT", name: "Dogecoin", sector: "Crypto" },
  { symbol: "AVAXUSDT", name: "Avalanche", sector: "Crypto" },
  { symbol: "LINKUSDT", name: "Chainlink", sector: "Crypto" },
  { symbol: "DOTUSDT", name: "Polkadot", sector: "Crypto" },
  { symbol: "LTCUSDT", name: "Litecoin", sector: "Crypto" },
  { symbol: "TRXUSDT", name: "TRON", sector: "Crypto" },

  // ── Index ────────────────────────────────────────────────────────────────
  // SPY is here because a benchmark has to be pickable like anything else. It
  // needs no special-casing anywhere: through the equity provider path it is
  // one more ticker.
  { symbol: "SPY", name: "S&P 500 ETF", sector: "Index" },
  { symbol: "QQQ", name: "Nasdaq 100 ETF", sector: "Index" },

  // ── Equities, by sector ──────────────────────────────────────────────────
  { symbol: "AAPL", name: "Apple", sector: "Technology" },
  { symbol: "MSFT", name: "Microsoft", sector: "Technology" },
  { symbol: "NVDA", name: "NVIDIA", sector: "Technology" },
  { symbol: "AVGO", name: "Broadcom", sector: "Technology" },
  { symbol: "GOOGL", name: "Alphabet", sector: "Communication" },
  { symbol: "META", name: "Meta Platforms", sector: "Communication" },
  { symbol: "AMZN", name: "Amazon", sector: "Consumer" },
  { symbol: "TSLA", name: "Tesla", sector: "Consumer" },
  { symbol: "PG", name: "Procter & Gamble", sector: "Consumer" },
  { symbol: "KO", name: "Coca-Cola", sector: "Consumer" },
  { symbol: "JPM", name: "JPMorgan Chase", sector: "Financials" },
  { symbol: "V", name: "Visa", sector: "Financials" },
  { symbol: "JNJ", name: "Johnson & Johnson", sector: "Healthcare" },
  { symbol: "UNH", name: "UnitedHealth", sector: "Healthcare" },
  { symbol: "XOM", name: "Exxon Mobil", sector: "Energy" },
  { symbol: "CVX", name: "Chevron", sector: "Energy" },
  { symbol: "CAT", name: "Caterpillar", sector: "Industrials" },
  { symbol: "GE", name: "GE Aerospace", sector: "Industrials" },
];

/** Just the tickers, in roster order — what the datalist renders. */
export const RESEARCH_SYMBOL_IDS = RESEARCH_SYMBOLS.map((s) => s.symbol);

/**
 * The benchmark a run compares itself against when nobody has chosen one.
 *
 * Crypto against Bitcoin and equities against the S&P is the comparison each
 * asset class is actually judged on. Choosing by asset class rather than
 * defaulting to one global benchmark matters because the alternative — SPY for
 * a BTCUSDT run — produces an alpha that is really just a currency mismatch.
 *
 * A symbol benchmarked against itself is not a comparison, so the second-choice
 * fallback exists for the two instruments that are the defaults.
 */
export function defaultBenchmark(symbol: string): string {
  const s = symbol.toUpperCase();
  const crypto = RESEARCH_SYMBOLS.some((r) => r.symbol === s && r.sector === "Crypto")
    || /USDT?$/.test(s);
  if (crypto) return s === "BTCUSDT" ? "ETHUSDT" : "BTCUSDT";
  return s === "SPY" ? "QQQ" : "SPY";
}
