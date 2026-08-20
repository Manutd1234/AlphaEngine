/**
 * Research analytics — the part that debugs a failed strategy.
 * ============================================================
 *
 * `engine.ts` answers "what did this strategy do" and is pinned byte-for-byte
 * against the Python `NumpyEngine` by the parity fixture. Nothing here touches
 * it. This file answers the four questions a researcher asks *after* the verdict
 * comes back red, and every one of them is additive:
 *
 *   1. **Is the winner a plateau or a cliff?** A grid reports one champion. If
 *      its neighbours in parameter space collapse, the champion is a coordinate,
 *      not an edge — and the single reported Sharpe cannot show that.
 *   2. **Where did walk-forward break?** One aggregate OOS Sharpe says a strategy
 *      failed. It does not say whether it decayed steadily, died in one regime,
 *      or was never there — and those imply completely different next steps.
 *   3. **Is it alpha, or is it beta?** A long-only crypto strategy in a bull
 *      market earns a good Sharpe by holding the asset. Regressing against the
 *      asset itself is the cheapest way to find out, and it is the check that
 *      most often kills a "working" strategy.
 *   4. **What does the loss tail look like?** Sharpe divides by standard
 *      deviation, which treats a fat left tail as ordinary variance. VaR, CVaR
 *      and the monthly grid do not.
 *
 * ── On the factors ──────────────────────────────────────────────────────────
 * These are **time-series factors built from the same instrument**, not
 * Fama–French, not cross-sectional. One symbol's OHLCV cannot produce SMB, HML,
 * or a cross-sectional momentum decile, and constructing something that merely
 * resembles them from a single series would be the exact dishonesty the rest of
 * this codebase exists to prevent. What a single series *can* answer honestly is
 * "is this just the asset", "is this just trend-following", and "is this just a
 * volatility-regime bet" — so those are the three, named for what they are, with
 * their pairwise correlations reported so collinearity is visible rather than
 * hidden inside an inflated standard error.
 */

export { regress } from "./ols";
export { FACTOR_LOOKBACK, buildFactors } from "./factors";
export type { FactorSet } from "./factors";
export { describeNeighbourhood, parameterStability } from "./stability";
export { overfittingProbability, walkForwardReport } from "./walk-forward";
export { monthlyReturns, percentile, tailReport } from "./tail-risk";
export { HOURS_PER_BAR, NO_FRICTIONS, averageDailyVolume, holdingCost, hoursPerBar, turnoverCost } from "./cost-model";
export type { CostModel } from "./cost-model";
export { promotionGate } from "./promotion";
export { DEFAULT_KELLY_FRACTION, MAX_STRATEGY_FRACTION, MIN_TRADES_FOR_SIZING, kellySizing } from "./sizing";
export type { KellySizing } from "./sizing";
