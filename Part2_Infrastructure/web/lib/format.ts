import { BARS_PER_YEAR } from "./types";

export const fmt = (v: number | null | undefined, d = 2): string =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Normalises -0 (and values that round to it) so an axis never reads "-0%". */
export const pct = (v: number | null | undefined, d = 1): string => {
  if (v == null || !Number.isFinite(v)) return "—";
  const scaled = v * 100;
  return `${(Math.abs(scaled) < 0.5 * 10 ** -d ? 0 : scaled).toFixed(d)}%`;
};

export const signedPct = (v: number | null | undefined, d = 1): string =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;

export const usd = (v: number | null | undefined, d = 0): string =>
  v == null || !Number.isFinite(v) ? "—" : `$${fmt(v, d)}`;

export const compact = (v: number): string =>
  Math.abs(v) >= 1e9
    ? `${(v / 1e9).toFixed(2)}B`
    : Math.abs(v) >= 1e6
      ? `${(v / 1e6).toFixed(2)}M`
      : Math.abs(v) >= 1e3
        ? `${(v / 1e3).toFixed(1)}k`
        : fmt(v, 0);

export const sign = (v: number | null | undefined): "pos" | "neg" | "muted" =>
  v == null || !Number.isFinite(v) || v === 0 ? "muted" : v > 0 ? "pos" : "neg";

export const shortDate = (ms: number): string =>
  new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });

export const dateTime = (ms: number): string =>
  new Date(ms).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Price decimals that suit the magnitude — 2dp on BTC, 4dp on a sub-dollar alt. */
export const priceDp = (v: number): number => (v >= 1000 ? 2 : v >= 1 ? 3 : 5);

/**
 * Display pair for a Minimum Track Record Length card.
 *
 * `needed` is MinTRL in bars (null = the SR does not clear its benchmark, so
 * no finite record proves anything). The headline value is expressed in time
 * because "3.1 years" is what a researcher weighs a window against; the bar
 * counts live in the note. Unknown intervals fall back to bars.
 */
export function trackRecordNote(
  needed: number | null,
  windowBars: number,
  interval: string,
): { value: string; note: string; met: boolean | null } {
  if (needed == null) {
    return {
      value: "—",
      note: "SR does not clear the benchmark — no finite record can prove it",
      met: null,
    };
  }
  const ann = BARS_PER_YEAR[interval];
  const value = ann
    ? needed / ann >= 1
      ? `~${fmt(needed / ann, 1)} yr`
      : `~${fmt((needed / ann) * 12, 1)} mo`
    : `${needed.toLocaleString("en-US")} bars`;
  const met = windowBars >= needed;
  const counts = `needs ${needed.toLocaleString("en-US")} bars · window has ${windowBars.toLocaleString("en-US")}`;
  return { value, note: met ? `met — ${counts}` : counts, met };
}
