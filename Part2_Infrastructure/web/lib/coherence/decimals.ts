/**
 * One formatter per kind of engine number, and the rule they all keep.
 *
 * THE RULE, STATED ONCE. A quantity that arrives as a FIXED-POINT STRING — every
 * price, fee, edge, payoff, bound, slope and moment the gateway sends as the
 * exact text of a Decimal — is printed FROM THE STRING, truncated, never through
 * a float. `Number("0.00010533…")` is a different number by the time it could
 * be formatted, and these quantities exist at the places where the difference
 * between a reliability of 0.00010358 and a Brier of 0.00010533 is the whole
 * finding. A quantity DERIVED IN THE BROWSER — a share of a count, a ratio of
 * two floats, a slider's cents, an axis tick on a float scale — may round, and
 * it does so through `lib/format.ts`, whose helpers say so by existing. The call
 * site says which it is by which helper it calls.
 *
 * WHY ONE MODULE. Until 2026-08-26 the engine had two `decimalLabel`s
 * (`ReliabilityDiagram` padded to the places asked for; `DistributionView`
 * appended an ellipsis when a digit was cut), two `spanLabel`s, two `centsOf`s
 * and a private `count`, each right in its file and no two agreeing — so the
 * same wire string printed as "0.05" on one view and "0.0500" on the next.
 * `engine-number-format.test.ts` now refuses a formatter declared in a
 * component.
 *
 * SIGN AND ZEROS. A signed wire string keeps its sign as sent — never a
 * hand-built "+". Trailing zeros are printed only when the wire sent them or
 * when `decimalLabel` pads a column, and then the ellipsis says whether a
 * nonzero digit was cut. A derived float that rounds to −0 prints "0" (`pct`
 * does this); a fixed-point string never can.
 */

import { fromCenticents, toCenticents } from "./fixed-point";
import { groupDigits } from "./universe-metrics";

/**
 * A wire decimal cut to `places`, textually. Null when the text is not a
 * decimal, so a caller can decline rather than print a lie.
 */
export function truncateDecimal(raw: string | null | undefined, places: number): string | null {
  if (raw == null) return null;
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(raw.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  if (!whole && !fraction) return null;
  const kept = (fraction + "0".repeat(places)).slice(0, places);
  return places > 0 ? `${sign}${whole || "0"}.${kept}` : `${sign}${whole || "0"}`;
}

/**
 * A wire decimal for display: PADDED to `places` so a column lines up, with an
 * ellipsis when a nonzero digit was cut so the printed form never pretends to
 * be the whole. Dash on null or unparsable.
 *
 * Both halves of the two formatters this replaces, and both are honest:
 * padding is right for a statistic the gateway sent at twenty-eight places
 * (its neighbours in the column were sent at four), and the ellipsis is what
 * says "0.0001…" is not "0.0001".
 */
export function decimalLabel(raw: string | null | undefined, places = 4): string {
  const cut = truncateDecimal(raw, places);
  if (cut == null) return "—";
  const fraction = /\.(\d*)$/.exec(raw!.trim())?.[1] ?? "";
  const dropped = /[1-9]/.test(fraction.slice(places));
  return dropped ? `${cut}…` : cut;
}

/**
 * A decomposition term as a float, for GEOMETRY ONLY. Not a price: a mean
 * squared error carrying twenty-eight digits, and a pixel is not a
 * twenty-eight-digit quantity — so the coordinate may be a float while every
 * number the reader is shown is cut from the string by `decimalLabel`.
 */
export function statValue(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const text = raw.trim();
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * A quoted probability as a fraction of a dollar, for plotting — routed through
 * the centicent reader so a price on a diagram is the same quantity the rest of
 * the tab draws: four decimals, the exchange's own tick.
 */
export function unitOf(raw: string | null | undefined): number | null {
  const cc = toCenticents(truncateDecimal(raw, 4));
  return cc == null ? null : cc / 10_000;
}

/**
 * A product of probabilities as a float, for geometry. `toCenticents` refuses
 * anything finer than six decimals and is right to — but Πpᵢ is a product the
 * gateway never rounds, up to twenty-nine decimals long, and a position on a
 * track rather than a price to trade. Truncated at a millionth.
 */
export function toUnit(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(raw.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  if (!whole && !fraction) return null;
  const millionths = Number(`${fraction}000000`.slice(0, 6));
  const value = Number(whole || "0") + millionths / 1_000_000;
  return sign === "-" ? -value : value;
}

/** A probability for display: exact when the wire is exact, ≈ when it is not. */
export function probLabel(raw: string | null | undefined): string {
  if (raw == null) return "—";
  const exact = toCenticents(raw);
  if (exact != null) return fromCenticents(exact) as string;
  const unit = toUnit(raw);
  if (unit == null) return "—";
  return `≈${fromCenticents(Math.round(unit * 10_000)) as string}`;
}

/**
 * A count with thousands grouping, or a dash. Never a locale call — `toLocaleString`
 * rounds a fraction to make it prettier, and this engine's whole numeric contract is
 * "truncated, never rounded". Hoisted from `EngineStatePanel`'s private `count`, whose
 * header records the defect a null budget printed as "0 tokens per second".
 */
export function countLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return groupDigits(String(value));
}

/**
 * A span of seconds in the largest two units that describe it: "42s", "3m 20s",
 * "2h 10m", "1d 2h". Dash on null. Replaces two `spanLabel(ms)` copies and four
 * hand-built ladders; NOT `lib/format`'s `formatDuration`, whose top band prints
 * "3600 s" and whose subject is sub-second latency.
 */
export function secondsLabel(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${total % 60}s`;
  if (total < 86_400) return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
  return `${Math.floor(total / 86_400)}d ${Math.floor((total % 86_400) / 3600)}h`;
}
