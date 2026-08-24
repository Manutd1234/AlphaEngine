"use client";

/**
 * Lesson 0, drawn: `yes_ask + no_ask` and `1 + spread` are the same length.
 *
 * The algebra is three lines and most readers will take it on trust, which is
 * exactly the problem — the strategy it retires appears in two of the
 * most-starred prediction-market bots on GitHub, written by people who had the
 * same three lines available. So the identity is shown on the market in front
 * of the reader rather than asserted: two bars built from different quantities,
 * landing on the same tick, on whatever book is open.
 *
 * The bars are stacked from their parts so the equality is visibly structural
 * rather than arithmetical. The top bar is the two asks laid end to end; the
 * bottom is a dollar plus the spread. They are the same because an ask is one
 * minus the opposing bid, and the drawing is where that stops being a claim.
 */

import { DOLLAR_CC, fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import Figure, { FigureEmpty, Plot } from "./Figure";

const HEIGHT = 96;
const CEILING_CC = 13_000;

export interface IdentityStripProps {
  yesAsk: string | null;
  noAsk: string | null;
  spread: string | null;
  identitySum: string | null;
  identityOnePlusSpread: string | null;
  unquotedReason?: string | null;
}

export default function IdentityStrip({
  yesAsk,
  noAsk,
  spread,
  identitySum,
  identityOnePlusSpread,
  unquotedReason,
}: IdentityStripProps) {
  const yes = toCenticents(yesAsk);
  const no = toCenticents(noAsk);
  const spreadCc = toCenticents(spread);
  const sum = toCenticents(identitySum);
  const onePlus = toCenticents(identityOnePlusSpread);

  const caption = "Lesson 0 — why the bundle arbitrage cannot fire";

  if (yes == null || no == null || spreadCc == null || sum == null || onePlus == null) {
    return (
      <Figure
        caption={caption}
        ariaLabel="Lesson zero: not measurable on this book"
        missing={
          unquotedReason ??
          "One side of this book is unquoted, so the identity has no terms — an absent quote, not a zero one."
        }
      >
        <FigureEmpty reason="Both sides must be quoted." />
      </Figure>
    );
  }

  const equal = sum === onePlus;

  return (
    <Figure
      caption={caption}
      // The reading beside the bars carries all four numbers; the aria names the shape.
      ariaLabel="Two bars of equal length"
      reading={
        equal
          ? `${fromCenticents(yes)} + ${fromCenticents(no)} = ${identitySum}, and $1 + ${fromCenticents(spreadCc)} = ${identityOnePlusSpread}: the sum of the two asks is never below a dollar — the "buy both sides for under $1" branch is unreachable, not merely rare.`
          : `These should be equal and are not (${identitySum} against ${identityOnePlusSpread}): the two ladders were read at different instants — a torn snapshot, not an opportunity.`
      }
      /* Both sides can be quoted and the payload still carry a reason — one
         side quoted at a single level, or a torn snapshot. Without this the
         reason was dropped from a figure that looks complete, which is the
         failure `missing` exists to prevent. */
      missing={unquotedReason}
    >
      <Plot height={HEIGHT}>
        {(width) => {
          const scale = (cc: number) => (Math.min(cc, CEILING_CC) / CEILING_CC) * width;
          return (
            <>
              <line x1={scale(DOLLAR_CC)} x2={scale(DOLLAR_CC)} y1="4" y2={HEIGHT - 20} className="coh-identity__dollar" />
              <text x={scale(DOLLAR_CC)} y={HEIGHT - 8} textAnchor="middle" className="coh-identity__dollar-label">
                $1
              </text>

              <rect x="0" y="14" width={scale(yes)} height="18" className="coh-identity__part is-yes">
                <title>{`yes ask ${fromCenticents(yes)}`}</title>
              </rect>
              <rect x={scale(yes)} y="14" width={scale(no)} height="18" className="coh-identity__part is-no">
                <title>{`no ask ${fromCenticents(no)}`}</title>
              </rect>
              <text x="2" y="11" className="coh-identity__label">
                yes ask + no ask
              </text>

              <rect x="0" y="46" width={scale(DOLLAR_CC)} height="18" className="coh-identity__part is-dollar">
                <title>one dollar</title>
              </rect>
              <rect x={scale(DOLLAR_CC)} y="46" width={scale(spreadCc)} height="18" className="coh-identity__part is-spread">
                <title>{`spread ${fromCenticents(spreadCc)}`}</title>
              </rect>
              <text x="2" y="43" className="coh-identity__label">
                $1 + spread
              </text>

              {/* The tick both bars end on, drawn once — the equality is a place
                  on the page rather than two numbers to compare. */}
              <line x1={scale(sum)} x2={scale(sum)} y1="10" y2="68" className="coh-identity__meet" />
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
