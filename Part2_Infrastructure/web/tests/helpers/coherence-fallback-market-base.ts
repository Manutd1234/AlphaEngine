/** Test-only deterministic market snapshots. Never imported by runtime code. */

export const SNAPSHOT_NOTE = "Deterministic sandbox snapshot; the gateway did not supply this read.";
export const T0_NS = 1_777_572_000_000_000_000;
export const MINUTE_NS = 60_000_000_000;

export const markets = [
  {
    ticker: "KXFEDDECISION-28JAN-C25",
    event_ticker: "KXFEDDECISION-28JAN",
    series_ticker: "KXFEDDECISION",
    yes_sub_title: "Cut 25bps",
    strike_kind: "custom",
    floor_strike: null,
    cap_strike: null,
    exchange_index: 0,
    price_grid: "linear_cent",
    yes_bid: "0.0700",
    no_bid: "0.9200",
    yes_ask: "0.0800",
    no_ask: "0.9300",
    spread: "0.0100",
    depth: "top_of_book",
    unquoted_reason: null,
    open_interest: "1842.00",
    liquidity: "2450.00",
    volume: "619.00",
    notional_value: "1.0000",
  },
  {
    ticker: "KXFEDDECISION-28JAN-H0",
    event_ticker: "KXFEDDECISION-28JAN",
    series_ticker: "KXFEDDECISION",
    yes_sub_title: "Hold",
    strike_kind: "custom",
    floor_strike: null,
    cap_strike: null,
    exchange_index: 0,
    price_grid: "linear_cent",
    yes_bid: "0.6200",
    no_bid: "0.3700",
    yes_ask: "0.6300",
    no_ask: "0.3800",
    spread: "0.0100",
    depth: "top_of_book",
    unquoted_reason: null,
    open_interest: "8374.00",
    liquidity: "12480.00",
    volume: "4107.00",
    notional_value: "1.0000",
  },
  {
    ticker: "KXFEDDECISION-28JAN-H25",
    event_ticker: "KXFEDDECISION-28JAN",
    series_ticker: "KXFEDDECISION",
    yes_sub_title: "Hike 25bps",
    strike_kind: "custom",
    floor_strike: null,
    cap_strike: null,
    exchange_index: 0,
    price_grid: "linear_cent",
    yes_bid: "0.2700",
    no_bid: "0.7200",
    yes_ask: "0.2800",
    no_ask: "0.7300",
    spread: "0.0100",
    depth: "top_of_book",
    unquoted_reason: null,
    open_interest: "3660.00",
    liquidity: "5130.00",
    volume: "1528.00",
    notional_value: "1.0000",
  },
];

export const universe = {
  observed_age_s: null,
  state: "sandbox",
  events: [
    {
      event_ticker: "KXFEDDECISION-28JAN",
      series_ticker: "KXFEDDECISION",
      title: "Federal Reserve decision in January 2028",
      mutually_exclusive: true,
      exchange_index: 0,
      settlement_sources: ["Federal Reserve"],
      markets,
      yes_ask_total: "0.9900",
      yes_bid_total: "0.9600",
      basket_note: "The sandbox family is quoted one cent below its one-dollar payoff at the offer.",
      open_interest_total: "13876.00",
      liquidity_total: "20060.00",
    },
  ],
  watchlist: ["KXFEDDECISION"],
  categories: { KXFEDDECISION: "Economics" },
  notes: [SNAPSHOT_NOTE],
};

export const status = {
  state: "sandbox",
  hosts: [{ host: "sandbox", reachable: false, detail: "No public gateway answered." }],
  shards: [{ exchange_index: 0, description: "Sandbox market snapshot", exchange_active: false, trading_active: false }],
  schema_probe: { schema: "fp-2026", source: "sandbox" },
  recorder: {
    running: false,
    configured: false,
    poll_seconds: 20,
    watchlist: ["KXFEDDECISION"],
    polls: 0,
    books_written: 0,
    seconds_since_last_poll: null,
    last_error: "gateway unavailable",
    consecutive_failures: 1,
    series_seen: [],
  },
  budget: {
    tokens_per_second: 0,
    burst: 0,
    tokens_available: 0,
    default_cost: 1,
    published_costs_known: 0,
    tokens_spent: 0,
    refusals: 0,
    basis: "No exchange budget is spent by deterministic sandbox hydration.",
  },
  tape: { state: "sandbox", book_snapshots: 0, tickers_seen: 0 },
  solver: { linear_programme: "sandbox fixture" },
  signing: { state: "unavailable" },
  dry_run: true,
  notes: [SNAPSHOT_NOTE],
};

function bookFor(market: (typeof markets)[number]) {
  const yes = Number(market.yes_bid);
  const no = Number(market.no_bid);
  return {
    ticker: market.ticker,
    depth: "sandbox_l2",
    source: "sandbox",
    ts_ns: T0_NS,
    yes_bids: [0, 1, 2, 3].map((step) => ({
      price: (yes - step * 0.01).toFixed(4),
      size: String(120 + step * 45),
    })),
    no_bids: [0, 1, 2, 3].map((step) => ({
      price: (no - step * 0.01).toFixed(4),
      size: String(105 + step * 38),
    })),
    yes_asks: [0, 1, 2, 3].map((step) => ({
      price: (Number(market.yes_ask) + step * 0.01).toFixed(4),
      size: String(105 + step * 38),
    })),
    best_yes_bid: market.yes_bid,
    best_no_bid: market.no_bid,
    best_yes_ask: market.yes_ask,
    best_no_ask: market.no_ask,
    spread: market.spread,
    identity_sum: "1.0100",
    identity_one_plus_spread: "1.0100",
    unquoted_reason: null,
  };
}

export const books = {
  state: "sandbox",
  origin: "sandbox",
  books: markets.map(bookFor),
  notes: [SNAPSHOT_NOTE],
};

export function history(url: URL) {
  const ticker = url.searchParams.get("ticker") || markets[0].ticker;
  return {
    state: "ok",
    ticker,
    points: Array.from({ length: 12 }, (_, index) => {
      const bid = 0.56 + index * 0.005 + Math.sin(index * 1.3) * 0.01;
      return {
        ts_ns: T0_NS + index * MINUTE_NS,
        ticker,
        event_ticker: "KXFEDDECISION-28JAN",
        series_ticker: "KXFEDDECISION",
        best_yes_bid: bid.toFixed(4),
        best_no_bid: (0.99 - bid).toFixed(4),
        implied_yes_ask: (1 - (0.99 - bid)).toFixed(4),
        depth: "sandbox_l2",
        source: "sandbox",
      };
    }),
    recorded: markets.map((market) => market.ticker),
    notes: [SNAPSHOT_NOTE],
  };
}

export function certificate(url: URL) {
  const eventTicker = url.searchParams.get("event_ticker") || universe.events[0].event_ticker;
  return {
    observed_age_s: null,
    verdict: "incoherent",
    priced_out: false,
    engine: "highs",
    component_id: eventTicker,
    series_ticker: "KXFEDDECISION",
    exchange_index: 0,
    family: "mutually_exclusive",
    because: "Buying every offered outcome costs less than the certain one-dollar payoff.",
    scope: "all outcomes",
    tier: 1,
    tier_note: "All legs execute on one sandbox shard.",
    legs: markets.map((market) => ({
      ticker: market.ticker,
      label: market.yes_sub_title,
      direction: "buy_yes",
      price: market.yes_ask,
      size: "1.0000",
      notional: market.yes_ask,
      trade_fee: "0.0030",
      rounding_fee: "0.0001",
      rebate: "0.0000",
      net_fee: "0.0031",
    })),
    gross_edge: "0.0100",
    worst_case_payoff: "1.0000",
    total_fees: "0.0093",
    net_edge: "0.0007",
    margin: "0.010000",
    worth_doing: true,
    rows_tested: 7,
    rows_untestable: 0,
    notes: [SNAPSHOT_NOTE],
    proof: "minimise q·p subject to Aq ≥ 1; the sandbox offer vector admits q=(1,1,1) with q·p=0.99.",
  };
}
