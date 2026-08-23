"use client";

/**
 * The basket, priced against the dollar it pays. This tab's signature diagram.
 *
 * For a mutually exclusive event, exactly one outcome resolves YES, so owning
 * every outcome owns a guaranteed dollar. That makes one picture answer the
 * whole question: lay the legs end to end and see which side of $1 they land
 * on. Under the line, buying the basket buys a dollar for less than a dollar.
 * Over it, selling the basket sells a dollar for more.
 *
 * Three decisions worth stating, because each one is a way this chart could
 * lie:
 *
 * **The dollar line is fixed, not scaled to the data.** A bar chart that
 * normalises to its own maximum makes 1.02 and 0.98 look identical. Here the
 * axis is $0 to a fixed ceiling above $1, so the same overshoot is the same
 * distance every time and two events can be compared by eye.
 *
 * **A missing leg voids the total.** The bar is not drawn from the legs that
 * happen to be quoted — that would understate the cost by exactly the legs it
 * skipped, which is the direction that invents arbitrage. When a leg is
 * unquoted the figure says so instead of drawing.
 *
 * **Segments keep their given order.** A reader comparing two events is
 * comparing positions, so re-sorting by size would make that impossible.
 */

import { DOLLAR_CC, fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import Figure, { FigureEmpty } from "./Figure";

/** How far above $1 the axis runs. Enough headroom that a wide basket still
 *  fits, small enough that a two-cent overshoot is visible. */
const CEILING_CC = 13_000;
const HEIGHT = 92;
const BAR_TOP = 30;
const BAR_HEIGHT = 34;

export interface DollarLeg {
  label: string;
  /** The venue's price string. A null leg voids the whole basket. */
  price: string | null;
}

export interface DollarBarProps {
  legs: DollarLeg[];
  /** "buy" totals asks and asks whether the basket is cheap; "sell" totals bids. */
  direction: "buy" | "sell";
  caption: string;
  /** Named when a leg is unquoted, so the figure can say which one. */
  missingLeg?: string | null;
}

export default function DollarBar({ legs, direction, caption, missingLeg }: DollarBarProps) {
  const values = legs.map((leg) => toCenticents(leg.price));
  const absentAt = values.findIndex((value) => value == null);
  const total = absentAt === -1 ? values.reduce((sum, value) => (sum as number) + (value as number), 0) : null;

  const ariaLabel =
    total == null
      ? `${caption}: not measurable, a leg is unquoted`
      : `${caption}: ${legs.length} legs totalling ${fromCenticents(total)} against a one dollar payoff`;

  if (total == null) {
    const named = missingLeg ?? legs[absentAt]?.label ?? "one leg";
    return (
      <Figure
        caption={caption}
        ariaLabel={ariaLabel}
        missing={`${named} is unquoted on this side, so the basket has no total. The legs that are quoted are not drawn: summing only those understates the cost by exactly the ones missing, which is the direction that invents an arbitrage.`}
      >
        <FigureEmpty reason="No total — one or more legs are unquoted." />
      </Figure>
    );
  }

  const scale = (cc: number) => (Math.min(cc, CEILING_CC) / CEILING_CC) * 100;
  const dollarX = scale(DOLLAR_CC);
  const overshoot = total - DOLLAR_CC;
  const beatsTheDollar = direction === "buy" ? overshoot < 0 : overshoot > 0;

  let cursor = 0;
  const segments = legs.map((leg, index) => {
    const value = values[index] as number;
    const start = cursor;
    cursor += value;
    return { label: leg.label, x: scale(start), width: scale(cursor) - scale(start), price: leg.price as string };
  });

  const reading = beatsTheDollar
    ? direction === "buy"
      ? `Every outcome bought together costs ${fromCenticents(total)} and pays exactly $1. Before fees, that is a Dutch book.`
      : `Every outcome sold together pays ${fromCenticents(total)} against a $1 liability. Before fees, that is a Dutch book.`
    : direction === "buy"
      ? `Buying the whole basket costs ${fromCenticents(total)} for a $1 payoff — ${fromCenticents(Math.abs(overshoot))} more than the dollar it returns.`
      : `Selling the whole basket pays ${fromCenticents(total)} against a $1 liability — ${fromCenticents(Math.abs(overshoot))} short of it.`;

  return (
    <Figure caption={caption} ariaLabel={ariaLabel} reading={reading}>
      <svg viewBox={`0 0 100 ${HEIGHT}`} preserveAspectRatio="none" className="coh-dollarbar">
        <rect x="0" y={BAR_TOP} width="100" height={BAR_HEIGHT} className="coh-dollarbar__track" />
        {segments.map((segment, index) => (
          <g key={segment.label}>
            <rect
              x={segment.x}
              y={BAR_TOP}
              width={Math.max(0, segment.width)}
              height={BAR_HEIGHT}
              className={`coh-dollarbar__leg is-leg-${(index % 3) + 1}`}
            />
            <title>{`${segment.label}: ${segment.price}`}</title>
          </g>
        ))}
        {/* The dollar line. Drawn last so no leg can cover it: it is the only
            reference the reader is asked to judge against. */}
        <line x1={dollarX} x2={dollarX} y1={BAR_TOP - 12} y2={BAR_TOP + BAR_HEIGHT + 12} className="coh-dollarbar__dollar" />
        <text x={dollarX} y={BAR_TOP - 16} textAnchor="middle" className="coh-dollarbar__dollar-label">
          $1 payoff
        </text>
        <text
          x={Math.min(scale(total), 96)}
          y={BAR_TOP + BAR_HEIGHT + 22}
          textAnchor={scale(total) > 80 ? "end" : "middle"}
          className={`coh-dollarbar__total ${beatsTheDollar ? "is-dutch" : ""}`}
        >
          {fromCenticents(total)}
        </text>
      </svg>
    </Figure>
  );
}
