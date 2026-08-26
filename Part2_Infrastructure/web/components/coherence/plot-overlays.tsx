"use client";

/**
 * What the plot paints OVER a figure's own marks, and one thing it paints under.
 *
 * Split out of `Figure.tsx` on 2026-08-26 when the reference line took that
 * file past the 400-line ceiling, and the seam was already there: these three
 * are SVG fragments that take plain props, know nothing about the figure's
 * announce context, and are drawn in a fixed order the plot decides —
 * reference first (under every mark), then the figure's children, then the
 * readout or the shared-axis crosshair (over them). Nothing here decides WHAT
 * to say; that is the hooks' job. This decides where the saying is drawn.
 */

import { Tooltip } from "@/components/chart-kit";
import { DIAGRAM_LABEL_PX, advancePx, truncateMiddle } from "@/lib/coherence/label-metrics";
import type { MarkReadout } from "@/lib/coherence/use-mark-readout";

import type { PlotReference } from "./Figure";

/** The readout sets on the diagram label rung, like every other word in a plot. */
const READOUT_PX = DIAGRAM_LABEL_PX;

/**
 * The reference, drawn as one labelled mark.
 *
 * A `stroke` ATTRIBUTE rather than a class alone: the forced-colors block
 * targets `svg line[stroke]`, so this survives Windows High Contrast, where a
 * line styled only from CSS would take the page's forced colour or vanish. The
 * class then sets the dash and weight, which is what makes it read as a
 * reference and not a series.
 */
export function ReferenceLine({ y, y1, x0, x1, label }: PlotReference) {
  const diagonal = y1 !== undefined;
  const far = Math.max(x0 + 1, x1);
  return (
    <g className="coh-plot__reference">
      <line x1={x0} x2={far} y1={y} y2={diagonal ? y1 : y} stroke="var(--axis)" />
      {/* A level line is read from its start; a diagonal is read where it
          ends, because that is the point the eye follows it to. */}
      {diagonal
        ? <text x={far - 2} y={y1 - 6} textAnchor="end">{label}</text>
        : <text x={x0 + 2} y={y - 4}>{label}</text>}
      <title>{`Reference: ${label}`}</title>
    </g>
  );
}

/**
 * The focused or hovered mark's own words, drawn beside it.
 *
 * In USER units, like everything else in the plot, so it lands beside the thing
 * it describes whatever width the figure was measured at. Clamped to the plot
 * on both sides: a mark at the right edge would otherwise put its readout off
 * the viewBox, which is the same clipping this engine has just finished fixing
 * in its label gutters.
 */
/**
 * THE PILL WAS CLAMPED AND THE TEXT WAS NOT, until 2026-08-25.
 *
 * `width` has always been bounded by the plot, so a long readout drew a pill
 * that stopped at the edge — and a `<text>` that did not. The glyphs carried on
 * past the rounded corner and out of the viewBox, so the tail of the sentence
 * painted over the drawing and then vanished at the clip.
 *
 * It needed a mark title longer than the plot to show, which is why no figure
 * caught it for months and no test could: the suite has no DOM, so a string
 * length is a number nobody compares to a pixel width. `ClockAgreement`'s
 * per-run title is about 130 characters and overflowed at desk width.
 *
 * Truncated in the MIDDLE rather than the tail: a readout is "what this mark is
 * — what it measures", and the two ends are the halves worth keeping. The full
 * sentence is still announced to a screen reader, which reads `announce` and
 * not this.
 */
export function Readout({ text, x, y, chartWidth }: MarkReadout & { chartWidth: number }) {
  const width = Math.min(chartWidth - 8, advancePx(text, READOUT_PX) + 20);
  const shown = truncateMiddle(text, width - 20, READOUT_PX);
  const left = Math.min(Math.max(x - width / 2, 4), Math.max(4, chartWidth - width - 4));
  const top = Math.max(2, y - 26);
  return (
    <g className="coh-plot__readout" pointerEvents="none">
      <rect x={left} y={top} width={width} height={22} rx={6} />
      <text x={left + 10} y={top + 15}>{shown}</text>
    </g>
  );
}

/**
 * The rule and the card, for a figure read across one axis.
 *
 * The rule is what makes the card honest: a tooltip clamped away from the edge
 * sits somewhere other than the position it describes, and without a mark on
 * the axis a reader near the end of the series cannot tell which point they
 * are being told about. `Tooltip` does the clamping and the card; this adds the
 * one line that says where.
 */
export function SharedXReadout({ at, height, width, chartWidth, reading }: {
  at: number;
  height: number;
  width: number;
  chartWidth: number;
  reading: { title: string; rows: Array<{ label: string; value: string; color?: string }> };
}) {
  return (
    <g pointerEvents="none">
      <line x1={at} x2={at} y1={0} y2={height} className="coh-plot__crosshair" />
      <Tooltip x={at} width={width} chartWidth={chartWidth} title={reading.title} rows={reading.rows} />
    </g>
  );
}
