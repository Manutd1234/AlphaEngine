"use client";

/**
 * The four moments drawn ON the distribution they are moments OF.
 *
 * WHY THIS EXISTS. The Moments view answered with four numbers and a sentence
 * each — mean, standard deviation, skewness, excess kurtosis — in a table whose
 * third column was there to tell a reader what the second column meant. That is
 * a glossary, not a reading, and the reader said so: "add more diagrams and
 * summarise the words".
 *
 * Every one of the four is a statement about a SHAPE, and the shape is already
 * in the payload: `bins` carries the mass the moments were taken over. So the
 * shape is drawn, and each moment is drawn onto it as the thing it actually
 * says — the mean as the line it sits at, the standard deviation as the band it
 * measures, the skew as which side the long tail is on, the kurtosis as whether
 * the shoulders are heavier than a normal of the same width. A reader who has
 * never met excess kurtosis can see the answer without being taught the word;
 * the definitions stay, folded, for the reader who wants them.
 *
 * DRAWN FROM THE BINS, NEVER FROM THE MOMENTS. The silhouette is the quoted
 * mass itself, so it cannot disagree with the figure beside it on the Mass
 * view — the same bins, the same heights. The moments are overlaid as
 * reference marks. A curve SYNTHESISED from mean and variance would be a normal
 * this desk never measured, and drawing it under a skewness reading would be
 * the exact contradiction the reading exists to report.
 *
 * The bins are unequal only at the two unbounded tails, which have no width to
 * draw (see `PmfChart`'s note), so those are marked at the edges rather than
 * given an invented extent.
 */

import { DIAGRAM_LABEL_PX, advancePx } from "@/lib/coherence/label-metrics";
import type { CoherenceSurface } from "@/lib/coherence/types-lab";
import Figure, { FigureEmpty, Plot } from "../Figure";

const HEIGHT = 190;
/** `top` clears the 13px label rung the mean's own word draws at. */
const MARGIN = { top: 26, right: 14, bottom: 30, left: 14 };

/**
 * A wire decimal as a number, or null when it is not one.
 *
 * `Number()` is the wrong test on its own here: `Number(null)` is 0 and
 * `Number("")` is 0, both finite, so an ABSENT moment reads as the number zero
 * — which on this figure drew a mean line at the far edge of a plot whose axis
 * starts in the eighty thousands.
 */
function numberOrNull(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const text = raw.trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** A bounded bin's midpoint and mass, which is all the silhouette needs. */
interface Slice {
  mid: number;
  mass: number;
}

function slices(surface: CoherenceSurface): Slice[] {
  const out: Slice[] = [];
  for (const bin of surface.bins) {
    if (bin.low == null || bin.high == null) continue;
    const lo = Number(bin.low);
    const hi = Number(bin.high);
    const mass = Number(bin.mass);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(mass)) continue;
    out.push({ mid: (lo + hi) / 2, mass: Math.max(0, mass) });
  }
  return out.sort((a, b) => a.mid - b.mid);
}

export default function MomentsShape({ surface, meanLabel, sdLabel }: {
  surface: CoherenceSurface;
  /**
   * The mean and the standard deviation already cut to the desk's four places.
   *
   * Passed IN rather than formatted here, and the reason is a real constraint
   * rather than a preference: `decimalLabel` is defined in `DistributionView`,
   * which imports this file, so importing it back would be a module cycle. Nine
   * components read it from there and four of them are on the other tab, so
   * moving the definition would edit files this change has no business in.
   *
   * Passing the string also keeps the raw payload out of the drawing. The wire
   * carries `80738.64979381443298969072165`; drawn unformatted it ran off the
   * plot and past the card, which is the fourth time on this tab that a label
   * was sized against a string nobody had looked at.
   */
  meanLabel: string;
  sdLabel: string;
}) {
  const caption = "The shape the moments describe, with each moment drawn on it";
  const body = slices(surface);
  // `Number(null)` is 0, and 0 IS finite — so a guard of `Number.isFinite` alone
  // let an absent mean through as the number zero and drew its line hard against
  // the left edge of a plot that starts at 67,650, under the word "mean —".
  // Screenshotted on the running desk within a minute of the figure landing.
  // Every moment is optional on this payload, so every one is parsed the same
  // careful way and `null` means absent rather than zero.
  const mean = numberOrNull(surface.mean);
  const sd = numberOrNull(surface.standard_deviation);
  const skew = numberOrNull(surface.skewness);
  const kurt = numberOrNull(surface.excess_kurtosis);
  const decimalSkew = skew == null ? "—" : skew.toFixed(4);
  const heaviest = body.reduce((most, slice) => Math.max(most, slice.mass), 0);

  if (body.length < 3 || mean == null || !heaviest) {
    return (
      <Figure
        caption={caption}
        ariaLabel="No shape to draw for these moments"
        missing="The moments are drawn on the mass they were taken over, and this read carries too few bounded intervals to draw one."
      >
        <FigureEmpty reason="Fewer than three bounded intervals, or no mean — there is no silhouette to put a mean on." />
      </Figure>
    );
  }

  const lo = body[0].mid;
  const hi = body[body.length - 1].mid;
  const span = Math.max(1e-9, hi - lo);
  const hasSd = sd != null && sd > 0;

  const reading = [
    `The mass sits at ${meanLabel}`,
    hasSd ? `and one standard deviation either side is the shaded band, ${sdLabel} wide in the strikes' own units` : null,
    skew != null
      ? (Math.abs(skew) < 0.05
        ? ", and it is near symmetric"
        : `, and its long tail runs ${skew > 0 ? "UP toward the high strikes" : "DOWN toward the low strikes"}`)
      : null,
    kurt != null
      ? (kurt > 0
        ? " with heavier shoulders than a normal of the same width."
        : " with lighter shoulders than a normal of the same width.")
      : ".",
  ].filter(Boolean).join(" ").replace(/\s+,/g, ",");

  return (
    <Figure
      caption={caption}
      ariaLabel={`The implied mass as a silhouette, with the mean at ${meanLabel}${hasSd ? ` and a one-standard-deviation band of ${sdLabel}` : ""}`}
      reading={reading}
      missing={`Drawn from the ${body.length} bounded intervals only. The two unbounded tails have no width to draw and are marked at the edges rather than given an invented one.`}
    >
      <Plot height={HEIGHT}>
        {(width) => {
          const plotWidth = Math.max(1, width - MARGIN.left - MARGIN.right);
          const base = HEIGHT - MARGIN.bottom;
          const x = (value: number) => MARGIN.left + ((value - lo) / span) * plotWidth;
          const y = (mass: number) => base - (mass / heaviest) * (base - MARGIN.top);
          const area = `M${x(lo).toFixed(2)},${base.toFixed(2)}`
            + body.map((slice) => `L${x(slice.mid).toFixed(2)},${y(slice.mass).toFixed(2)}`).join("")
            + `L${x(hi).toFixed(2)},${base.toFixed(2)}Z`;
          const meanX = Math.min(Math.max(x(mean), MARGIN.left), width - MARGIN.right);
          const word = `mean ${meanLabel}`;
          const half = advancePx(word, DIAGRAM_LABEL_PX) / 2;
          return (
            <>
              {/* The band first, so the silhouette and the mean draw over it. */}
              {hasSd ? (
                <rect
                  x={Math.max(MARGIN.left, x(mean - sd))}
                  y={MARGIN.top}
                  width={Math.max(1, Math.min(width - MARGIN.right, x(mean + sd)) - Math.max(MARGIN.left, x(mean - sd)))}
                  height={base - MARGIN.top}
                  className="coh-settle__window"
                >
                  <title>{`one standard deviation either side of the mean: ${sdLabel}`}</title>
                </rect>
              ) : null}

              <path d={area} className="coh-surface__shape" />
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={base} y2={base} className="coh-surface__axis" />

              <line x1={meanX} x2={meanX} y1={MARGIN.top - 6} y2={base} className="coh-surface__median">
                <title>{`mean ${meanLabel}`}</title>
              </line>
              <text
                x={Math.min(Math.max(meanX, MARGIN.left + half), Math.max(MARGIN.left + half, width - MARGIN.right - half))}
                y={MARGIN.top - 8}
                textAnchor="middle"
                className="coh-surface__value"
              >
                {word}
              </text>

              {/* Which way the long tail runs, drawn at the end it runs to.
                  A mark and a word, never the direction in colour alone. */}
              {skew != null && Math.abs(skew) >= 0.05 ? (
                <text
                  x={skew > 0 ? width - MARGIN.right : MARGIN.left}
                  y={base - 6}
                  textAnchor={skew > 0 ? "end" : "start"}
                  className="coh-surface__tick"
                >
                  {skew > 0 ? "long tail ▸" : "◂ long tail"}
                  <title>{`skewness ${decimalSkew}`}</title>
                </text>
              ) : null}

              <text x={MARGIN.left} y={HEIGHT - 8} className="coh-surface__tick">
                {body[0].mid.toFixed(0)}
              </text>
              <text x={width - MARGIN.right} y={HEIGHT - 8} textAnchor="end" className="coh-surface__tick">
                {body[body.length - 1].mid.toFixed(0)}
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
