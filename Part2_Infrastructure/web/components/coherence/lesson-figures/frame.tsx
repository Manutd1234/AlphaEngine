/**
 * The frame every lesson figure draws inside, and the one rule they all keep.
 *
 * A lesson figure is a DIAGRAM, not a chart: it draws the shape of a claim at
 * fixed, chosen values rather than plotting a reading. So it takes no width
 * measurement and no `<Plot>` — 260×96 user units, at natural size, centred in
 * whatever column the card gives it.
 *
 * IT TAKES NO `<Plot>` AND STILL SPEAKS. Until 2026-08-26 the facts these
 * figures carry were `<title>` elements on a bare `<svg>` — native tooltips,
 * reachable with a mouse and by nothing else: not from a keyboard, not on a
 * touch screen, not through a screen reader. That is the exact defect
 * `use-mark-readout` was written to end everywhere else on this engine, and
 * fourteen diagrams were still carrying it. Ten of them carried no facts at
 * all, which hid the first problem behind a second.
 *
 * So the frame takes the READOUT without taking the measurement. `Plot` bundles
 * the two, and only one of them is wanted here: the geometry is fixed and
 * chosen, and measuring it would be measuring a diagram that never varies. One
 * tab stop, arrows to walk the marks, Escape to let go — the same four gestures
 * as every plotted figure, so a reader who has met one has met both.
 *
 * `preserveAspectRatio` keeps `meet` and takes `xMin` since 2026-08-26.
 * Measured in Chrome on 2026-08-25 the screen CTM is exactly 1:1, so nothing
 * here is scaled or stretched; the letterboxing is the whole point, and
 * `preserveAspectRatio="none"` — which WOULD stretch the text, and is the
 * defect this engine's charts were fixed for — must never be added. What
 * changed is only WHERE the letterbox goes: `xMid` centred the drawing in the
 * card, so it lined up with nothing, while the summary, the formula and the two
 * bounds all start at the card's left edge. `xMin` puts it on their vertical.
 */

import type { ReactNode } from "react";

import { Readout } from "../Figure";
import { useMarkReadout } from "@/lib/coherence/use-mark-readout";

/**
 * The canvas, and why it is this size rather than any other.
 *
 * IT WAS 260×96 AND IT WAS TOO SMALL, which is a layout fact rather than a
 * drawing one: the lesson cards are about 490px wide at three columns, so a 260
 * unit drawing sat in half its card with the other half empty. Widening the
 * CANVAS rather than scaling the drawing is the only move that adds room
 * without touching the type — `meet` scales by `min(cardW/WIDTH, cardH/HEIGHT)`
 * and the height is pinned in px, so that minimum stays 1 and every word keeps
 * the size it declares.
 *
 * 320 IS THE LARGEST WIDTH A PHONE CARD STILL HOLDS AT 1:1. Measured: a 390px
 * viewport gives the shell 362 after its 14px gutters and the card 338 after
 * its 12px padding. Past 338 the minimum stops being 1 and the text starts
 * shrinking with the drawing, which is the thing this file exists to prevent.
 *
 * The height is free — nothing constrains it but the card — so it takes what
 * the drawings needed: a band under every figure for its claim, and room above
 * for the labels that were sitting on top of their own marks.
 */
export const WIDTH = 320;
export const HEIGHT = 132;

/**
 * Where every figure's one-line claim sits, in the frame rather than in each
 * figure.
 *
 * All fourteen already ended with a sentence, and all fourteen placed it
 * themselves: `y={HEIGHT - 6}`, `HEIGHT - 8`, `HEIGHT - 10`, some anchored
 * left and some centred. Fourteen decisions about one thing, none of them
 * wrong on its own and no two agreeing — so a reader moving between cards met
 * the same sentence at a different baseline each time. It is one baseline now,
 * and the figures pass the words instead of positioning them.
 */
export const CLAIM_Y = HEIGHT - 9;

/**
 * The lowest a figure may draw before it is inside the claim's band.
 *
 * Published because the first three figures redrawn onto this canvas all put
 * something at 116 or 122 and it printed over the claim — SVG text neither
 * wraps nor clips, so a baseline eight pixels above another baseline is two
 * sentences on one line. One number, exported, rather than each figure
 * subtracting its own guess from `HEIGHT`.
 */
export const FLOOR = CLAIM_Y - 15;

export function Frame({ label, claim, children }: {
  label: string;
  /** The one line under the drawing. Not a sentence — a clause. */
  claim?: string;
  children: ReactNode;
}) {
  const { svgRef, readout, interactive, announce, handlers } = useMarkReadout(HEIGHT);
  return (
    <div className="coh-lessonfig__frame">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        // LEFT, NOT CENTRED. `xMidYMid` is the default and it centres the
        // drawing in whatever the card gives it — so a 260-unit diagram in a
        // 490px card floats with white either side and lines up with nothing.
        // Every other thing in the card starts at its left edge: the summary,
        // the formula, the two bounds. `xMinYMid` puts the diagram on that same
        // vertical, so a reader's eye follows one line down the card.
        //
        // `meet` is untouched, and must stay: `none` would stretch the drawing
        // to the card and stretch its text with it, which is the defect this
        // engine's charts were fixed for.
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label={label}
        // Only once it HAS a mark to walk to. A diagram drawn without facts
        // must not put an empty control in the tab order.
        tabIndex={interactive ? 0 : undefined}
        {...handlers}
      >
        {children}
        {/* Above the readout, so a claim can never be drawn over the card a
            reader has just opened with a keypress. */}
        {claim ? (
          <text x={0} y={CLAIM_Y} className="coh-lessonfig__claim">{claim}</text>
        ) : null}
        {readout ? <Readout {...readout} chartWidth={WIDTH} /> : null}
      </svg>
      {/* OUTSIDE the `role="img"` element. Its subtree is presentational to
          assistive technology, so a reading placed inside it would be drawn and
          never announced — the same reason `Figure` renders its live region as
          a sibling rather than a descendant. */}
      <p className="coh-plot__live" role="status" aria-live="polite">{announce}</p>
    </div>
  );
}
