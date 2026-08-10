/**
 * O(n) indicator kernels.
 *
 * A 400-combination sweep runs inside a serverless function with a hard wall
 * clock, so every indicator is incremental: rolling sums for the SMA, a
 * monotonic deque for rolling max/min, Wilder smoothing for RSI. The naive
 * O(n·window) versions are ~50× slower on a 3000-bar × 400-combo grid and would
 * blow the function timeout on the widest settings the UI allows.
 *
 * `NaN` marks "not enough history yet" and propagates into a flat position,
 * which is the correct behaviour: the model cannot have an opinion before its
 * lookback is filled.
 */

export function sma(values: Float64Array, window: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n).fill(NaN);
  if (window <= 0 || window > n) return out;

  // NaN is counted, not summed. The running sum is what makes this O(n), but a
  // NaN added into it poisons every later value — the sum never returns to a
  // number. pandas' `rolling(w).mean()` yields NaN only while the window still
  // CONTAINS one and recovers after, and these two engines are checked against
  // each other to the cent.
  //
  // No caller hit this until an oscillator was smoothed: every earlier input
  // was a price series with no gaps. It cost a 13-vs-2 trade-count divergence
  // that the parity fixture caught and nothing else would have.
  let sum = 0;
  let nans = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(values[i])) nans++;
    else sum += values[i];

    if (i >= window) {
      const leaving = values[i - window];
      if (Number.isNaN(leaving)) nans--;
      else sum -= leaving;
    }
    if (i >= window - 1) out[i] = nans > 0 ? NaN : sum / window;
  }
  return out;
}

/** Rolling extremum via a monotonic deque — amortised O(1) per bar. */
function rollingExtreme(
  values: Float64Array,
  window: number,
  isMax: boolean,
): Float64Array {
  const n = values.length;
  const out = new Float64Array(n).fill(NaN);
  if (window <= 0 || window > n) return out;

  const deque: number[] = []; // indices, values monotonic
  for (let i = 0; i < n; i++) {
    while (deque.length && deque[0] <= i - window) deque.shift();
    while (
      deque.length &&
      (isMax
        ? values[deque[deque.length - 1]] <= values[i]
        : values[deque[deque.length - 1]] >= values[i])
    ) {
      deque.pop();
    }
    deque.push(i);
    if (i >= window - 1) out[i] = values[deque[0]];
  }
  return out;
}

export const rollingMax = (v: Float64Array, w: number) => rollingExtreme(v, w, true);
export const rollingMin = (v: Float64Array, w: number) => rollingExtreme(v, w, false);

/** Shift forward by one bar — the "use only information available at the close
 *  of the previous bar" operator. */
export function shift1(values: Float64Array): Float64Array {
  const out = new Float64Array(values.length).fill(NaN);
  for (let i = 1; i < values.length; i++) out[i] = values[i - 1];
  return out;
}

/** Wilder's RSI (EMA with alpha = 1/period), matching the pandas ewm version. */
export function rsi(close: Float64Array, period: number): Float64Array {
  const n = close.length;
  const out = new Float64Array(n).fill(NaN);
  if (period <= 0 || n < 2) return out;

  const alpha = 1 / period;
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i < n; i++) {
    const delta = close[i] - close[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = i === 1 ? gain : avgGain + alpha * (gain - avgGain);
    avgLoss = i === 1 ? loss : avgLoss + alpha * (loss - avgLoss);
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function pctChange(values: Float64Array): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const prev = values[i - 1];
    out[i] = prev !== 0 ? values[i] / prev - 1 : 0;
  }
  return out;
}

/**
 * Exponential moving average, `adjust=False` — the recursive form pandas uses
 * when `adjust=False`, seeded with the first value.
 *
 * The seeding matters for parity: pandas' adjusted EMA weights the early window
 * differently, and a TypeScript implementation that seeds with an SMA drifts
 * from the Python engine for the first few hundred bars. Both engines run the
 * same recursion from the same first value.
 */
export function ema(values: Float64Array, span: number): Float64Array {
  const out = new Float64Array(values.length).fill(NaN);
  if (values.length === 0 || span < 1) return out;
  const alpha = 2 / (span + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = alpha * values[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/**
 * Rolling population standard deviation (`ddof=0`), matching
 * `pandas.rolling().std(ddof=0)`.
 *
 * ddof matters: pandas defaults to the SAMPLE deviation (ddof=1) and this uses
 * the population one, so the Python side must pass `ddof=0` explicitly. On a
 * 20-bar window the two differ by ~2.6%, which is enough to move a Bollinger
 * band across a price and change a trade — the parity fixture would catch it,
 * but only after someone spent an afternoon on it.
 *
 * Two-pass per window rather than the sum-of-squares shortcut: on price series
 * the mean is large relative to the deviation, and `E[x²] - E[x]²` loses most
 * of its significant digits to cancellation exactly there.
 */
export function rollingStd(values: Float64Array, window: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n).fill(NaN);
  if (window <= 0 || window > n) return out;
  for (let i = window - 1; i < n; i++) {
    let sum = 0;
    let bad = false;
    for (let j = i - window + 1; j <= i; j++) {
      if (Number.isNaN(values[j])) { bad = true; break; }
      sum += values[j];
    }
    if (bad) continue;
    const mean = sum / window;
    let acc = 0;
    for (let j = i - window + 1; j <= i; j++) acc += (values[j] - mean) ** 2;
    out[i] = Math.sqrt(acc / window);
  }
  return out;
}

/**
 * Average true range, Wilder-smoothed — the recursion `pandas.ewm(alpha=1/n,
 * adjust=False)` performs.
 *
 * True range takes the widest of three spans, not the bar's own high-low: a gap
 * through the previous close is real movement the bar's range cannot see.
 */
export function atr(
  high: Float64Array, low: Float64Array, close: Float64Array, period: number,
): Float64Array {
  const n = close.length;
  const out = new Float64Array(n).fill(NaN);
  if (n === 0) return out;
  const alpha = 1 / Math.max(1, period);
  let prev = high[0] - low[0];
  out[0] = prev;
  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1]),
    );
    prev = alpha * tr + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/**
 * Linearly weighted moving average — weight `i+1` on the i-th bar of the window.
 *
 * Its own primitive rather than three call sites because the weight vector is
 * the part that gets written backwards. Hull, KST and Coppock all need it and
 * all three would otherwise carry their own copy, which is three chances for
 * one of them to weight the OLDEST bar most heavily and look plausible.
 *
 * `pandas` has no `rolling().wma()`, so the Python reference walks the same
 * window in the same direction with the same accumulation order.
 */
export function wma(values: Float64Array, window: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n).fill(NaN);
  const period = Math.max(1, Math.round(window));
  const denominator = (period * (period + 1)) / 2;
  for (let i = period - 1; i < n; i++) {
    let total = 0;
    let usable = true;
    for (let k = 0; k < period; k++) {
      const value = values[i - period + 1 + k];
      if (Number.isNaN(value)) { usable = false; break; }
      total += value * (k + 1);
    }
    out[i] = usable ? total / denominator : NaN;
  }
  return out;
}

/**
 * Bars since the highest value in the trailing window, 0 when it is this bar.
 *
 * Ties resolve to the MOST RECENT occurrence, which is the convention Aroon is
 * defined with and the opposite of what `argmax` returns. On a flat series every
 * bar ties, and the two conventions differ by the whole window length.
 */
export function barsSinceMax(values: Float64Array, window: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n).fill(NaN);
  const period = Math.max(1, Math.round(window));
  for (let i = period - 1; i < n; i++) {
    let best = -Infinity;
    let at = i;
    for (let j = i - period + 1; j <= i; j++) {
      if (!Number.isNaN(values[j]) && values[j] >= best) { best = values[j]; at = j; }
    }
    out[i] = i - at;
  }
  return out;
}

/** Mirror of `barsSinceMax`; ties again resolve to the most recent bar. */
export function barsSinceMin(values: Float64Array, window: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n).fill(NaN);
  const period = Math.max(1, Math.round(window));
  for (let i = period - 1; i < n; i++) {
    let best = Infinity;
    let at = i;
    for (let j = i - period + 1; j <= i; j++) {
      if (!Number.isNaN(values[j]) && values[j] <= best) { best = values[j]; at = j; }
    }
    out[i] = i - at;
  }
  return out;
}

/** Rolling sum. Two-pass per window, matching `rollingStd`'s reasoning: a
 *  running total never recovers from a NaN, and pandas does. */
export function rollingSum(values: Float64Array, window: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n).fill(NaN);
  const period = Math.max(1, Math.round(window));
  for (let i = period - 1; i < n; i++) {
    let total = 0;
    let usable = true;
    for (let j = i - period + 1; j <= i; j++) {
      if (Number.isNaN(values[j])) { usable = false; break; }
      total += values[j];
    }
    out[i] = usable ? total : NaN;
  }
  return out;
}

/** Double EMA: `2·EMA − EMA(EMA)`. Built from `ema`, so parity comes free. */
export function dema(values: Float64Array, span: number): Float64Array {
  const one = ema(values, span);
  const two = ema(one, span);
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = 2 * one[i] - two[i];
  return out;
}

/** Triple EMA: `3·EMA − 3·EMA(EMA) + EMA(EMA(EMA))`. */
export function tema(values: Float64Array, span: number): Float64Array {
  const one = ema(values, span);
  const two = ema(one, span);
  const three = ema(two, span);
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = 3 * one[i] - 3 * two[i] + three[i];
  return out;
}

/**
 * Zero-lag EMA: an EMA of the series with its own lag subtracted back out.
 *
 * `lag = (span − 1) / 2` rounded down, which is the published definition. The
 * de-lagged input is `2·close − close[lag]`, an extrapolation — so it overshoots
 * at a turn, and that is the trade it makes for reacting sooner.
 */
export function zlema(values: Float64Array, span: number): Float64Array {
  const n = values.length;
  const lag = Math.floor((Math.max(1, Math.round(span)) - 1) / 2);
  const adjusted = new Float64Array(n);
  for (let i = 0; i < n; i++) adjusted[i] = i >= lag ? 2 * values[i] - values[i - lag] : values[i];
  return ema(adjusted, span);
}

/**
 * Hull MA: `WMA(2·WMA(n/2) − WMA(n), √n)`.
 *
 * Both sub-periods use FLOOR, not rounding, and that is a cross-language
 * decision rather than a stylistic one. `Math.round(2.5)` is 3 and Python's
 * `round(2.5)` is 2 — banker's rounding, round-half-to-even — so an odd `n`
 * gave the two engines different half-periods and a different indicator with
 * the same name. It surfaced as exactly one failing parity combination out of
 * 193, on `hull_trend` at n=5, which is the only place the halving lands on
 * a .5 within the swept range.
 */
export function hma(values: Float64Array, window: number): Float64Array {
  const period = Math.max(2, Math.round(window));
  const half = wma(values, Math.max(1, Math.floor(period / 2)));
  const full = wma(values, period);
  const diff = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) diff[i] = 2 * half[i] - full[i];
  return wma(diff, Math.max(1, Math.floor(Math.sqrt(period))));
}
