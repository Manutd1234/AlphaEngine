"use client";

/**
 * The same legs the waterfall draws, in words.
 *
 * SPLIT OUT ON 2026-08-26 rather than trimmed. Bringing the chart through
 * `Figure`/`Plot` took the file past the 400-line ceiling, and the house rule
 * is to split at a real seam instead of shaving prose to buy a line. This is
 * the seam that was already there: the figure and this table are two readings
 * of one set of legs, and the table is the one that carries the caveats as
 * words rather than as a shape.
 *
 * It is not a duplicate of the drawing. One light-mode categorical slot sits
 * below 3:1 against the surface, so the palette itself obliges a non-colour
 * reading of the same figures — which is the accessibility contract, not a
 * convenience.
 */

import { usd } from "@/lib/format";
import type { PnlLeg, PnlWaterfall as Waterfall } from "@/lib/pnl-attribution";

import { BASIS_SOURCE, BASIS_WORD } from "./pnl-basis";

export default function PnlLegTable(
  { legs, dayPnl, waterfall, hover }: {
    legs: readonly PnlLeg[];
    dayPnl: number;
    waterfall: Waterfall;
    /** The leg the reader is pointing at in the figure, so both agree. */
    hover: string | null;
  },
) {
  return (
    <>
  {/* One light-mode categorical slot sits below 3:1 against the surface, so
      the palette obliges a non-colour reading of the same figures. The table
      is also where the caveats live in words rather than as a shape. */}
  <div className="table-wrap" tabIndex={0}>
    <table>
      <caption className="sr-only">
        Each leg of the day&apos;s P&amp;L, its basis, and why any is missing.
      </caption>
      <thead>
        <tr>
          <th scope="col">Leg</th>
          <th scope="col">Amount</th>
          <th scope="col">Basis</th>
          <th scope="col">Source</th>
        </tr>
      </thead>
      <tbody>
        {legs.map((leg) => (
          <tr key={leg.key} className={hover === leg.key ? "is-best" : undefined}>
            <th scope="row">{leg.label}</th>
            <td className={`num ${leg.value == null ? "muted" : leg.value >= 0 ? "pos" : "neg"}`}>
              {leg.value == null ? "—" : usd(leg.value, 0)}
            </td>
            <td>
              <span aria-hidden>{leg.value == null ? "○" : "●"}</span> {BASIS_WORD[leg.basis]}
            </td>
            <td className="muted">{BASIS_SOURCE[leg.basis]}</td>
          </tr>
        ))}
        <tr className="is-best">
          <th scope="row">Day P&amp;L</th>
          <td className={`num ${dayPnl >= 0 ? "pos" : "neg"}`}>{usd(dayPnl, 0)}</td>
          <td>
            <span aria-hidden>{waterfall.complete ? "●" : "○"}</span>{" "}
            {waterfall.complete ? "reconciles" : "partial"}
          </td>
          <td className="muted">
            {waterfall.startEquity ? `from ${usd(waterfall.startEquity, 0)}` : "—"}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
    </>
  );
}
