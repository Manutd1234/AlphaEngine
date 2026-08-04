/**
 * Query-parameter coercion for the API routes.
 *
 * `Math.min(hi, Math.max(lo, Number(x)))` looks like a clamp but is NaN-
 * transparent: `Number("abc")` is NaN and both comparisons are false, so NaN
 * survives every bound. Downstream that fails *silently behind HTTP 200* —
 * `slice(0, NaN)` returns an empty array, so `?depth=abc` produced a response
 * with a live mid, real depth totals and completely empty ladders, which is
 * indistinguishable from an empty order book.
 *
 * Every route uses these instead, so a bad parameter falls back to the documented
 * default rather than propagating as a plausible-looking wrong answer.
 */

/**
 * Absent means absent — use the default, do not coerce.
 *
 * `Number(null)` and `Number("")` are both **0**, not NaN, so a naive
 * finite-check treats a missing parameter as the number zero and clamps it to
 * the lower bound. `/api/depth` with no `limit` would have fetched 5 levels
 * instead of the documented 100.
 */
function parseNumeric(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Integer in [lo, hi]; `fallback` for absent, non-numeric or non-finite input. */
export function clampInt(raw: string | null, lo: number, hi: number, fallback: number): number {
  const n = parseNumeric(raw);
  if (n === null) return fallback;
  // Binance rejects a non-integer `limit` outright, so rounding is required
  // here, not cosmetic.
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** Float in [lo, hi]; `fallback` for absent, non-numeric or non-finite input. */
export function clampFloat(raw: string | null, lo: number, hi: number, fallback: number): number {
  const n = parseNumeric(raw);
  if (n === null) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export const SYMBOL_RE = /^[A-Z0-9]{5,20}$/;

/** Upper-cases and validates a symbol. Returns null when it is not well-formed. */
export function parseSymbol(raw: string | null, fallback = "BTCUSDT"): string | null {
  const s = (raw ?? fallback).toUpperCase();
  return SYMBOL_RE.test(s) ? s : null;
}

/** Membership check against a closed set (intervals, sides, …). */
export function parseEnum<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T,
): T | null {
  if (raw == null) return fallback;
  const v = raw as T;
  return allowed.includes(v) ? v : null;
}
