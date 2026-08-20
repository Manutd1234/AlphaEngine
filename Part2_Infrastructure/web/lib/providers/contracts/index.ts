/**
 * Data contracts — expectations a payload must meet before it is believed.
 * =========================================================================
 *
 * The adapters already throw when a *primary* field is missing: a quote with no
 * price fails loudly and the registry fails over to the next provider. That
 * covers the loud case. It does not cover the quiet one, which is the one that
 * costs money — a bar series with a duplicated timestamp, a high below its low,
 * a "live" quote stamped four days ago, a change field that silently became
 * null when the vendor renamed it. Every one of those is a payload that parses,
 * validates, renders, and is wrong.
 *
 * So this is a small expectation suite in the Great Expectations tradition,
 * evaluated after normalisation and before the answer is cached or shown.
 *
 * Three rules shape it:
 *
 * **1. Violations are attached, not thrown.** A stale timestamp does not
 * justify discarding a price a trader can see is stale; it justifies saying so.
 * Only checks marked `fatal` reject the payload, and those are reserved for
 * data that is internally impossible — a high below a low is not a market
 * condition, it is a broken record.
 *
 * **2. A check that cannot run is not a check that passed.** A provider that
 * publishes no timestamp cannot fail a freshness check, and pretending it
 * passed would make the least transparent vendor look like the most reliable.
 *
 * **3. Drift is reported separately from failure.** When a *secondary* field
 * coerces to null while the rest of the payload is intact, the likely cause is
 * a renamed vendor field, not a bad market. That distinction is exactly the
 * misdiagnosis this repo's pipeline inspector exists to prevent — "the change
 * field is null" versus "the vendor renamed the change field".
 */

export { CONTRACTED_CAPABILITIES, FRESHNESS_LIMIT_MS, VALIDATION_TELEMETRY_CAPACITY, validationTelemetry } from "./shared";
export type { ContractResult, Severity, ValidationCounts, ValidationTelemetrySnapshot, Violation } from "./shared";
export { checkQuote } from "./quotes";
export { MAX_GAP_MULTIPLE, checkBars } from "./bars";
export { NEWS_FUTURE_SKEW_MS, NEWS_MAX_AGE_MS, checkNews } from "./news";
export { checkFundamentals, summariseContract } from "./fundamentals";
