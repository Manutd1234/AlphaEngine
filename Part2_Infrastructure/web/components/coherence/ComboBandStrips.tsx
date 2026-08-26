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
import { DIAGRAM_LABEL_PX, gutterFor, truncateMiddle } from "@/lib/coherence/label-metrics";
import type { CoherenceCombo } from "@/lib/coherence/types-lab";
import Figure, { Plot } from "./Figure";

/** 40, from 34. Two adjacent price markers are 22px tall in a row that was 34,
 *  so they came within 12px of touching and read as one mark spanning two
 *  parlays. */
const ROW_H = 40;
const TOP = 4;
const AXIS_GAP = 8;

export default function ComboBandStrips({ combos }: { combos: CoherenceCombo[] }) {
  const rows = combos.map((combo) => ({
    ticker: combo.ticker,
    lo: toCenticents(combo.lower_bound),
    hi: toCenticents(combo.upper_bound),
    price: toCenticents(combo.price),
    // Πpᵢ — where the parlay would sit if the legs were independent. Drawn as a
    // hollow tick rather than said in a chip: "priced above independence" was
    // four words for a comparison of two positions, and a reader had to hold
    // both numbers in their head to make it. It is NOT a fair value, which is
    // why it is hollow where the price is solid — the venue never promises
    // independence, and `FrechetBand` carries the sentence that says so.
    independence: toCenticents(combo.independence),
    width: combo.band_width,
    inside: combo.inside_band,
    // THE PARLAY'S OWN BOOK. `combo_bid`, `combo_ask` and `combo_mid` are on
    // the wire and appeared NOWHERE in this repository — the strip drew
    // `price`, which is whichever of them the basis names, as a single rule.
    // Where both sides are quoted the two are a SPREAD, and a spread is a
    // different object from a price: it says what the parlay could be entered
    // AND left at. Live on this deployment every bid is null, so what this
    // draws today is one mark and a note saying so — which is itself the
    // reading, because "nobody bids for a parlay" is the claim `FrechetBand`
    // makes in prose and nothing on the tab has ever shown.
    bid: toCenticents(combo.combo_bid),
    ask: toCenticents(combo.combo_ask),
  }));
  const axisY = TOP + rows.length * ROW_H + AXIS_GAP;
  const height = axisY + 16;
  const unpriced = rows.filter((row) => row.lo == null || row.hi == null).length;
  const twoSided = rows.filter((row) => row.bid != null && row.ask != null).length;

  return (
    <Figure
      caption="Every parlay against the Fréchet–Hoeffding band its own legs impose, on one dollar axis"
      ariaLabel={rows
        .map((row) => row.lo == null || row.hi == null
          ? `${row.ticker}: no band`
          : `${row.ticker}: ${fromCenticents(row.lo)} to ${fromCenticents(row.hi)}, price ${row.price == null ? "unquoted" : fromCenticents(row.price)}`)
        .join(". ")}
      missing={[
        unpriced
          ? `${unpriced} of ${rows.length} parlays have no band: a leg is unquoted on the side the parlay needs.`
          : "",
        twoSided
          ? `${twoSided} of ${rows.length} parlays are quoted on both sides; those rows draw a spread rather`
            + " than a single price."
          : `No parlay in this read is quoted on both sides, so every price mark here is one side of a book`
            + " — there is no spread to draw, which is not the same as a spread of nothing.",
      ].filter(Boolean).join(" ") || null}
    >
      <Plot height={height}>
        {(width) => {
          // MEASURED, not multiplied out by hand. The gutter this replaces was a
          // fixed 205px derived from a tabular-mono advance for text that is set
          // in Inter, so every full-length ticker ran past it. See
          // `lib/coherence/label-metrics.ts` for the measurement and the method.
          const labelW = gutterFor(rows.map((row) => row.ticker), width, DIAGRAM_LABEL_PX, {
            min: 96, maxFraction: 0.34, max: 260,
          });
          const trackW = Math.max(60, width - labelW);
          const x = (cc: number) => labelW + (Math.min(cc, DOLLAR_CC) / DOLLAR_CC) * trackW;
          return (
            <>
              {/* TRACKS AND MARKS FIRST, LABELS AFTER. `.coh-combo__track` is an
                  opaque fill, so with the labels emitted first SVG paint order
                  turned an overrun into a silent CLIP — the tail of a long
                  ticker was painted over by the bar beside it, which is
                  indistinguishable from a shorter ticker. Drawn last, an overrun
                  that the gutter arithmetic ever gets wrong again is visible as
                  an overlap instead of hidden as a truncation. */}
              {rows.map((row, index) => {
                const y = TOP + index * ROW_H;
                return (
                  <g key={`${row.ticker}-track`}>
                    <rect x={labelW} y={y + 9} width={trackW} height={14} className="coh-combo__track" />
                    {row.lo != null && row.hi != null ? (
                      <rect x={x(row.lo)} y={y + 9} width={Math.max(1, x(row.hi) - x(row.lo))} height={14}
                            className="coh-combo__band">
                        <title>{`band ${fromCenticents(row.lo)} to ${fromCenticents(row.hi)}${row.width ? `, ${row.width} wide` : ""}`}</title>
                      </rect>
                    ) : (
                      <text x={labelW + 4} y={y + 20} className="coh-combo__label">◌ no band</text>
                    )}
                    {row.independence != null ? (
                      <circle cx={x(row.independence)} cy={y + 16} r={4} className="coh-combo__independence">
                        <title>{`independence Πpᵢ would put this at ${fromCenticents(row.independence)} — a guess about the legs, never a fair value`}</title>
                      </circle>
                    ) : null}
                    {/* Where both sides are quoted, the gap between them is
                        the spread and is drawn as one; where only one is, the
                        single rule stands as it always has. Never a bar from a
                        quoted side to a missing one — that would draw a spread
                        reaching to a price nobody has offered. */}
                    {row.bid != null && row.ask != null ? (
                      <rect x={x(row.bid)} y={y + 11} width={Math.max(1, x(row.ask) - x(row.bid))} height={10}
                            className="coh-combo__spread">
                        <title>{`book ${fromCenticents(row.bid)} bid, ${fromCenticents(row.ask)} ask`}</title>
                      </rect>
                    ) : null}
                    {row.price != null ? (
                      <line x1={x(row.price)} x2={x(row.price)} y1={y + 5} y2={y + 27}
                            className="coh-combo__price">
                        <title>{`price ${fromCenticents(row.price)}${row.inside == null ? "" : row.inside ? ", inside the band" : ", outside the band"}${row.bid == null ? ", one side of the book only — no bid" : ""}`}</title>
                      </line>
                    ) : null}
                  </g>
                );
              })}
              {rows.map((row, index) => (
                <text key={`${row.ticker}-label`} x={0} y={TOP + index * ROW_H + 20} className="coh-combo__label">
                  {/* Both ends kept. A combo ticker's tail is what tells it from
                      every other parlay in the same series, so a trailing
                      ellipsis leaves six rows reading identically. */}
                  {truncateMiddle(row.ticker, labelW - 10, DIAGRAM_LABEL_PX)}
                  <title>{row.ticker}</title>
                </text>
              ))}
              <line x1={labelW} x2={width} y1={axisY} y2={axisY} className="coh-ladder__axis" />
              <text x={labelW} y={axisY + 13} className="coh-combo__axis">$0</text>
              <text x={width} y={axisY + 13} textAnchor="end" className="coh-combo__axis">$1</text>
              {/* The key names both marks in words, so the figure carries no
                  meaning in shape alone any more than in colour alone. */}
              <text x={(labelW + width) / 2} y={axisY + 13} textAnchor="middle" className="coh-combo__key">
                | quoted price ○ independence Πpᵢ
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
