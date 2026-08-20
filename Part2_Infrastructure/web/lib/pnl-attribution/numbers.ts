import type { PortfolioPayload } from "@/lib/portfolio";

// --------------------------------------------------------------------------
// Numbers
// --------------------------------------------------------------------------

export function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * IEEE −0, kept out of every number this module hands to a renderer.
 *
 * `-slippage_cost` on a session that genuinely cost nothing is −0, and the
 * shipped panel prints that as `$-0` in the **positive** class, because
 * `-0 >= 0` is true — a cost drawn as a signed-negative gain, while the chart
 * label on the very same leg reads `+$0` because `-0 < 0` is false. The two
 * halves of one panel then disagree about the sign of the same number.
 *
 * Not a hypothetical: `session_attribution` emits `fees: 0.0,
 * slippage_cost: 0.0` for any session with no fills, and `round(-0.001, 2)`
 * emits a literal `-0.0` that `JSON.parse` faithfully preserves. −0 and 0 are
 * the same quantity, so collapsing them loses nothing and stops the sign being
 * something IEEE decided rather than the desk.
 */
export function positiveZero(value: number): number {
  return value === 0 ? 0 : value;
}

// --------------------------------------------------------------------------
// Timing alignment
// --------------------------------------------------------------------------

/** `new Date(ms).toISOString()` throws beyond ±8.64e15 rather than returning junk. */
export const MAX_TIMESTAMP_MS = 8.64e15;

export function utcDate(ms: number): string | null {
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_TIMESTAMP_MS) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The session-to-date return of the reference instrument — or null, loudly.
 *
 * The alignment this depends on is real but fragile, so it is checked rather
 * than assumed. `_roll_session_if_needed` measures a **UTC** day and Binance 1d
 * klines close at UTC midnight; `fetchBinanceKlines` sends no `endTime` on the
 * first page, so the newest kline is the in-progress UTC day. The newest daily
 * return is therefore exactly the session-to-date return over exactly the
 * gateway's window.
 *
 * "Therefore" is doing a lot of work there. A gateway that was restarted, or
 * one that has been up across a UTC midnight without rolling, carries a
 * `session_date` that is not today's UTC date — and then the newest kline
 * measures a different day from the P&L it would be attributing. That produces
 * a market leg that is wrong rather than missing, which is the failure mode this
 * whole module exists to avoid. So the bar's own UTC date must equal the
 * session the book claims, and a mismatch returns null.
 */
export function sessionReturn(
  bar: { openMs: number; prevClose: number; close: number } | undefined,
  sessionDate: string,
): number | null {
  if (!bar) return null;
  const openMs = finite(bar.openMs);
  const prevClose = finite(bar.prevClose);
  const close = finite(bar.close);
  if (openMs === null || prevClose === null || close === null) return null;
  // A non-positive previous close cannot produce a return; it can only produce
  // an Infinity or a sign flip that would render as a plausible number.
  if (prevClose <= 0) return null;
  const barDate = utcDate(openMs);
  if (barDate === null || !sessionDate || barDate !== sessionDate) return null;
  return close / prevClose - 1;
}
