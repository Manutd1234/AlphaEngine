/**
 * Momentum, volume, volatility, and the one fitted model.
 *
 * Grouped because none of the four families is large enough to be worth its own
 * file and all four read the same way: a measure of participation or of
 * dispersion, used as a filter or as a signal in its own right. The fitted
 * entry sits here too — it is the only strategy in the catalogue whose
 * parameters are estimated rather than chosen, and its failure section says so.
 */

import type { StrategyDoc } from "@/lib/strategy-docs/model";
import type { Strategy } from "@/lib/types";

export const MOMENTUM_DOCS = {
  momentum: {
    summary:
      "Buy what has already risen, ignoring the most recent bars — the academic 12-1 construction.",
    formula:
      "Long when the return from `slow` bars ago to `fast` bars ago is positive. The recent window is skipped deliberately: short-horizon reversal is the documented contaminant of momentum, and including it measures the opposite effect.",
    whenItWorks:
      "Cross-sectional and time-series momentum is one of the most replicated anomalies in finance, over horizons of months.",
    whenItFails:
      "Momentum crashes — sharp reversals after a sustained run, historically the worst drawdowns in the factor's history. The skip window does not protect against them.",
    similar: ["roc_trend", "ema_slope", "trix_cross"],
  },
  roc_trend: {
    summary: "Rate of change, gated by a longer trend filter.",
    formula:
      "Long when close / close[fast bars ago] − 1 > 0 AND close > SMA(slow). Both conditions must hold, so this one genuinely is a gate rather than a stop.",
    whenItWorks:
      "Trending markets where short-term momentum and long-term direction agree — the filter removes the counter-trend bounces.",
    whenItFails:
      "Range-bound markets, where the two conditions agree at the top of the range and disagree everywhere useful.",
    similar: ["momentum", "breakout_sma", "ema_slope"],
  },
  rsi_trend: {
    summary:
      "RSI read as a trend indicator rather than a reversion one — the opposite reading of the same number.",
    formula:
      "Long when RSI(fast) > 50 AND close > SMA(slow). RSI above 50 means average gains exceed average losses over the lookback, which is a statement about direction rather than exhaustion.",
    whenItWorks:
      "Trending markets — and it is worth running against `rsi_reversion` on the same instrument, because whichever wins tells you which regime the instrument is in.",
    whenItFails:
      "Ranges, where RSI crosses 50 constantly and the SMA filter is the only thing preventing continuous trading.",
    similar: ["rsi_reversion", "roc_trend", "ema_slope"],
  },
  obv_trend: {
    summary:
      "On-balance volume: a running total that adds the day's volume on an up close and subtracts it on a down one.",
    formula:
      "Long while OBV is above SMA(OBV, fast). The `slow` axis is unused and kept only so the grid keeps its shape.",
    whenItWorks:
      "Where volume leads price. Accumulation shows in OBV before it shows in the close, which is the entire premise.",
    whenItFails:
      "Ranges, where up and down closes alternate: OBV oscillates around its own average and crosses it on noise. And separately — the failure that has nothing to do with the market — any instrument whose reported volume is unreliable. Crypto is the standard example, with wash trading and venue-specific reporting, and OBV is only ever as good as the volume feed under it.",
    similar: ["vwap_trend", "volume_breakout", "mfi_reversion", "ma_cross"],
  },
  volume_breakout: {
    summary: "A price breakout that must be confirmed by unusual volume.",
    formula:
      "Long when close exceeds the prior `fast`-bar high AND volume exceeds its own `slow`-bar average; flat when close falls back below the breakout channel.",
    whenItWorks:
      "Separating real breakouts from drift. A move on ordinary volume is one participant; a move on twice the average is a change of opinion.",
    whenItFails:
      "Thin sessions and holidays, where volume itself is the anomaly. It also inherits every problem with the volume feed that `obv_trend` has.",
    similar: ["eom_trend", "donchian", "obv_trend", "breakout_sma"],
  },
  mfi_reversion: {
    summary: "RSI weighted by money flow — price and volume in one oscillator.",
    formula:
      "MFI over `fast` bars from typical price × volume, split into positive and negative flow. Long below 20; flat above 50 or when close < SMA(slow) — the same exit-dominates-entry structure as `rsi_reversion`.",
    whenItWorks:
      "Reversion where volume confirms exhaustion: a low MFI is a sell-off that is running out of participants, not just out of price.",
    whenItFails:
      "The same way RSI reversion fails, plus a volume feed that can be wrong. A downtrend on rising volume pins MFI low for as long as the selling lasts.",
    similar: ["rsi_reversion", "williams_r", "obv_trend"],
  },
  vwap_trend: {
    summary:
      "Trade above the volume-weighted average price, exit below a trend line.",
    formula:
      "Rolling VWAP over `fast` bars from typical price × volume; long while the close is above it, flat below SMA(slow). Rolling rather than session-anchored: a 24/7 instrument has no session, and a UTC boundary is not one.",
    whenItWorks:
      "Instruments where participants genuinely reference VWAP — large-cap equities most of all, since execution desks are measured against it.",
    whenItFails:
      "Thin or erratic volume. VWAP is a volume-weighted level, so a few outsized prints drag it somewhere no one traded.",
    similar: ["obv_trend", "ma_cross", "cmf_trend"],
  },
  awesome_cross: {
    summary:
      "Bill Williams' oscillator: two averages of the median price rather than the close.",
    formula:
      "AO = SMA(median price, fast) − SMA(median price, slow), traded as a sign change. Median price is (H+L)/2 — substituting the close makes a different indicator with the same name.",
    whenItWorks:
      "Instruments with meaningful intrabar range. Using the bar's midpoint rather than its close makes it less sensitive to where the last print happened to land.",
    whenItFails:
      "Low-range bars, where the median and the close converge and this becomes an ordinary SMA crossover with extra steps.",
    similar: ["ma_cross", "macd_cross", "cmo_trend"],
  },
  cmo_trend: {
    summary:
      "Chande's momentum oscillator, read as direction rather than exhaustion.",
    formula:
      "CMO = 100 × (up moves − down moves) / (up + down) over `fast` bars. Long above +`slow`, flat below −`slow`. Unlike RSI it is unsmoothed, so it reaches its extremes far more often.",
    whenItWorks:
      "Markets with persistent directional pressure. Being unsmoothed means it registers a regime change sooner than RSI does.",
    whenItFails:
      "Anything choppy. Without smoothing it crosses its thresholds constantly, which is why the entry and exit levels here are symmetric and far apart rather than RSI's 30/70.",
    similar: ["rsi_trend", "momentum", "awesome_cross"],
  },
  chaikin_volatility: {
    summary:
      "Rising volatility traded as a continuation signal, not a warning.",
    formula:
      "Rate of change of an EMA of the high-low spread over `slow` bars; long when it is rising and price is above a 50-bar SMA. The trend filter is what makes expansion bullish rather than merely eventful.",
    whenItWorks:
      "Breakouts from compression, where an expanding range and an upward trend genuinely coincide.",
    whenItFails:
      "Volatility spikes at a top. A crash expands the range violently, and without the trend filter this would read a collapse as a signal to buy.",
    similar: ["atr_breakout", "keltner_breakout", "ulcer_filter"],
  },
  ulcer_filter: {
    summary:
      "Hold the trend only while recent losses have been shallow and short.",
    formula:
      "The Ulcer Index is the root-mean-square drawdown from the rolling peak. Long while it is below `slow` and price is above a 50-bar SMA; flat above twice that or below the SMA.",
    whenItWorks:
      "Avoiding the worst of a decline. Unlike maximum drawdown, the Ulcer Index penalises duration as well as depth, so a long grinding loss registers where a single sharp dip does not.",
    whenItFails:
      "V-shaped recoveries. The index stays elevated for as long as the drawdown persists, so it keeps the position flat through the first and best part of the rebound.",
    similar: ["atr_trailing_stop", "chaikin_volatility", "supertrend"],
  },
  cmf_trend: {
    summary:
      "Volume weighted by where inside the bar the close landed.",
    formula:
      "Money-flow multiplier = ((close − low) − (high − close)) / (high − low), times volume, summed over `fast` bars and divided by total volume. Long above `slow`, flat below 0.",
    whenItWorks:
      "Detecting accumulation. A close at the high on heavy volume counts fully; a close at the midpoint counts zero however large the volume, which is what separates conviction from mere activity.",
    whenItFails:
      "Gapping instruments. The multiplier only sees inside the bar, so an overnight gap — the most informative move an equity makes — contributes nothing at all.",
    similar: ["obv_trend", "mfi_reversion", "force_index"],
  },
  force_index: {
    summary:
      "Price change multiplied by volume: direction and conviction in one number.",
    formula:
      "Force = (close − previous close) × volume, smoothed by an EMA over `fast` bars. Long while it is positive and price is above SMA(slow).",
    whenItWorks:
      "Confirming that a move has participation behind it. A large move on small volume and a small move on large volume are different events, and this is the simplest statistic that separates them.",
    whenItFails:
      "Low-volume drift, where the smoothed force hovers either side of zero and the sign flips on bars that barely moved. And structurally: force is unbounded and scales with both price and volume, so it cannot be compared across instruments or across a period where either changed by an order of magnitude — which is why this reads its sign rather than a level.",
    similar: ["obv_trend", "cmf_trend", "volume_breakout"],
  },
  eom_trend: {
    summary:
      "How far price travelled per unit of volume — the market nobody is defending.",
    formula:
      "Ease of Movement = midpoint change / (volume / range), smoothed over `fast` bars, scaled by 1e6 so the number is readable. Long while positive and above SMA(slow).",
    whenItWorks:
      "Spotting moves through thin resistance. A large advance on little volume is exactly the condition this was built to name.",
    whenItFails:
      "Thin, illiquid markets — every bar there is a large move on little volume, so the indicator sits permanently elevated and never says anything. It measures a ratio, and a ratio with a vanishing denominator is noise amplified rather than a signal. The same happens in a low-volatility range for the opposite reason: the numerator goes to zero and the sign flips on rounding.",
    similar: ["force_index", "cmf_trend", "obv_trend"],
  },
  aroon_cross: {
    summary:
      "The only indicator here that measures TIME rather than price.",
    formula:
      "Aroon Up = (period − bars since the window's high) / period × 100, and the mirror for Down. Long when Up exceeds `slow` and leads Down. Ties resolve to the most recent bar, which is the definition and the opposite of what an argmax returns.",
    whenItWorks:
      "Identifying a range that is about to end. Because it counts bars rather than distance, it can turn while price is still flat — which no price-based indicator can do.",
    whenItFails:
      "Choppy markets that keep setting marginal new extremes. Each one resets the count, so both lines stay high and the crossover fires repeatedly on nothing.",
    similar: ["donchian", "price_channel", "ema_slope"],
  },
  linreg_forecast: {
    summary:
      "The only model here that estimates its own rule: an ordinary least-squares forecast of the next bar's return, refitted as it goes.",
    formula:
      "Regress next-bar return on three features known at the bar — the 1-bar return, the 5-bar return, and the close's deviation from its 20-bar mean — over a trailing window of `fast` bars. Long when the forecast exceeds `slow` × the fit's own residual standard error; flat when the forecast turns negative. Refit every 20 bars: a coefficient set that changes every bar is fitting the last observation.",
    whenItWorks:
      "Series with genuine short-horizon autocorrelation, and it will find either sign of it — the coefficients decide whether the last move is continued or faded, rather than the user deciding in advance.",
    whenItFails:
      "Regime changes, which is the failure specific to being fitted. Coefficients estimated across a trending window keep predicting a trend into the range that follows, and the model is confidently wrong for a full window before the next refit corrects it. Compare its in-sample and out-of-sample Sharpe rather than reading the coefficients — a fit that only worked in-sample is the thing this strategy is most likely to be.",
    similar: ["zscore_reversion", "momentum", "roc_trend"],
  },
} satisfies Partial<Record<Strategy, StrategyDoc>>;
