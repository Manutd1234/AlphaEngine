/**
 * Donut-segment geometry, pulled out of the card so it can be measured.
 *
 * WHY THIS IS ITS OWN MODULE. The builder that lived inside `AllocationDonut`
 * painted NOTHING on a one-position book — which is the book the live
 * deployment holds. With a single 100% slice `from = 0` and `to = 2π`, so the
 * outer arc's start and end points are the same point, and after `.toFixed(2)`
 * they are the same STRING. SVG 1.1 §F.6.2 is explicit about that case: "If the
 * endpoints (x1, y1) and (x2, y2) are identical, then this is equivalent to
 * omitting the elliptical arc segment entirely." Both arcs were therefore
 * dropped and the path degenerated to `M 95,21 L 95,47 Z` — a line with zero
 * area, `fill` and no `stroke`, so a 190×190 box rendered with only its centre
 * text. It looked exactly like a failed load. Nothing caught it because the
 * component still rendered, still had the right aria-label, and the legend
 * beside it still printed the correct 100%: the house defect, green while
 * broken.
 *
 * THE FIX is to split every sweep into segments of at most a quarter turn. A
 * full ring becomes four arcs whose endpoints are all distinct, so no segment
 * is ever dropped; anything under 90° — every slice of a book of four or more —
 * draws as the single arc it always did. The large-arc flag goes with it, since
 * a segment this cannot exceed a half turn never needs one, which removes the
 * second place the old builder could disagree with itself.
 *
 * `AllocationMixes` never had the bug: `common/DonutChart` strokes a
 * `stroke-dasharray` circle, and a dash covering the whole circumference is a
 * correct full ring. Two donuts, two encodings — this is the one that had to be
 * taught the edge case.
 */

export const DONUT_SIZE = 190;
export const DONUT_RADIUS = 74;
export const DONUT_THICKNESS = 26;

/**
 * Largest sweep drawn as one arc segment. A quarter turn rather than the half
 * turn the spec would allow: it keeps every segment's endpoints far enough
 * apart that the 2-decimal rounding above cannot collapse them, with the same
 * margin at any radius this component might later be drawn at.
 */
const MAX_SEGMENT = Math.PI / 2;

/**
 * Path for one donut segment. Angles in radians, clockwise from 12 o'clock,
 * with `to >= from`.
 */
export function donutArc(from: number, to: number): string {
  const centre = DONUT_SIZE / 2;
  const outer = DONUT_RADIUS;
  const inner = DONUT_RADIUS - DONUT_THICKNESS;

  const at = (r: number, angle: number) => {
    const x = centre + r * Math.sin(angle);
    const y = centre - r * Math.cos(angle);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  };

  const sweep = to - from;
  const steps = Math.max(1, Math.ceil(sweep / MAX_SEGMENT));
  const angles = Array.from({ length: steps + 1 }, (_, i) => from + (sweep * i) / steps);
  const last = angles[angles.length - 1];

  return [
    `M${at(outer, angles[0])}`,
    // Sweep flag 1: clockwise on screen, outward edge first.
    ...angles.slice(1).map((angle) => `A${outer},${outer} 0 0 1 ${at(outer, angle)}`),
    `L${at(inner, last)}`,
    // …and back along the inner edge the other way, closing the annulus.
    ...angles.slice(0, -1).reverse().map((angle) => `A${inner},${inner} 0 0 0 ${at(inner, angle)}`),
    "Z",
  ].join("");
}
