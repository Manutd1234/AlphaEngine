"use client";

/**
 * The frame every diagram on this tab is drawn in.
 *
 * The tab makes one argument in several shapes — a basket against a dollar, two
 * ladders facing each other, an identity that always balances — and the reader
 * has to be able to move between them without relearning the furniture. So
 * every figure gets the same parts in the same order: a caption above that says
 * what is being shown, the drawing, and a footnote below that says what the
 * drawing cannot say.
 *
 * The footnote is not decoration. Every diagram here can be missing a leg, a
 * side or a whole book, and a chart that quietly omits what it could not
 * measure reads as a complete picture of a smaller world. `missing` renders in
 * the same place, in the same voice, every time.
 *
 * Nothing here carries meaning in colour alone: each state also has a
 * typographic mark and a word, which is what `forced-colors.test.ts` and the
 * house rule require and what makes the figures legible in Windows High
 * Contrast and to a reader who cannot separate red from green.
 */

import { type ReactNode } from "react";

import { useMeasuredWidth } from "@/components/chart-kit";
import { DIAGRAM_LABEL_PX, advancePx } from "@/lib/coherence/label-metrics";
import { useMarkReadout, type MarkReadout } from "@/lib/coherence/use-mark-readout";

/** The readout sets on the diagram label rung, like every other word in a plot. */
const READOUT_PX = DIAGRAM_LABEL_PX;

export interface FigureProps {
  /** What this figure shows, as a sentence fragment. Always present. */
  caption: string;
  /** The reading a viewer should take away, when there is one. */
  reading?: string | null;
  /** What the drawing could not include, and why. Rendered when present. */
  missing?: string | null;
  /** Screen-reader description of the drawing itself. */
  ariaLabel: string;
  children: ReactNode;
}

export default function Figure({ caption, reading, missing, ariaLabel, children }: FigureProps) {
  return (
    <figure className="coh-figure">
      <figcaption className="coh-figure__caption">{caption}</figcaption>
      <div className="coh-figure__plot" role="img" aria-label={ariaLabel}>
        {children}
      </div>
      {reading ? <p className="coh-figure__reading">{reading}</p> : null}
      {missing ? (
        <p className="coh-figure__missing">
          <span aria-hidden="true">◌</span> {missing}
        </p>
      ) : null}
    </figure>
  );
}

/**
 * A plot area that reports its own width in pixels.
 *
 * Every chart on this tab used `preserveAspectRatio="none"` over a 0-100
 * viewBox, which stretches the drawing to the container — and stretches the
 * TEXT with it. On a 1,400px column the labels came out at fourteen times
 * their intended width: "$1 payoff" rendered as "$ 1  p a y o f f" and the
 * basket total beside it was illegible.
 *
 * Measuring instead means the viewBox is in real pixels, the aspect ratio is
 * one, and a label is the size it says it is. This is the idiom `chart-kit`
 * already uses for the same reason.
 */
export function Plot({
  height,
  children,
}: {
  height: number;
  children: (width: number) => ReactNode;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>(720);
  const { svgRef, readout, interactive, announce, handlers } = useMarkReadout(height);

  return (
    <div ref={ref} className="coh-plot" style={{ width: "100%" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="presentation"
        // ONE tab stop for the whole plot, and only once it has a mark to walk
        // to — an empty figure must not put an empty control in the tab order.
        // `Heatmap` set this rule for the desk: one keyboard instrument, not
        // hundreds of tab stops.
        tabIndex={interactive ? 0 : undefined}
        {...handlers}
      >
        {children(width)}
        {readout ? <Readout {...readout} chartWidth={width} /> : null}
      </svg>
      {/* OUTSIDE the `role="img"` wrapper's subtree in the accessibility tree
          is not possible from here, so this is a live region that speaks the
          focused mark's own words. A `role="img"` subtree is presentational, so
          labelling the marks themselves would announce nothing. */}
      <p className="coh-plot__live" role="status" aria-live="polite">{announce}</p>
    </div>
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
function Readout({ text, x, y, chartWidth }: MarkReadout & { chartWidth: number }) {
  const width = Math.min(chartWidth - 8, advancePx(text, READOUT_PX) + 20);
  const left = Math.min(Math.max(x - width / 2, 4), Math.max(4, chartWidth - width - 4));
  const top = Math.max(2, y - 26);
  return (
    <g className="coh-plot__readout" pointerEvents="none">
      <rect x={left} y={top} width={width} height={22} rx={6} />
      <text x={left + 10} y={top + 15}>{text}</text>
    </g>
  );
}

/**
 * The empty state a figure renders instead of an axis with nothing on it.
 *
 * A blank plot area and a plot area with nothing in it look identical, and one
 * of them means the feed is down. This says which.
 */
export function FigureEmpty({ reason }: { reason: string }) {
  return (
    <p className="coh-figure__empty">
      <span aria-hidden="true">◌</span> {reason}
    </p>
  );
}

/**
 * A labelled state chip: mark, word, and optionally a figure.
 *
 * The mark comes first so the sentence still parses when colour is stripped —
 * "▲ Dutch book, 0.9800" reads the same in monochrome as in full colour.
 */
export function StateChip({
  mark,
  word,
  value,
  tone,
}: {
  mark: string;
  word: string;
  value?: string | null;
  tone: "good" | "warn" | "critical" | "muted";
}) {
  return (
    <span className={`coh-chip is-${tone}`}>
      <span className="coh-chip__mark" aria-hidden="true">
        {mark}
      </span>
      <span className="coh-chip__word">{word}</span>
      {/* The value carries its own `title`, because it is the part that
          truncates: a chip is `white-space: nowrap` by design — a state that
          wrapped mid-phrase would read as two states — so a long value like a
          hostname could only widen the pill until it broke the row. It ellipses
          now, and the hover has the whole of it. */}
      {value ? <span className="coh-chip__value" title={value}>{value}</span> : null}
    </span>
  );
}
