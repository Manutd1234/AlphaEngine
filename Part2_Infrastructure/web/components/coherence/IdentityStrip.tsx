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
import Figure, { FigureEmpty } from "./Figure";

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
        ariaLabel="Lesson zero identity: not measurable on this book"
        missing={
          unquotedReason ??
          "One side of this book is unquoted, so it has no spread and the identity has no terms. That is an absent quote, not a zero one."
        }
      >
        <FigureEmpty reason="The identity needs both sides quoted." />
      </Figure>
    );
  }

  const scale = (cc: number) => (Math.min(cc, CEILING_CC) / CEILING_CC) * 100;
  const equal = sum === onePlus;

  return (
    <Figure
      caption={caption}
      ariaLabel={`Two bars of equal length: yes ask plus no ask is ${identitySum}, one dollar plus the spread is ${identityOnePlusSpread}`}
      reading={
        equal
          ? `${fromCenticents(yes)} + ${fromCenticents(no)} = ${identitySum}, and $1 + ${fromCenticents(spreadCc)} = ${identityOnePlusSpread}. The sum of the two asks is always one dollar plus the spread, so it is never below a dollar — the "buy both sides for under $1" branch is unreachable, not merely rare.`
          : `These should be equal and are not (${identitySum} against ${identityOnePlusSpread}). That means the two ladders were read at different instants — a torn snapshot, not an opportunity.`
      }
    >
      <svg viewBox={`0 0 100 ${HEIGHT}`} preserveAspectRatio="none" className="coh-identity">
        <line x1={scale(DOLLAR_CC)} x2={scale(DOLLAR_CC)} y1="4" y2={HEIGHT - 20} className="coh-identity__dollar" />
        <text x={scale(DOLLAR_CC)} y={HEIGHT - 8} textAnchor="middle" className="coh-identity__dollar-label">
          $1
        </text>

        <rect x="0" y="14" width={scale(yes)} height="18" className="coh-identity__part is-yes" />
        <rect x={scale(yes)} y="14" width={scale(no)} height="18" className="coh-identity__part is-no" />
        <text x="1" y="11" className="coh-identity__label">
          yes ask + no ask
        </text>

        <rect x="0" y="46" width={scale(DOLLAR_CC)} height="18" className="coh-identity__part is-dollar" />
        <rect x={scale(DOLLAR_CC)} y="46" width={scale(spreadCc)} height="18" className="coh-identity__part is-spread" />
        <text x="1" y="43" className="coh-identity__label">
          $1 + spread
        </text>

        {/* The tick both bars end on. Drawn once, so the equality is a place on
            the page rather than two numbers a reader has to compare. */}
        <line x1={scale(sum)} x2={scale(sum)} y1="10" y2="68" className="coh-identity__meet" />
      </svg>
    </Figure>
  );
}
