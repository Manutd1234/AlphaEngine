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

import type { Capability, OhlcvBar, Quote } from "./types";

export type Severity = "fatal" | "warn" | "drift";

export interface Violation {
  /** Stable identifier, so a dashboard can count occurrences over time. */
  check: string;
  severity: Severity;
  message: string;
  /** The offending value, when showing it helps and does not leak a secret. */
  observed?: string | number | null;
}

export interface ContractResult {
  capability: Capability;
  provider: string;
  passed: boolean;
  violations: Violation[];
  /** Checks that could not be evaluated because the input was absent. */
  notEvaluated: string[];
}

/** Beyond this a "live" quote is being read as something it is not. */
export const FRESHNESS_LIMIT_MS = 24 * 60 * 60 * 1000;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// --------------------------------------------------------------------------
// Quotes
// --------------------------------------------------------------------------

export function checkQuote(provider: string, quote: Quote, now = Date.now()): ContractResult {
  const violations: Violation[] = [];
  const notEvaluated: string[] = [];

  if (!finite(quote.price) || quote.price <= 0) {
    violations.push({
      check: "quote.price_positive",
      severity: "fatal",
      message: "A quote with no positive price is not a quote.",
      observed: quote.price ?? null,
    });
  }

  // High below low, or a price outside its own day range, is not a market
  // condition — it is a record assembled from two different moments.
  if (finite(quote.high) && finite(quote.low) && quote.high < quote.low) {
    violations.push({
      check: "quote.high_ge_low",
      severity: "fatal",
      message: `High ${quote.high} is below low ${quote.low}.`,
    });
  } else if (finite(quote.high) && finite(quote.low) && finite(quote.price)) {
    // A 1% tolerance: some venues stamp the range and the last trade from
    // marginally different snapshots, which is sloppy rather than broken.
    const tolerance = Math.max(quote.high - quote.low, quote.price * 0.01);
    if (quote.price > quote.high + tolerance || quote.price < quote.low - tolerance) {
      violations.push({
        check: "quote.price_within_range",
        severity: "warn",
        message: `Last ${quote.price} sits outside the day range ${quote.low}–${quote.high}.`,
      });
    }
  } else {
    notEvaluated.push("quote.price_within_range");
  }

  const asOf = quote.asOf ? Date.parse(quote.asOf) : NaN;
  if (Number.isNaN(asOf)) {
    // Unparseable and absent are different problems: one is a bad field, the
    // other is a provider that never promised one.
    if (quote.asOf) {
      violations.push({
        check: "quote.as_of_parseable",
        severity: "warn",
        message: "The as-of timestamp could not be parsed.",
        observed: String(quote.asOf).slice(0, 40),
      });
    } else {
      notEvaluated.push("quote.freshness");
    }
  } else {
    const age = now - asOf;
    if (age > FRESHNESS_LIMIT_MS) {
      violations.push({
        check: "quote.freshness",
        severity: "warn",
        message: `Quote is ${(age / 3_600_000).toFixed(1)} hours old.`,
        observed: quote.asOf,
      });
    }
    if (age < -60_000) {
      violations.push({
        check: "quote.not_from_the_future",
        severity: "warn",
        message: "Quote is stamped in the future — check the provider's timezone handling.",
        observed: quote.asOf,
      });
    }
  }

  // Secondary fields: their absence is drift, not failure. The price is still
  // usable; what is suspect is our mapping of the vendor's schema.
  for (const [field, value] of [["change", quote.change], ["changePct", quote.changePct]] as const) {
    if (value === null && finite(quote.prevClose) && finite(quote.price)) {
      violations.push({
        check: `quote.${field}_derivable`,
        severity: "drift",
        message: `${field} is null although a previous close is present — the vendor may have renamed the field.`,
      });
    }
  }

  return {
    capability: "quote",
    provider,
    passed: !violations.some((v) => v.severity === "fatal"),
    violations,
    notEvaluated,
  };
}

// --------------------------------------------------------------------------
// Bars
// --------------------------------------------------------------------------

export function checkBars(
  provider: string,
  bars: OhlcvBar[],
  requestedLimit?: number,
): ContractResult {
  const violations: Violation[] = [];
  const notEvaluated: string[] = [];

  if (!bars.length) {
    return {
      capability: "bars",
      provider,
      passed: false,
      violations: [{
        check: "bars.non_empty",
        severity: "fatal",
        message: "The provider returned no bars.",
      }],
      notEvaluated: ["bars.monotonic", "bars.high_ge_low", "bars.no_gaps"],
    };
  }

  let outOfOrder = 0;
  let duplicated = 0;
  let inverted = 0;
  let nonPositive = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (![bar.o, bar.h, bar.l, bar.c].every(finite) || bar.c <= 0) nonPositive++;
    if (finite(bar.h) && finite(bar.l) && bar.h < bar.l) inverted++;
    if (i > 0) {
      if (bar.t === bars[i - 1].t) duplicated++;
      else if (bar.t < bars[i - 1].t) outOfOrder++;
    }
  }

  if (nonPositive) {
    violations.push({
      check: "bars.prices_finite",
      severity: "fatal",
      message: `${nonPositive} bar(s) carry a null or non-positive price.`,
      observed: nonPositive,
    });
  }
  if (inverted) {
    violations.push({
      check: "bars.high_ge_low",
      severity: "fatal",
      message: `${inverted} bar(s) have a high below their low.`,
      observed: inverted,
    });
  }
  if (duplicated) {
    // A duplicated timestamp double-counts a return and understates volatility
    // — the failure mode that makes a backtest look calmer than the market.
    violations.push({
      check: "bars.unique_timestamps",
      severity: "fatal",
      message: `${duplicated} duplicated timestamp(s) — returns would be double-counted.`,
      observed: duplicated,
    });
  }
  if (outOfOrder) {
    violations.push({
      check: "bars.monotonic",
      severity: "fatal",
      message: `${outOfOrder} bar(s) arrive out of chronological order.`,
      observed: outOfOrder,
    });
  }

  // A short series is a legitimate answer for a young instrument, so this is a
  // warning: it tells a researcher their window is smaller than they asked for
  // rather than refusing the data.
  if (requestedLimit && bars.length < requestedLimit * 0.5) {
    violations.push({
      check: "bars.coverage",
      severity: "warn",
      message: `Only ${bars.length} of ${requestedLimit} requested bars were returned.`,
      observed: bars.length,
    });
  } else if (!requestedLimit) {
    notEvaluated.push("bars.coverage");
  }

  // Irregular spacing points at missing bars — a hole a strategy will silently
  // trade straight through, treating the two sides as consecutive.
  //
  // The threshold is the *largest* gap as a multiple of the median, not a count
  // of gaps, because a count cannot separate the two cases that matter. Daily
  // equity bars have a 3x gap every single weekend and are complete; one 16x
  // hole in a 24/7 crypto series is missing data. Strictly greater than 3x
  // keeps the weekend and catches the hole.
  if (bars.length >= 5) {
    const spacings: number[] = [];
    for (let i = 1; i < bars.length; i++) spacings.push(bars[i].t - bars[i - 1].t);
    const sorted = [...spacings].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const largest = Math.max(...spacings);
    if (median > 0 && largest > median * 3) {
      violations.push({
        check: "bars.no_gaps",
        severity: "warn",
        message: `Largest interval is ${(largest / median).toFixed(1)}x the median spacing — bars are missing.`,
        observed: Number((largest / median).toFixed(1)),
      });
    }
  } else {
    notEvaluated.push("bars.no_gaps");
  }

  return {
    capability: "bars",
    provider,
    passed: !violations.some((v) => v.severity === "fatal"),
    violations,
    notEvaluated,
  };
}

/** Compact one-line summary for a lineage stage or a trace event. */
export function summariseContract(result: ContractResult): string {
  if (!result.violations.length) {
    return result.notEvaluated.length
      ? `passed (${result.notEvaluated.length} check(s) not evaluated)`
      : "passed";
  }
  const counts = result.violations.reduce<Record<Severity, number>>(
    (acc, v) => ({ ...acc, [v.severity]: (acc[v.severity] ?? 0) + 1 }),
    { fatal: 0, warn: 0, drift: 0 },
  );
  return [
    counts.fatal ? `${counts.fatal} fatal` : null,
    counts.warn ? `${counts.warn} warning` : null,
    counts.drift ? `${counts.drift} drift` : null,
  ].filter(Boolean).join(", ");
}
