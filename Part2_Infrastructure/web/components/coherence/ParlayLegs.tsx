"use client";

/**
 * What each parlay is built out of: its legs, on the axis the band comes from.
 *
 * THE VIEW THIS SERVES HAD NO DRAWING AT ALL. `Parlays` is six folded cards,
 * each opening on a position sentence, and it carried a named exemption in
 * `engine-opens-on-a-drawing.test.ts` on the argument that the Bands view draws
 * all six bands together so a figure here would be the same bands twice. That
 * argument was right about BANDS and it is why this figure is not one.
 *
 * REJECTED FIRST, and recorded because it is the obvious thing to build: a
 * price-against-Πpᵢ strip. `ComboBandStrips` already draws the quoted price as
 * a rule and independence as a hollow ring, one row per parlay, on this same
 * dollar axis — so a dependence figure would be two marks a reader has already
 * met, redrawn one press away. A figure has to answer its own view's question
 * or not be drawn.
 *
 * THE QUESTION THIS VIEW ACTUALLY ASKS is what a parlay is made of, and the
 * answer is on every card behind a `<details>`: five columns of legs, six times
 * over, reachable only by opening each one. The legs are also where the band
 * comes from — `max(0, Σpᵢ − (n−1)) ≤ P(all) ≤ min pᵢ`, both ends built from
 * the leg mids — so a reader who can see them can see WHY one parlay's band is
 * tight and another's runs half the dollar. That is the reading, and it is
 * otherwise a table nobody opens.
 *
 * A LEG WITH NO IMPLIED p IS THE POINT, NOT AN INCONVENIENCE. The side the
 * parlay needs is unquoted, so Πpᵢ has no value and neither do the bounds. It
 * gets a counted word in the row rather than a tick at zero: zero is a legal
 * Kalshi price and "nobody is quoting" is not it. The parlays whose legs are
 * mostly unquoted are exactly the ones this read can say least about, and this
 * is the only place that is visible at a glance.
 *
 * It fetches nothing — the combos payload the section already read carries
 * every leg.
 */

import { DOLLAR_CC, priceLabel, toCenticents } from "@/lib/coherence/fixed-point";
import { DIAGRAM_LABEL_PX, gutterFor, truncateMiddle } from "@/lib/coherence/label-metrics";
import type { CoherenceCombo } from "@/lib/coherence/types-lab";
import Figure, { Plot } from "./Figure";

/** One parlay per row. Matched to `ComboBandStrips` so the two read as a pair. */
const ROW_H = 40;
const TOP = 4;
const AXIS_GAP = 8;

export default function ParlayLegs({ combos }: { combos: CoherenceCombo[] }) {
  const rows = combos.map((combo) => {
    const legs = combo.legs.map((leg) => ({
      ticker: leg.ticker,
      side: leg.side,
      p: toCenticents(leg.probability),
      text: priceLabel(leg.probability),
    }));
    return {
      ticker: combo.ticker,
      legs,
      quoted: legs.filter((leg) => leg.p != null),
      unquoted: legs.filter((leg) => leg.p == null).length,
    };
  });

  const axisY = TOP + rows.length * ROW_H + AXIS_GAP;
  const height = axisY + 16;
  const blind = rows.filter((row) => row.unquoted > 0).length;
  const widest = rows.reduce((most, row) => Math.max(most, row.legs.length), 0);

  return (
    <Figure
      caption="Every parlay's legs at their implied p, the two prices its band is built from"
      ariaLabel={rows
        .map((row) =>
          `${row.ticker}: ${row.legs.length} legs, ${row.quoted
            .map((leg) => leg.text)
            .join(", ") || "none quoted"}`)
        .join(". ")}
      reading={
        widest
          ? "The lowest tick in a row is that parlay's upper bound, and the ticks together fix the lower one — so a row whose legs sit high has little room left in its band."
          : "No parlay in this read carries a quoted leg."
      }
      notes={[
        blind
          ? `${blind} of ${rows.length} parlays carry a leg with no implied p: the side the parlay needs is unquoted, so Πpᵢ has no value and neither do that parlay's bounds. A missing quote, never a probability of zero.`
          : "Every leg of every parlay is quoted on the side its parlay needs, so no band in this read is missing an end.",
        "Implied p is the MID of the side the parlay needs, which is what both bounds are built from. The parlay itself is read from its offer, so a price above the ticks is not on its own evidence of anything about the legs.",
      ]}
    >
      <Plot height={height}>
        {(width) => {
          const labelW = gutterFor(rows.map((row) => row.ticker), width, DIAGRAM_LABEL_PX, {
            min: 96, maxFraction: 0.34, max: 260,
          });
          const trackW = Math.max(60, width - labelW);
          const x = (cc: number) => labelW + (Math.min(cc, DOLLAR_CC) / DOLLAR_CC) * trackW;
          return (
            <>
              {/* TRACKS AND MARKS FIRST, LABELS AFTER — the paint-order rule
                  `ComboBandStrips` records: the track is an opaque fill, so a
                  label emitted first turns any gutter overrun into a silent
                  clip that looks exactly like a shorter ticker. */}
              {rows.map((row, index) => {
                const y = TOP + index * ROW_H;
                return (
                  <g key={`${row.ticker}-legs`}>
                    <rect x={labelW} y={y + 9} width={trackW} height={14} className="coh-combo__track" />
                    {row.quoted.map((leg, at) => (
                      <line
                        key={`${leg.ticker}-${leg.side}-${at}`}
                        x1={x(leg.p as number)}
                        x2={x(leg.p as number)}
                        y1={y + 6}
                        y2={y + 26}
                        className="coh-combo__leg"
                      >
                        <title>
                          {`${leg.ticker} must land ${leg.side}: implied p ${leg.text}`}
                        </title>
                      </line>
                    ))}
                    {row.unquoted ? (
                      <text x={labelW + 4} y={y + 20} className="coh-combo__label">
                        {`◌ ${row.unquoted} unquoted`}
                        <title>
                          {`${row.unquoted} of this parlay's ${row.legs.length} legs are unquoted on the side it needs, so it has no bounds`}
                        </title>
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {rows.map((row, index) => (
                <text key={`${row.ticker}-label`} x={0} y={TOP + index * ROW_H + 20} className="coh-combo__label">
                  {truncateMiddle(row.ticker, labelW - 10, DIAGRAM_LABEL_PX)}
                  <title>{`${row.ticker} — ${row.legs.length} legs`}</title>
                </text>
              ))}
              <line x1={labelW} x2={width} y1={axisY} y2={axisY} className="coh-ladder__axis" />
              <text x={labelW} y={axisY + 13} className="coh-combo__axis">$0</text>
              <text x={width} y={axisY + 13} textAnchor="end" className="coh-combo__axis">$1</text>
              <text x={(labelW + width) / 2} y={axisY + 13} textAnchor="middle" className="coh-combo__key">
                | one leg at its implied p
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
