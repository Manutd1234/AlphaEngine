/**
 * Types and shaping for the execution cockpit's gateway-backed panels.
 *
 * The gateway's audit rows arrive as loosely-typed JSON from a separately
 * deployed service. Parsing them here — once, defensively — keeps that
 * uncertainty out of the components, which should be rendering decisions rather
 * than guessing whether a field survived the trip.
 *
 * Nothing here fabricates a value. A missing number stays `null` and renders as
 * "—", because a slippage of "0" and a slippage nobody measured mean opposite
 * things to a trader reading an execution report.
 */

export type { BlotterRow, GateCheck, OrderStatus, RiskEventRow, WorkingOrderRow } from "./types";
export { toBlotterRow, toRiskEvent, toWorkingOrder } from "./parse";
export type { ExecutionSummary } from "./parse";
export { SANDBOX_LIMITS, sandboxBlotter, sandboxRiskEvents, sandboxWorkingOrders } from "./sandbox-data";
export { createSandboxDesk, summarise } from "./sandbox-desk";
export type { SandboxDecision, SandboxOrder } from "./sandbox-desk";
export { UNTAGGED, filterBlotterRows, filterWorkingOrders, rejectGateTags, strategyTags } from "./views";
export type { BlotterStatusFilter } from "./views";
export {
  BASIS_WORD, MIN_DISPERSION_FILLS, MIN_PRICED_FILLS, REALIZED_SPREAD_WITHHELD,
  SIMULATED_FLAG_UNSTATED, assumedSlippageNote, costBasis, effectiveSpreadBps, feeBps,
  priceImprovement, venueProvenance, venueQuality,
} from "./fill-quality";
export type {
  CostBasis, FillSource, PriceImprovement, ProvenanceMark, VenueMix, VenueProvenance, VenueQuality,
} from "./fill-quality";
