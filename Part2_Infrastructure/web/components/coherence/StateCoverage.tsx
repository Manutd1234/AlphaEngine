"use client";

/**
 * Every state this family can settle into, and which of them the basket touches.
 *
 * THE SECTION'S OWN HONEST PROBLEM, DRAWN. `BasketSection`'s header states it:
 * the common answer is coherent, a coherent family hands back NO portfolio, and
 * a rail section whose usual state is one sentence of absence is a dead end.
 * `MarginAxis` answered half of that — how far the best available basket fell
 * short — and left the other half unanswered, which is what the basket would
 * have had to cover. This is that half, and it is the same drawing in both
 * cases: the states are a property of the FAMILY, so they exist whether or not
 * a portfolio does.
 *
 * NOT `PayoffByState`, AND THE DIFFERENCE IS THE SUBJECT. That figure draws what
 * a winning portfolio PAYS in each state, so it needs legs, prices and sizes and
 * is correctly absent on the ordinary answer. This one draws which states a leg
 * NAMES — a fact about the basket's shape rather than its arithmetic — and its
 * ordinary answer is a row of stubs, which is the finding rather than an empty
 * frame.
 *
 * IT FETCHES NOTHING. The states come from the universe read the console
 * already holds and the legs from the certificate already on screen. A figure
 * that quietly needed a new route would be a schema change wearing a chart's
 * clothes, which is the rule `diffusion-figures.test.ts` pins for the
 * announcement arm and `proofs-figures.test.ts` pins for this one.
 *
 * WHAT IT REFUSES TO SAY. A leg is matched to a state by TICKER, which is exact
 * for a mutually exclusive family — one market, one state, the payoff matrix is
 * the identity (`kernel/states.py::_named_states`). It is not exact for a strike
 * family, whose states are intervals that several markets pay in, so the caller
 * passes `exact: false` and the figure says the covering is a lower bound rather
 * than drawing a picture of a world it guessed at.
 *
 * Nothing means anything by colour alone: a covered state is a filled block with
 * its direction word beneath it, an uncovered one is a stub with ◌ and the word
 * "none", and the key at the top pairs the two.
 *
 * IT DEGRADES AT WIDTH, AND THAT WAS FOUND IN A BROWSER RATHER THAN DERIVED.
 * The first version drew a labelled column per state with a rotated ticker and a
 * word under each, which is right for the five-market family it was designed
 * against and unreadable for `KXBTCD-26AUG2507`, whose ladder is 188 strikes: at
 * 1,440px that is a 7px column carrying a rotated label and the word "none", and
 * it rendered as a hatched grey block. Every test passed — `npm test` has no DOM,
 * so a column count is a number nobody can see (CLAUDE.md, fact 6).
 *
 * So above the density at which a label fits, the labels and the per-state words
 * are DROPPED rather than drawn on top of each other, and the figure becomes a
 * ribbon: one cell per state, covered cells filled, the count in the reading and
 * every state still named in its own `<title>`. The claim is identical at both
 * densities; what changes is only what there is room to write.
 */

import { DIAGRAM_LABEL_PX, truncateMiddle } from "@/lib/coherence/label-metrics";
import type { CoherenceCertificate } from "@/lib/coherence/types";
import Figure, { FigureEmpty, Plot } from "./Figure";

export interface CoverageState {
  ticker: string;
  label: string;
}

const CAPTION = "Every state this family can settle into, marked where a leg names it";

const KEY_Y = 15;
const WORD_Y = 30;
const BLOCK_TOP = 38;
const BLOCK_H = 34;
/** Room under the axis for the rotated state labels, on the 10px tick rung. */
const LABEL_BAND = 104;
/** Room for the two end labels once the per-state ones are dropped. */
const DENSE_BAND = 24;
/**
 * Below this many pixels per state a label cannot be written, so none is.
 *
 * A rotated ticker needs its column to be wider than the type it sets in, and
 * the word under it ("bought", "none") needs the same. 16 is the smallest
 * column that holds a 10px tick label upright with a hair of separation;
 * measured against `KXBTCD-26AUG2507`, whose 188 strikes give 7px at desk
 * width and drew as a hatched block.
 */
const DENSE_PX = 16;
/**
 * The width the density is judged at, since the real one is not known yet.
 *
 * `Plot` measures its container and hands the width to the render callback, but
 * the plot's HEIGHT — which is what reserves the label band — has to be decided
 * before that. So one estimate decides both, and it is deliberately the narrow
 * case: this figure is drawn inside a two-column pair at desk width, so about
 * half of a 1,360px card. Erring narrow drops a label that would have fitted;
 * erring wide draws one that is clipped, and only one of those is recoverable
 * by hovering.
 */
const REFERENCE_W = 680;

/** "buy", "sell", or both — what the basket does in this state. */
function sideWord(directions: string[]): string {
  const unique = [...new Set(directions)];
  if (!unique.length) return "none";
  if (unique.length > 1) return "both";
  return unique[0] === "buy" ? "bought" : "sold";
}

export default function StateCoverage({
  certificate,
  states,
  exact,
}: {
  certificate: CoherenceCertificate;
  /** The family's settlement states, in the exchange's own order. */
  states: CoverageState[];
  /** True only where one market is one state, so a ticker match IS a covering. */
  exact: boolean;
}) {
  const columns = states.map((state) => {
    const legs = certificate.legs.filter((leg) => leg.ticker === state.ticker);
    return { ...state, legs, word: sideWord(legs.map((leg) => leg.direction)) };
  });
  const covered = columns.filter((column) => column.legs.length > 0).length;
  // A leg whose ticker is in no column is the one shape that would make this
  // figure a picture of a smaller world. Counted rather than dropped.
  const offBoard = certificate.legs.filter(
    (leg) => !states.some((state) => state.ticker === leg.ticker),
  ).length;

  // The density the figure will be drawn at. Derived from the state COUNT rather
  // than measured width, because `Plot` hands the width to the render callback
  // and the plot's own height has to be decided before that.
  const dense = columns.length > 0 && REFERENCE_W / columns.length < DENSE_PX;

  const ariaLabel = `${columns.length} settlement states, ${covered} named by a leg: ${columns
    .map((column) => `${column.label} ${column.word}`)
    .join(", ")}.`;

  if (!columns.length) {
    return (
      <Figure
        caption={CAPTION}
        ariaLabel="No settlement states were read for this family"
        missing="The family read carries no markets, so there is no state space to draw against."
      >
        <FigureEmpty reason="No states read for this family." />
      </Figure>
    );
  }

  const notes = [
    exact
      ? null
      : "This family is not marked mutually exclusive, so a state is an interval several markets pay in: a ticker match is a lower bound on the covering, never the covering itself.",
    offBoard
      ? `${offBoard} leg(s) name a market that is not one of these states, so the basket reaches outside the space drawn here.`
      : null,
    "The block says a leg NAMES this state, never what it pays in it — the payoff is the figure above, and it is drawn only where the solver returned a basket.",
    dense
      ? `${columns.length} states is more than this width can label, so the per-state names are dropped rather than `
        + "drawn over each other. Every state still carries its own name on hover, and the ends of the ladder are marked."
      : null,
  ].filter((note): note is string => note != null);

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={ariaLabel}
      reading={
        covered
          ? `${covered} of ${columns.length} states carry a leg.`
          : `No leg in any of the ${columns.length} states: the solver found no basket worth assembling here.`
      }
      notes={notes}
    >
      <Plot height={BLOCK_TOP + BLOCK_H + (dense ? DENSE_BAND : LABEL_BAND)}>
        {(width) => {
          const axisY = BLOCK_TOP + BLOCK_H;
          const colW = width / columns.length;
          const blockW = dense ? Math.max(1, colW - 1) : Math.max(6, Math.min(colW - 10, 34));
          return (
            <>
              <text x={0} y={KEY_Y} className="coh-svg-note">
                <tspan>● a leg names this state</tspan>
                <tspan dx={14}>◌ none</tspan>
              </text>

              <line x1={0} x2={width} y1={axisY} y2={axisY} className="coh-surface__axis" />

              {columns.map((column, index) => {
                const cx = index * colW + colW / 2;
                // Rotated -90°, so the anchor's glyphs hang below and to the
                // left of it; nudged right to sit optically over the column.
                const labelX = cx + 3.5;
                const labelY = axisY + 8;
                const hover = column.legs.length
                  ? `${column.label}: ${column.legs
                      .map((leg) => `${leg.direction} ${leg.size} at ${leg.price}`)
                      .join("; ")}`
                  : `${column.label}: no leg of this basket names it`;
                return (
                  <g key={column.ticker}>
                    {column.legs.length ? (
                      <rect
                        x={cx - blockW / 2}
                        y={BLOCK_TOP}
                        width={blockW}
                        height={BLOCK_H}
                        className="coh-surface__bar"
                      >
                        <title>{hover}</title>
                      </rect>
                    ) : (
                      <>
                        {/* A stub ON the axis, not a gap: the state exists and
                            carries no leg, which is not the same as absent. */}
                        <rect
                          x={cx - blockW / 2}
                          y={axisY - 3}
                          width={blockW}
                          height={3}
                          className="coh-surface__bar-zero"
                        >
                          <title>{hover}</title>
                        </rect>
                        {dense ? null : (
                          <text x={cx} y={axisY - 8} textAnchor="middle" className="coh-surface__unread">
                            ◌
                          </text>
                        )}
                      </>
                    )}
                    {/* DROPPED WHEN THERE IS NO ROOM, never drawn overlapping.
                        At 188 states a column is 7px and both of these printed
                        through their neighbours; the `<title>` above still
                        names every state, and the reading carries the count. */}
                    {dense ? null : (
                      <>
                        {column.legs.length ? (
                          <text x={cx} y={WORD_Y} textAnchor="middle" className="coh-surface__value">
                            {column.word}
                          </text>
                        ) : null}
                        <text
                          x={labelX}
                          y={labelY}
                          textAnchor="end"
                          transform={`rotate(-90 ${labelX.toFixed(2)} ${labelY.toFixed(2)})`}
                          className="coh-surface__tick"
                        >
                          {truncateMiddle(column.label, LABEL_BAND - 8, DIAGRAM_LABEL_PX)}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}

              {/* The ends of the ladder, when the per-state labels are gone. */}
              {dense ? (
                <>
                  <text x={0} y={axisY + 16} className="coh-surface__tick">
                    {truncateMiddle(columns[0].label, width / 3, DIAGRAM_LABEL_PX)}
                  </text>
                  <text x={width} y={axisY + 16} textAnchor="end" className="coh-surface__tick">
                    {truncateMiddle(columns[columns.length - 1].label, width / 3, DIAGRAM_LABEL_PX)}
                  </text>
                </>
              ) : null}
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
