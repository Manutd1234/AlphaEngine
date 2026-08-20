/**
 * The mean-reversion family: eight rules that buy weakness and sell strength.
 *
 * Every one of them is short volatility in disguise, and every one of them is
 * taken apart by the same market — a trend that does not come back. The
 * entries below differ on WHICH trend does it and how quickly, which is the
 * only part a reader can act on.
 */

import type { StrategyDoc } from "@/lib/strategy-docs/model";
import type { Strategy } from "@/lib/types";

export const REVERSION_DOCS = {
  rsi_reversion: {
    summary: "Buy oversold, exit on recovery or when the trend gives way.",
    formula:
      "Long when RSI(fast) < 30. Flat when RSI > 50 OR close < SMA(slow). The trend filter is an EXIT, not an entry gate — requiring oversold and above-trend simultaneously makes the two conditions nearly exclusive, and the model takes almost no trades.",
    whenItWorks:
      "Instruments that oscillate around a stable level. Win rate is high; individual wins are small.",
    whenItFails:
      "Sustained downtrends, catastrophically. RSI can sit under 30 for weeks while price halves, and \"oversold\" describes the indicator rather than the value.",
    similar: ["rsi_trend", "williams_r", "stochastic", "zscore_reversion"],
  },
  williams_r: {
    summary:
      "Where the close sits inside the recent range, traded as a reversion signal.",
    formula:
      "%R = −100 × (highest high − close) / (highest high − lowest low) over `fast` bars. Long below −80; flat above −20 or when close < SMA(slow).",
    whenItWorks:
      "Range-bound markets with a stable width. %R is bounded by construction, so it cannot drift the way an unbounded oscillator can.",
    whenItFails:
      "An expanding range. The denominator grows with each new extreme, so %R recovers toward the middle without price recovering at all.",
    similar: ["stochastic", "rsi_reversion", "mfi_reversion"],
  },
  stochastic: {
    summary: "The close's position in the recent range, smoothed against itself.",
    formula:
      "%K = 100 × (close − lowest low) / (highest high − lowest low) over `fast` bars; %D = SMA(%K, slow). Long when %K < 20; flat when %K > 80 or %K < %D. Oversold arms the entry and %D confirms the exit — requiring `%K < 20 AND %K > %D` at once is the crossing instant, which almost never coincides, and the strategy took zero trades until they were separated.",
    whenItWorks: "Sideways markets with regular swings between support and resistance.",
    whenItFails:
      "Strong trends. %K pins above 80 for the whole advance, so the model spends the trend flat and re-enters at the top.",
    similar: ["stoch_rsi_x", "williams_r", "rsi_reversion", "mfi_reversion"],
  },
  zscore_reversion: {
    summary: "Buy when price is statistically far below its own recent mean.",
    formula:
      "z = (close − SMA(fast)) / σ(fast). Long when z < −slow; flat when z rises back above 0. The threshold is in standard deviations and is swept as a fraction.",
    whenItWorks:
      "Genuinely stationary series. This is the single-instrument shape of the pairs-trading rule, without the pair.",
    whenItFails:
      "Anything trending. A price making new lows has a mean that follows it down, so z returns to zero without price returning anywhere — the rule reports a successful reversion after a permanent loss.",
    similar: ["linreg_forecast", "rsi_reversion", "bollinger_breakout", "williams_r"],
  },
  cci_reversion: {
    summary:
      "The Commodity Channel Index, read as an overextension signal.",
    formula:
      "CCI = (typical price − SMA) / (0.015 × mean absolute deviation). Long below −`slow`, flat above 0 or under a 50-bar SMA. The 0.015 is Lambert's empirical constant, chosen so most readings fall inside ±100.",
    whenItWorks:
      "Range-bound markets with recurring extremes. Mean absolute deviation is less distorted by one outlier bar than a standard deviation, so the bands stay usable through a shock.",
    whenItFails:
      "Sustained trends, the same way every reversion rule fails: CCI can hold below −100 for the whole descent, and the trend filter is the only thing preventing a series of losing entries.",
    similar: ["rsi_reversion", "zscore_reversion", "dpo_reversion"],
  },
  stoch_rsi_x: {
    summary:
      "RSI's position inside its own recent range — an oscillator of an oscillator.",
    formula:
      "%K = (RSI − min RSI) / (max RSI − min RSI) over the ranking window. Long below 0.2, flat above 0.8. `fast` is the RSI period; `slow` is the window RSI is ranked inside.",
    whenItWorks:
      "Instruments whose RSI never reaches classical extremes. Re-ranking it locally makes a signal out of a range that would otherwise sit permanently between 40 and 60.",
    whenItFails:
      "Trends, and worse than plain RSI. Re-scaling to a local range guarantees extremes appear, so it produces confident oversold readings all the way down.",
    similar: ["rsi_reversion", "stochastic", "williams_r"],
  },
  dpo_reversion: {
    summary:
      "Price with its own trend removed, traded against the residual.",
    formula:
      "DPO = (close − SMA shifted back by n/2+1), scaled by the rolling standard deviation. Long below −`slow`σ, flat above 0. The shift is what removes the trend instead of lagging it.",
    whenItWorks:
      "Cyclical instruments. Detrending is what makes a cycle visible when a persistent drift would otherwise dominate the signal.",
    whenItFails:
      "Regime changes. The detrending window assumes the cycle length is roughly stable, and a market that switches from a 20-bar rhythm to a 60-bar one leaves DPO measuring the wrong thing entirely.",
    similar: ["zscore_reversion", "cci_reversion", "bollinger_pctb"],
  },
  bollinger_pctb: {
    summary:
      "Where the close sits between the Bollinger bands, as a number from 0 to 1.",
    formula:
      "%B = (close − lower band) / (upper − lower), with 2σ bands over `fast` bars. Long below `slow`, flat above 0.5. Same bands as the breakout strategy, opposite side of the trade.",
    whenItWorks:
      "Mean-reverting instruments. Because it is bounded, the entry level means the same thing across instruments and across volatility regimes, which a raw price distance does not.",
    whenItFails:
      "Strong trends, where %B pins near 0 for the whole decline. Running this against `bollinger_breakout` on the same symbol is the cheapest way to learn which side that instrument rewards.",
    similar: ["bollinger_breakout", "zscore_reversion", "stddev_channel"],
  },
} satisfies Partial<Record<Strategy, StrategyDoc>>;
