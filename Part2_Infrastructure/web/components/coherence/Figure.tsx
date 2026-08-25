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

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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
  /**
   * The caveats too long to stand under the drawing, folded and COUNTED.
   *
   * Added 2026-08-25, for the reason `missing` alone stopped serving. Several
   * figures on Proofs had grown a `missing` of three joined sentences — the
   * index chart's ran to four lines under a 168px plot — so the footnote was
   * taller than the thing it qualified and a reader scrolled past the drawing
   * to reach the next one. Splitting them into an array and folding it keeps
   * every word (nothing here is deleted) while giving the figure back its
   * proportions.
   *
   * THE SUMMARY COUNTS, and that is not decoration: an empty fold and a fold
   * hiding four look identical, so a reader cannot tell whether opening it is
   * worth the click. It is the same rule `copy-audit-engines.test.ts` already
   * holds the engine's note lists to.
   *
   * `missing` STAYS for the one short line that changes how the drawing may be
   * READ — a caveat that invalidates the figure must not be behind a click.
   * The split between the two is a judgement each caller makes; the rule is
   * that `missing` is one clause and anything longer is a note.
   */
  notes?: readonly string[] | null;
  /** Screen-reader description of the drawing itself. */
  ariaLabel: string;
  children: ReactNode;
}

/**
 * Where a `Plot` hands its focused mark's words, so a `Figure` can say them.
 *
 * THE REGION HAS TO BE OUTSIDE THE IMAGE AND `Plot` IS ALWAYS INSIDE IT. A
 * `role="img"` subtree is presentational to assistive technology: everything
 * under it loses its role and its name, a live region included. `Plot` used to
 * render the region as a sibling of its own `<svg>` and note in a comment that
 * putting it outside the wrapper "is not possible from here" — which was true,
 * and meant the region was inside the image in all of its callers and announced
 * to nobody. The suite could not see it because it compared source positions
 * within one file.
 *
 * So the plot publishes and the figure speaks. A `Plot` used outside a `Figure`
 * falls back to rendering its own region, which is worse but is not silence.
 */
const AnnounceContext = createContext<((text: string) => void) | null>(null);

export default function Figure({ caption, reading, missing, notes, ariaLabel, children }: FigureProps) {
  const [announced, setAnnounced] = useState("");
  return (
    <figure className="coh-figure">
      <figcaption className="coh-figure__caption">{caption}</figcaption>
      <AnnounceContext.Provider value={setAnnounced}>
        <div className="coh-figure__plot" role="img" aria-label={ariaLabel}>
          {children}
        </div>
      </AnnounceContext.Provider>
      {/* OUTSIDE the `role="img"` element, which is the whole point of the
          context above: a sibling of the image rather than a descendant of it. */}
      <p className="coh-plot__live" role="status" aria-live="polite">{announced}</p>
      {reading ? <p className="coh-figure__reading">{reading}</p> : null}
      {missing ? (
        <p className="coh-figure__missing">
          <span aria-hidden="true">◌</span> {missing}
        </p>
      ) : null}
      {notes?.length ? (
        <details className="disclosure coh-figure__notes">
          <summary>{`What this figure cannot say, ${notes.length}`}</summary>
          <ul className="coh-notes">
            {notes.map((note, index) => (
              <li key={`${index}-${note.slice(0, 24)}`}>{note}</li>
            ))}
          </ul>
        </details>
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
  minWidth = 0,
  children,
}: {
  height: number;
  /**
   * A floor the drawing may not be compressed below.
   *
   * For a figure whose text sits at fixed positions and cannot thin — the stage
   * timeline is the one — a narrow column has to SCROLL rather than squeeze the
   * geometry into it. Zero for every other caller, which is what it was before
   * this existed.
   */
  minWidth?: number;
  children: (width: number) => ReactNode;
}) {
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>(720);
  const width = Math.max(measured, minWidth);
  const { svgRef, readout, interactive, announce, handlers } = useMarkReadout(height);
  const publish = useContext(AnnounceContext);
  // In an effect, not during render. Calling a PARENT's setter while a child is
  // rendering is the one thing React refuses outright — "cannot update a
  // component while rendering a different component" — and it is the obvious
  // way to write this. The cost is one extra commit per readout change, which
  // is a keypress, not a frame loop.
  useEffect(() => { publish?.(announce); }, [publish, announce]);

  return (
    <div ref={ref} className={`coh-plot${minWidth ? " is-floored" : ""}`} style={{ width: "100%" }}>
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
      {/* Only when this plot is NOT inside a Figure. Inside one — which is every
          caller on the engine — the figure renders the region outside its own
          `role="img"` element, where assistive technology can reach it. */}
      {publish ? null : (
        <p className="coh-plot__live" role="status" aria-live="polite">{announce}</p>
      )}
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
