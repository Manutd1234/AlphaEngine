/**
 * What each strategy is, and — the half that usually goes unwritten — when it
 * does not work.
 *
 * The picker grew from three strategies to forty-six. A
 * dropdown of forty-six names with no explanation is not more capability, it
 * is a longer list of things to try at random until one of them scores well,
 * which is precisely the search process the Deflated Sharpe Ratio exists to
 * punish. A reader who knows that Donchian breakout loses money in a range and
 * that RSI reversion loses money in a trend can rule out half the catalogue
 * before running anything.
 *
 * `whenItFails` is mandatory and is never a hedge. Every entry names a specific
 * market condition, because "may underperform in some conditions" is the same
 * sentence for all forty-six and therefore tells a reader nothing.
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
    similar: ["aroon_cross", "price_channel", "breakout_sma", "volume_breakout"],
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
    similar: ["stoch_rsi_x", "williams_r", "rsi_reversion", "mfi_reversion"],
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
    summary: "Two averages crossing, gated on the slow one already turning.",
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
    similar: ["vortex_cross", "atr_trailing_stop", "keltner_breakout", "triple_ma"],
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
  dema_cross: {
    summary:
      "Two exponential averages with most of their own lag subtracted back out.",
    formula:
      "DEMA = 2·EMA(n) − EMA(EMA(n)). Long while the fast DEMA is above the slow one. Subtracting the double-smoothed series removes roughly half the lag an EMA carries.",
    whenItWorks:
      "Trends that reverse before a plain EMA crossover has finished turning. It is the same trade as `ema_cross` with the reaction time moved forward.",
    whenItFails:
      "Choppy markets, harder than either simpler average. Removing lag removes the smoothing that was suppressing the whipsaws, and every false turn now arrives earlier and in full.",
    similar: ["ema_cross", "tema_cross", "zlema_cross"],
  },
  tema_cross: {
    summary:
      "The same lag correction applied a third time, faster still and correspondingly twitchier.",
    formula:
      "TEMA = 3·EMA − 3·EMA(EMA) + EMA(EMA(EMA)). Long while the fast TEMA is above the slow one.",
    whenItWorks:
      "Fast-moving instruments where a DEMA is still late. Among the least-lagging averages that remain smooth enough to cross cleanly.",
    whenItFails:
      "Volatile ranges. Each extra correction amplifies short-term noise, so TEMA overshoots at every turn and crosses back within a few bars.",
    similar: ["dema_cross", "ema_cross", "hull_trend"],
  },
  zlema_cross: {
    summary:
      "An EMA fed a de-lagged input rather than a de-lagged output.",
    formula:
      "Feeds `2·close − close[(n−1)/2]` into a normal EMA. That input is an extrapolation of the recent move, which is what cancels the lag — and what makes it overshoot.",
    whenItWorks:
      "Steady trends. The extrapolation is right whenever the recent direction continues, which is most of the time inside a trend.",
    whenItFails:
      "Sharp reversals, where the extrapolation points exactly the wrong way. It is confidently early in the wrong direction at precisely the turn.",
    similar: ["ema_cross", "dema_cross", "tema_cross"],
  },
  hull_trend: {
    summary:
      "Hull's average, which is unusually smooth and unusually fast at the same time.",
    formula:
      "HMA = WMA(2·WMA(n/2) − WMA(n), √n). Long while the HMA is above its own value `slow` bars ago — a slope rule, not a crossover.",
    whenItWorks:
      "Medium-term trends. The construction genuinely does buy smoothness and responsiveness together rather than trading one for the other.",
    whenItFails:
      "Sideways markets. A very smooth line still has a slope, and a flat market's slope oscillates around zero, so the rule flips repeatedly on moves too small to pay for themselves.",
    similar: ["ema_slope", "tema_cross", "triple_ma"],
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
  stddev_channel: {
    summary:
      "A breakout measured in standard deviations of price rather than of returns.",
    formula:
      "Long when the close exceeds SMA(fast) + `slow`σ; flat back below the midline. The exit at the mean rather than the lower band is deliberate — it gives back less of a move that fails.",
    whenItWorks:
      "Volatility expansions from a quiet base. The threshold scales with the instrument's own recent dispersion, so it means the same thing across regimes.",
    whenItFails:
      "Trending markets with a rising mean. The midline chases price upward, so the exit tightens exactly as the trend matures and cuts the position early.",
    similar: ["bollinger_breakout", "keltner_breakout", "bollinger_pctb"],
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
  vortex_cross: {
    summary:
      "Two directed movements built from different data, so their crossing is not a smoothing artefact.",
    formula:
      "VI+ = Σ|high − previous low| / Σ true range; VI− = Σ|low − previous high| / Σ true range, over `fast` bars. Long while VI+ leads VI−, flat below SMA(slow).",
    whenItWorks:
      "Trend initiation. Unlike a crossover of two averages of the same series — where the crossing is partly an artefact of the smoothing — these two lines measure genuinely different quantities.",
    whenItFails:
      "Range-bound markets, where the two lines hug each other and cross on noise. True range in the denominator also means a single volatile bar can flip both at once.",
    similar: ["supertrend", "atr_breakout", "triple_ma"],
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
