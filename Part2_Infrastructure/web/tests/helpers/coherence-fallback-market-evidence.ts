import { MINUTE_NS, SNAPSHOT_NOTE, T0_NS } from "./coherence-fallback-market-base";

function feeFill(price: number, contracts: number) {
  const notional = price * contracts;
  const trade = 0.07 * contracts * price * (1 - price);
  const rounding = 0.0001;
  return {
    trade_fee: trade.toFixed(4),
    rounding_fee: rounding.toFixed(4),
    rebate: "0.0000",
    net: (trade + rounding).toFixed(4),
    notional: notional.toFixed(4),
  };
}

export function fees(url: URL) {
  const price = Math.max(0.01, Math.min(0.99, Number(url.searchParams.get("price") || 0.63)));
  const contracts = Math.max(1, Number(url.searchParams.get("contracts_fp") || 1));
  const fills = Math.max(1, Math.min(20, Number(url.searchParams.get("fills") || 1)));
  const perFill = Array.from({ length: fills }, () => feeFill(price, contracts / fills));
  const totalNet = perFill.reduce((sum, fill) => sum + Number(fill.net), 0);
  const notional = price * contracts;
  return {
    state: "ok",
    price: price.toFixed(4),
    contracts: contracts.toFixed(4),
    fills,
    multiplier: "1.0000",
    balance_precision: "0.0001",
    per_fill: perFill,
    total: {
      trade_fee: perFill.reduce((sum, fill) => sum + Number(fill.trade_fee), 0).toFixed(4),
      rounding_fee: perFill.reduce((sum, fill) => sum + Number(fill.rounding_fee), 0).toFixed(4),
      rebate: "0.0000",
      net: totalNet.toFixed(4),
      notional: notional.toFixed(4),
    },
    net_as_fraction_of_notional: notional ? (totalNet / notional).toFixed(4) : null,
    minimum_clip: "1.0000",
    minimum_clip_note: "One contract is the sandbox minimum.",
    naive_threshold: "1.0000",
    fee_aware_threshold: (1 + totalNet).toFixed(4),
    notes: [SNAPSHOT_NOTE],
  };
}

export function feeCurve(url: URL) {
  const contracts = Math.max(1, Number(url.searchParams.get("contracts_fp") || 1));
  const fills = Math.max(1, Number(url.searchParams.get("fills") || 1));
  return {
    state: "ok",
    contracts: contracts.toFixed(4),
    fills,
    multiplier: "1.0000",
    balance_precision: "0.0001",
    points: Array.from({ length: 19 }, (_, index) => {
      const price = (index + 1) * 0.05;
      const fill = feeFill(price, contracts / fills);
      return {
        price: price.toFixed(4),
        ...fill,
        as_fraction_of_notional: Number(fill.notional) > 0
          ? (Number(fill.net) / Number(fill.notional)).toFixed(4)
          : null,
      };
    }),
    notes: [SNAPSHOT_NOTE],
  };
}

export function indexSeries() {
  const points = Array.from({ length: 36 }, (_, index) => ({
    ts_ns: T0_NS + index * MINUTE_NS,
    series_ticker: index % 2 ? "KXFEDDECISION" : "KXHIGHNY",
    event_ticker: index % 2 ? "KXFEDDECISION-28JAN" : "KXHIGHNY-26AUG23",
    exchange_index: 0,
    ci: index % 11 === 0 ? null : (0.007 + Math.abs(Math.sin(index / 4)) * 0.024).toFixed(4),
    engine: index % 2 ? "lp_l1" : "isotonic_l1",
    detail: index % 11 === 0 ? "one side of the sandbox ladder is unquoted" : null,
  }));
  return {
    state: "ok",
    points,
    series: ["KXFEDDECISION", "KXHIGHNY"],
    measured: points.filter((point) => point.ci !== null).length,
    unmeasurable: points.filter((point) => point.ci === null).length,
    notes: [SNAPSHOT_NOTE],
  };
}

export function episodes() {
  const samples = Array.from({ length: 10 }, (_, index) => ({
    ts_ns: T0_NS + index * MINUTE_NS,
    ci: Math.max(0, 0.034 - index * 0.0035).toFixed(4),
  }));
  return {
    state: "ok",
    episodes: [
      {
        component_id: "sandbox-episode-1",
        series_ticker: "KXFEDDECISION",
        event_ticker: "KXFEDDECISION-28JAN",
        family: "mutually_exclusive",
        exchange_index: 0,
        opened_ts_ns: T0_NS,
        closed_ts_ns: T0_NS + 9 * MINUTE_NS,
        lifetime_s: "540.000",
        peak_ci: "0.0340",
        peak_net_edge_dollars: "0.0100",
        samples,
      },
      {
        component_id: "sandbox-episode-2",
        series_ticker: "KXHIGHNY",
        event_ticker: "KXHIGHNY-26AUG23",
        family: "threshold_ladder",
        exchange_index: 0,
        opened_ts_ns: T0_NS + 20 * MINUTE_NS,
        closed_ts_ns: T0_NS + 25 * MINUTE_NS,
        lifetime_s: "300.000",
        peak_ci: "0.0210",
        peak_net_edge_dollars: "0.0060",
        samples: samples.slice(0, 6),
      },
    ],
    open_episodes: 0,
    survival: [
      { t_s: "0", surviving: "1.0000" },
      { t_s: "300", surviving: "0.5000" },
      { t_s: "540", surviving: "0.0000" },
    ],
    median_s: "420.000",
    median_withheld_reason: null,
    verdict: "sandbox episodes outlive the displayed transport floor",
    round_trip_s: "0.084",
    round_trip_source: "assumed",
    round_trip_samples: 0,
    notes: [SNAPSHOT_NOTE],
  };
}

export function replay() {
  const rows = [
    ["full", "Trade, rounding, and rebate schedule", 9, 3, "0.0840", "0.0120"],
    ["no_rebate", "Trade and rounding fees", 9, 2, "0.0840", "0.0090"],
    ["trade_only", "Trade fee only", 11, 5, "0.1010", "0.0280"],
    ["no_fees", "Gross basket test", 18, 18, "0.1730", "0.1730"],
  ] as const;
  return {
    state: "ok",
    rows: 480,
    observations: 120,
    first_ts_ns: T0_NS,
    last_ts_ns: T0_NS + 119 * MINUTE_NS,
    span_seconds: "7140",
    ablations: rows.map(([name, description, violations, worthDoing, gross, net]) => ({
      name,
      description,
      observations: 120,
      violations,
      worth_doing: worthDoing,
      gross_total: gross,
      net_total: net,
      untestable: 4,
      notes: [],
    })),
    headline: "fees remove 15 of 18 gross signals",
    notes: [SNAPSHOT_NOTE],
  };
}
