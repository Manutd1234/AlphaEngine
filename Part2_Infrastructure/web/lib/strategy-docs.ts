/**
 * What each strategy is, and — the half that usually goes unwritten — when it
 * does not work.
 *
 * The picker went from three strategies to twenty-six in four commits. A
 * dropdown of twenty-six names with no explanation is not more capability, it
 * is a longer list of things to try at random until one of them scores well,
 * which is precisely the search process the Deflated Sharpe Ratio exists to
 * punish. A reader who knows that Donchian breakout loses money in a range and
 * that RSI reversion loses money in a trend can rule out half the catalogue
 * before running anything.
 *
 * `whenItFails` is mandatory and is never a hedge. Every entry names a specific
 * market condition, because "may underperform in some conditions" is the same
 * sentence for all twenty-six and therefore tells a reader nothing.
 *
 * `formula` is the rule as implemented — matching `longState` in `engine.ts` and
 * `build_signals` in `backtester.py`, including the detail both engines share
 * and neither advertises: EXIT DOMINATES ENTRY on a bar where both fire.
 *
 * Parameter names are NOT repeated here. `PARAM_MEANING` already owns them and
 * the card renders from that, so a renamed axis cannot end up described one way
 * beside a slider labelled another.
 */

import type { Strategy } from "./types";

export interface StrategyDoc {
  /** One sentence a reader can decide from. */
  summary: string;
  /** The rule as implemented, in words rather than code. */
  formula: string;
  /** The market condition it is built for. */
  whenItWorks: string;
  /** The market condition that takes it apart. Never a hedge. */
  whenItFails: string;
  /** Strategies worth comparing against, by id. */
  similar: Strategy[];
}

export const STRATEGY_DOCS: Record<Strategy, StrategyDoc> = {
  ma_cross: {
    summary:
      "The oldest trend rule there is: hold while a short average sits above a long one.",
    formula:
      "Long while SMA(fast) > SMA(slow). Both averages must have filled their lookback — before that the rule has no opinion, which is not the same as an exit.",
    whenItWorks:
      "Sustained directional moves lasting many multiples of the slow period. It gives up the first part of every move and keeps the middle.",
    whenItFails:
      "Ranges. Price oscillating around the slow average crosses it repeatedly, and each crossing is a round trip paying fee plus slippage. This is the classic way a strategy with a positive raw edge is destroyed by costs.",
    similar: ["ema_cross", "triple_ma", "ema_slope"],
  },
  ema_cross: {
    summary:
      "The same crossover with exponential averages, which react faster to a turn and are noisier for it.",
    formula:
      "Long while EMA(fast) > EMA(slow). Unlike the SMA version there is no warm-up gap — an EMA has a value from the first bar, weighted toward recent prices.",
    whenItWorks:
      "Trends that begin sharply. The exponential weighting reaches a new level in roughly a third of the bars a simple average needs.",
    whenItFails:
      "Choppy markets, worse than the SMA version: reacting faster to a turn also means reacting faster to noise, so it trades more and pays more.",
    similar: ["ma_cross", "macd_cross", "ppo_cross"],
  },
  macd_cross: {
    summary:
      "The difference between two EMAs, traded against its own smoothed version.",
    formula:
      "MACD = EMA(fast) − EMA(slow); long while MACD > EMA(MACD, 9). The signal span is fixed at the conventional 9 — a third swept axis for a number nobody tunes would multiply every grid by nine.",
    whenItWorks:
      "Trends with visible acceleration. Because the comparison is against MACD's own average, it can turn long while price is still below its slow EMA.",
    whenItFails:
      "Low-volatility drift. MACD hugs zero, and its crossings with a 9-span smoothing of itself become almost arbitrary.",
    similar: ["ppo_cross", "trix_cross", "ema_cross"],
  },
  donchian: {
    summary:
      "Buy a new high, sell a new low. The rule the original Turtles traded.",
    formula:
      "Long when close exceeds the highest high of the previous `fast` bars; flat when it falls below the lowest low of the previous `slow` bars. Both channels are shifted one bar so the current bar cannot set the level it is being compared against.",
    whenItWorks:
      "Markets that break out and keep going — crypto and commodities more than large-cap equities. It is a small number of large winners and a long tail of small losses.",
    whenItFails:
      "Range-bound markets, where every new high is the top of the range. Win rate collapses below 40% and the winners that pay for it never arrive.",
    similar: ["price_channel", "breakout_sma", "volume_breakout"],
  },
  donchian_mid: {
    summary:
      "Donchian's channel used as a pullback entry rather than a breakout one.",
    formula:
      "Long when close is above the channel midpoint of the last `fast` bars; flat when it closes below SMA(slow). Entering at the midpoint rather than the high buys the retracement instead of the extension.",
    whenItWorks:
      "Trends that advance in steps. It gets in earlier and cheaper than the breakout version, at the cost of more false starts.",
    whenItFails:
      "A market that is halfway through a top. The midpoint of a widening range is a level price crosses on the way down as readily as on the way up.",
    similar: ["donchian", "price_channel", "ma_cross"],
  },
  breakout_sma: {
    summary: "A breakout that is only taken while the longer trend agrees.",
    formula:
      "Long when close exceeds the prior `fast`-bar high AND sits above SMA(slow); flat when it loses the SMA. The filter is a veto on entries, not a second entry condition.",
    whenItWorks:
      "Markets with clear regimes. The filter removes the breakout trades that occur inside a downtrend, which are the ones that fail immediately.",
    whenItFails:
      "Sharp V-shaped reversals. By the time the slow average turns up the move is largely over, and the filter has cost the entire first leg.",
    similar: ["donchian", "volume_breakout", "roc_trend"],
  },
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
      "%K = 100 × (close − lowest low) / (highest high − lowest low) over `fast` bars; %D = SMA(%K, slow). Long when %K < 20; flat when %K > 80 or %K < %D. Oversold arms the entry and %D confirms the exit — requiring `%K < 20 AND %K > %D` at once is the crossing instant, which almost never coincides, and the strategy took zero trades until that was separated.",
    whenItWorks: "Sideways markets with regular swings between support and resistance.",
    whenItFails:
      "Strong trends. %K pins above 80 for the whole advance, so the model spends the trend flat and re-enters at the top.",
    similar: ["williams_r", "rsi_reversion", "mfi_reversion"],
  },
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
  triple_ma: {
    summary:
      "A crossover that also requires the slow average itself to be rising.",
    formula:
      "Long while SMA(fast) > SMA(slow) AND SMA(slow) is above its own value one bar earlier. The second condition removes crossovers that happen while the trend is still falling.",
    whenItWorks:
      "Established trends. It trades noticeably less than the plain crossover and each trade is better qualified.",
    whenItFails:
      "Trend beginnings. Waiting for the slow average to turn is waiting for confirmation, and confirmation is late by construction.",
    similar: ["ma_cross", "ema_slope", "supertrend"],
  },
  ppo_cross: {
    summary:
      "MACD expressed as a percentage, so the signal means the same thing across price levels.",
    formula:
      "PPO = 100 × (EMA(fast) − EMA(slow)) / EMA(slow); long while PPO > EMA(PPO, 9). Dividing by the slow EMA is the whole difference: a raw MACD of 2.0 means something else at $20 than at $200.",
    whenItWorks:
      "Comparing or backtesting across instruments and across long windows where price level changed by an order of magnitude.",
    whenItFails:
      "The same conditions as MACD — low-volatility drift, where the oscillator hovers near zero and crossings are arbitrary.",
    similar: ["macd_cross", "trix_cross", "ema_cross"],
  },
  trix_cross: {
    summary:
      "Triple-smoothed rate of change, built to strip out the cycles a trader does not want to trade.",
    formula:
      "TRIX = per-bar rate of change of EMA(EMA(EMA(close, fast))); long while TRIX > SMA(TRIX, slow). Three passes of exponential smoothing suppress cycles shorter than the span almost entirely.",
    whenItWorks:
      "Noisy instruments with a real underlying trend. Very few whipsaws survive the third smoothing pass.",
    whenItFails:
      "Any move shorter than roughly three times the span. The same smoothing that removes noise removes the signal, and the lag is the cost.",
    similar: ["macd_cross", "ppo_cross", "momentum"],
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
  price_channel: {
    summary:
      "Donchian with independent entry and exit lookbacks, so the exit can be tighter than the entry.",
    formula:
      "Long when close exceeds the prior `fast`-bar high; flat when it falls below the prior `slow`-bar low, both shifted one bar. Setting the exit channel shorter than the entry one is the classic asymmetric configuration.",
    whenItWorks:
      "Trending markets where giving back less of each move matters more than catching every move.",
    whenItFails:
      "Volatile trends. A tight exit channel is hit by ordinary retracement, and the model exits into the middle of the move it was right about.",
    similar: ["donchian", "donchian_mid", "atr_trailing_stop"],
  },
  ema_slope: {
    summary: "Trade the direction of an average rather than its level.",
    formula:
      "Long when EMA(fast) is above its own value `slow` bars ago. No crossing is involved: a single average, compared with its own past.",
    whenItWorks:
      "Smooth trends. It has one fewer parameter interaction than a crossover and is correspondingly harder to overfit.",
    whenItFails:
      "Near turning points, where the slope oscillates around zero and every bar flips the position.",
    similar: ["ma_cross", "triple_ma", "momentum"],
  },
  bollinger_breakout: {
    summary:
      "Buy a move beyond the upper band — volatility expansion treated as a signal, not a warning.",
    formula:
      "Long when close > SMA(fast) + slow × σ(fast), where σ is the population standard deviation over the same window; flat when close falls back below the SMA. The band width is a genuine fractional axis: 1.5σ is 1.5σ, and encoding it as the integer 15 would make a slider that lies about its units.",
    whenItWorks:
      "Volatility breakouts after a squeeze. Because the band is measured in standard deviations, the threshold adapts to the instrument's own regime.",
    whenItFails:
      "The opposite reading is also popular and also profitable in ranges — a touch of the upper band is a classic reversion SELL. In a mean-reverting instrument this rule is on the wrong side of every trade.",
    similar: ["keltner_breakout", "zscore_reversion", "atr_breakout"],
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
  atr_breakout: {
    summary: "A breakout sized in the instrument's own volatility.",
    formula:
      "Long when close exceeds the prior close plus `slow` × ATR(fast); flat when it falls the same distance below. ATR is Wilder-smoothed — an `ewm(alpha=1/n)`, which is what every published ATR means and what both engines implement.",
    whenItWorks:
      "Across instruments and across regimes. A threshold in ATRs means the same thing on a quiet day and a violent one, which a percentage threshold does not.",
    whenItFails:
      "Volatility contractions. As ATR falls the threshold tightens, so the rule trades most in exactly the conditions where moves are smallest relative to costs.",
    similar: ["keltner_breakout", "supertrend", "bollinger_breakout"],
  },
  keltner_breakout: {
    summary: "Bollinger's idea with ATR instead of standard deviation.",
    formula:
      "Long when close > EMA(fast) + slow × ATR(fast); flat below the EMA. ATR uses true range, which includes the gap through the previous close — a standard deviation of closes cannot see that.",
    whenItWorks:
      "Gappy instruments. Equities gap overnight and crypto gaps on liquidations; a channel built from closes understates both.",
    whenItFails:
      "The same failure as any breakout: a range, where every band touch is the edge rather than the start of something.",
    similar: ["bollinger_breakout", "atr_breakout", "supertrend"],
  },
  supertrend: {
    summary:
      "A trailing band that flips side when price crosses it, and stays put otherwise.",
    formula:
      "The band sits `slow` × ATR(fast) from the midpoint and ratchets in the direction of the trend only — it never loosens. Position flips when close crosses it, so the model is always long or always flat with no ambiguous state.",
    whenItWorks:
      "Persistent trends. The ratchet means the exit level follows the move up and never gives ground back.",
    whenItFails:
      "Sideways markets, where the ratchet works against it: the band is dragged in behind price and then crossed by ordinary noise.",
    similar: ["atr_trailing_stop", "keltner_breakout", "triple_ma"],
  },
  atr_trailing_stop: {
    summary:
      "The chandelier exit — a stop hung from the highest high, measured in ATRs.",
    formula:
      "Long while close stays above (highest high over `fast` bars) − slow × ATR(fast). Entry is the trend filter; the stop is what defines the strategy.",
    whenItWorks:
      "Riding a trend to its end. The distance adapts to volatility, so a violent trend is given room a fixed percentage stop would not.",
    whenItFails:
      "Volatility spikes at a top. ATR rises as the move ends, which widens the stop exactly when it should tighten, and the exit comes well below the high.",
    similar: ["supertrend", "price_channel", "donchian"],
  },
  obv_trend: {
    summary:
      "On-balance volume: a running total that adds the day's volume on an up close and subtracts it on a down one.",
    formula:
      "Long while OBV is above SMA(OBV, fast). The `slow` axis is unused and kept only so the grid keeps its shape — the card says so rather than letting a slider imply an effect it does not have.",
    whenItWorks:
      "Where volume leads price. Accumulation shows in OBV before it shows in the close, which is the entire premise.",
    whenItFails:
      "Ranges, where up and down closes alternate: OBV oscillates around its own average and crosses it on noise. And separately — the failure that has nothing to do with the market — any instrument whose reported volume is unreliable. Crypto is the standard example, with wash trading and venue-specific reporting, and OBV is only ever as good as the volume feed under it.",
    similar: ["volume_breakout", "mfi_reversion", "ma_cross"],
  },
  volume_breakout: {
    summary: "A price breakout that must be confirmed by unusual volume.",
    formula:
      "Long when close exceeds the prior `fast`-bar high AND volume exceeds its own `slow`-bar average; flat when close falls back below the breakout channel.",
    whenItWorks:
      "Separating real breakouts from drift. A move on ordinary volume is one participant; a move on twice the average is a change of opinion.",
    whenItFails:
      "Thin sessions and holidays, where volume itself is the anomaly. It also inherits every problem with the volume feed that `obv_trend` has.",
    similar: ["donchian", "obv_trend", "breakout_sma"],
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
};
