import { MINUTE_NS, markets, SNAPSHOT_NOTE, T0_NS, universe } from "./coherence-fallback-market-base";

export function surface(url: URL) {
  const eventTicker = url.searchParams.get("event_ticker") || universe.events[0].event_ticker;
  return {
    state: "available",
    engine: "named",
    basis: "YES offers, quoted directly",
    event_ticker: eventTicker,
    probes: [],
    bins: markets.map((market) => ({
      label: market.yes_sub_title,
      low: null,
      high: null,
      mass: market.yes_ask,
      representative: null,
      negative: false,
    })),
    total_mass: universe.events[0].yes_ask_total,
    tail_mass_low: null,
    tail_mass_high: null,
    mean: null,
    variance: null,
    standard_deviation: null,
    skewness: null,
    excess_kurtosis: null,
    moments_note: "These outcomes are names rather than numbers, so no numeric moments are defined.",
    negative_bins: [],
    detail: `Three mutually exclusive named outcomes are quoted directly. ${SNAPSHOT_NOTE}`,
  };
}

export function stake() {
  const probabilities = [0.10, 0.64, 0.26];
  const shrinkage = 0.35;
  const basket = markets.reduce((sum, market) => sum + Number(market.yes_ask), 0);
  const arbitrage = basket < 1;
  const stakes = markets.map((market, index) => {
    const probability = probabilities[index];
    const price = Number(market.yes_ask);
    // The fixture basket is below a dollar, so the server's joint solver sets
    // the reserve rate to zero and full Kelly equals the returned measure.
    const full = arbitrage ? probability : Math.max(0, (probability - price) / Math.max(0.01, 1 - price));
    return {
      ticker: market.ticker,
      label: market.yes_sub_title,
      probability: probability.toFixed(4),
      price: market.yes_ask,
      edge: (probability - price).toFixed(4),
      full_fraction: full.toFixed(4),
      fraction: (full * shrinkage).toFixed(4),
      admitted: full > 0,
    };
  });
  const staked = stakes.reduce((sum, row) => sum + Number(row.fraction), 0);
  const cash = 1 - staked;
  const wealth = stakes.map((row) => cash + Number(row.fraction) / Number(row.price));
  const growth = stakes.reduce((sum, row, index) => sum + Number(row.probability) * Math.log(wealth[index]), 0);
  const fullGrowth = stakes.reduce((sum, row) => sum + Number(row.probability) * Math.log(Number(row.full_fraction) / Number(row.price)), 0);
  return {
    state: "available",
    engine: "sandbox_kelly",
    stakes,
    shrinkage: shrinkage.toFixed(4),
    reserve_rate: arbitrage ? "0.0000" : "0.0200",
    cash_fraction: cash.toFixed(4),
    staked_fraction: staked.toFixed(4),
    growth_rate: growth.toFixed(8),
    full_growth_rate: fullGrowth.toFixed(8),
    worst_case_wealth: Math.min(...wealth).toFixed(8),
    basket_cost: basket.toFixed(4),
    arbitrage_available: arbitrage,
    riskless_growth: arbitrage ? Math.log(1 / basket).toFixed(8) : null,
    detail: SNAPSHOT_NOTE,
  };
}

export function combos() {
  const legs = markets.slice(0, 2).map((market) => ({
    ticker: market.ticker,
    label: market.yes_sub_title,
    side: "yes",
    probability: market.yes_ask,
    buy_cost: market.yes_ask,
    opposite_cost: market.no_ask,
  }));
  const combo = {
    ticker: "KXCOMBO-SANDBOX-1",
    label: "Cut 25bps and Hold",
    collection_ticker: "KXCOMBO-SANDBOX",
    scope: "same meeting",
    legs,
    combo_bid: "0.0300",
    combo_ask: "0.0500",
    combo_mid: "0.0400",
    price: "0.0500",
    price_basis: "ask",
    lower_bound: "0.0000",
    upper_bound: "0.0800",
    independence: "0.0504",
    band_width: "0.0800",
    band_position: "0.6250",
    dependence: "inside the Fréchet band",
    inside_band: true,
    violated_rows: 0,
    detail: "The ask lies inside the band implied by its two legs.",
  };
  return {
    observed_age_s: null,
    state: "available",
    combos: [combo],
    rows: [
      { because: "intersection cannot exceed either leg", scope: "upper", bound: "0.0800", cost: "0.0500", slack: "0.0300", violated: false, legs },
      { because: "Bonferroni lower bound", scope: "lower", bound: "0.0000", cost: "0.0500", slack: "0.0500", violated: false, legs },
    ],
    quoted: 1,
    outside_band: 0,
    violations: 0,
    notes: [SNAPSHOT_NOTE],
  };
}

export function calibration() {
  return {
    state: "available",
    engine: "tape",
    count: 320,
    base_rate: "0.4313",
    brier: "0.1728",
    reliability: "0.0124",
    resolution: "0.0831",
    uncertainty: "0.2453",
    binning: "-0.0018",
    skill: "0.2955",
    bias_slope: "1.0840",
    bias_by_series: [
      { series_ticker: "KXFEDDECISION", slope: "1.0710" },
      { series_ticker: "KXHIGHNY", slope: "1.1030" },
    ],
    median_horizon_s: 86_400,
    horizon_s: 3_600,
    thin: false,
    bins: Array.from({ length: 10 }, (_, index) => {
      const low = index / 10;
      const high = (index + 1) / 10;
      const forecast = (low + high) / 2;
      const outcome = Math.max(0, Math.min(1, forecast + Math.sin(index * 1.7) * 0.035));
      return {
        label: `${index * 10}-${(index + 1) * 10}%`,
        low: low.toFixed(4),
        high: high.toFixed(4),
        count: 24 + (index % 4) * 7,
        mean_forecast: forecast.toFixed(4),
        outcome_rate: outcome.toFixed(4),
        deviation: (outcome - forecast).toFixed(4),
      };
    }),
    isotonic_map: Array.from({ length: 10 }, (_, index) => ({
      quoted: ((index + 0.5) / 10).toFixed(4),
      calibrated: Math.max(0, Math.min(1, (index + 0.5) / 10 + Math.sin(index) * 0.02)).toFixed(4),
      weight: 24 + (index % 4) * 7,
    })),
    composition: [
      { series_ticker: "KXFEDDECISION", count: 172 },
      { series_ticker: "KXHIGHNY", count: 148 },
    ],
    detail: SNAPSHOT_NOTE,
  };
}

export function calibrationHistory() {
  return {
    state: "ok",
    points: Array.from({ length: 16 }, (_, index) => ({
      ts_ns: T0_NS + index * 6 * MINUTE_NS,
      engine: "tape",
      markets: 80 + index * 16,
      brier: (0.205 - index * 0.0021 + Math.sin(index) * 0.003).toFixed(4),
      skill: (0.18 + index * 0.007).toFixed(4),
      base_rate: (0.42 + Math.sin(index / 3) * 0.025).toFixed(4),
      uncertainty: "0.2440",
      bias_slope: (1.16 - index * 0.005).toFixed(4),
      median_horizon_s: 86_400,
      horizon_s: 3_600,
      thin: index < 2,
      detail: null,
    })),
    notes: [SNAPSHOT_NOTE],
  };
}

export function settlement() {
  const samples = Array.from({ length: 30 }, (_, index) => ({
    ts_ms: 1_777_572_000_000 + index * 60_000,
    value: (81.4 + Math.sin(index / 4) * 0.65).toFixed(2),
    contributors: 5 - (index % 9 === 0 ? 1 : 0),
    status: index % 9 === 0 ? "degraded" : "clean",
  }));
  const average = samples.reduce((sum, sample) => sum + Number(sample.value), 0) / samples.length;
  return {
    state: "available",
    detail: SNAPSHOT_NOTE,
    city: "NYC",
    config_version: "sandbox-v1",
    samples,
    sample_count: samples.length,
    degraded_samples: samples.filter((sample) => sample.status !== "clean").length,
    contributors_min: 4,
    contributors_max: 5,
    latest_value: samples.at(-1)?.value ?? null,
    window_minutes: 30,
    window_average: average.toFixed(2),
    window_average_clean: average.toFixed(2),
    spot_minus_window: ((Number(samples.at(-1)?.value) || average) - average).toFixed(2),
    reference_rate_state: "sandbox",
    reference_rate_detail: SNAPSHOT_NOTE,
    units: "°F",
    stations: ["KNYC", "KLGA", "KJFK", "KEWR", "KTEB"],
    formation_checked: 26,
    formation_agreed: 26,
    formation_holds: true,
    formation_detail: "The committed aggregation rule reproduces every clean sandbox minute.",
    quorum_gaps: 0,
    pending: [],
    window_is_assumed: false,
  };
}

export function rfq() {
  return {
    state: "available",
    detail: SNAPSHOT_NOTE,
    signing_environment: "demo",
    open_requests: 2,
    dispersions: markets.slice(0, 2).map((market, index) => ({
      market_ticker: market.ticker,
      band_width: index ? "0.1200" : "0.0800",
      band_fraction: index ? "0.4167" : "0.3750",
      band_note: "Maker spread as a share of the admissible Fréchet interval.",
      quotes: 5,
      usable: 5,
      median: index ? "0.6250" : "0.0750",
      lowest: index ? "0.6000" : "0.0600",
      highest: index ? "0.6500" : "0.0900",
      spread: "0.0300",
      median_width: "0.0200",
      crossed: 0,
      thin: false,
      detail: SNAPSHOT_NOTE,
    })),
  };
}

export function shell(url: URL) {
  const path = url.searchParams.get("path") || "/";
  const command = url.searchParams.get("command") || "ls";
  const event = universe.events[0];
  const shard = String(event.exchange_index);
  const eventPath = `/shards/${shard}/${event.series_ticker}/${event.event_ticker}`;
  const files = [
    ["implied_pmf", "probability mass differenced from the ladder"],
    ["survival", "survival by quoted strike"],
    ["lattice", "market implication graph"],
    ["certificate", "coherence proof, solved on demand"],
    ["books", "both bid ladders and implied offers"],
  ] as const;

  if (command === "cat") {
    const name = path.split("/").filter(Boolean).at(-1) ?? "";
    const file = files.find(([candidate]) => candidate === name);
    const market = markets.find((candidate) => candidate.ticker === name);
    const underEvent = path.startsWith(`${eventPath}/`);
    if (!underEvent || (!file && !market)) {
      return { state: "missing", path, command: "cat", exists: false, entries: [], body: "", detail: "a readable file lives below a watched event" };
    }
    if (market) {
      return { state: "unavailable", path, command: "cat", exists: true, entries: [], body: "", detail: "a market is listed here but has no standalone file body" };
    }
    const body = name === "books"
      ? markets.map((row) => `${row.ticker}\tYES ${row.yes_bid} / ${row.yes_ask}`).join("\n")
      : `${name}\n${SNAPSHOT_NOTE}`;
    return { state: "ok", path, command: "cat", exists: true, entries: [], body, detail: SNAPSHOT_NOTE };
  }

  const listings = new Map<string, { path: string; entries: Array<{ name: string; kind: "dir" | "file"; detail: string }>; detail: string }>([
    ["/", { path: "/shards", entries: [{ name: shard, kind: "dir", detail: "1 watched event on this exchange instance" }], detail: SNAPSHOT_NOTE }],
    ["/shards", { path: "/shards", entries: [{ name: shard, kind: "dir", detail: "1 watched event on this exchange instance" }], detail: SNAPSHOT_NOTE }],
    [`/shards/${shard}`, { path: `/shards/${shard}`, entries: [{ name: event.series_ticker, kind: "dir", detail: "1 watched event" }], detail: `series on exchange instance ${shard}` }],
    [`/shards/${shard}/${event.series_ticker}`, { path: `/shards/${shard}/${event.series_ticker}`, entries: [{ name: event.event_ticker, kind: "dir", detail: `${markets.length} markets; mutually exclusive` }], detail: `events under ${event.series_ticker}` }],
    [eventPath, { path: eventPath, entries: [
      ...markets.map((row) => ({ name: row.ticker, kind: "file" as const, detail: row.yes_sub_title })),
      ...files.map(([name, detail]) => ({ name, kind: "file" as const, detail })),
    ], detail: "markets and their computed readings" }],
  ]);
  const listing = listings.get(path);
  return listing
    ? { state: "available", command: "ls", exists: true, body: "", ...listing }
    : { state: "unavailable", path, command: "ls", exists: false, entries: [], body: "", detail: "no watched path matches this address" };
}
