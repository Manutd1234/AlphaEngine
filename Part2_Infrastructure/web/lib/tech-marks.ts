/**
 * A mark per dependency, and a deliberate limit on what a mark may claim.
 *
 * WHY THIS EXISTS. The dependency tree names thirteen things — eight provider
 * APIs, two venues, and the platform components behind the gateway — and a wall
 * of identically-styled text rows makes them all look alike. A distinct mark per
 * row lets a reader find "the Binance one" without reading, which is the whole
 * point of an icon strip.
 *
 * WHY MOST OF THESE ARE LETTERMARKS, and this is the honest part. A mark is a
 * claim of identity. Shipping a hand-traced approximation of a vendor's logo
 * makes that claim badly: it is recognisably wrong to anyone who knows the
 * brand, and recolouring a vendor mark — which a health-tinted tile does by
 * construction — is the single thing most brand guidelines prohibit outright.
 * So:
 *
 *   - `kind: "path"` is reserved for marks whose geometry is EXACT and
 *     unambiguous, not approximated from memory.
 *   - Everything else gets a house lettermark: two or three letters in the
 *     app's own mono face, in a tile of identical geometry. It reads as one
 *     strip with the paths, and it asserts nothing it cannot back.
 *
 * Adding a real mark later is one entry: drop the vendor's own single-path SVG
 * in with its native `viewBox` and the tile picks it up. Nothing else changes,
 * because `markFor` degrades to initials for anything absent.
 *
 * NO `fill` ON THE PATH ITSELF. The component supplies `fill="currentColor"`,
 * which is what makes forced-colours work with no exemption: inside a `.card`
 * the single permitted high-contrast block sets `color: CanvasText`, so the
 * mark follows the user's ink instead of vanishing at an authored colour.
 */

export type TechMark =
  | { kind: "path"; viewBox: string; d: string; name: string }
  | { kind: "letters"; letters: string; name: string };

const letters = (l: string, name: string): TechMark => ({ kind: "letters", letters: l, name });

/**
 * Keyed by the technology, not by the node — `markFor` does the mapping, so one
 * entry serves both `provider:binance` and `venue:binance`.
 */
export const TECH_MARKS: Record<string, TechMark> = {
  /**
   * An equilateral triangle. This one is exact rather than traced: the mark IS
   * the triangle, so there is no proportion to get subtly wrong.
   */
  vercel: {
    kind: "path",
    viewBox: "0 0 24 24",
    d: "M12 2 L23 21 L1 21 Z",
    name: "Vercel",
  },

  // Venues and providers. Lettermarks until a vendor's own single-path SVG is
  // dropped in — see the header note on why an approximation is worse.
  binance: letters("BN", "Binance"),
  bybit: letters("BY", "Bybit"),
  alphavantage: letters("AV", "Alpha Vantage"),
  tiingo: letters("TI", "Tiingo"),
  fmp: letters("FMP", "Financial Modeling Prep"),
  massive: letters("MA", "Massive"),
  openbb: letters("OB", "OpenBB"),
  firecrawl: letters("FC", "Firecrawl"),

  // Platform components, keyed by the backend string the gateway reports.
  supabase: letters("SB", "Supabase"),
  postgres: letters("PG", "PostgreSQL"),
  postgresql: letters("PG", "PostgreSQL"),
  sqlite: letters("SQL", "SQLite"),
  celery: letters("CY", "Celery"),
  redis: letters("RD", "Redis"),
  fastapi: letters("API", "FastAPI"),
  python: letters("PY", "Python"),

  // House nodes. These have no vendor at all and must not borrow one.
  web: letters("UI", "Next.js runtime"),
  gateway: letters("GW", "Trading gateway"),
  registry: letters("RG", "Provider registry"),
  feeds: letters("FD", "Market data feeds"),
  risk: letters("RK", "Pre-trade risk"),
  audit: letters("AU", "Audit store"),
  queue: letters("QU", "Research queue"),
  mirror: letters("MR", "Durable mirror"),
};

/** Initials from a label, for anything the table does not name. */
function initials(label: string): string {
  const words = label.split(/[\s/_-]+/).filter(Boolean);
  if (!words.length) return "??";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The mark for a dependency node.
 *
 * `backendHint` is a runtime string — `platform.audit.backend`,
 * `platform.queue.backend` — and is consulted FIRST, but only when it names a
 * technology this module knows. That order matters: when the queue backend is
 * `memory`, no technology is named, so it falls through to the node's own house
 * lettermark rather than painting a Redis mark on an in-memory queue. A mark
 * that names the wrong technology is exactly the fabrication this tab exists to
 * avoid.
 */
export function markFor(nodeId: string, label: string, backendHint?: string | null): TechMark {
  if (backendHint) {
    const hinted = TECH_MARKS[normalise(backendHint)];
    if (hinted) return hinted;
  }
  const bare = normalise(nodeId.replace(/^(provider|venue):/, ""));
  const direct = TECH_MARKS[bare];
  if (direct) return direct;
  return { kind: "letters", letters: initials(label), name: label };
}
