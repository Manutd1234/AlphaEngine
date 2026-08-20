/**
 * Where an x-axis label goes, as arithmetic rather than as JSX.
 *
 * THE BUG THIS EXISTS TO CLOSE. `XAxis` kept a candidate tick when its centre
 * was at least `minGap` = 78px from every centre already kept. But the thing
 * that must not overlap is the rendered TEXT, and text width is not a
 * constant: `07 Mar` is six characters where `21 Sept 25` is ten, and a gap
 * that is comfortable for the first is an overlap for the second. Compounding
 * it, the outer labels are anchored inward — the first runs a full width
 * rightwards from its tick, the last a full width leftwards from its — so the
 * two outermost gaps must hold one and a half labels where an interior gap
 * holds one. At the research charts' own geometry that asks for 113px where
 * the axis had left 95px, and the ends printed through their neighbours:
 * `21 Sept` over `25 Nov 25`, `26 Jun 26` over `26 Aug 26`.
 *
 * THE RULE. A label is placed only when its own extent clears the extent of
 * every label already placed, both computed from the formatted string and from
 * the anchor it will be drawn with. A tie drops the candidate: four legible
 * dates beat seven illegible ones. Nothing is truncated or ellipsised — half a
 * date is a wrong date, not a shorter one.
 *
 * Extracted from the component the way `drift-label` was, and for the same
 * reason: an overlap is invisible to a test that reads the component as text,
 * which is exactly how this one shipped.
 */

/**
 * Advance width of one character in the tick face, in ems.
 *
 * Tick labels are one monospace face at one size, so a label's rendered width
 * is `label.length × fontSize × MONO_ADVANCE_EM` — arithmetic rather than a DOM
 * measurement, which is what lets the tick set be chosen during render, on the
 * server, and inside a test.
 *
 * MEASURED, NOT GUESSED. `--mono` resolves to JetBrains Mono, self-hosted by
 * next/font (app/layout.tsx). Reading the shipped woff2 subsets: unitsPerEm is
 * 1000 and every drawn glyph in every subset has an advance of 600, so 0.600em
 * exactly, as a monospace face must. The system faces behind it in the stack
 * sit a hair wider — Menlo 1233/2048 = 0.60205em, Andale Mono 1229/2048 =
 * 0.60010em — so the constant is the widest of the whole stack rather than the
 * webfont's own figure: under-measuring on a machine that never loads the
 * webfont is how labels touch. `DriftBars` carries the same number as its
 * `GLYPH = 6` at 10px.
 */
export const MONO_ADVANCE_EM = 0.605;

/** Size of a tick label, in SVG user units. On the inline rung list. */
export const TICK_FONT_SIZE = 12.5;

/** Clear space required between two neighbouring labels — about 1.6 characters. */
export const LABEL_CLEARANCE = 12;

export type TickAnchor = "start" | "middle" | "end";

export interface AxisTick {
  /** Index into the series the label speaks for. */
  index: number;
  x: number;
  label: string;
  anchor: TickAnchor;
}

/**
 * The span a label actually covers, which is not centred on its tick.
 *
 * `start` runs entirely rightwards from the tick, `end` entirely leftwards,
 * `middle` half each way. Three anchors, three clearances — which is why one
 * centre-to-centre distance can never describe them all.
 */
export function labelExtent(
  x: number,
  label: string,
  anchor: TickAnchor,
  fontSize: number = TICK_FONT_SIZE,
): [number, number] {
  const width = label.length * fontSize * MONO_ADVANCE_EM;
  if (anchor === "start") return [x, x + width];
  if (anchor === "end") return [x - width, x];
  return [x - width / 2, x + width / 2];
}

/** Which ticks get a label, and where each label lands. */
export function axisTicks({
  points,
  x0,
  x1,
  format,
  minGap = 78,
  fontSize = TICK_FONT_SIZE,
}: {
  points: number[];
  x0: number;
  x1: number;
  format: (v: number) => string;
  /** Density floor: short labels are never packed tighter than this. */
  minGap?: number;
  fontSize?: number;
}): AxisTick[] {
  if (!points.length) return [];

  const last = points.length - 1;
  const span = Math.max(1, x1 - x0);
  // `linearScale(0, last, x0, x1)`, written out: this module imports nothing,
  // so the geometry can be exercised without pulling a client component in.
  const xScale = (i: number) => x0 + (i / Math.max(1, last)) * (x1 - x0);

  const tick = (i: number): AxisTick => ({
    index: i,
    x: xScale(i),
    label: format(points[i]),
    anchor: i === 0 ? "start" : i === last ? "end" : "middle",
  });
  /** `n` evenly spaced indices, both endpoints included. */
  const spread = (n: number): number[] =>
    Array.from({ length: n }, (_, k) => Math.round((k * last) / Math.max(1, n - 1)));

  // How many labels the widest of them allows. The outer gaps bind: an end
  // label is anchored inward and takes a whole width out of the gap beside it,
  // where an interior pair share one width between the two of them.
  const dense = Math.max(2, Math.min(7, Math.floor(span / minGap) + 1));
  const widest = Math.max(...spread(dense).map((i) => format(points[i]).length));
  const pitch = 1.5 * widest * fontSize * MONO_ADVANCE_EM + LABEL_CLEARANCE;
  const target = Math.max(2, Math.min(dense, 1 + Math.floor(span / pitch)));

  // Endpoints first — they are the domain, and an axis missing them says less
  // than one missing an interior date — then inwards from the right, which is
  // the order the evenly-spaced-plus-forced-final layout has always used.
  const order = [last, 0, ...spread(target).reverse()].filter((i, k, all) => all.indexOf(i) === k);

  const kept: AxisTick[] = [];
  for (const candidate of order.map(tick)) {
    const [lo, hi] = labelExtent(candidate.x, candidate.label, candidate.anchor, fontSize);
    const clears = kept.every((placed) => {
      const [plo, phi] = labelExtent(placed.x, placed.label, placed.anchor, fontSize);
      return lo >= phi + LABEL_CLEARANCE || plo >= hi + LABEL_CLEARANCE;
    });
    if (clears) kept.push(candidate);
  }
  return kept.sort((a, b) => a.index - b.index);
}
