/**
 * What the coherence gateway sends, as the desk reads it.
 *
 * Mirrors `modules/schemas_coherence.py`. Every price is `string | null` for
 * the reason that module states: JSON's one numeric type is binary64, and a
 * price that arrives as a number has already lost the exactness the engine is
 * built on. Nullable means *absent*, and absent is rendered as a dash with a
 * reason — never as zero, which is itself a legal Kalshi price.
 */

export interface CoherenceHostStatus {
  host: string;
  reachable: boolean;
  detail: string | null;
}

export interface CoherenceShardStatus {
  exchange_index: number;
  description: string;
  exchange_active: boolean;
  trading_active: boolean;
}

export interface CoherenceRecorderStatus {
  running: boolean;
  configured: boolean;
  poll_seconds: number;
  watchlist: string[];
  polls: number;
  books_written: number;
  seconds_since_last_poll: number | null;
  last_error: string | null;
  consecutive_failures: number;
  series_seen: string[];
}

export interface CoherenceBudgetStatus {
  tokens_per_second: number;
  burst: number;
  tokens_available: number;
  default_cost: number;
  published_costs_known: number;
  tokens_spent: number;
  refusals: number;
  basis: string;
}

export interface CoherenceStatus {
  state: string;
  hosts: CoherenceHostStatus[];
  shards: CoherenceShardStatus[];
  schema_probe: Record<string, unknown>;
  recorder: CoherenceRecorderStatus;
  budget: CoherenceBudgetStatus;
  tape: Record<string, unknown>;
  solver: Record<string, unknown>;
  signing: Record<string, unknown>;
  dry_run: boolean;
  notes: string[];
}

export interface CoherenceMarketView {
  ticker: string;
  event_ticker: string;
  series_ticker: string;
  yes_sub_title: string;
  strike_kind: string;
  floor_strike: string | null;
  cap_strike: string | null;
  exchange_index: number;
  price_grid: string;
  yes_bid: string | null;
  no_bid: string | null;
  yes_ask: string | null;
  no_ask: string | null;
  spread: string | null;
  depth: string;
  unquoted_reason: string | null;
}

export interface CoherenceEventView {
  event_ticker: string;
  series_ticker: string;
  title: string;
  mutually_exclusive: boolean;
  exchange_index: number;
  settlement_sources: string[];
  markets: CoherenceMarketView[];
  yes_ask_total: string | null;
  yes_bid_total: string | null;
  basket_note: string | null;
}

export interface CoherenceUniverse {
  state: string;
  events: CoherenceEventView[];
  watchlist: string[];
  notes: string[];
}

export interface CoherenceBookLevel {
  price: string;
  size: string;
}

export interface CoherenceBookView {
  ticker: string;
  depth: string;
  source: string;
  ts_ns: number | null;
  yes_bids: CoherenceBookLevel[];
  no_bids: CoherenceBookLevel[];
  yes_asks: CoherenceBookLevel[];
  best_yes_bid: string | null;
  best_no_bid: string | null;
  best_yes_ask: string | null;
  best_no_ask: string | null;
  spread: string | null;
  identity_sum: string | null;
  identity_one_plus_spread: string | null;
  unquoted_reason: string | null;
}

export interface CoherenceBooks {
  state: string;
  origin: string;
  books: CoherenceBookView[];
  notes: string[];
}

/** The shape a panel gets: the payload, or a named reason there is none. */
export interface CoherenceLoad<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: Date | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Payload guards for `callGateway`'s `validate`.
 *
 * Shallow on purpose: they check the shape the panel branches on — the `state`
 * discriminator and the collection it renders — and let the fields inside stay
 * nullable. A deep validator here would reject a payload for a field no panel
 * reads, turning a partial answer into no answer.
 */
export function isCoherenceStatus(value: unknown): value is CoherenceStatus {
  return isRecord(value) && typeof value.state === "string" && isRecord(value.recorder) && isRecord(value.budget);
}

export function isCoherenceUniverse(value: unknown): value is CoherenceUniverse {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.events);
}

export function isCoherenceBooks(value: unknown): value is CoherenceBooks {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.books);
}
