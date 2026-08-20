import type { Capability, Fundamentals, NewsItem, OhlcvBar, Quote } from "../types";
import { ContractResult, Violation, finite } from "./shared";

// --------------------------------------------------------------------------
// Bars
// --------------------------------------------------------------------------

/**
 * Largest tolerated gap, as a multiple of the median bar spacing.
 *
 * Exported so the test that pins it can cite the same number the check uses.
 */
export const MAX_GAP_MULTIPLE = 4.5;

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
  // hole in a 24/7 crypto series is missing data.
  //
  // 3x was the original threshold and it fired on every US equity daily series
  // this app can load — measured, not theorised: AAPL from Massive reports a
  // largest gap of exactly 4.0x the median, because a holiday Monday makes a
  // four-day weekend and there are roughly nine of those a year. A check that
  // warns "bars are missing" on every complete equity series is a check a
  // reader learns to scroll past, which costs more than the hole it was
  // written to catch.
  //
  // 4.5x keeps every exchange holiday (the longest routine US market closure is
  // Thursday→Monday at 4 days) and still catches a genuine hole, which starts
  // at a full missing week — 7x on daily bars, and larger on anything intraday
  // where the median spacing is smaller.
  if (bars.length >= 5) {
    const spacings: number[] = [];
    for (let i = 1; i < bars.length; i++) spacings.push(bars[i].t - bars[i - 1].t);
    const sorted = [...spacings].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const largest = Math.max(...spacings);
    if (median > 0 && largest > median * MAX_GAP_MULTIPLE) {
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
