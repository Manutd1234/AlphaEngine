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
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
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
