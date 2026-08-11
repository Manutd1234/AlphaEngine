"use client";

/**
 * Is the consolidated book crossed?
 *
 * The routing card answers "which venue fills this order best". This answers a
 * question the same two books already contain and nothing else on the page
 * asks: is one venue's bid above another's ask right now.
 *
 * It renders in the uncrossed case too — deliberately. A strip that appears
 * only on a hit trains the eye to read its absence as "nothing there", when the
 * far more common cause is a venue having dropped out. Saying "no cross, both
 * venues live" and saying nothing at all are different claims.
 *
 * The edge is always labelled gross, and the fee note is not collapsible. A
 * two-basis-point cross is a loss after two taker legs, and a number presented
 * as an opportunity is much harder to un-see than one presented with its cost.
 */

import { fmt, usd } from "@/lib/format";
import type { Dislocation } from "@/lib/venues";

/** Below this, the round trip costs more than the edge on any real fee tier. */
const FEE_FLOOR_BPS = 10;

export default function DislocationStrip({
  dislocation,
  venuesOnline,
}: {
  dislocation: Dislocation | null;
  venuesOnline: string[];
}) {
  if (!dislocation) {
    return (
      <div className="dislocation-strip muted">
        <span className="disloc-tag">Cross-venue</span>
        <span>
          Needs two live books to compare;{" "}
          {venuesOnline.length === 0 ? "none" : venuesOnline.join(" and ")} answered.
        </span>
      </div>
    );
  }

  if (!dislocation.crossed) {
    return (
      <div className="dislocation-strip">
        <span className="disloc-tag">Cross-venue</span>
        <span>
          <strong>No dislocation.</strong> {dislocation.note}
        </span>
      </div>
    );
  }

  // Crossed, but is it crossed by enough to survive the round trip?
  const marginal = dislocation.edgeBps < FEE_FLOOR_BPS;

  return (
    <div className={`dislocation-strip ${marginal ? "marginal" : "hit"}`}>
      <span className="disloc-tag">{marginal ? "Crossed — thin" : "Crossed"}</span>
      <span className="disloc-legs">
        Buy <strong>{dislocation.buyVenue}</strong>{" "}
        <span className="num">{fmt(dislocation.buyPrice, 2)}</span> → sell{" "}
        <strong>{dislocation.sellVenue}</strong>{" "}
        <span className="num">{fmt(dislocation.sellPrice, 2)}</span>
      </span>
      <span className="disloc-edge num">
        {fmt(dislocation.edgeBps, 1)} bps · {usd(dislocation.grossEdgeUsd, 2)} gross on{" "}
        {fmt(dislocation.executableSize, 4)} units
      </span>
      <span className="disloc-note">
        {marginal
          ? `Under ${FEE_FLOOR_BPS} bps — two taker legs cost more than this. Reported, not tradeable.`
          : "Gross of fees and transfer. Size is the smaller resting leg, since both have to fill."}
      </span>
    </div>
  );
}
