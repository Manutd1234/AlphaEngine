/**
 * The breakout family: eight rules that act on price leaving a band.
 *
 * The band is a channel, a rolling extreme, a volatility envelope or a standard
 * deviation, and the entry is the same shape in each. So is the failure — a
 * false break — which is exactly why each entry below has to say what a false
 * break looks like for its own band rather than borrowing the family's word.
 */

import type { StrategyDoc } from "@/lib/strategy-docs/model";
import type { Strategy } from "@/lib/types";

export const BREAKOUT_DOCS = {
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
} satisfies Partial<Record<Strategy, StrategyDoc>>;
