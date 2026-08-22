import { BlotterRow } from "./types";

// --------------------------------------------------------------------------
// Fill quality — cost decomposition
//
// What is derivable here, and what is not, traced to the gateway rather than
// assumed. `risk_proxy.py` computes `slippage_bps = (price - mark)/mark * 1e4`
// and `mark()` resolves through `tca_engine.py` to `consolidated_mid(symbol)`
// at decision time. So the reference price these figures are measured against
// IS M_decision, which makes `2 * |slippageBps|` the textbook effective spread
// exactly rather than a stand-in for it.
//
// Realized spread needs the mid a few minutes AFTER the fill. The gateway
// records mids in its `tca_snapshots` table but publishes no endpoint that
// serves them by timestamp, and `/api/tca` returns a live report rather than a
// historical one. It is therefore not derivable here, and the chart draws it
// as an empty column rather than at zero — a spread measured at zero and a
// spread nobody measured are opposite claims.
// --------------------------------------------------------------------------

/** Below this many priced fills a per-venue breakdown is noise, not evidence. */
export const MIN_PRICED_FILLS = 8;

/** Rendered under the spread chart. Exported so a test can pin that the
 *  withheld leg still explains itself rather than merely vanishing. */
export const REALIZED_SPREAD_WITHHELD =
  "Realized spread needs the consolidated mid a few minutes after each fill. The gateway "
  + "records mids in its tca_snapshots table but publishes no endpoint that serves them by "
  + "timestamp, so no post-trade reference exists here. The column is drawn empty rather than "
  + "at zero: a spread measured at zero and a spread nobody measured are opposite claims.";

/**
 * Effective spread in bps for one fill: `2 x |slippage|`.
 *
 * Null in, null out. A fill nobody priced has no effective spread, and zero
 * would claim it traded exactly at the mid.
 */
export function effectiveSpreadBps(row: BlotterRow): number | null {
  if (row.slippageBps == null || !Number.isFinite(row.slippageBps)) return null;
  return 2 * Math.abs(row.slippageBps);
}

/** Explicit cost in bps. Null unless BOTH a fee and a non-zero notional exist. */
export function feeBps(row: BlotterRow): number | null {
  if (row.feeUsd == null || row.notional == null) return null;
  if (!Number.isFinite(row.feeUsd) || !Number.isFinite(row.notional) || row.notional === 0) return null;
  return (row.feeUsd / Math.abs(row.notional)) * 1e4;
}

// --------------------------------------------------------------------------
// Provenance — where a figure came from, which is not what the figure is
//
// THE DEFECT THIS ANSWERS, measured rather than asserted. Reading the live
// gateway on 2026-08-22: BINANCE fills carry slippage 0.682, 1.1, 0.5 bps —
// different every time, because `TcaEngine.smart_route` walks a real ladder and
// the VWAP it returns depends on the book. PAPER_EQUITY fills carry the same
// figure on every row, because `modules/risk_proxy/execution.py:64` does
// `slippage_bps = settings.paper_equity_slippage_bps` — an assignment, not a
// measurement. Both then render through `effectiveSpreadBps` into one column,
// in one typeface, with nothing between them. A desk reading that column would
// conclude the second venue was measured at 2 x 8.0 bps. It was assumed at it.
//
// WHAT THIS DOES NOT DO. It does not decide "simulated" from the venue string.
// Every `Fill` the gateway builds is stamped `simulated=True` — the crypto
// smart-route path included — so a venue-name rule would either call everything
// simulated (true, and useless) or invent a distinction the gateway never made.
// The axis a desk actually needs is measured-versus-assumed, and that is a
// property of the NUMBERS: a cost that is identical on every fill did not come
// from the fills. So the verdict is dispersion, computed here, and the venue
// tag is used only to NAME the setting once dispersion has already spoken.
//
// WHAT IT REFUSES TO INVENT. Real venue fee schedules would replace a visible
// constant with an invisible fabrication, and hiding the paper venues would
// delete the evidence. The number is fine. The silence about it was the defect.
// --------------------------------------------------------------------------

/**
 * Below this many priced fills, dispersion proves nothing.
 *
 * Two fills that happen to agree are a coincidence at any liquid venue —
 * slippage reaches the wire rounded to three decimals, so collisions are
 * ordinary. Three is where "identical every time" stops being luck. Lower than
 * `MIN_PRICED_FILLS` on purpose: that floor governs whether a per-venue
 * BREAKDOWN is worth drawing, this one governs whether a single claim about one
 * venue may be made, and conflating them would mute the warning on exactly the
 * thin venues where an assumed cost does the most damage.
 */
export const MIN_DISPERSION_FILLS = 3;

/** Two bps figures closer than this are one figure. `fee/notional * 1e4` is a
 *  float division, so an exact `===` compares IEEE 754 rather than economics;
 *  the gateway rounds every bps it publishes to three decimals, which puts a
 *  real difference a million times above this. */
const FLAT_TOLERANCE_BPS = 1e-6;

/** What a per-venue cost figure rests on. A typed state carrying its reason —
 *  never a bare boolean, because "assumed" and "we cannot tell yet" are
 *  different answers and only one of them is a warning. */
export type CostBasis =
  | { kind: "measured"; n: number; rangeBps: number; detail: string }
  | { kind: "assumed"; n: number; valueBps: number; detail: string }
  | { kind: "undetermined"; n: number; detail: string };

/** One word for the table, from the basis. */
export const BASIS_WORD: Record<CostBasis["kind"], string> = {
  measured: "measured",
  assumed: "assumed",
  undetermined: "not established",
};

/**
 * Does this series vary, and what does that make it?
 *
 * `measure` names the figure in the sentence this returns; `named` is appended
 * to an ASSUMED verdict only, and only where the caller can actually name the
 * setting. A bare "simulated" tag sends the reader to the source tree; naming
 * PAPER_EQUITY_SLIPPAGE_BPS ends the question on the card.
 */
export function costBasis(values: number[], measure: string, named?: string | null): CostBasis {
  const n = values.length;
  if (n === 0) return { kind: "undetermined", n, detail: `No fill here carried ${measure}.` };
  if (n < MIN_DISPERSION_FILLS) {
    return {
      kind: "undetermined",
      n,
      detail: `${n} priced fill${n === 1 ? "" : "s"} of ${measure}. Too few to separate a constant `
        + `from a coincidence, so this reports nothing rather than the more interesting guess.`,
    };
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi - lo <= FLAT_TOLERANCE_BPS) {
    return {
      kind: "assumed",
      n,
      valueBps: hi,
      detail: `All ${n} fills carry the identical ${measure} of ${hi.toFixed(3)} bps, agreeing to `
        + `within a millionth of a basis point. A cost that does not vary across ${n} fills was `
        + `applied to them, not measured from them.${named ? ` ${named}` : ""}`,
    };
  }
  return {
    kind: "measured",
    n,
    rangeBps: hi - lo,
    detail: `${measure} ranges from ${lo.toFixed(3)} to ${hi.toFixed(3)} bps across ${n} fills. A `
      + `constant cannot do that, so these figures came from the fills.`,
  };
}

/**
 * What the gateway's own venue tag makes knowable about an assumed slippage.
 *
 * Only reached after dispersion has already returned ASSUMED, so this never
 * decides anything — it explains a verdict the numbers reached on their own.
 * `PAPER_EQUITY/…` and bare `PAPER` are written by one function,
 * `modules/risk_proxy/execution.py::_paper_fill`, and nothing else in the
 * system emits them; an exchange venue arrives as `BINANCE`, `BYBIT` or the
 * `+`-joined leg list of a route.
 */
export function assumedSlippageNote(venue: string): string | null {
  if (venue.startsWith("PAPER_EQUITY/")) {
    return "Assumed: the flat PAPER_EQUITY_SLIPPAGE_BPS setting, which "
      + "modules/risk_proxy/execution.py assigns to equity fills instead of walking a ladder.";
  }
  if (venue === "PAPER") {
    return "Assumed: the same file's fallback, which fills at the mark and records slippage as a "
      + "literal 0.0 when no route could be walked.";
  }
  return null;
}

/** Charged, not quoted: every paper fill's fee is notional x a configured rate. */
const ASSUMED_FEE_NOTE =
  "Assumed: modules/risk_proxy/execution.py charges notional x PAPER_FEE_BPS (or "
  + "PAPER_MAKER_FEE_BPS on a resting fill). No venue fee schedule is consulted anywhere.";

/** What the gateway SAID, which is a different question from what the numbers
 *  show — and today it says nothing, so the two must not be merged. */
export interface FillSource {
  /** Stamped `simulated: true`. */
  simulated: number;
  /** Stamped `simulated: false` — an exchange fill, on the gateway's own word. */
  exchange: number;
  /** The gateway did not say. Never counted as either of the above. */
  unstated: number;
  kind: "simulated" | "exchange" | "mixed" | "unstated";
}

/** Why `unstated` is the answer for every venue on today's feed. Exported so a
 *  test pins the explanation rather than only the state. */
export const SIMULATED_FLAG_UNSTATED =
  "The gateway stamps every Fill it builds with a simulated flag, but its orders audit table has "
  + "no column for one, so the flag never reaches this feed and no row on it states whether its "
  + "venue was real. That is shown as UNSTATED and never as EXCHANGE: an older gateway that never "
  + "stamped the flag is exactly the case that must not render as measured.";

/** The mark shown at rest beside a venue. Glyph AND word, from the repo's
 *  existing set (lib/signal-path) — the colour is decoration, the word is the
 *  reading, and the glyph survives forced-colors when both are stripped. */
export interface ProvenanceMark {
  glyph: string;
  word: string;
  tone: "warn" | "info";
}

export interface VenueProvenance {
  source: FillSource;
  spread: CostBasis;
  fee: CostBasis;
  mark: ProvenanceMark;
}

function fillSource(rows: BlotterRow[]): FillSource {
  let simulated = 0;
  let exchange = 0;
  let unstated = 0;
  for (const row of rows) {
    if (row.simulated === true) simulated += 1;
    else if (row.simulated === false) exchange += 1;
    else unstated += 1;
  }
  // A venue that is part one thing and part another is neither. Reporting the
  // majority would pick whichever reading flattered the venue, which is the
  // move this whole module exists to refuse.
  const present = [simulated > 0, exchange > 0, unstated > 0].filter(Boolean).length;
  const kind = present > 1
    ? "mixed" as const
    : simulated > 0
      ? "simulated" as const
      : exchange > 0
        ? "exchange" as const
        : "unstated" as const;
  return { simulated, exchange, unstated, kind };
}

/** Loudest true thing first: an assumed cost outranks a simulated venue,
 *  because a reader who sees SIMULATED still believes the number was measured
 *  inside the simulation — and on these venues it was not. */
function provenanceMark(source: FillSource, spread: CostBasis, fee: CostBasis): ProvenanceMark {
  if (spread.kind === "assumed" || fee.kind === "assumed") {
    return { glyph: "▲", word: "ASSUMED", tone: "warn" };
  }
  if (source.kind === "mixed") return { glyph: "▲", word: "MIXED", tone: "warn" };
  if (source.kind === "simulated") return { glyph: "▲", word: "SIMULATED", tone: "warn" };
  if (source.kind === "exchange") return { glyph: "●", word: "EXCHANGE", tone: "info" };
  return { glyph: "◌", word: "UNSTATED", tone: "info" };
}

export function venueProvenance(venue: string, rows: BlotterRow[]): VenueProvenance {
  const source = fillSource(rows);
  const spreads = rows.map(effectiveSpreadBps).filter((v): v is number => v != null);
  const fees = rows.map(feeBps).filter((v): v is number => v != null);
  const spread = costBasis(spreads, "effective spread", assumedSlippageNote(venue));
  // The fee note is safe on any venue: there is one fee path in the gateway and
  // it is arithmetic on a setting, whatever tag the fill ended up carrying.
  const fee = costBasis(fees, "fee", ASSUMED_FEE_NOTE);
  return { source, spread, fee, mark: provenanceMark(source, spread, fee) };
}

export interface VenueQuality {
  venue: string;
  fills: number;
  notional: number;
  /** Mean of 2x|slip| over this venue's priced fills. */
  effectiveSpreadBps: number | null;
  meanFeeBps: number | null;
  /** Signed — the sign is the maker/taker story the absolute value hides. */
  meanSlippageBps: number | null;
  improvedFills: number;
  /** Always null. See REALIZED_SPREAD_WITHHELD. */
  realizedSpreadBps: null;
  /** Where the two figures above came from, and what the gateway said about
   *  the fills they were computed over. */
  provenance: VenueProvenance;
}

export interface VenueMix {
  venues: VenueQuality[];
  totalFills: number;
  /**
   * Fills carrying no venue tag. Reported rather than absorbed, so the donut's
   * denominator and the KPI row's fill count reconcile on screen.
   */
  unattributed: number;
}

const mean = (values: number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/**
 * Fill quality grouped by venue.
 *
 * NOTE a per-venue *fill ratio* is not computable and this does not pretend
 * otherwise: `venue` is non-null only on fills, because an order that never
 * filled never reached a venue. What this returns is the venue MIX of fills.
 */
export function venueQuality(rows: BlotterRow[]): VenueMix {
  const fills = rows.filter((r) => r.status === "FILLED");
  const buckets = new Map<string, BlotterRow[]>();
  let unattributed = 0;

  for (const row of fills) {
    if (!row.venue) {
      unattributed += 1;
      continue;
    }
    const bucket = buckets.get(row.venue);
    if (bucket) bucket.push(row);
    else buckets.set(row.venue, [row]);
  }

  const venues = [...buckets.entries()]
    .map(([venue, bucket]) => {
      // The denominator for each mean is the count that HAS the measure, never
      // the fill count — averaging over rows that carry no figure would drag
      // every mean toward zero.
      const spreads = bucket.map(effectiveSpreadBps).filter((v): v is number => v != null);
      const fees = bucket.map(feeBps).filter((v): v is number => v != null);
      const slips = bucket.map((r) => r.slippageBps).filter((v): v is number => v != null);
      return {
        venue,
        fills: bucket.length,
        notional: bucket.reduce((sum, r) => sum + Math.abs(r.notional ?? 0), 0),
        effectiveSpreadBps: mean(spreads),
        meanFeeBps: mean(fees),
        meanSlippageBps: mean(slips),
        improvedFills: slips.filter((v) => v < 0).length,
        realizedSpreadBps: null as null,
        provenance: venueProvenance(venue, bucket),
      };
    })
    .sort((a, b) => b.fills - a.fills);

  return { venues, totalFills: fills.length, unattributed };
}

export interface PriceImprovement {
  /** Priced fills considered. */
  n: number;
  /** Fills that executed inside the reference mid. */
  improved: number;
  /** Null when n === 0 — "no fills" and "no improvement" are different facts. */
  rate: number | null;
  /** Mean improvement across improved fills, as a positive number of bps. */
  meanBps: number | null;
}

/**
 * Fills that beat the reference mid.
 *
 * Negative signed slippage is a gateway-authored signal, not a construct:
 * `_maker_fill` in risk_proxy.py documents that a resting fill's slippage is
 * "usually negative — price improvement against the mark".
 */
export function priceImprovement(rows: BlotterRow[]): PriceImprovement {
  const slips = rows
    .filter((r) => r.status === "FILLED")
    .map((r) => r.slippageBps)
    .filter((v): v is number => v != null);
  const improved = slips.filter((v) => v < 0);
  return {
    n: slips.length,
    improved: improved.length,
    rate: slips.length ? improved.length / slips.length : null,
    meanBps: improved.length ? mean(improved.map(Math.abs)) : null,
  };
}
