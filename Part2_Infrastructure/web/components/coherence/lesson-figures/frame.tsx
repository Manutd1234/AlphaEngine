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

export const WIDTH = 260;
export const HEIGHT = 96;

export function Frame({ label, children }: { label: string; children: ReactNode }) {
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
