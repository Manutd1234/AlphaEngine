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

export interface CoherenceCertificateLeg {
  ticker: string;
  label: string;
  direction: string;
  price: string;
  size: string;
  notional: string;
  trade_fee: string;
  rounding_fee: string;
  rebate: string;
  net_fee: string;
}

export interface CoherenceCertificate {
  verdict: string;
  engine: string;
  component_id: string;
  series_ticker: string;
  exchange_index: number;
  family: string;
  because: string;
  scope: string;
  tier: number;
  tier_note: string;
  legs: CoherenceCertificateLeg[];
  gross_edge: string | null;
  worst_case_payoff: string | null;
  total_fees: string | null;
  net_edge: string | null;
  worth_doing: boolean;
  rows_tested: number;
  rows_untestable: number;
  notes: string[];
  proof: string;
}

export interface CoherenceFeeFill {
  trade_fee: string;
  rounding_fee: string;
  rebate: string;
  net: string;
  notional: string;
}

export interface CoherenceFees {
  state: string;
  price: string;
  contracts: string;
  fills: number;
  multiplier: string;
  balance_precision: string;
  per_fill: CoherenceFeeFill[];
  total: CoherenceFeeFill | null;
  net_as_fraction_of_notional: string | null;
  minimum_clip: string | null;
  minimum_clip_note: string;
  naive_threshold: string;
  fee_aware_threshold: string | null;
  notes: string[];
}

export interface CoherenceIndexPoint {
  ts_ns: number;
  series_ticker: string;
  event_ticker: string;
  exchange_index: number;
  ci: string | null;
  engine: string;
  detail: string | null;
}

export interface CoherenceIndexSeries {
  state: string;
  points: CoherenceIndexPoint[];
  series: string[];
  measured: number;
  unmeasurable: number;
  notes: string[];
}

export interface CoherenceEpisodeSample {
  ts_ns: number;
  ci: string | null;
}

export interface CoherenceEpisode {
  component_id: string;
  series_ticker: string;
  event_ticker: string;
  family: string;
  exchange_index: number;
  opened_ts_ns: number;
  closed_ts_ns: number | null;
  lifetime_s: string | null;
  peak_ci: string | null;
  peak_net_edge_dollars: string | null;
  samples: CoherenceEpisodeSample[];
}

export interface CoherenceSurvivalPoint {
  t_s: string;
  surviving: string;
}

export interface CoherenceEpisodes {
  state: string;
  episodes: CoherenceEpisode[];
  open_episodes: number;
  survival: CoherenceSurvivalPoint[];
  median_s: string | null;
  median_withheld_reason: string | null;
  verdict: string;
  round_trip_s: string;
  notes: string[];
}

export interface CoherenceAblation {
  name: string;
  description: string;
  observations: number;
  violations: number;
  worth_doing: number;
  gross_total: string;
  net_total: string;
  untestable: number;
  notes: string[];
}

export interface CoherenceReplay {
  state: string;
  rows: number;
  observations: number;
  first_ts_ns: number;
  last_ts_ns: number;
  span_seconds: string;
  ablations: CoherenceAblation[];
  headline: string;
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

export function isCoherenceCertificate(value: unknown): value is CoherenceCertificate {
  return isRecord(value) && typeof value.verdict === "string" && typeof value.engine === "string";
}

export function isCoherenceFees(value: unknown): value is CoherenceFees {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.per_fill);
}

export function isCoherenceIndexSeries(value: unknown): value is CoherenceIndexSeries {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.points);
}

export function isCoherenceEpisodes(value: unknown): value is CoherenceEpisodes {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.episodes);
}

export function isCoherenceReplay(value: unknown): value is CoherenceReplay {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.ablations);
}
