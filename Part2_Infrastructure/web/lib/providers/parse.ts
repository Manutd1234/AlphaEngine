/**
 * Coercion helpers shared by the adapters.
 *
 * Every one of these vendors sends numbers as strings somewhere in its payload,
 * and several send the string `"None"`, `"-"` or `""` for a missing value. The
 * failure that matters is not a crash — it is `Number("None")` becoming `NaN`,
 * surviving `JSON.stringify` as `null`, and reaching a chart as a gap that looks
 * like a genuine data hole rather than a parse failure. So: one funnel, and
 * absent is `null`, never `NaN` and never `0`.
 */

const MISSING = new Set(["", "none", "null", "n/a", "na", "-", "undefined"]);

/** Number or null. Never NaN. */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (MISSING.has(t.toLowerCase())) return null;
  // Percent strings ("1.23%") appear in Alpha Vantage payloads; thousands
  // separators show up in vendor JSON often enough to strip defensively.
  const n = Number(t.replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Number, or `fallback` when missing — for fields a caller cannot handle as null. */
export function numOr(v: unknown, fallback: number): number {
  return num(v) ?? fallback;
}

export function str(v: unknown): string | null {
  if (typeof v !== "string") return typeof v === "number" ? String(v) : null;
  const t = v.trim();
  return t && !MISSING.has(t.toLowerCase()) ? t : null;
}

/**
 * ISO-8601 UTC, or null.
 *
 * Handles the three encodings in play: epoch ms/seconds (Massive, FMP),
 * ISO strings (Tiingo, Firecrawl), and Alpha Vantage's `20240102T120000`,
 * which `new Date()` parses as *Invalid Date* rather than failing loudly.
 */
export function iso(v: unknown): string | null {
  if (v == null) return null;

  if (typeof v === "number" && Number.isFinite(v)) {
    // Epoch seconds vs milliseconds: anything below ~1e12 is seconds. The
    // boundary is the year 2001 in ms and the year 33658 in seconds, so no real
    // market timestamp is ambiguous.
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const s = String(v).trim();
  if (!s) return null;

  const av = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (av) {
    const [, y, mo, d, h, mi, sec] = av;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec)).toISOString();
  }

  // A bare date ("2024-01-02") is midnight *UTC*, not midnight local — without
  // the suffix, V8 already treats date-only strings as UTC but date-time
  // strings as local, and mixing the two shifts half the series by the offset.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s;
  const d = new Date(dateOnly);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function isoOrNow(v: unknown): string {
  return iso(v) ?? new Date().toISOString();
}

/** Narrows an unknown JSON value to a record without an `any` cast. */
export function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Percent change from two prices, when the vendor did not send it.
 *
 * Guards the zero denominator explicitly: a previous close of 0 is not a real
 * price but it does appear in halted/placeholder rows, and `x/0` is `Infinity`,
 * which serialises to `null` and shows up as a missing value rather than the
 * bad input it is.
 */
export function pctChange(price: number | null, prev: number | null): number | null {
  if (price == null || prev == null || prev === 0) return null;
  return ((price - prev) / prev) * 100;
}
