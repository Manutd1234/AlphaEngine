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
