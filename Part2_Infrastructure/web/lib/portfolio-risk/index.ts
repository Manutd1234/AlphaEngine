/**
 * Book-level risk — measured, not assumed.
 * ========================================
 *
 * The gateway is authoritative about *what the book is*: positions, notionals,
 * realised P&L, the limits that bind. It says nothing about how risky that book
 * is, because risk is a property of how the instruments move together, and the
 * gateway does not carry price history.
 *
 * So every covariance here comes from bars this app actually fetched. That
 * matters more than it sounds: a stress panel wired to hand-written betas will
 * produce confident numbers on a book it has never seen, and nothing on screen
 * distinguishes that from a real measurement. If the history is missing, the
 * functions below return `null` and the UI says so rather than substituting a
 * plausible constant.
 *
 * ── What is a model and what is a measurement ───────────────────────────────
 *  - Covariance, correlation, beta, historical VaR: **measured** from returns.
 *  - Parametric VaR/CVaR: **modelled** — it assumes normality, which crypto
 *    returns violate in exactly the tail the number is about. Both are reported
 *    side by side precisely so the gap is visible; when historical is materially
 *    worse than parametric, that gap *is* the fat tail.
 *  - Stress scenarios: **assumptions**, chosen by the person running them. The
 *    propagation to unshocked instruments uses a measured beta, but the shock
 *    itself is a hypothesis and is labelled as one.
 */

import { mean, stdev } from "../stats";
import { BARS_PER_YEAR } from "../types";

export type { ReturnsBySymbol, RiskPosition } from "./inputs";
export { buildCovariance } from "./covariance";
export type { CovarianceModel } from "./covariance";
export { gbmTerminalVar99, portfolioRisk } from "./risk";
export type { PortfolioRisk, RiskContribution } from "./risk";
export { SCENARIOS, applyScenario, beta, manualShocks } from "./stress";
export type { Scenario, ScenarioResult, Shock } from "./stress";
export { volatilityRegime } from "./regime";
export type { Regime, VolatilityRegime } from "./regime";
export { rollingVarBacktest, rollingVarSeries } from "./var-validation";
export type { VarBacktest, VarSeries, VarSeriesPoint } from "./var-validation";
export { ALLOCATION_METHODS, applyManualWeights, portfolioVariance, proposeAllocation, rebalanceTrades } from "./allocation";
export type { AllocationLimits, AllocationMethod, AllocationProposal, ManualAllocation, RebalanceTrade, TargetWeight } from "./allocation";
