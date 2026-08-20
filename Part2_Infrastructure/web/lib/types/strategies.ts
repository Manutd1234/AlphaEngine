/**
 * The strategy catalogue: which models exist, how they group, and what their
 * two parameters and two chart overlays mean.
 *
 * Split out of `lib/types.ts` when that file passed 790 lines. Nothing here
 * describes the wire — these are the closed `Strategy` union and the
 * `Record<Strategy, …>` tables that must stay exhaustive with it, which is
 * exactly why they belong together: adding a model is one edit to the union
 * and four compile errors pointing at the tables that have not caught up.
 *
 * Re-exported in full by `lib/types/index.ts`; importers keep saying
 * `@/lib/types` and none of them had to change.
 */

export type Strategy =
  | "ma_cross"
  | "ema_cross"
  | "macd_cross"
  | "donchian"
  | "donchian_mid"
  | "breakout_sma"
  | "rsi_reversion"
  | "williams_r"
  | "stochastic"
  | "momentum"
  | "roc_trend"
  | "triple_ma"
  | "ppo_cross"
  | "trix_cross"
  | "rsi_trend"
  | "price_channel"
  | "ema_slope"
  | "bollinger_breakout"
  | "zscore_reversion"
  | "atr_breakout"
  | "keltner_breakout"
  | "supertrend"
  | "atr_trailing_stop"
  | "obv_trend"
  | "volume_breakout"
  | "mfi_reversion"
  | "dema_cross"
  | "tema_cross"
  | "zlema_cross"
  | "hull_trend"
  | "vwap_trend"
  | "cci_reversion"
  | "awesome_cross"
  | "cmo_trend"
  | "stoch_rsi_x"
  | "dpo_reversion"
  | "bollinger_pctb"
  | "stddev_channel"
  | "chaikin_volatility"
  | "ulcer_filter"
  | "cmf_trend"
  | "force_index"
  | "eom_trend"
  | "aroon_cross"
  | "vortex_cross"
  | "linreg_forecast";

/**
 * Families, for grouping the picker.
 *
 * Every strategy takes exactly two parameters, which is why they fit the
 * existing request shape unchanged. That is the selection criterion, not a
 * coincidence: models needing a third axis (Ichimoku) are held back until the
 * request carries named parameters, because folding a third value into one of
 * the two existing ones makes a slider that lies about its units. Fractional
 * axes were the first relaxation of that rule and named axes will be the next.
 *
 * "Fitted" is the one family that is different in kind rather than in method.
 * Every other strategy applies a fixed rule the user chose; `linreg_forecast`
 * estimates its coefficients from the data, so its two parameters control the
 * FIT (window, threshold) rather than the rule. Grouping it separately is the
 * cheapest way to stop a reader treating estimated coefficients as tuned ones.
 */
export type StrategyFamily =
  | "Trend" | "Breakout" | "Mean reversion" | "Momentum" | "Volume" | "Volatility" | "Fitted";

export const STRATEGY_FAMILY: Record<Strategy, StrategyFamily> = {
  ma_cross: "Trend",
  ema_cross: "Trend",
  macd_cross: "Trend",
  donchian: "Breakout",
  donchian_mid: "Breakout",
  breakout_sma: "Breakout",
  rsi_reversion: "Mean reversion",
  williams_r: "Mean reversion",
  stochastic: "Mean reversion",
  momentum: "Momentum",
  roc_trend: "Momentum",
  triple_ma: "Trend",
  ppo_cross: "Trend",
  trix_cross: "Trend",
  ema_slope: "Trend",
  price_channel: "Breakout",
  rsi_trend: "Momentum",
  bollinger_breakout: "Breakout",
  zscore_reversion: "Mean reversion",
  atr_breakout: "Breakout",
  keltner_breakout: "Breakout",
  supertrend: "Trend",
  atr_trailing_stop: "Trend",
  obv_trend: "Volume",
  volume_breakout: "Volume",
  mfi_reversion: "Volume",
  dema_cross: "Trend",
  tema_cross: "Trend",
  zlema_cross: "Trend",
  hull_trend: "Trend",
  vwap_trend: "Volume",
  cci_reversion: "Mean reversion",
  awesome_cross: "Momentum",
  cmo_trend: "Momentum",
  stoch_rsi_x: "Mean reversion",
  dpo_reversion: "Mean reversion",
  bollinger_pctb: "Mean reversion",
  stddev_channel: "Breakout",
  chaikin_volatility: "Volatility",
  ulcer_filter: "Volatility",
  cmf_trend: "Volume",
  force_index: "Volume",
  eom_trend: "Volume",
  aroon_cross: "Momentum",
  vortex_cross: "Trend",
  linreg_forecast: "Fitted",
};

export const STRATEGY_LABELS: Record<Strategy, string> = {
  ma_cross: "Moving-average crossover",
  ema_cross: "EMA crossover",
  macd_cross: "MACD signal crossover",
  donchian: "Donchian breakout",
  donchian_mid: "Donchian mid-band",
  breakout_sma: "Trend-filtered breakout",
  rsi_reversion: "RSI mean reversion",
  williams_r: "Williams %R reversion",
  stochastic: "Stochastic oscillator",
  momentum: "Momentum (skip-recent)",
  roc_trend: "Rate of change with trend filter",
  triple_ma: "Triple moving average",
  ppo_cross: "Percentage price oscillator",
  trix_cross: "TRIX signal crossover",
  rsi_trend: "RSI trend continuation",
  bollinger_breakout: "Bollinger band breakout",
  zscore_reversion: "Z-score mean reversion",
  price_channel: "Price channel breakout",
  ema_slope: "EMA slope",
  atr_breakout: "ATR breakout",
  keltner_breakout: "Keltner channel breakout",
  supertrend: "Supertrend",
  atr_trailing_stop: "ATR trailing stop (chandelier)",
  obv_trend: "On-balance volume trend",
  volume_breakout: "Volume-confirmed breakout",
  mfi_reversion: "Money-flow index reversion",
  dema_cross: "Double EMA crossover",
  tema_cross: "Triple EMA crossover",
  zlema_cross: "Zero-lag EMA crossover",
  hull_trend: "Hull moving average slope",
  vwap_trend: "Rolling VWAP trend",
  cci_reversion: "CCI mean reversion",
  awesome_cross: "Awesome oscillator crossover",
  cmo_trend: "Chande momentum trend",
  stoch_rsi_x: "Stochastic RSI",
  dpo_reversion: "Detrended price oscillator",
  bollinger_pctb: "Bollinger %B reversion",
  stddev_channel: "Standard-deviation channel",
  chaikin_volatility: "Chaikin volatility expansion",
  ulcer_filter: "Ulcer index regime filter",
  cmf_trend: "Chaikin money flow",
  force_index: "Force index",
  eom_trend: "Ease of movement",
  aroon_cross: "Aroon crossover",
  vortex_cross: "Vortex indicator crossover",
  linreg_forecast: "Linear regression forecast",
};

/** What `fast` and `slow` actually mean for each model — shown in the UI so the
 *  sliders are not two unlabelled numbers. */
export const PARAM_MEANING: Record<Strategy, { fast: string; slow: string }> = {
  ma_cross: { fast: "Fast SMA period", slow: "Slow SMA period" },
  ema_cross: { fast: "Fast EMA span", slow: "Slow EMA span" },
  macd_cross: { fast: "Fast EMA span", slow: "Slow EMA span" },
  donchian: { fast: "Breakout lookback", slow: "Trailing-exit lookback" },
  donchian_mid: { fast: "Channel lookback", slow: "Exit SMA period" },
  breakout_sma: { fast: "Breakout lookback", slow: "Trend-filter SMA period" },
  rsi_reversion: { fast: "RSI period", slow: "Trend-filter SMA period" },
  williams_r: { fast: "%R lookback", slow: "Exit SMA period" },
  stochastic: { fast: "%K lookback", slow: "%D smoothing" },
  momentum: { fast: "Bars skipped (recent)", slow: "Momentum lookback" },
  roc_trend: { fast: "Rate-of-change lookback", slow: "Trend-filter SMA period" },
  triple_ma: { fast: "Fast SMA period", slow: "Slow SMA period" },
  ppo_cross: { fast: "Fast EMA span", slow: "Slow EMA span" },
  trix_cross: { fast: "TRIX EMA span", slow: "Signal SMA period" },
  rsi_trend: { fast: "RSI period", slow: "Trend-filter SMA period" },
  bollinger_breakout: { fast: "Band SMA period", slow: "Band width (σ)" },
  zscore_reversion: { fast: "Z-score lookback", slow: "Entry threshold (σ)" },
  price_channel: { fast: "Breakout lookback", slow: "Exit-channel lookback" },
  ema_slope: { fast: "EMA span", slow: "Slope lookback (bars)" },
  atr_breakout: { fast: "ATR period", slow: "Breakout size (ATRs)" },
  keltner_breakout: { fast: "EMA & ATR period", slow: "Channel width (ATRs)" },
  supertrend: { fast: "ATR period", slow: "Band distance (ATRs)" },
  atr_trailing_stop: { fast: "ATR & trend period", slow: "Stop distance (ATRs)" },
  obv_trend: { fast: "OBV smoothing period", slow: "Unused (kept for grid shape)" },
  volume_breakout: { fast: "Breakout lookback", slow: "Volume average period" },
  mfi_reversion: { fast: "MFI period", slow: "Exit SMA period" },
  dema_cross: { fast: "Fast DEMA span", slow: "Slow DEMA span" },
  tema_cross: { fast: "Fast TEMA span", slow: "Slow TEMA span" },
  zlema_cross: { fast: "Fast ZLEMA span", slow: "Slow ZLEMA span" },
  hull_trend: { fast: "Hull MA period", slow: "Slope lookback (bars)" },
  vwap_trend: { fast: "VWAP lookback", slow: "Exit SMA period" },
  cci_reversion: { fast: "CCI period", slow: "Entry threshold (|CCI|)" },
  awesome_cross: { fast: "Fast median-price SMA", slow: "Slow median-price SMA" },
  cmo_trend: { fast: "CMO period", slow: "Entry threshold (|CMO|)" },
  stoch_rsi_x: { fast: "RSI period", slow: "Ranking window" },
  dpo_reversion: { fast: "Detrend period", slow: "Entry threshold (σ)" },
  bollinger_pctb: { fast: "Band SMA period", slow: "Entry level (%B)" },
  stddev_channel: { fast: "Channel period", slow: "Channel width (σ)" },
  chaikin_volatility: { fast: "Spread EMA period", slow: "Rate-of-change lookback" },
  ulcer_filter: { fast: "Ulcer window", slow: "Maximum ulcer index" },
  cmf_trend: { fast: "CMF period", slow: "Entry threshold (CMF)" },
  force_index: { fast: "Force EMA period", slow: "Trend-filter SMA period" },
  eom_trend: { fast: "EOM smoothing period", slow: "Trend-filter SMA period" },
  aroon_cross: { fast: "Aroon period", slow: "Entry threshold (Aroon)" },
  vortex_cross: { fast: "Vortex period", slow: "Exit SMA period" },
  linreg_forecast: { fast: "Training window (bars)", slow: "Entry threshold (residual σ)" },
};

/**
 * What the two overlay lines on the price chart actually ARE, per strategy.
 *
 * Distinct from `PARAM_MEANING`: a parameter is a lookback, the plotted line is
 * the level that lookback produces. `fast: null` means the model has no second
 * price-scale line worth drawing (RSI lives on 0-100, so plotting it would
 * collapse the price axis).
 */
export const CHART_SERIES: Record<Strategy, { fast: string | null; slow: string }> = {
  ma_cross: { fast: "Fast SMA", slow: "Slow SMA" },
  ema_cross: { fast: "Fast EMA", slow: "Slow EMA" },
  // MACD and the oscillators live on their own scale; drawing them against
  // price would flatten the price axis into a line.
  macd_cross: { fast: null, slow: "Slow EMA" },
  donchian: { fast: "Breakout high", slow: "Trailing low" },
  donchian_mid: { fast: "Channel high", slow: "Exit SMA" },
  breakout_sma: { fast: "Breakout high", slow: "Trend SMA" },
  rsi_reversion: { fast: null, slow: "Trend SMA" },
  williams_r: { fast: null, slow: "Exit SMA" },
  stochastic: { fast: null, slow: "Exit SMA" },
  momentum: { fast: null, slow: "Lookback SMA" },
  roc_trend: { fast: null, slow: "Trend SMA" },
  triple_ma: { fast: "Fast SMA", slow: "Slow SMA" },
  ppo_cross: { fast: null, slow: "Slow EMA" },
  trix_cross: { fast: null, slow: "TRIX signal" },
  rsi_trend: { fast: null, slow: "Trend SMA" },
  bollinger_breakout: { fast: "Upper band", slow: "Band mid" },
  zscore_reversion: { fast: null, slow: "Rolling mean" },
  price_channel: { fast: "Channel high", slow: "Channel low" },
  ema_slope: { fast: null, slow: "EMA" },
  atr_breakout: { fast: null, slow: "Prior close" },
  keltner_breakout: { fast: "Upper channel", slow: "Channel mid" },
  supertrend: { fast: "Upper band", slow: "Lower band" },
  atr_trailing_stop: { fast: "Trailing stop", slow: "Trend SMA" },
  obv_trend: { fast: null, slow: "OBV average" },
  volume_breakout: { fast: "Breakout high", slow: "Trend SMA" },
  mfi_reversion: { fast: null, slow: "Exit SMA" },
  // The forecast lives in return space, not price space: there is no level
  // to draw. The 20-bar mean one of its features is measured against is the
  // one line on this chart that means anything for it.
  dema_cross: { fast: "Fast DEMA", slow: "Slow DEMA" },
  tema_cross: { fast: "Fast TEMA", slow: "Slow TEMA" },
  zlema_cross: { fast: "Fast ZLEMA", slow: "Slow ZLEMA" },
  hull_trend: { fast: null, slow: "Hull MA" },
  vwap_trend: { fast: null, slow: "Exit SMA" },
  cci_reversion: { fast: null, slow: "Exit SMA (50)" },
  awesome_cross: { fast: null, slow: "Slow median SMA" },
  cmo_trend: { fast: null, slow: "Trend reference" },
  stoch_rsi_x: { fast: null, slow: "RSI range" },
  dpo_reversion: { fast: null, slow: "Detrend SMA" },
  bollinger_pctb: { fast: null, slow: "Band midline" },
  stddev_channel: { fast: null, slow: "Channel midline" },
  chaikin_volatility: { fast: null, slow: "Trend SMA (50)" },
  ulcer_filter: { fast: null, slow: "Trend SMA (50)" },
  cmf_trend: { fast: null, slow: "Trend reference" },
  force_index: { fast: null, slow: "Trend SMA" },
  eom_trend: { fast: null, slow: "Trend SMA" },
  aroon_cross: { fast: null, slow: "Aroon reference" },
  vortex_cross: { fast: null, slow: "Exit SMA" },
  linreg_forecast: { fast: null, slow: "Feature mean (20)" },
};

