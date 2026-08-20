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

export { RECONCILIATION_TOLERANCE } from "./types";
export type { LegBasis, PnlLeg, PnlWaterfall } from "./types";
export { sessionReturn } from "./numbers";
export { buildPnlWaterfall } from "./waterfall";
