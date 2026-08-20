/**
 * The trend family: fourteen ways of saying "hold while the short measure is
 * above the long one".
 *
 * They differ in how fast the measure turns and in what turns it — a simple
 * average, an exponential one, a triple, a slope, a stop that trails. What they
 * share is the failure, and each entry has to name its own version of it rather
 * than repeat the family's: a range destroys all fourteen, but it destroys each
 * of them at a different speed and for a different reason.
 */

import type { StrategyDoc } from "@/lib/strategy-docs/model";
import type { Strategy } from "@/lib/types";

export const TREND_DOCS = {
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
} satisfies Partial<Record<Strategy, StrategyDoc>>;
