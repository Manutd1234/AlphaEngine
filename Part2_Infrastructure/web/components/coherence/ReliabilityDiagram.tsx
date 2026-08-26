"use client";

/**
 * The reliability diagram: what a band was priced at, against how often it happened.
 *
 * A contract paying a dollar is a probability with money on it, so the test is
 * direct. Take every market that settled from a price in the same tenth of a
 * dollar, and ask how many of them resolved YES. A venue whose prices mean what
 * they say puts those points on the diagonal, and the diagonal is drawn last so
 * nothing can cover the one reference the reader is asked to judge against.
 *
 * The vertical dropped from each point to that diagonal IS the gap the
 * reliability term squares and weights, so this drawing and the first bar of
 * the Murphy decomposition beside it are the same measurement seen twice.
 *
 * A band nobody quoted is a gap, never a point on the floor. Eight of the ten
 * bands are empty on the live sample; plotting them at zero would assert that
 * the exchange priced eight bands and every one of them failed to happen, when
 * what actually happened is that nothing settled there at all. They are marked
 * ◌ under the axis instead, which is a different claim and the true one.
 *
 * Points are sized by how many markets fell in the band. A band of 3 and a band
 * of 354 are not the same evidence, and a diagram that draws them the same size
 * invites a reader to weight them the same.
 *
 * The section's decimal readers live in `lib/coherence/decimals.ts` since
 * 2026-08-26, and the per-band reading the crosshair speaks in
 * `lib/coherence/reliability-read.ts` — one parser in one place, so the same
 * wire string never gets two readings.
 */

import { DOLLAR_CC, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceMapPoint, CoherenceReliabilityBin } from "@/lib/coherence/types-lab";
import Figure, { FigureEmpty, Plot } from "./Figure";
import { unitOf } from "@/lib/coherence/decimals";
import { readBand } from "@/lib/coherence/reliability-read";

const HEIGHT = 310;
const MARGIN = { top: 14, right: 10, bottom: 40, left: 36 };
const MAX_SIDE = 256;
/* The key's six entries are set at the 13px legend rung (14r): the longest,
   "perfect calibration" and "isotonic correction" at 19 characters, run
   19 x 13 x 0.56 = 138px past the 28px mark offset = 166px, so 200 keeps
   ~34px of slack. At the old 178 the 13px lift left 12px, one glyph. */
const KEY_WIDTH = 200;
const DOT_MIN = 3.5;
const DOT_MAX = 9;

/* ------------------------------------------------------------- diagram --- */

interface Point {
  label: string;
  count: number;
  priced: number;
  happened: number;
}

export default function ReliabilityDiagram({
  bins,
  map,
  baseRate,
  horizonNote,
}: {
  bins: CoherenceReliabilityBin[];
  map: CoherenceMapPoint[];
  baseRate: string | null;
  /** What the x axis is a price AT — the pane knows, this figure does not. */
  horizonNote: string;
}) {
  const points: Point[] = [];
  for (const bin of bins) {
    if (bin.count <= 0) continue;
    const priced = unitOf(bin.mean_forecast);
    const happened = unitOf(bin.outcome_rate);
    if (priced == null || happened == null) continue;
    points.push({
      label: bin.label,
      count: bin.count,
      priced,
      happened,
    });
  }

  const empty = bins.filter((bin) => bin.count === 0);
  const emptyNote = empty.length
    ? `${empty.length} of the ${bins.length} bands were never quoted (${empty
        .map((bin) => bin.label)
        .join(", ")}) and are marked ◌ under the axis, never drawn on the floor: nothing settled there, which is not a zero outcome rate.`
    : null;

  if (!points.length) {
    return (
      <Figure
        caption="Reliability diagram: quoted price against realised frequency, band by band"
        ariaLabel="No price band has a settled market in it yet"
        missing={emptyNote}
      >
        <FigureEmpty reason="No band has a settled market yet — nothing to place against the diagonal." />
      </Figure>
    );
  }

  const steps: Array<{ x: number; y: number; weight: number }> = [];
  for (const point of map) {
    const x = unitOf(point.quoted);
    const y = unitOf(point.calibrated);
    if (x == null || y == null) continue;
    steps.push({ x, y, weight: point.weight });
  }

  const base = unitOf(baseRate);
  const heaviest = Math.max(...points.map((point) => point.count), 1);
  const heaviestKnot = Math.max(...steps.map((step) => step.weight), 1);
  const worst = points.reduce((carry, point) =>
    Math.abs(point.happened - point.priced) > Math.abs(carry.happened - carry.priced) ? point : carry,
  );

  /** The square, and the two maps into it — shared by the marks and the crosshair. */
  const geometry = (width: number) => {
    const side = Math.max(80, Math.min(width - MARGIN.left - MARGIN.right, MAX_SIDE));
    const left = MARGIN.left;
    const floor = MARGIN.top + side;
    const px = (value: number) => left + value * side;
    const py = (value: number) => floor - value * side;
    return { side, left, floor, px, py };
  };

  return (
    <Figure
      caption={`Reliability diagram: quoted price against realised frequency, band by band — ${horizonNote}`}
      ariaLabel={`${points.length} of ${bins.length} price bands carry settled markets; the widest gap is in the ${worst.label} band`}
      // WHAT WENT, 2026-08-25. "Priced at the horizontal, happening at the
      // vertical" is the two axis labels; "sized and numbered by its N settled
      // markets" is the dot, which is sized and has its count printed beside
      // it; "the widest gap is the X band, priced Y against Z" is the visibly
      // widest dot with both figures already on it; and "the step line is the
      // isotonic correction" is the key. Five clauses describing the drawing to
      // someone looking at it.
      //
      // What survives is the one thing the geometry cannot state: what a gap
      // MEANS. A reader can see which band is furthest from the diagonal
      // without being told; that it is that band's contribution to the
      // reliability term — the quantity the Murphy waterfall then decomposes —
      // is a fact about the arithmetic, not about the picture.
      reading={`Each gap from the diagonal is that band's contribution to the reliability term.${steps.length ? ` The step line is the isotonic correction; its knots are sized by the settled markets each was fitted on${steps.some((step) => step.weight === 1) ? ", and one of them rests on a single observation" : ""}.` : ""}`}
      missing={emptyNote}
    >
      <Plot
        height={HEIGHT}
        // ONE CROSSHAIR PER BAND, since 2026-08-26, in place of three kinds of
        // title. A reader walks the ten bands in price order and hears, at
        // each, what settled there, what it was priced at, what happened, the
        // gap, and the isotonic knot if one rests in it — or that nobody
        // quoted the band. Bands are equal tenths, so the axis is even by
        // construction. The same `px` the marks use.
        sharedX={(width) => {
          const { px } = geometry(width);
          return {
            count: bins.length,
            x0: px(0.5 / bins.length),
            x1: px((bins.length - 0.5) / bins.length),
            read: (index) => readBand(bins, map, index),
            width: 300,
            arriveAt: "first",
          };
        }}
      >
        {(width) => {
          const { side, left, floor, px, py } = geometry(width);
          const keyX = left + side + 20;
          const showKey = width - keyX >= KEY_WIDTH;
          const radius = (count: number) => DOT_MIN + (DOT_MAX - DOT_MIN) * Math.sqrt(count / heaviest);
          const isotonic = steps.length
            ? steps
                .map((step, index) =>
                  index === 0
                    ? `M${px(step.x).toFixed(2)},${py(step.y).toFixed(2)}`
                    : `L${px(step.x).toFixed(2)},${py(steps[index - 1].y).toFixed(2)}L${px(step.x).toFixed(2)},${py(step.y).toFixed(2)}`,
                )
                .join("")
            : null;

          return (
            <>
              <line x1={left} x2={left} y1={MARGIN.top} y2={floor} className="coh-calib__axis" />
              <line x1={left} x2={left + side} y1={floor} y2={floor} className="coh-calib__axis" />

              {bins.slice(1).map((bin, index) => (
                <line
                  key={`edge-${bin.label}`}
                  x1={px((index + 1) / bins.length)}
                  x2={px((index + 1) / bins.length)}
                  y1={MARGIN.top}
                  y2={floor}
                  className="coh-calib__band"
                />
              ))}

              {bins.map((bin, index) =>
                bin.count === 0 ? (
                  <text
                    key={`gap-${bin.label}`}
                    x={px((index + 0.5) / bins.length)}
                    y={floor + 12}
                    textAnchor="middle"
                    className="coh-calib__gapmark"
                  >
                    ◌
                  </text>
                ) : null,
              )}

              {base != null ? (
                <>
                  <line x1={left} x2={left + side} y1={py(base)} y2={py(base)} className="coh-calib__base" />
                  <text x={left + side - 2} y={py(base) - 3} textAnchor="end" className="coh-calib__tick">
                    base rate
                  </text>
                </>
              ) : null}

              {isotonic ? <path d={isotonic} className="coh-calib__isotonic" fill="none" /> : null}

              {/* HOW MUCH EACH STEP RESTS ON. `weight` was read into `steps`
                  and then never encoded, so a step fitted on 178 settled
                  markets and one fitted on a SINGLE market were the same
                  corner of the same line. Measured on the live corpus, that is
                  exactly the spread: 178, 1, 92. A correction whose middle knot
                  is one observation is not the same claim as one whose knots
                  are hundreds, and the drawing said nothing either way. */}
              {steps.map((step, index) => (
                <circle
                  key={`knot-${index}`}
                  cx={px(step.x)}
                  cy={py(step.y)}
                  r={DOT_MIN + (DOT_MAX - DOT_MIN) * Math.sqrt(step.weight / heaviestKnot)}
                  className="coh-calib__knot"
                />
              ))}

              {points.map((point) => (
                <line
                  key={`residual-${point.label}`}
                  x1={px(point.priced)}
                  x2={px(point.priced)}
                  y1={py(point.happened)}
                  y2={py(point.priced)}
                  className="coh-calib__residual"
                />
              ))}

              {points.map((point) => {
                const r = radius(point.count);
                const anchorRight = px(point.priced) + r + 6 > left + side - 24;
                return (
                  <g key={`point-${point.label}`}>
                    {/* The residual line DRAWS the gap; the crosshair's rows
                        carry the number for it, with the two prices. */}
                    <circle cx={px(point.priced)} cy={py(point.happened)} r={r} className="coh-calib__point" />
                    <text
                      x={anchorRight ? px(point.priced) - r - 4 : px(point.priced) + r + 4}
                      y={py(point.happened) + 3}
                      textAnchor={anchorRight ? "end" : "start"}
                      className="coh-calib__count"
                    >
                      {point.count}
                    </text>
                  </g>
                );
              })}

              {/* Last, over everything: the diagonal is the claim being tested. */}
              <line x1={px(0)} x2={px(1)} y1={py(0)} y2={py(1)} className="coh-calib__perfect" />

              {[0, 0.5, 1].map((tick) => (
                <text key={`xt-${tick}`} x={px(tick)} y={floor + 24} textAnchor="middle" className="coh-calib__tick">
                  {tick.toFixed(1)}
                </text>
              ))}
              {[0, 0.5, 1].map((tick) => (
                <text key={`yt-${tick}`} x={left - 5} y={py(tick) + 3} textAnchor="end" className="coh-calib__tick">
                  {tick.toFixed(1)}
                </text>
              ))}
              {/* Axis TITLES, not tick numerals — they take the diagram
                  ladder's 12px label rung (coh-svg-label, 14r) while the
                  0.0/0.5/1.0 ticks above stay on the 10px floor. */}
              <text x={px(0.5)} y={floor + 36} textAnchor="middle" className="coh-svg-label">
                price quoted
              </text>
              <text
                x={12}
                y={MARGIN.top + side / 2}
                textAnchor="middle"
                transform={`rotate(-90 12 ${MARGIN.top + side / 2})`}
                className="coh-svg-label"
              >
                how often it happened
              </text>

              {showKey ? (
                <g>
                  <line x1={keyX} x2={keyX + 22} y1={MARGIN.top + 8} y2={MARGIN.top + 8} className="coh-calib__perfect" />
                  <text x={keyX + 28} y={MARGIN.top + 11} className="coh-calib__keytext">
                    perfect calibration
                  </text>
                  <line x1={keyX} x2={keyX + 22} y1={MARGIN.top + 26} y2={MARGIN.top + 26} className="coh-calib__isotonic" />
                  <text x={keyX + 28} y={MARGIN.top + 29} className="coh-calib__keytext">
                    isotonic correction
                  </text>
                  <line x1={keyX + 11} x2={keyX + 11} y1={MARGIN.top + 38} y2={MARGIN.top + 50} className="coh-calib__residual" />
                  <text x={keyX + 28} y={MARGIN.top + 47} className="coh-calib__keytext">
                    gap this band adds
                  </text>
                  <circle cx={keyX + 11} cy={MARGIN.top + 64} r={DOT_MAX} className="coh-calib__point" />
                  <text x={keyX + 28} y={MARGIN.top + 67} className="coh-calib__keytext">
                    area is the count
                  </text>
                  <text x={keyX + 11} y={MARGIN.top + 85} textAnchor="middle" className="coh-calib__gapmark">
                    ◌
                  </text>
                  <text x={keyX + 28} y={MARGIN.top + 85} className="coh-calib__keytext">
                    band nobody quoted
                  </text>
                  <line x1={keyX} x2={keyX + 22} y1={MARGIN.top + 98} y2={MARGIN.top + 98} className="coh-calib__base" />
                  <text x={keyX + 28} y={MARGIN.top + 101} className="coh-calib__keytext">
                    base rate
                  </text>
                </g>
              ) : null}
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
