"use client";

/**
 * Why the solver staked nothing: every outcome, priced against what it is worth.
 *
 * THE BRANCH A READER NORMALLY LANDS ON WAS ONE GREY SENTENCE. Fed the market's
 * own mids the solver returns "stake nothing" — the section's own lede says so —
 * so "No outcome is admitted" is not the exceptional case, it is the usual one,
 * and until 2026-08-25 it was the whole view. The desk's standing rule is that
 * an empty branch draws too, and it is sharpest here: the branch a reader meets
 * most often is the one with nothing on it.
 *
 * What it draws is the reason. Each outcome sits at (what the market charges,
 * what the measure says it is worth), and the diagonal is where those two
 * agree. A point BELOW the line is an outcome priced under its worth — an edge,
 * and something the plan would stake. A point ON or ABOVE it is not. When every
 * point sits on or above the diagonal, "no outcome is admitted" stops being an
 * assertion a reader has to take and becomes a picture they can check.
 *
 * IT IS DRAWN ON BOTH BRANCHES, not only the empty one. A plan that staked
 * three of sixty outcomes raises exactly the same question about the other
 * fifty-seven, and a figure that appeared only when the answer was "none" would
 * be teaching a reader that no news is no picture.
 *
 * THE DIAGONAL IS THE REFERENCE AND NOTHING MAY OCCLUDE IT, which is this tab's
 * rule for every figure that has one. Admitted points carry a mark as well as a
 * fill, because a fill alone is colour-only meaning and this figure's whole
 * content is which side of a line a dot is on.
 */

import type { CoherenceKelly, CoherenceStake } from "@/lib/coherence/types-lab";
import { toUnit } from "../FrechetBand";
import Figure, { FigureEmpty, Plot } from "../Figure";

const HEIGHT = 240;
const MARGIN = { top: 14, right: 16, bottom: 42, left: 44 };

interface Placed {
  stake: CoherenceStake;
  price: number;
  worth: number;
}

function placed(stakes: CoherenceStake[]): Placed[] {
  const out: Placed[] = [];
  for (const stake of stakes) {
    const price = toUnit(stake.price);
    const worth = toUnit(stake.probability);
    if (price == null || worth == null) continue;
    out.push({ stake, price, worth });
  }
  return out;
}

export default function EdgeScatter({ kelly }: { kelly: CoherenceKelly }) {
  const points = placed(kelly.stakes);
  const admitted = points.filter((point) => point.stake.admitted).length;
  const dropped = kelly.stakes.length - points.length;
  const caption = "Every outcome: what it costs against what the measure says it is worth";
  const aria = "Each outcome plotted at its price against its implied probability, with the fair-value diagonal";

  if (points.length < 2) {
    return (
      <Figure caption={caption} ariaLabel={aria}>
        <FigureEmpty
          reason={
            kelly.stakes.length
              ? `Only ${points.length} of ${kelly.stakes.length} outcomes carried both a price and a measure, `
                + "and two points are the fewest that can show a pattern against the diagonal."
              : "The solve returned no outcomes, so there is nothing to place against the line."
          }
        />
      </Figure>
    );
  }

  return (
    <Figure
      caption={caption}
      ariaLabel={aria}
      reading={
        admitted
          ? `${admitted} of ${points.length} outcomes sit below the line — priced under what the measure says `
            + "they are worth, which is the edge the plan stakes."
          : "Every outcome sits on or above the line: the market charges at least what the measure says each "
            + "is worth, which is why the plan stakes nothing. That is a reading of these prices, not a failure."
      }
      missing={dropped
        ? `${dropped} of ${kelly.stakes.length} outcomes carried no price or no measure and are not placed — `
          + "an outcome that could not be valued is absent, not worthless."
        : null}
      notes={[
        "The measure is the one this family's own quotes imply, normalised to sum to one — so the diagonal is "
        + "internal consistency, not an outside forecast. A family whose prices already admit a probability sits "
        + "on the line by construction.",
        "Price is what the venue charges to buy that outcome. Where the book is one-sided it is read off the "
        + "opposite ladder, like every other offer on this tab.",
      ]}
    >
      <Plot height={HEIGHT}>
        {(width) => {
          const right = width - MARGIN.right;
          const x = (v: number) => MARGIN.left + v * (right - MARGIN.left);
          const y = (v: number) => HEIGHT - MARGIN.bottom - v * (HEIGHT - MARGIN.bottom - MARGIN.top);
          const grid = [0, 0.25, 0.5, 0.75, 1];

          return (
            <g>
              {grid.map((v) => (
                <g key={v}>
                  <line className="coh-tape__grid" x1={MARGIN.left} x2={right} y1={y(v)} y2={y(v)} />
                  <text className="coh-tape__tick" x={MARGIN.left - 6} y={y(v) + 4} textAnchor="end">
                    {v.toFixed(2)}
                  </text>
                  <text className="coh-tape__tick" x={x(v)} y={HEIGHT - 22} textAnchor="middle">
                    {v.toFixed(2)}
                  </text>
                </g>
              ))}

              {/* The reference, over the grid and under nothing. */}
              <line className="coh-edge__fair" x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} />
              {/* ANCHORED AT ITS END, and that is the fix rather than the
                  style. Left-anchored at 0.72 the label ran to the RIGHT, and
                  the diagonal rises to the right — so the line caught up with
                  the text and struck it through. Ending at 0.55 the label
                  extends left, into the region where the line is lower, and the
                  8px lift clears it the whole way. */}
              <text className="coh-edge__fair-label" x={x(0.55)} y={y(0.55) - 8} textAnchor="end">
                priced at what it is worth
              </text>

              {points.map((point) => (
                <g key={point.stake.ticker}>
                  <circle
                    className={point.stake.admitted ? "coh-edge__dot is-admitted" : "coh-edge__dot"}
                    cx={x(point.price)}
                    cy={y(point.worth)}
                    r={point.stake.admitted ? 4.5 : 3}
                  >
                    <title>
                      {`${point.stake.label || point.stake.ticker}: costs ${point.stake.price}, `
                        + `worth ${point.stake.probability}, edge ${point.stake.edge} — `
                        + `${point.stake.admitted ? "staked" : "passed over"}`}
                    </title>
                  </circle>
                  {/* A MARK AS WELL AS A FILL on the admitted points. Which side
                      of the line a dot is on is this figure's entire content, so
                      it may not rest on colour — the house rule, and what keeps
                      it legible in Windows High Contrast. */}
                  {point.stake.admitted ? (
                    <text className="coh-edge__mark" x={x(point.price)} y={y(point.worth) - 7} textAnchor="middle">
                      ●
                    </text>
                  ) : null}
                </g>
              ))}

              {/* Under the ticks, not beside them. At the right edge on the
                  tick row it overprinted the 1.00 label; a row of its own costs
                  12px of a 240px figure and reads at any width. */}
              <text className="coh-tape__tick" x={(MARGIN.left + right) / 2} y={HEIGHT - 6} textAnchor="middle">
                what the venue charges for this outcome
              </text>
            </g>
          );
        }}
      </Plot>
    </Figure>
  );
}
