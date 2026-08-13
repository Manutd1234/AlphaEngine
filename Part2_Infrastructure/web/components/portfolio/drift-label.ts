/**
 * Where a drift bar's figure goes, as arithmetic rather than as JSX.
 *
 * THE BUG THIS EXISTS TO CLOSE. `DriftBars` printed each figure just past the
 * end of its bar — `x(drift) ± 5`, anchored outward. `linearScale` maps the
 * domain onto the full plot range, so the largest bar in the set ends exactly
 * on the plot edge and its figure was pushed into whatever lived beyond that
 * edge: the symbol label at one extreme, the current→target pair at the other.
 * Both are anchored the same way as the figure, so the two strings printed over
 * each other glyph for glyph — `BTCU18D7%`, `+10.4%10.4% → 39.2%`.
 *
 * It is not an edge case. The old domain was
 * `max(driftBand * 1.25, max|drift|)`, so the second term wins — and the
 * largest bar lands exactly on the plot edge — for every band satisfying
 * `driftBand ≤ 0.8 × max|drift|`. Measured against the shipped geometry the
 * figure then overhung by up to 41px.
 *
 * THE RULE. Beyond the bar end when the gutter can hold the figure; otherwise
 * back at the axis, reading toward the bar. The half-row on the far side of
 * zero is empty by construction — a bar occupies one side of the axis, never
 * both — so there is always somewhere to put it that is neither over another
 * label nor over a fill.
 *
 * NOT over the fill, deliberately. `PnlWaterfall` flips its labels rather than
 * overprinting for the same reason: a figure on a diverging fill needs a colour
 * that holds in both themes and in forced colours, and the empty half of the
 * row needs none.
 *
 * Extracted so the geometry can be asserted. The overlap it prevents is
 * invisible to a test that reads the component as text, and invisible to a
 * snapshot that never widens the band — which is exactly how it shipped.
 */

export interface FigurePlacement {
  x: number;
  anchor: "start" | "end";
  /** False when the figure had to fall back to the axis. Useful to assert on. */
  beyondBar: boolean;
}

export function placeDriftFigure({
  end,
  zero,
  up,
  figureWidth,
  gap,
  plotLeft,
  plotRight,
}: {
  /** Where the bar ends, in user units. */
  end: number;
  /** Where the axis sits — the bar's other end. */
  zero: number;
  /** The bar points right (an add) rather than left (a trim). */
  up: boolean;
  /** Approximate rendered width of the figure. */
  figureWidth: number;
  /** Clearance between the bar end and the figure. */
  gap: number;
  plotLeft: number;
  plotRight: number;
}): FigurePlacement {
  const beyondBar = up
    ? end + gap + figureWidth <= plotRight
    : end - gap - figureWidth >= plotLeft;

  if (beyondBar) {
    return {
      x: up ? end + gap : end - gap,
      anchor: up ? "start" : "end",
      beyondBar: true,
    };
  }
  // Back at the axis, reading toward its own bar across the empty half.
  return {
    x: up ? zero - gap : zero + gap,
    anchor: up ? "end" : "start",
    beyondBar: false,
  };
}
