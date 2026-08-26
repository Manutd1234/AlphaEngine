"use client";

/**
 * A parlay against the band its own legs impose.
 *
 * A combo pays $1 only when every leg lands the way the ticker lists, and
 * Kalshi states those legs in the market metadata, so for once the conjunction
 * is given rather than inferred. What the legs give is still not a price. Two
 * probabilities do not determine the probability of both; all they give is
 * Fréchet's band,
 *
 *     max(0, Σpᵢ − (n−1))  ≤  P(all legs)  ≤  min pᵢ
 *
 * and the width of that band is the whole subject of this figure. On the read
 * this component was built against, six parlays carried bands 0.3100 to 0.6650
 * wide — a third to two thirds of a dollar of room in which the parlay can move
 * with no leg price moving at all.
 *
 * Three things the drawing therefore refuses to say:
 *
 * **Inside the band is not "fairly priced".** Every point between the bounds is
 * consistent with some dependence structure between the legs, and nothing here
 * can choose between them. The figure marks a position and calls it a position.
 * Only a price OUTSIDE the band is a mispricing, and that one arrives with a
 * portfolio that proves it.
 *
 * **Independence is a reference point, not a fair value.** Πpᵢ is drawn as a
 * hollow ring, deliberately quieter than the price marker, because parlay legs
 * are routinely dependent — four legs of one match, four strikes on one coin —
 * and independence is a guess about them rather than a measurement of them.
 *
 * **The price and the bounds are not read from the same side of the book.** The
 * bounds are built from each leg's mid; the parlay's own price is almost always
 * its offer, because across a thousand listed parlays not one carries a bid. So
 * the basis is printed on the marker itself rather than tucked into a footnote:
 * a price above Πpᵢ may be nothing but the maker's margin.
 */

import { DOLLAR_CC, fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceCombo } from "@/lib/coherence/types-lab";
import Figure, { FigureEmpty, Plot } from "./Figure";
import { probLabel, toUnit } from "@/lib/coherence/decimals";

const HEIGHT = 126;
const PRICE_LABEL_Y = 14;
const PRICE_STEM_TOP = 20;
const EDGE_TOP = 38;
const TRACK_TOP = 44;
const TRACK_H = 26;
const TRACK_BOTTOM = TRACK_TOP + TRACK_H;
const EDGE_BOTTOM = 78;
const IND_LABEL_Y = 88;
const BRACKET_Y = 96;
const BRACKET_LABEL_Y = 110;
const AXIS_Y = 122;

/** The fields this figure reads, structurally, so a fixture can be drawn
 *  without constructing a whole combo. */
export type BandReading = Pick<
  CoherenceCombo,
  | "legs"
  | "price"
  | "price_basis"
  | "lower_bound"
  | "upper_bound"
  | "independence"
  | "band_width"
  | "inside_band"
  | "dependence"
  | "violated_rows"
>;


/**
 * What the `dependence` field measured, phrased as the comparison it is.
 *
 * Deliberately not "positive dependence": the gateway compares one number to
 * another and the words say which comparison it made. Calling the result a
 * dependence would assert a property of the legs that nobody quoted.
 */
export const DEPENDENCE_WORD: Record<string, string> = {
  positive: "Priced above independence",
  negative: "Priced below independence",
  independent: "Priced exactly at independence",
  unavailable: "No reading, the parlay is unquoted",
};

/** The caveat that must travel with every dependence reading on this pane. */
export function basisCaveat(basis: string): string {
  if (basis === "ask") {
    return "Read from the offer — nobody bids for a parlay — against bounds from leg mids, so a price above Πpᵢ is not evidence of positive dependence: it may be nothing but the maker's margin.";
  }
  if (basis === "mid") {
    return "Read from a mid — quoted on both sides, rare here. Πpᵢ is still a guess about the legs, not a measurement.";
  }
  // The band-still-real half of the old wording moved wholly into the
  // price-null reading, which ALWAYS co-renders with this branch — two
  // sentences of the same fact, one screen apart, was the duplication the
  // third review ordered out.
  return "Neither side of this book is quoted, so there is no price to compare with Πpᵢ and no dependence reading.";
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

export default function FrechetBand({ reading }: { reading: BandReading }) {
  // Only a violated row proves a trade. `inside_band` compares a price read
  // from the parlay's OFFER against bounds built from each leg's MID, so a
  // price outside the band is a mispricing against a mixed-basis bound and not
  // on its own a Dutch book — capturing the upper bound needs the parlay's BID
  // above a leg's ASK, and no parlay on this exchange carries a bid.
  const violatedRows = reading.violated_rows ?? 0;
  const lower = toCenticents(reading.lower_bound);
  const upper = toCenticents(reading.upper_bound);
  const price = toCenticents(reading.price);
  const bandWidth = toCenticents(reading.band_width);
  const independence = toUnit(reading.independence);
  const legCount = reading.legs.length;
  const caption = `The band the legs impose, and where the parlay is quoted inside it`;

  if (lower == null || upper == null) {
    return (
      <Figure
        caption={caption}
        ariaLabel={`No Fréchet band for this ${legCount}-leg parlay`}
        missing="Σpᵢ and min pᵢ have no value without that leg; a band from the quoted legs alone would be narrowed by exactly the missing ones — the direction that invents a mispricing."
      >
        {/* The footnote above carries the full why; repeating it in the empty
            frame was the same sentence twice on one card. */}
        <FigureEmpty reason="No band — a leg is unquoted." />
      </Figure>
    );
  }

  const loText = fromCenticents(lower) as string;
  const hiText = fromCenticents(upper) as string;
  const widthText = bandWidth == null ? "—" : (fromCenticents(bandWidth) as string);
  // A width the payload did not carry is said in words, never as "— wide".
  const widthPhrase = bandWidth == null ? "of a width the payload did not carry" : `${widthText} wide`;
  const indText = probLabel(reading.independence);
  const priceText = price == null ? "—" : (fromCenticents(price) as string);
  const inside = reading.inside_band;
  const mark = inside == null ? "◌" : inside ? "●" : "▲";
  const word = inside == null ? "no price to place" : inside ? "inside the band" : "outside the band";
  const basis = reading.price_basis;
  // How far the price actually lands from Πpᵢ. On four of the five quoted
  // parlays in the read this was built against it is under three pixels at a
  // 720px column, which is the finding rather than a rendering problem: an
  // offer a tick above the independence product is what a maker's margin looks
  // like, and calling it positive dependence would be reading the spread.
  const independenceCc = independence == null ? null : Math.round(independence * DOLLAR_CC);
  const gapCc = price == null || independenceCc == null ? null : Math.abs(price - independenceCc);
  const coincides = gapCc != null && gapCc <= 100;

  const readingText =
    price == null
      // That neither side is quoted is the footnote's sentence (basisCaveat
      // "unavailable"), co-rendered under this reading.
      ? `The ${legCount} legs bound the parlay to ${loText} — ${hiText}, ${widthPhrase}: the band is real and nothing can be traded against it.`
      : inside
        // "Consistent with some dependence" is the lede's sentence, one screen
        // up on the same view — the reading keeps only what is per-parlay.
        ? `${priceText} sits inside a band ${widthPhrase} — neither fairly priced nor mispriced: the parlay could move ${widthText} with no leg price moving at all.${coincides ? ` It lands ${fromCenticents(gapCc as number)} from the independence ring — an offer a tick above Πpᵢ, not positive dependence.` : ""}`
        : violatedRows > 0
          ? `${priceText} is outside the band (${loText} — ${hiText}), and ${violatedRows === 1 ? "a portfolio below costs" : `${violatedRows} portfolios below cost`} less than ${violatedRows === 1 ? "it is" : "they are"} certain to pay: a Dutch book before fees, with the legs that prove it.`
          // Which side each figure is read from is the footnote's whole
          // subject (`basisCaveat`, co-rendered below), so the reading states
          // the verdict and the one fact the footnote does not carry.
          : `${priceText} is outside the band (${loText} — ${hiText}), but no portfolio below is violated: a mispricing against a mixed-basis bound, not a trade — capturing the upper bound needs the parlay BID above a leg's ASK.`;

  const ariaLabel =
    `A $0-to-$1 track: band ${loText} to ${hiText}, ${widthPhrase}; independence at ${indText}; ` +
    (price == null
      ? "the parlay itself is unquoted, so no price is marked."
      : `quoted at ${priceText} on the ${basis}, ${word}.`);

  return (
    <Figure caption={caption} ariaLabel={ariaLabel} reading={readingText} missing={basisCaveat(basis)}>
      <Plot height={HEIGHT}>
        {(width) => {
          const scale = (cc: number) => (clamp(cc, 0, DOLLAR_CC) / DOLLAR_CC) * width;
          const loX = scale(lower);
          const hiX = scale(upper);
          const indX = independence == null ? null : scale(Math.round(independence * DOLLAR_CC));
          const priceX = price == null ? null : scale(price);
          // Labels are centred on their marker and clamped so the whole string
          // stays on the canvas. `HALF_GLYPH` is half the advance width of the
          // tabular figures these labels are set in — 13px for the price line
          // and 12px for the bracket and independence labels since the
          // 2026-08-24 diagram-ladder lift (14r), so 13 x 0.56 / 2 = 3.64 —
          // over-estimating it costs a few pixels of drift and
          // under-estimating it clips a price, so it is rounded up and the
          // louder rung is the one budgeted for.
          const HALF_GLYPH = 3.7;
          const place = (x: number, text: string) => {
            const half = Math.min(text.length * HALF_GLYPH, width / 2);
            return clamp(x, half, Math.max(half, width - half));
          };
          const indLabel = `○ independence Πpᵢ ${indText}`;
          const priceLabelText = `${mark} ${priceText} ${basis}, ${word}`;
          const bracketText =
            hiX - loX <= 0
              ? `band ${widthPhrase} — the legs pin this parlay exactly`
              : `band ${widthPhrase}, ${loText} to ${hiText}`;
          return (
            <>
              <rect x="0" y={TRACK_TOP} width={width} height={TRACK_H} className="coh-combo__track" />
              <rect
                x={loX}
                y={TRACK_TOP}
                width={Math.max(0, hiX - loX)}
                height={TRACK_H}
                className="coh-combo__band"
              >
                <title>{`band ${loText} to ${hiText}`}</title>
              </rect>

              {/* The bracket under the band carries the headline number: how far
                  the parlay can move with no leg moving. */}
              <line x1={loX} x2={hiX} y1={BRACKET_Y} y2={BRACKET_Y} className="coh-combo__bracket" />
              <line x1={loX} x2={loX} y1={BRACKET_Y - 4} y2={BRACKET_Y + 4} className="coh-combo__bracket" />
              <line x1={hiX} x2={hiX} y1={BRACKET_Y - 4} y2={BRACKET_Y + 4} className="coh-combo__bracket" />
              <text
                x={place((loX + hiX) / 2, bracketText)}
                y={BRACKET_LABEL_Y}
                textAnchor="middle"
                className="coh-combo__label"
              >
                {bracketText}
              </text>

              {indX == null ? null : (
                <>
                  <line
                    x1={indX}
                    x2={indX}
                    y1={TRACK_TOP}
                    y2={TRACK_BOTTOM}
                    className="coh-combo__ind"
                  />
                  <circle
                    cx={indX}
                    cy={TRACK_TOP + TRACK_H / 2}
                    r="3.6"
                    className="coh-combo__ind-mark"
                  >
                    <title>{`independence ${indText}`}</title>
                  </circle>
                  <text
                    x={place(indX, indLabel)}
                    y={IND_LABEL_Y}
                    textAnchor="middle"
                    className="coh-combo__label"
                  >
                    {indLabel}
                  </text>
                </>
              )}

              {priceX == null ? (
                <text x={width / 2} y={PRICE_LABEL_Y} textAnchor="middle" className="coh-combo__state">
                  ◌ unquoted on both sides — no price to mark
                </text>
              ) : (
                <>
                  <line
                    x1={priceX}
                    x2={priceX}
                    y1={PRICE_STEM_TOP}
                    y2={TRACK_BOTTOM}
                    className="coh-combo__price"
                  />
                  <polygon
                    points={`${priceX - 5},${TRACK_TOP - 9} ${priceX + 5},${TRACK_TOP - 9} ${priceX},${TRACK_TOP}`}
                    className="coh-combo__price-mark"
                  >
                    <title>{`${priceText} on the ${basis}`}</title>
                  </polygon>
                  <text
                    x={place(priceX, priceLabelText)}
                    y={PRICE_LABEL_Y}
                    textAnchor="middle"
                    className={`coh-combo__state ${inside === false ? "is-outside" : ""}`}
                  >
                    {priceLabelText}
                  </text>
                </>
              )}

              {/* The bounds are what the reader is asked to judge against, so
                  they are drawn last and nothing may occlude them. */}
              <line x1={loX} x2={loX} y1={EDGE_TOP} y2={EDGE_BOTTOM} className="coh-combo__edge" />
              <line x1={hiX} x2={hiX} y1={EDGE_TOP} y2={EDGE_BOTTOM} className="coh-combo__edge" />

              <text x="0" y={AXIS_Y} textAnchor="start" className="coh-combo__axis">
                $0
              </text>
              <text x={width} y={AXIS_Y} textAnchor="end" className="coh-combo__axis">
                $1
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
