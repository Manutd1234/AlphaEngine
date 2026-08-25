/**
 * How wide a string will be drawn, in one place, measured rather than guessed.
 *
 * SVG text neither wraps nor clips itself, so every row-labelled figure on this
 * engine has to reserve a gutter before it can draw anything — and every one of
 * them was doing that arithmetic itself. Eight spellings of the same constant
 * were in the tree on 2026-08-25: `0.56` in `ValueStrip`, `0.567` in
 * `ChannelStates` and `FormationDiagram`, `0.575` in `BasketOverview`, a
 * commented `~7.6` in `PendingMinutes`, `~7.3` in `BasketOverview`'s legend,
 * `6.9` for the 12px rung in two files, `6.72` in a third that was never lifted
 * when the rung moved, and a bare `5.2` in `PmfChart` with no derivation beside
 * it at all.
 *
 * WHAT THAT COST, and it is the reason this module exists rather than a
 * tidiness argument: `ComboBandStrips` reserved 205px for a 26-glyph combo
 * ticker on the 13px rung, from `26 × 13 × 0.577 = 195`. That ratio is a
 * TABULAR-MONO ratio. `.coh-combo__label` declares no `font-family`, so the
 * text inherits the page's Inter, and measured in the browser on 2026-08-25 an
 * uppercase ticker in Inter sets at **0.668 em** — 26 glyphs need 226px. The
 * label ran 21px past its gutter, and because the `<text>` was emitted BEFORE
 * the opaque track rect, SVG paint order turned the overrun into a clip: the
 * tail of every long ticker was painted over by the bar beside it. Nothing
 * caught it, and nothing could have — `npm test` has no DOM, so the 195 was
 * checked by redoing the same wrong multiplication (CLAUDE.md, fact 6).
 *
 * HOW THE NUMBERS BELOW WERE OBTAINED. Headless Chrome, `getComputedTextLength`
 * on a real `<text>` node carrying each class, against the strings this engine
 * actually draws. They are the only measured type figures in the repository and
 * they are ROUNDED UP, because the failure is asymmetric: a gutter 5px too wide
 * costs 5px of track, and a gutter 5px too narrow costs the reader the end of
 * every label.
 *
 * ONE RATIO CANNOT SERVE, which is the other half of why eight of them
 * accumulated. Measured at the same size in the same face:
 *
 *   `KXMVECROSSCATEGORY-SHARD1-…`  0.668 em   uppercase identifier
 *   `ABCDEFGHIJKLMNOPQRSTUVWXYZ`   0.681 em   uppercase alphabetic
 *   `0123456789`                   0.648 em   tabular figures
 *   `Worst-case payoff`            0.526 em   mixed-case prose
 *
 * A caller asked to pick would pick wrong, so `advancePx` classifies the string
 * instead. Prose is nearly a quarter narrower than a ticker; using the ticker
 * ratio everywhere would push a prose gutter 27% wider than it needs to be and
 * eat the track it was protecting.
 */

/**
 * The diagram ladder's two rungs, as NUMBERS, because SVG text is user units.
 *
 * `14r-coherence-density.css` declares `--fs-diagram-label: 13px` and
 * `--fs-diagram-legend: 14px` on `.coherence-plane`, and `type-diagram-ladder`
 * pins both. A component doing gutter arithmetic cannot read a custom property
 * — it needs the number before layout — so the two are mirrored here, once,
 * beside the ratios they are multiplied by. `tests/coherence-label-metrics`
 * asserts these against the stylesheet, so the mirror cannot drift silently.
 */
export const DIAGRAM_LABEL_PX = 13;
export const DIAGRAM_LEGEND_PX = 14;

/** Measured in Chrome on 2026-08-25, rounded up. See the header for method. */
export const GLYPH_EM = {
  /** Uppercase identifiers: tickers, shard names, series codes. */
  upper: 0.69,
  /** Mixed-case prose: row labels, axis names, legends. */
  prose: 0.56,
  /** Tabular figures, equal-width by declaration. */
  digits: 0.65,
} as const;

export type GlyphClass = keyof typeof GLYPH_EM;

/**
 * Which ratio a string sets at.
 *
 * A string is `upper` as soon as it is mostly capitals — a ticker with a shard
 * suffix, a strike label — because the widest reading is the safe one. Purely
 * numeric strings are `digits`. Everything else is prose.
 */
export function glyphClassOf(text: string): GlyphClass {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (!letters) return /\d/.test(text) ? "digits" : "prose";
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length >= 0.6 ? "upper" : "prose";
}

/** How wide `text` will be drawn at `fontPx`, in CSS pixels. */
export function advancePx(text: string, fontPx: number, kind: GlyphClass = glyphClassOf(text)): number {
  return text.length * fontPx * GLYPH_EM[kind];
}

/** How many glyphs of `kind` fit in `px`. Floors, so the answer always fits. */
export function glyphsWithin(px: number, fontPx: number, kind: GlyphClass): number {
  return Math.max(0, Math.floor(px / (fontPx * GLYPH_EM[kind])));
}

export interface GutterOptions {
  /** Never narrower than this, so a figure of short labels still reads as a column. */
  min?: number;
  /** Never wider than this fraction of the plot, so labels cannot eat the track. */
  maxFraction?: number;
  /** Never wider than this, whatever the fraction allows. */
  max?: number;
  /** Clear space between the longest label and whatever is drawn beside it. */
  clearance?: number;
}

/**
 * The label column a set of row labels needs.
 *
 * Bounded on both sides on purpose. Unbounded, one long ticker would take the
 * whole plot and leave no track to read against; floored, a figure of two-letter
 * labels would draw them jammed against the bars.
 */
export function gutterFor(
  labels: readonly string[],
  plotWidth: number,
  fontPx: number,
  { min = 72, maxFraction = 0.38, max = 320, clearance = 10 }: GutterOptions = {},
): number {
  const widest = labels.reduce((most, label) => Math.max(most, advancePx(label, fontPx)), 0);
  const ceiling = Math.min(max, plotWidth * maxFraction);
  return Math.round(Math.min(Math.max(widest + clearance, min), Math.max(min, ceiling)));
}

/**
 * Shorten to fit, keeping BOTH ends.
 *
 * The head of a combo ticker is its series and the tail is what distinguishes
 * it from every other parlay in the same series, so a trailing ellipsis
 * truncates exactly the half a reader is using to tell rows apart:
 * `KXMVECROSSCATEGORY-SHARD1-S2026D4…` names nothing. Six rows truncated that
 * way are six identical labels.
 *
 * The full string stays in the figure's `<title>` and its `aria-label`, so
 * nothing is lost — only folded.
 */
export function truncateMiddle(text: string, px: number, fontPx: number): string {
  const kind = glyphClassOf(text);
  const fits = glyphsWithin(px, fontPx, kind);
  if (text.length <= fits) return text;
  // One glyph of the budget is the ellipsis itself.
  const keep = fits - 1;
  if (keep < 4) return text.slice(0, Math.max(0, fits - 1)) + "…";
  const head = Math.ceil(keep / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}
