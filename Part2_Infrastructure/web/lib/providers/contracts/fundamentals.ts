import type { Capability, Fundamentals, NewsItem, OhlcvBar, Quote } from "../types";
import { ContractResult, Severity, Violation, finite } from "./shared";

// --------------------------------------------------------------------------
// Fundamentals
// --------------------------------------------------------------------------

/** Ticker spellings that mean the same listing: `BRK.B`, `BRK-B`, `brk.b`. */
function canonicalTicker(symbol: string): string {
  return symbol.toUpperCase().replace(/-/g, ".");
}

/**
 * Expectations on a normalised issuer profile.
 *
 * Fatal for a profile that is not about the issuer asked for, a profile with
 * nothing in it, a NaN that survived normalisation, or a market cap or share
 * count no company can have. Warnings for values that are possible but
 * unusual enough to check; drift for the two shapes a renamed vendor field
 * takes that can be told from a value: a missing name beside a present market
 * cap.
 */
export function checkFundamentals(
  provider: string,
  profile: Fundamentals,
  requestedSymbol: string,
): ContractResult {
  const violations: Violation[] = [];
  const notEvaluated: string[] = [];

  if (canonicalTicker(profile.symbol) !== canonicalTicker(requestedSymbol)) {
    violations.push({
      check: "fundamentals.symbol_matches",
      severity: "fatal",
      message: `Profile is for ${profile.symbol}, not ${requestedSymbol}.`,
      observed: profile.symbol,
    });
  }

  const numeric = [
    ["marketCap", profile.marketCap], ["peRatio", profile.peRatio], ["eps", profile.eps],
    ["beta", profile.beta], ["dividendYield", profile.dividendYield], ["sharesOutstanding", profile.sharesOutstanding],
  ] as const;
  const nonFinite = numeric.filter(([, v]) => v !== null && !finite(v));
  if (nonFinite.length) {
    violations.push({
      check: "fundamentals.numeric_finite",
      severity: "fatal",
      message: `${nonFinite.map(([k]) => k).join(", ")} ${nonFinite.length === 1 ? "is" : "are"} not a finite number.`,
      observed: nonFinite.map(([k]) => k).join(","),
    });
  }

  const empty = profile.name === null && profile.marketCap === null && profile.peRatio === null
    && profile.eps === null && profile.sharesOutstanding === null;
  if (empty) {
    violations.push({
      check: "fundamentals.non_empty",
      severity: "fatal",
      message: "The profile carries no name, market cap, P/E, EPS or share count.",
    });
  }

  if (finite(profile.marketCap)) {
    if (profile.marketCap < 0) {
      violations.push({
        check: "fundamentals.market_cap_non_negative",
        severity: "fatal",
        message: `Market cap ${profile.marketCap} is negative.`,
        observed: profile.marketCap,
      });
    }
  } else {
    notEvaluated.push("fundamentals.market_cap_non_negative");
  }

  if (finite(profile.sharesOutstanding)) {
    if (profile.sharesOutstanding <= 0) {
      violations.push({
        check: "fundamentals.shares_positive",
        severity: "fatal",
        message: `Shares outstanding ${profile.sharesOutstanding} is not positive.`,
        observed: profile.sharesOutstanding,
      });
    }
  } else {
    notEvaluated.push("fundamentals.shares_positive");
  }

  if (finite(profile.peRatio)) {
    if (Math.abs(profile.peRatio) > 1_000) {
      violations.push({
        check: "fundamentals.pe_ratio_sane",
        severity: "warn",
        message: `P/E of ${profile.peRatio} — possible, but worth a second look at the earnings figure.`,
        observed: profile.peRatio,
      });
    }
  } else {
    notEvaluated.push("fundamentals.pe_ratio_sane");
  }

  if (finite(profile.dividendYield)) {
    // Percent, as every adapter here normalises it. A scale drift (a vendor
    // switching to fractions) is NOT checked: a legitimate 0.5 % yield and a
    // 0.5 fraction are the same number, and a check that flags AAPL's yield
    // as drift is a check a reader learns to scroll past.
    if (profile.dividendYield < 0 || profile.dividendYield > 100) {
      violations.push({
        check: "fundamentals.dividend_yield_range",
        severity: "warn",
        message: `Dividend yield ${profile.dividendYield}% is outside 0–100.`,
        observed: profile.dividendYield,
      });
    }
  } else {
    notEvaluated.push("fundamentals.dividend_yield_range");
  }

  if (profile.name === null && finite(profile.marketCap)) {
    violations.push({
      check: "fundamentals.name_derivable",
      severity: "drift",
      message: "The name is null although a market cap is present — the vendor may have renamed the field.",
    });
  }

  return {
    capability: "fundamentals",
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
