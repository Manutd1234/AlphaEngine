import type { Capability, Fundamentals, NewsItem, OhlcvBar, Quote } from "../types";
import { ContractResult, FRESHNESS_LIMIT_MS, Violation, finite } from "./shared";

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
