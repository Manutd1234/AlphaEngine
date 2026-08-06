/**
 * Cell encoding for the correlation matrix.
 *
 * The doctrine the panel is built on is that colour is the *second* channel:
 * hue carries sign, depth carries magnitude, and the number is printed in every
 * cell so the matrix survives being read with no colour perception at all. That
 * makes the alpha ceiling a hard constraint rather than a taste call — past a
 * point the fill wins and the number, which is the fallback, stops being
 * legible.
 *
 * Kept out of the component so the arithmetic is testable. tests/correlation.test.ts
 * recomputes the contrast rather than trusting the comment below.
 */

/**
 * Alpha ceiling for a cell fill, in percent.
 *
 * At 75% the deepest tile still clears AA for --text-primary in both palettes
 * (4.64:1 dark, 4.96:1 light); at 80% dark falls to 4.24:1 and the printed
 * number — the whole point of the encoding — stops clearing. The previous value
 * was 55%, which was safe and also flat: 0.5 and 0.9 landed 22 percentage
 * points of alpha apart and read as the same blue.
 */
export const CORR_ALPHA_MAX = 75;

/**
 * Fill for a correlation in [-1, 1].
 *
 * Zero is fully transparent — no correlation is no ink, not a colour. Values
 * outside the unit interval are clamped rather than emitting an alpha over 100,
 * which the browser would silently discard along with the whole declaration.
 */
export function corrFill(c: number): string {
  const safe = Number.isFinite(c) ? c : 0;
  const pole = safe >= 0 ? "var(--diverging-pos)" : "var(--diverging-neg)";
  const alpha = Math.round(Math.min(1, Math.abs(safe)) * CORR_ALPHA_MAX);
  return `color-mix(in srgb, ${pole} ${alpha}%, transparent)`;
}

/**
 * The printed number, two places without the leading zero.
 *
 * Correlations are bounded to [-1, 1], so the "0." carries no information and
 * costs two characters a 42px cell cannot spare once the book holds twelve
 * symbols. Full precision does not disappear — it moves to the title, which
 * `corrTitle` builds.
 */
export function corrLabel(c: number): string {
  const safe = Number.isFinite(c) ? c : 0;
  if (safe >= 0.995) return "1";
  if (safe <= -0.995) return "−1";
  return `${safe < 0 ? "−" : ""}${Math.abs(safe).toFixed(2).slice(1)}`;
}

/** Full precision, on hover. The diagonal says why it is 1 rather than asserting it. */
export function corrTitle(a: string, b: string, c: number): string {
  return a === b
    ? `${a} against itself — 1.000 by construction`
    : `${a} vs ${b}: ${(Number.isFinite(c) ? c : 0).toFixed(3)}`;
}
