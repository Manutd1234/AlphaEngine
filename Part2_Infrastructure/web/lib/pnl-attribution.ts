/**
 * Where the day's P&L came from — and where it demonstrably did not.
 * ==================================================================
 *
 * A day P&L number answers "how much" and nothing else. The question a PM
 * actually asks at the close is "how much of that was the market moving, and
 * how much was us", and the difference decides whether a good day is worth
 * repeating. This splits one session's P&L into four bars: the market (beta)
 * return, a residual, slippage, and fees.
 *
 * ── The accounting, and why it is not double counting ───────────────────────
 * `PositionState.apply_fill` does `self.realized_pnl -= fee`, and `_paper_fill`
 * fills at the smart-route VWAP rather than at mid. **Fees and slippage are
 * therefore already inside `equity.daily_pnl`.** Pulling them out as their own
 * bars and letting the residual absorb the remainder counts each exactly once —
 * the residual is a plug, `dayPnl − market − slippage − fees`, so the four bars
 * sum back to the number they came from by construction.
 *
 * ── Why every cost figure here is session-scoped ────────────────────────────
 * `_roll_session_if_needed` zeroes per-position realised P&L at UTC midnight, so
 * today's P&L contains only today's costs. The lifetime aggregates already in
 * the payload (`attribution.by_strategy`, `by_symbol`, `execution_quality`) are
 * useless for this and dangerous: subtracting a lifetime fee total from one
 * day's P&L reports a loss the desk did not take, and `avg_slippage_bps` is an
 * *unweighted mean of basis points* that cannot become dollars at all. The only
 * admissible source is `attribution.session`, which names the day it covers.
 *
 * ── The withholding rules, which are the whole point ────────────────────────
 * Every leg here can refuse to exist, and a refusal is never a zero. A leg
 * measured at zero and a leg nobody could measure are opposite claims:
 *
 *  - **No reference return** → the market leg is withheld *and so is the
 *    residual*. A residual with no market leg subtracted from it is just day
 *    P&L wearing a more flattering name, so the waterfall degenerates to the
 *    costs plus one bar honestly labelled "Unattributed".
 *  - **Some betas unmeasurable** → those positions leave the market leg, which
 *    is then *understated*; their P&L lands in the residual and their names are
 *    reported in `unmeasuredSymbols`. If *no* held position has a measurable
 *    beta the leg is withheld outright rather than reported as zero — and then
 *    `unmeasuredSymbols` is empty, because a leg that does not exist cannot be
 *    understated by the names missing from it.
 *  - **No `attribution.session`** → an older gateway, not a broken one. The
 *    cost legs are withheld, the residual absorbs them, and the note says so —
 *    naming the legs actually withheld, never both when only one was.
 *  - **`0 < fills_without_slippage < fills`** → the slippage leg is a *lower
 *    bound*: some of the cost was measured and the rest is missing, which is a
 *    measurement with a known direction of error.
 *  - **`fills_without_slippage >= fills`** → the leg is *withheld*. `session_costs`
 *    sums `COALESCE(notional,0) * COALESCE(slippage_bps,0)`, so a session whose
 *    every fill has a NULL slippage reports `slippage_cost: 0.0` — a sum over
 *    nothing. `_maker_fill` writes that NULL whenever there is no mark, so one
 *    mark outage during a maker-filled session is enough to reach it, and
 *    reporting it as a measured zero says execution was free when what happened
 *    is that nobody could tell what it cost.
 *  - **Sandbox** → the generated book carries its own generated market leg and
 *    the beta path never runs. Attributing part of a synthetic P&L to a real
 *    measured market move would be a fabricated attribution, and it would move
 *    the number between a server render and a client hydrate.
 *
 * ── On the word "residual" ──────────────────────────────────────────────────
 * It is never called alpha. It contains genuine idiosyncratic moves, but also
 * intraday trading P&L, beta-estimation error, the P&L of every position whose
 * beta could not be measured, and the error from computing the market leg on
 * closing rather than opening exposure. Naming that alpha would be exactly the
 * fabrication this codebase refuses everywhere else.
 */

// `SessionAttribution` describes `attribution.session` as
// `modules/portfolio.session_attribution` emits it, and it is imported from the
// module that owns the payload rather than restated here. A second structural
// copy of a wire shape does not fail loudly when the wire changes: both
// declarations keep compiling and only one of them still describes the gateway,
// so the duplicate rots in silence and takes a cost leg down with it.
import type { PortfolioPayload, SessionAttribution } from "@/lib/portfolio";
import type { RiskPosition } from "@/lib/portfolio-risk";

// --------------------------------------------------------------------------
// Output
// --------------------------------------------------------------------------

export type LegBasis = "measured" | "audited" | "derived" | "generated" | "withheld";

export interface PnlLeg {
  key: "market" | "residual" | "unattributed" | "slippage" | "fees";
  label: string;
  /**
   * Signed as a contribution to day P&L, so the legs sum to `dayPnl` and a
   * waterfall can draw them without re-deciding what a cost means: slippage and
   * fees are therefore **negative** in the ordinary case.
   *
   * Null when the leg cannot be computed truthfully. NEVER 0 as a stand-in — a
   * leg measured at zero and a leg nobody could measure are opposite claims.
   */
  value: number | null;
  basis: LegBasis;
  /** One sentence naming where the number came from, or why it is absent. */
  note: string;
}

export interface PnlWaterfall {
  startEquity: number;
  endEquity: number;
  dayPnl: number;
  legs: PnlLeg[];
  /**
   * Held symbols excluded from the market leg because their beta could not be
   * measured. Non-empty means the market leg is understated by exactly their
   * exposure, and the residual is carrying it.
   *
   * Therefore **empty whenever the market leg is withheld**, on every path that
   * withholds it. There is no leg for those names to have been excluded from and
   * nothing for them to understate, and the panel that reads this field says in
   * so many words that "the market leg excludes them and is understated by
   * whatever they moved" — a sentence that is false about a leg which does not
   * exist. The withheld leg's own note carries the reason instead.
   */
  unmeasuredSymbols: string[];
  /** dayPnl - (realised + unrealised). Legitimately non-zero in a correct multi-day
   *  book — mark-to-market carried in on positions opened before the session. */
  carriedMarkToMarket: number | null;
  referenceSymbol: string | null;
  referenceReturn: number | null;
  /**
   * Some — but not all — of this session's fills carried no measured slippage,
   * so the leg is a floor on execution cost rather than a measurement of it.
   *
   * False when *none* of them did: that leg is withheld, and a caveat about how
   * far a bar understates the truth is meaningless next to a bar nobody drew.
   */
  slippageIsLowerBound: boolean;
  /** True only when every leg is present and they reconcile to dayPnl. */
  complete: boolean;
}

/**
 * How close the legs must sum to day P&L before the decomposition is called
 * complete. One cent: the residual is a plug, so the only error possible is
 * float accumulation, and anything larger than this is a bug rather than a
 * rounding artefact.
 */
export const RECONCILIATION_TOLERANCE = 0.01;

// --------------------------------------------------------------------------
// Numbers
// --------------------------------------------------------------------------

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * IEEE −0, kept out of every number this module hands to a renderer.
 *
 * `-slippage_cost` on a session that genuinely cost nothing is −0, and the
 * shipped panel prints that as `$-0` in the **positive** class, because
 * `-0 >= 0` is true — a cost drawn as a signed-negative gain, while the chart
 * label on the very same leg reads `+$0` because `-0 < 0` is false. The two
 * halves of one panel then disagree about the sign of the same number.
 *
 * Not a hypothetical: `session_attribution` emits `fees: 0.0,
 * slippage_cost: 0.0` for any session with no fills, and `round(-0.001, 2)`
 * emits a literal `-0.0` that `JSON.parse` faithfully preserves. −0 and 0 are
 * the same quantity, so collapsing them loses nothing and stops the sign being
 * something IEEE decided rather than the desk.
 */
function positiveZero(value: number): number {
  return value === 0 ? 0 : value;
}

// --------------------------------------------------------------------------
// Timing alignment
// --------------------------------------------------------------------------

/** `new Date(ms).toISOString()` throws beyond ±8.64e15 rather than returning junk. */
const MAX_TIMESTAMP_MS = 8.64e15;

function utcDate(ms: number): string | null {
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_TIMESTAMP_MS) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The session-to-date return of the reference instrument — or null, loudly.
 *
 * The alignment this depends on is real but fragile, so it is checked rather
 * than assumed. `_roll_session_if_needed` measures a **UTC** day and Binance 1d
 * klines close at UTC midnight; `fetchBinanceKlines` sends no `endTime` on the
 * first page, so the newest kline is the in-progress UTC day. The newest daily
 * return is therefore exactly the session-to-date return over exactly the
 * gateway's window.
 *
 * "Therefore" is doing a lot of work there. A gateway that was restarted, or
 * one that has been up across a UTC midnight without rolling, carries a
 * `session_date` that is not today's UTC date — and then the newest kline
 * measures a different day from the P&L it would be attributing. That produces
 * a market leg that is wrong rather than missing, which is the failure mode this
 * whole module exists to avoid. So the bar's own UTC date must equal the
 * session the book claims, and a mismatch returns null.
 */
export function sessionReturn(
  bar: { openMs: number; prevClose: number; close: number } | undefined,
  sessionDate: string,
): number | null {
  if (!bar) return null;
  const openMs = finite(bar.openMs);
  const prevClose = finite(bar.prevClose);
  const close = finite(bar.close);
  if (openMs === null || prevClose === null || close === null) return null;
  // A non-positive previous close cannot produce a return; it can only produce
  // an Infinity or a sign flip that would render as a plausible number.
  if (prevClose <= 0) return null;
  const barDate = utcDate(openMs);
  if (barDate === null || !sessionDate || barDate !== sessionDate) return null;
  return close / prevClose - 1;
}

// --------------------------------------------------------------------------
// Reading the session block
// --------------------------------------------------------------------------

type SessionRead =
  | { state: "ok"; session: SessionAttribution; basis: "audited" | "generated" }
  /** No block at all, or a `{}` from a gateway running without an audit log. */
  | { state: "absent" }
  /** The block covers a different UTC day than the book's own session. */
  | { state: "mismatch"; blockDate: string }
  /** The book and the block disagree about whether any of this is real. */
  | { state: "inconsistent" };

/**
 * The session block, accepted only when it describes *this* book and *this* day.
 *
 * Three rejections, each for a different lie it could otherwise tell:
 *
 *  - A `basis` that disagrees with `book.sandbox` means one of the two is
 *    describing a book that does not exist. A live gateway must never emit
 *    `generated`, and the sandbox must never claim `audited` fills, so the
 *    contradiction is surfaced rather than resolved in favour of either.
 *  - A `session_date` other than the book's is a stale or restarted gateway.
 *    Those costs are real, they are simply another day's, and subtracting them
 *    from this day's P&L is the same error as using the lifetime totals. A
 *    block that names *no* date is accepted rather than rejected — the costs may
 *    well be this session's — but silence is not agreement, so `costLegs` says
 *    the date could not be checked instead of asserting a day the block never
 *    claimed.
 *  - Anything without a `basis` is the empty block, which is a gateway with no
 *    audit log rather than a gateway reporting zero cost.
 */
function readSession(book: PortfolioPayload, sandbox: boolean): SessionRead {
  const session = book.attribution?.session;
  if (!session || typeof session !== "object") return { state: "absent" };

  const basis = session.basis;
  if (basis !== "audited" && basis !== "generated") return { state: "absent" };
  if (sandbox !== (basis === "generated")) return { state: "inconsistent" };

  const blockDate = session.session_date;
  if (typeof blockDate === "string" && blockDate && blockDate !== book.session_date) {
    return { state: "mismatch", blockDate };
  }

  return { state: "ok", session, basis };
}

// --------------------------------------------------------------------------
// Cost legs
// --------------------------------------------------------------------------

const ABSENT_COST_NOTE =
  "Withheld: this gateway sent no session attribution block, and the lifetime totals it did send "
  + "cover every session since the audit log was opened — subtracting those from one day's P&L "
  + "would report a loss the desk did not take.";

function withheldCostNote(read: SessionRead, book: PortfolioPayload, what: string): string {
  if (read.state === "mismatch") {
    return `Withheld: the gateway's attribution block covers ${read.blockDate} but this book's `
      + `session is ${book.session_date}, so those ${what} belong to a different day.`;
  }
  if (read.state === "inconsistent") {
    return `Withheld: this book and its attribution block disagree about whether they are `
      + `generated or audited, and ${what} cannot be read off a contradiction.`;
  }
  return ABSENT_COST_NOTE;
}

interface CostLegs {
  slippage: PnlLeg;
  fees: PnlLeg;
  lowerBound: boolean;
}

function costLegs(read: SessionRead, book: PortfolioPayload): CostLegs {
  if (read.state !== "ok") {
    return {
      slippage: {
        key: "slippage", label: "Slippage", value: null, basis: "withheld",
        note: withheldCostNote(read, book, "execution costs"),
      },
      fees: {
        key: "fees", label: "Fees", value: null, basis: "withheld",
        note: withheldCostNote(read, book, "fees"),
      },
      lowerBound: false,
    };
  }

  const { session, basis } = read;
  const slippageCost = finite(session.slippage_cost);
  const fees = finite(session.fees);
  const unmeasured = finite(session.fills_without_slippage) ?? 0;

  // The two counts default independently, so a block can report fills it never
  // counted — and `${unmeasured} of ${fills}` then renders the impossible
  // "4 of 0 fills". A fill count is only usable as a denominator when it is a
  // positive number; anything else means the block never stated one.
  const fills = finite(session.fills);
  const counted = fills !== null && fills > 0 ? fills : null;

  /**
   * Not one fill in the session carried a measured slippage.
   *
   * `session_costs` sums `COALESCE(notional,0) * COALESCE(slippage_bps,0)`, so
   * this session reports `slippage_cost: 0.0` — a sum over nothing, not a
   * measurement of nothing. `_maker_fill` records `slippage_bps = None` whenever
   * there is no mark, and it is the only Fill construction that writes NULL, so
   * a single mark outage across a maker-filled session produces exactly this.
   * Drawing it as an audited leg of −0 would say execution was free on a session
   * where nobody could measure what execution cost, which is the one collapse
   * this whole module exists to prevent.
   */
  const noneMeasured = counted !== null && unmeasured >= counted;

  // A lower bound is a measurement whose error has a known *direction*: some of
  // the cost was measured, the rest is missing, and the truth is at least this.
  // That claim needs at least one measured fill to stand on, so the all-NULL
  // session above is withheld rather than described as a bound on itself.
  const lowerBound = slippageCost !== null && unmeasured > 0 && !noneMeasured;

  const day = typeof session.session_date === "string" && session.session_date
    ? session.session_date
    : null;
  const source = basis === "generated"
    ? "Generated with the sandbox book"
    : day === null
      ? "Replayed from audited fills"
      : `Replayed from audited fills for session ${day}`;
  // `readSession` only rejects a date that *disagrees* with the book's. An
  // undated block passes, and naming the book's own session in its note would
  // put a claim in the block's mouth that the block never made — the same class
  // of fabrication as reading its silence about slippage as a zero.
  const undated = basis === "audited" && day === null
    ? ` The block names no session date, so these costs could not be checked against this book's `
      + `session of ${book.session_date}.`
    : "";

  // The lower-bound sentence, in the two forms the block's own counts allow: with
  // a denominator when it stated a usable fill count, and without one when it did
  // not. The bound itself holds either way — at least this many fills went
  // unmeasured — so the missing denominator weakens the sentence, not the claim.
  const boundClause = !lowerBound
    ? ""
    : counted === null
      ? ` ${unmeasured} fills carry no measured slippage — the block states no fill count to weigh `
        + `that against — so this is a lower bound on what execution actually cost.`
      : ` ${unmeasured} of ${counted} fills carry no measured slippage, so this is a lower bound `
        + `on what execution actually cost.`;

  const slippageNote = slippageCost === null
    ? "Withheld: the session block carries no slippage figure, so the gap between the decision "
      + "price and the fill price was never measured for this session."
    : noneMeasured
      ? `Withheld: not one of the ${counted} fills this session carries a measured slippage, so `
        + `the block's Σ notional × slippage bps is a sum over nothing rather than a cost of zero `
        + `— the gap between decision price and fill price went unmeasured on every fill, and `
        + `reporting that as free execution would be a fabricated measurement.`
      : `${source}: Σ notional × slippage bps ÷ 10,000, already inside day P&L because paper fills `
        + `print at the route VWAP rather than at mid.${boundClause}${undated}`;

  return {
    slippage: {
      key: "slippage",
      label: "Slippage",
      // Negated: the block reports cost as a positive number, and every leg
      // here is signed as a contribution to P&L so the four of them add up.
      value: slippageCost === null || noneMeasured ? null : positiveZero(-slippageCost),
      basis: slippageCost === null || noneMeasured ? "withheld" : basis,
      note: slippageNote,
    },
    fees: {
      key: "fees",
      label: "Fees",
      value: fees === null ? null : positiveZero(-fees),
      basis: fees === null ? "withheld" : basis,
      note: fees === null
        ? "Withheld: the session block carries no fee total for this session."
        : `${source}: already inside day P&L via \`realized_pnl -= fee\` on every fill, and `
          + `counted exactly once here.${undated}`,
    },
    lowerBound,
  };
}

// --------------------------------------------------------------------------
// Market leg
// --------------------------------------------------------------------------

interface MarketLeg {
  leg: PnlLeg;
  unmeasuredSymbols: string[];
  referenceSymbol: string | null;
  referenceReturn: number | null;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * The generated market leg the sandbox supplies for itself.
 *
 * Read verbatim, never recomputed. The sandbox book's P&L is invented, so the
 * only internally consistent market leg is the one invented alongside it —
 * running measured betas against a real Binance return would attribute part of
 * a synthetic number to a real market move, and would additionally make the
 * panel render differently on the server and on the client.
 */
function generatedMarketLeg(session: SessionAttribution): MarketLeg {
  const marketPnl = finite(session.market_pnl);
  const referenceSymbol = session.reference_symbol ?? null;
  const referenceReturn = finite(session.reference_return);

  if (marketPnl === null) {
    return {
      leg: {
        key: "market", label: "Market (beta)", value: null, basis: "withheld",
        note: "Withheld: this is the generated sandbox book and its attribution block supplies no "
          + "market leg, and measuring one against real prices would attribute a synthetic P&L to "
          + "a real market move.",
      },
      unmeasuredSymbols: [],
      // Nulled for the same reason `unmeasuredSymbols` is emptied above: the
      // panel's closing paragraph is gated on this pair alone, so leaving it
      // populated makes it print "the market leg uses X at Y%, applied through
      // each position's measured beta" about a leg that was withheld. Two of the
      // four withheld-market paths already null it; a field that survives on
      // some of them and not others is a field the reader cannot trust.
      referenceSymbol: null,
      referenceReturn: null,
    };
  }

  return {
    leg: {
      key: "market",
      label: "Market (beta)",
      value: positiveZero(marketPnl),
      basis: "generated",
      note: `Generated with the sandbox book from a ${referenceSymbol ?? "reference"} move of `
        + `${referenceReturn === null ? "an unstated size" : percent(referenceReturn)} — the book `
        + `is synthetic and so is this leg.`,
    },
    unmeasuredSymbols: [],
    referenceSymbol,
    referenceReturn,
  };
}

/**
 * Σ signedNotional × beta × the reference return, over the positions that have
 * a beta at all.
 *
 * `beta()` in `lib/portfolio-risk.ts` returns null rather than defaulting to 1,
 * and that null has to survive to here: a missing beta silently treated as 1
 * would move an unmeasurable instrument exactly with the reference and produce
 * a market leg indistinguishable from a measured one.
 *
 * Computed on *closing* exposure, because closing exposure is what the payload
 * carries. A book that traded during the session did not hold this exposure all
 * day, so the leg carries that error — which is one of the several things
 * living in the residual, and one of the several reasons it is not alpha.
 */
function measuredMarketLeg(
  positions: RiskPosition[],
  betaBySymbol: Map<string, number | null>,
  referenceSymbol: string,
  referenceReturn: number,
): MarketLeg {
  const exposed = positions.filter((p) => finite(p.signedNotional) !== null && p.signedNotional !== 0);
  const measured = exposed.filter((p) => finite(betaBySymbol.get(p.symbol)) !== null);
  const unmeasuredSymbols = exposed
    .filter((p) => finite(betaBySymbol.get(p.symbol)) === null)
    .map((p) => p.symbol);

  // A flat book has no market exposure, and saying so is a measurement rather
  // than a guess — this is the one zero in this module that is a real answer.
  if (!exposed.length) {
    return {
      leg: {
        key: "market", label: "Market (beta)", value: 0, basis: "measured",
        note: `The book holds no position, so there is no exposure for the ${referenceSymbol} `
          + `move of ${percent(referenceReturn)} to act on.`,
      },
      unmeasuredSymbols: [],
      referenceSymbol,
      referenceReturn,
    };
  }

  // Every held name is unmeasurable. Zero here would read as "the market
  // contributed nothing", which is the opposite of "we could not tell".
  if (!measured.length) {
    return {
      leg: {
        key: "market", label: "Market (beta)", value: null, basis: "withheld",
        note: `Withheld: not one of the ${exposed.length} held positions — `
          + `${unmeasuredSymbols.join(", ")} — has a measurable beta against ${referenceSymbol}, `
          + `so any market leg here would be an assumption wearing the shape of a measurement.`,
      },
      // Empty, not `unmeasuredSymbols`. The field means "excluded from a market
      // leg that exists", and the panel spends a paragraph on it saying the leg
      // "excludes them and is understated by whatever they moved" — false when
      // there is no leg to understate. The no-reference-return path already
      // returns `[]` for exactly this reason; two withheld market legs that
      // disagree about it would make the field mean one thing on one path and
      // the opposite on the other. The names are in the note above instead.
      unmeasuredSymbols: [],
      // Nulled for the same reason `unmeasuredSymbols` is emptied above: the
      // panel's closing paragraph is gated on this pair alone, so leaving it
      // populated makes it print "the market leg uses X at Y%, applied through
      // each position's measured beta" about a leg that was withheld. Two of the
      // four withheld-market paths already null it; a field that survives on
      // some of them and not others is a field the reader cannot trust.
      referenceSymbol: null,
      referenceReturn: null,
    };
  }

  let value = 0;
  for (const position of measured) {
    value += position.signedNotional * (betaBySymbol.get(position.symbol) as number) * referenceReturn;
  }

  const complete = unmeasuredSymbols.length === 0;
  return {
    leg: {
      key: "market",
      label: "Market (beta)",
      value: positiveZero(value),
      basis: "measured",
      note: complete
        ? `Σ signed notional × measured beta × the ${referenceSymbol} session return of `
          + `${percent(referenceReturn)}, across all ${measured.length} held positions.`
        : `Σ signed notional × measured beta × the ${referenceSymbol} session return of `
          + `${percent(referenceReturn)}, across ${measured.length} of ${exposed.length} held `
          + `positions — ${unmeasuredSymbols.join(", ")} have no measurable beta, so this leg is `
          + `understated and their P&L falls into the residual instead.`,
    },
    unmeasuredSymbols,
    referenceSymbol,
    referenceReturn,
  };
}

// --------------------------------------------------------------------------
// The waterfall
// --------------------------------------------------------------------------

const RESIDUAL_NOTE =
  "The plug: day P&L less every other leg, holding genuine idiosyncratic moves together with "
  + "intraday trading P&L, beta-estimation error, and the error from computing the market leg on "
  + "closing rather than opening exposure — which is why it is called a residual and not alpha.";

const UNATTRIBUTED_NOTE =
  "Day P&L less whatever costs could be measured. With no market leg there is nothing to "
  + "residualise against, so this remainder is not attributed to anything — calling it a residual "
  + "would be day P&L wearing a more flattering name.";

/**
 * The four-bar decomposition of one session's P&L.
 *
 * Returns null only when the payload cannot support any decomposition at all —
 * a missing or non-finite equity block. Every other degradation is expressed as
 * a withheld leg, because "the gateway is older than this feature" and "the
 * gateway is broken" must not render the same.
 */
export function buildPnlWaterfall(input: {
  book: PortfolioPayload;
  positions: RiskPosition[];
  betaBySymbol: Map<string, number | null>;
  referenceSymbol: string;
  referenceReturn: number | null;
}): PnlWaterfall | null {
  const { book, positions, betaBySymbol, referenceSymbol, referenceReturn } = input;

  const equity = book?.equity;
  const dayPnl = finite(equity?.daily_pnl);
  const startEquity = finite(equity?.start_of_day);
  const endEquity = finite(equity?.current);
  if (dayPnl === null || startEquity === null || endEquity === null) return null;

  const sandbox = book.sandbox === true;
  const read = readSession(book, sandbox);
  const { slippage, fees, lowerBound } = costLegs(read, book);

  // The sandbox never runs the beta path — not even when a reference return is
  // available, which it usually is, since the market data routes answer
  // regardless of whether the gateway does.
  const market: MarketLeg = sandbox
    ? read.state === "ok"
      ? generatedMarketLeg(read.session)
      : {
          leg: {
            key: "market", label: "Market (beta)", value: null, basis: "withheld",
            note: "Withheld: this is the generated sandbox book, and attributing part of a "
              + "generated P&L to a real measured market move would be a fabricated attribution.",
          },
          unmeasuredSymbols: [],
          referenceSymbol: null,
          referenceReturn: null,
        }
    : referenceReturn === null || finite(referenceReturn) === null
      ? {
          leg: {
            key: "market", label: "Market (beta)", value: null, basis: "withheld",
            note: `Withheld: the ${referenceSymbol} session return could not be measured against `
              + `this book's session, so there is no reference move to apply the betas to.`,
          },
          unmeasuredSymbols: [],
          // Nulled alongside the return rather than left standing. The panel
          // gates its closing paragraph on this pair, and a symbol with no move
          // beside it still reads as "the market leg uses BTCUSDT" — naming a
          // reference for an attribution that was withheld. The symbol is
          // already in the note above, where it explains what could not be
          // measured instead of implying something was.
          referenceSymbol: null,
          referenceReturn: null,
        }
      : measuredMarketLeg(positions, betaBySymbol, referenceSymbol, referenceReturn);

  const knownCosts = (slippage.value ?? 0) + (fees.value ?? 0);

  // Named individually, because a cost leg that *was* measured has already been
  // subtracted out and the remainder is not carrying it. A note that blames both
  // legs whenever either is missing tells a reader to mentally re-add a number
  // that is already accounted for — double-counting the one leg the module got
  // right. Fees first so the pair reads as "fee and slippage".
  const withheldCosts = [
    fees.value === null ? "fee" : null,
    slippage.value === null ? "slippage" : null,
  ].filter((name): name is string => name !== null);
  const absorbed = withheldCosts.length
    ? `${withheldCosts.join(" and ")} ${withheldCosts.length > 1 ? "legs" : "leg"}`
    : null;

  // The remainder, and what it is allowed to be called. With a market leg it is
  // a residual; without one the same arithmetic is just day P&L minus costs,
  // and it gets a name that admits it.
  const remainder = market.leg.value === null
    ? {
        key: "unattributed" as const,
        label: "Unattributed",
        value: positiveZero(dayPnl - knownCosts),
        basis: "derived" as LegBasis,
        note: UNATTRIBUTED_NOTE
          + (absorbed ? ` It also absorbs the withheld ${absorbed}.` : ""),
      }
    : {
        key: "residual" as const,
        label: "Residual",
        value: positiveZero(dayPnl - market.leg.value - knownCosts),
        basis: "derived" as LegBasis,
        note: RESIDUAL_NOTE
          + (absorbed
            ? ` It is also absorbing the withheld ${absorbed}, which `
              + `${withheldCosts.length > 1 ? "are" : "is"} inside day P&L but could not be `
              + `separated out.`
            : ""),
      };

  const legs: PnlLeg[] = [market.leg, remainder, slippage, fees];

  // `complete` is a statement about arithmetic closure — every leg present, and
  // the four of them summing to the number they decompose. It is deliberately
  // *not* a quality claim: a waterfall can be complete while its market leg is
  // understated by an unmeasurable beta. `unmeasuredSymbols` and
  // `slippageIsLowerBound` carry that, and a caller that wants "trustworthy"
  // rather than "closed" has to read all three.
  const present = legs.every((leg) => leg.value !== null);
  const total = legs.reduce((acc, leg) => acc + (leg.value ?? 0), 0);
  const complete = present && Math.abs(total - dayPnl) <= RECONCILIATION_TOLERANCE;

  const realized = finite(equity?.realized_pnl);
  const unrealized = finite(equity?.unrealized_pnl);

  // Every figure that leaves here goes through `positiveZero`, not just the leg
  // values: the header renders `dayPnl` with the same `>= 0` colour test the
  // table uses on a leg, so a −0 day P&L prints "$-0" in the gain colour there
  // too. One rule for every number the module emits is also one rule to state.
  return {
    startEquity: positiveZero(startEquity),
    endEquity: positiveZero(endEquity),
    dayPnl: positiveZero(dayPnl),
    legs,
    unmeasuredSymbols: market.unmeasuredSymbols,
    carriedMarkToMarket:
      realized === null || unrealized === null
        ? null
        : positiveZero(dayPnl - (realized + unrealized)),
    referenceSymbol: market.referenceSymbol,
    referenceReturn: market.referenceReturn,
    slippageIsLowerBound: lowerBound,
    complete,
  };
}
