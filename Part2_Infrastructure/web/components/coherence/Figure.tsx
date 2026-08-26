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
import { useSharedXReadout, type SharedX } from "@/lib/coherence/use-shared-x-readout";
import { useMarkReadout } from "@/lib/coherence/use-mark-readout";

import { Readout, ReferenceLine, SharedXReadout } from "./plot-overlays";

// Re-exported so the one outside caller (`lesson-figures/frame.tsx`) keeps its
// import: the overlays moved on 2026-08-26 and a lifted primitive leaves a
// thin re-export behind rather than a changed import in every consumer.
export { Readout } from "./plot-overlays";

/** The readout sets on the diagram label rung, like every other word in a plot. */

/**
 * A line the reader judges the marks against.
 *
 * Every figure on this desk that convinces has one — the diagonal where a
 * price equals its worth, the window mean a print is running hot or cold
 * against, the base rate a score has to beat. It is what turns an assertion in
 * the caption into something a reader can CHECK. Three figures drew one by
 * hand and each drew it differently; this makes it the plot's, so it is
 * painted before the marks (an SVG paints in source order, so nothing can
 * occlude it) and always carries a word (a bare hairline is colour-only
 * meaning, which the house rule forbids).
 *
 * `y` is in the plot's own units — the caller has the scale, the plot does
 * not — and `x0`/`x1` bound it to the drawn axis rather than the whole width,
 * so it does not run under a label gutter.
 */
export interface PlotReference {
  y: number;
  x0: number;
  x1: number;
  /** The word beside the line: "the mean it settles on", "break-even". */
  label: string;
}

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
  onSelect,
  sharedX,
  viewBox,
  reference = null,
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
  /**
   * Called with the index of a mark the reader chose, in document order — the
   * same order the arrow walk uses, so a figure can map an index back to its
   * own row without keeping a parallel list.
   *
   * OPT-IN, because most figures on this tab are read rather than operated. A
   * plot without this renders no click handler at all, so a reader never meets
   * a mark that looks pressable and is not.
   */
  onSelect?: (index: number) => void;
  /**
   * For a figure whose facts share one x and differ down the y.
   *
   * The mark readout answers "what is this shape". A panel of measures over one
   * axis is asked a different question — "what were ALL of these, at this
   * point" — and a per-mark readout cannot answer it, because it positions a
   * single `getBBox` and shows one fact. Passing this swaps the readout for an
   * index-over-shared-x one; the tab stop, the four gestures and the live
   * region are identical, so the two feel like one instrument.
   *
   * A FUNCTION OF THE MEASURED WIDTH, not a value, because the axis it reads
   * across is one the figure lays out — a label gutter reserved from measured
   * glyph advances, a track that is whatever is left. The caller cannot know
   * either until the plot has been measured, and passing constants instead is
   * how the crosshair ends up reading a position the drawing never uses.
   */
  sharedX?: (width: number) => SharedX;
  /**
   * A fixed coordinate system, for a drawing that has one.
   *
   * `Plot` normally hands a figure the measured width and draws in pixels, and
   * that is right for anything laid out from data — a ladder, a curve, a bar
   * per row. It is wrong for a diagram whose geometry is FIXED and scaled to
   * fit: a state machine, a scope matrix, a donut. Those are authored in their
   * own units against `preserveAspectRatio`, and forcing them onto a pixel
   * viewBox would move every hand-placed coordinate.
   *
   * Passing this keeps the caller's box and lets the browser scale it, while
   * the plot still collects the marks, takes one tab stop and speaks. Added
   * 2026-08-26, when three such drawings turned out to be the only ones left
   * that could not be made instruments — the primitive was the thing that did
   * not fit, not the callers.
   */
  viewBox?: string;
  /**
   * The baseline the marks are read against, painted under them.
   *
   * A function of the measured width where the axis it spans is one the
   * figure lays out — the same reason `sharedX` is — or a plain value where
   * the caller already knows its extent.
   */
  reference?: PlotReference | ((width: number) => PlotReference | null) | null;
  children: (width: number) => ReactNode;
}) {
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>(720);
  const width = Math.max(measured, minWidth);
  // Both hooks run every render — they must, they are hooks — and the figure
  // uses one of them. A figure carries per-mark titles or a shared axis, never
  // both, so there is no case where the unused one has anything to say.
  const marks = useMarkReadout(height, onSelect);
  const axis = sharedX ? sharedX(width) : undefined;
  const shared = useSharedXReadout(axis);
  // The svg needs ONE ref, and which hook owns it depends on which readout is
  // in use: each binds its own native `focusin`, because React's synthetic
  // focus does not fire on an `<svg>` — measured, not assumed.
  const { selectable } = marks;
  const svgRef = axis ? shared.svgRef : marks.svgRef;
  const { interactive, announce, handlers } = axis ? shared : marks;
  const readout = axis ? null : marks.readout;
  const publish = useContext(AnnounceContext);
  // In an effect, not during render. Calling a PARENT's setter while a child is
  // rendering is the one thing React refuses outright — "cannot update a
  // component while rendering a different component" — and it is the obvious
  // way to write this. The cost is one extra commit per readout change, which
  // is a keypress, not a frame loop.
  useEffect(() => { publish?.(announce); }, [publish, announce]);

  return (
    <div
      ref={ref}
      className={`coh-plot${minWidth ? " is-floored" : ""}${selectable ? " is-selectable" : ""}`}
      style={{ width: "100%" }}
    >
      <svg
        ref={svgRef}
        viewBox={viewBox ?? `0 0 ${width} ${height}`}
        // A fixed box scales to the column; a measured one is already the
        // column, so it keeps its pixel width and does not restate it.
        width={viewBox ? "100%" : width}
        height={height}
        preserveAspectRatio={viewBox ? "xMidYMid meet" : undefined}
        role="presentation"
        // ONE tab stop for the whole plot, and only once it has a mark to walk
        // to — an empty figure must not put an empty control in the tab order.
        // `Heatmap` set this rule for the desk: one keyboard instrument, not
        // hundreds of tab stops.
        tabIndex={interactive ? 0 : undefined}
        {...handlers}
      >
        {/* ONE HATCH FOR THE WHOLE DESK. A refused or unmeasured region is
            drawn textured rather than merely paler, because in Windows High
            Contrast two fills collapse to one colour and the texture is what
            survives — the same argument `.diff-bars__fill--refused` made in
            CSS when these bars were HTML. Declared here so any figure can
            reach it by id without each one carrying its own `<defs>`. */}
        <defs>
          <pattern id="diff-hatch" width="5" height="5" patternUnits="userSpaceOnUse"
                   patternTransform="rotate(45)">
            <rect width="5" height="5" fill="transparent" />
            <line x1="0" y1="0" x2="0" y2="5" className="coh-plot__hatch" />
          </pattern>
        </defs>
        {/* FIRST, and that is the whole contract: source order is paint order,
            so a reference painted here sits under every mark a figure draws
            after it. It is also a mark itself — it carries a title — so the
            readout can say what the line is when a keyboard reader lands on
            it, which a bare hairline could never do. */}
        {(() => {
          const ref = typeof reference === "function" ? reference(width) : reference;
          return ref ? <ReferenceLine {...ref} /> : null;
        })()}
        {children(width)}
        {readout ? <Readout {...readout} chartWidth={width} /> : null}
        {axis && shared.reading && shared.index !== null ? (
          <SharedXReadout
            at={axis.x0 + ((axis.x1 - axis.x0) * shared.index) / Math.max(1, axis.count - 1)}
            height={height}
            width={axis.width ?? 200}
            chartWidth={width}
            reading={shared.reading}
          />
        ) : null}
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

