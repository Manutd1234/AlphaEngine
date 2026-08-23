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
 * This file also holds the section's decimal readers. The gateway sends these
 * statistics as thirty-digit Python `Decimal`s; one parser in one place, so the
 * same string never gets two different readings across the three files here.
 */

import { DOLLAR_CC, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceMapPoint, CoherenceReliabilityBin } from "@/lib/coherence/types-lab";
import Figure, { FigureEmpty, Plot } from "./Figure";

const HEIGHT = 310;
const MARGIN = { top: 14, right: 10, bottom: 40, left: 36 };
const MAX_SIDE = 256;
const KEY_WIDTH = 178;
const DOT_MIN = 3.5;
const DOT_MAX = 9;

/* ------------------------------------------------------------- decimals -- */

/**
 * A wire decimal cut to `places`, textually.
 *
 * Cut, not rounded, and never through a float: `Number("0.00010533…")` is
 * already a different number by the time it could be formatted, and these
 * quantities exist at the places where the difference between a reliability of
 * 0.00010358 and a brier of 0.00010533 is the entire finding.
 */
export function truncateDecimal(raw: string | null | undefined, places: number): string | null {
  if (raw == null) return null;
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(raw.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  if (!whole && !fraction) return null;
  const kept = (fraction + "0".repeat(places)).slice(0, places);
  return places > 0 ? `${sign}${whole || "0"}.${kept}` : `${sign}${whole || "0"}`;
}

/** The same, ready to print. A statistic the engine could not compute is a dash. */
export function decimalLabel(raw: string | null | undefined, places = 4): string {
  return truncateDecimal(raw, places) ?? "—";
}

/**
 * A quoted probability as a fraction of a dollar, for plotting.
 *
 * Routed through the centicent reader so a price on this diagram is the same
 * quantity the rest of the tab draws — four decimals, the exchange's own tick.
 */
export function unitOf(raw: string | null | undefined): number | null {
  const cc = toCenticents(truncateDecimal(raw, 4));
  return cc == null ? null : cc / DOLLAR_CC;
}

/**
 * A decomposition term as a float, for GEOMETRY ONLY.
 *
 * These are not prices. They are mean squared errors carrying twenty-eight
 * significant digits, and a pixel is not a twenty-eight-digit quantity — so the
 * coordinate is allowed to be a float while every number the reader is shown is
 * cut from the string by `decimalLabel` and never from this.
 */
export function statValue(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const text = raw.trim();
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------- diagram --- */

interface Point {
  label: string;
  count: number;
  priced: number;
  happened: number;
  /** The wire strings, kept so every printed number is cut from the source. */
  pricedText: string;
  happenedText: string;
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
      pricedText: decimalLabel(bin.mean_forecast),
      happenedText: decimalLabel(bin.outcome_rate),
    });
  }

  const empty = bins.filter((bin) => bin.count === 0);
  const emptyNote = empty.length
    ? `${empty.length} of the ${bins.length} bands were never quoted (${empty
        .map((bin) => bin.label)
        .join(", ")}) and are marked ◌ under the axis rather than drawn on the floor: nothing settled from those prices, which is not the same claim as an outcome rate of zero.`
    : null;

  if (!points.length) {
    return (
      <Figure
        caption="Price against outcome, band by band"
        ariaLabel="No price band has a settled market in it yet"
        missing={emptyNote}
      >
        <FigureEmpty reason="No band has a settled market in it yet — there is nothing to place against the diagonal." />
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
  const worst = points.reduce((carry, point) =>
    Math.abs(point.happened - point.priced) > Math.abs(carry.happened - carry.priced) ? point : carry,
  );

  return (
    <Figure
      caption={`Price against outcome, band by band — ${horizonNote}`}
      ariaLabel={`${points.length} of ${bins.length} price bands carry settled markets; the widest gap between price and outcome is in the ${worst.label} band`}
      reading={`Each point is one tenth-of-a-dollar band: across the band's ${points
        .map((point) => point.count)
        .join(" and ")} settled markets, the horizontal is what they were priced at and the vertical is how often they happened. The dashed diagonal is perfect calibration; the short line from a point to it is that band's contribution to the reliability term. The widest gap here is the ${worst.label} band, priced at ${worst.pricedText} against an outcome rate of ${worst.happenedText}. The number beside a point, and its area, are both how many settled markets fell in that band.${steps.length ? ` The step line is the isotonic correction: the non-decreasing curve that would put these points back on the diagonal.` : ``}`}
      missing={emptyNote}
    >
      <Plot height={HEIGHT}>
        {(width) => {
          const side = Math.max(80, Math.min(width - MARGIN.left - MARGIN.right, MAX_SIDE));
          const left = MARGIN.left;
          const floor = MARGIN.top + side;
          const px = (value: number) => left + value * side;
          const py = (value: number) => floor - value * side;
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
                  <g key={`gap-${bin.label}`}>
                    <title>{`${bin.label}: nobody quoted this band, so it has no outcome rate`}</title>
                    <text
                      x={px((index + 0.5) / bins.length)}
                      y={floor + 12}
                      textAnchor="middle"
                      className="coh-calib__gapmark"
                    >
                      ◌
                    </text>
                  </g>
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
                    <title>{`${point.label}: ${point.count} settled market(s), priced ${point.pricedText}, happened ${point.happenedText}`}</title>
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
              <text x={px(0.5)} y={floor + 36} textAnchor="middle" className="coh-calib__tick">
                price quoted
              </text>
              <text
                x={12}
                y={MARGIN.top + side / 2}
                textAnchor="middle"
                transform={`rotate(-90 12 ${MARGIN.top + side / 2})`}
                className="coh-calib__tick"
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
