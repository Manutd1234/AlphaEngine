/**
 * The frame every lesson figure draws inside, and the one rule they all keep.
 *
 * A lesson figure is a DIAGRAM, not a chart: it draws the shape of a claim at
 * fixed, chosen values rather than plotting a reading. So it takes no width
 * measurement and no `<Plot>` — 260×96 user units, at natural size, centred in
 * whatever column the card gives it.
 *
 * `preserveAspectRatio` is left at its default `xMidYMid meet` deliberately.
 * Measured in Chrome on 2026-08-25 the screen CTM is exactly 1:1, so nothing
 * here is scaled or stretched; the letterboxing is the whole point, and
 * `preserveAspectRatio="none"` — which WOULD stretch the text, and is the
 * defect this engine's charts were fixed for — must never be added.
 */

import type { ReactNode } from "react";

export const WIDTH = 260;
export const HEIGHT = 96;

export function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} role="img" aria-label={label}>
      {children}
    </svg>
  );
}
