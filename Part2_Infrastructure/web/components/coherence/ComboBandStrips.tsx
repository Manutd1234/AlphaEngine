"use client";

/**
 * Every parlay's band on one dollar axis, one strip per parlay.
 *
 * Added on the third 2026-08-24 review: the Bands view opened on chips and
 * sentences, and its subject — where each price sits in the room its legs
 * leave — is a picture. One row per parlay: the band the legs impose, drawn
 * on the same $0-to-$1 track `FrechetBand` uses, with the quoted price as a
 * marker. The full single-parlay figure, with independence and the basis
 * caveat, stays on the Parlays view; this strip only ranks, and the rows
 * beneath it prove.
 *
 * A parlay with no band keeps its row and gets words instead of a strip —
 * a missing bound is a fact about the legs' quotes, not a reason to hide the
 * parlay — and an unquoted price is simply no marker, never a marker at zero.
 */

import { DOLLAR_CC, fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceCombo } from "@/lib/coherence/types-lab";
import Figure, { Plot } from "./Figure";

const ROW_H = 34;
const TOP = 4;
const AXIS_GAP = 8;
/** Combo tickers run long; 26 glyphs at the 13px rung is 26 x 13 x 0.577 =
 *  195px, and the gutter keeps the same 10px of clearance it kept at 12px,
 *  where the same 26 glyphs were ≈180px inside 190. */
const LABEL_W = 205;

export default function ComboBandStrips({ combos }: { combos: CoherenceCombo[] }) {
  const rows = combos.map((combo) => ({
    ticker: combo.ticker,
    lo: toCenticents(combo.lower_bound),
    hi: toCenticents(combo.upper_bound),
    price: toCenticents(combo.price),
    width: combo.band_width,
    inside: combo.inside_band,
  }));
  const axisY = TOP + rows.length * ROW_H + AXIS_GAP;
  const height = axisY + 16;
  const unpriced = rows.filter((row) => row.lo == null || row.hi == null).length;

  return (
    <Figure
      caption="Every parlay on one dollar axis"
      ariaLabel={rows
        .map((row) => row.lo == null || row.hi == null
          ? `${row.ticker}: no band`
          : `${row.ticker}: ${fromCenticents(row.lo)} to ${fromCenticents(row.hi)}, price ${row.price == null ? "unquoted" : fromCenticents(row.price)}`)
        .join(". ")}
      missing={unpriced
        ? `${unpriced} of ${rows.length} parlays have no band: a leg is unquoted on the side the parlay needs.`
        : null}
    >
      <Plot height={height}>
        {(width) => {
          const trackW = Math.max(60, width - LABEL_W);
          const x = (cc: number) => LABEL_W + (Math.min(cc, DOLLAR_CC) / DOLLAR_CC) * trackW;
          return (
            <>
              {rows.map((row, index) => {
                const y = TOP + index * ROW_H;
                const label = row.ticker.length > 26 ? `${row.ticker.slice(0, 25)}…` : row.ticker;
                return (
                  <g key={row.ticker}>
                    <text x={0} y={y + 15} className="coh-combo__label">
                      {label}
                      <title>{row.ticker}</title>
                    </text>
                    <rect x={LABEL_W} y={y + 6} width={trackW} height={14} className="coh-combo__track" />
                    {row.lo != null && row.hi != null ? (
                      <rect x={x(row.lo)} y={y + 6} width={Math.max(1, x(row.hi) - x(row.lo))} height={14}
                            className="coh-combo__band">
                        <title>{`band ${fromCenticents(row.lo)} to ${fromCenticents(row.hi)}${row.width ? `, ${row.width} wide` : ""}`}</title>
                      </rect>
                    ) : (
                      <text x={LABEL_W + 4} y={y + 17} className="coh-combo__label">◌ no band</text>
                    )}
                    {row.price != null ? (
                      <line x1={x(row.price)} x2={x(row.price)} y1={y + 2} y2={y + 24}
                            className="coh-combo__price">
                        <title>{`price ${fromCenticents(row.price)}${row.inside == null ? "" : row.inside ? ", inside the band" : ", outside the band"}`}</title>
                      </line>
                    ) : null}
                  </g>
                );
              })}
              <line x1={LABEL_W} x2={width} y1={axisY} y2={axisY} className="coh-ladder__axis" />
              <text x={LABEL_W} y={axisY + 13} className="coh-combo__axis">$0</text>
              <text x={width} y={axisY + 13} textAnchor="end" className="coh-combo__axis">$1</text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
