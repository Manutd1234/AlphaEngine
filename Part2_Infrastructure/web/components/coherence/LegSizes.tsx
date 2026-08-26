"use client";

/**
 * The size quartet, drawn — three ribbons on the prices' own strike axis.
 *
 * `CoherenceMarketView` carries four size fields per leg, and its own type
 * says why they are worth drawing: they "disagree with each other,
 * legitimately — a market reporting zero liquidity while carrying open
 * interest and traded volume". Nothing on either tab drew any of them except
 * as `LadderPrices`' mark area. So a family could be quoted across eighty
 * strikes with every contract outstanding sitting on three of them, and no
 * figure said so.
 *
 * THREE RIBBONS, EACH NORMALISED TO ITS OWN MAXIMUM. Contracts outstanding,
 * contracts traded and dollars resting are three units, so one scale across
 * them would invent a comparison the payload explicitly denies. What IS
 * comparable is the shape along the strike axis, which is what a reader came
 * for: where the interest sits, whether anything traded there, and whether
 * there is anything to trade against now.
 *
 * UNDER THE PRICES, NEVER BESIDE THEM. Two figures sharing an x extent must
 * share a width; side by side, a strike would sit at two different pixels.
 * `lib/coherence/strike-axis.ts` is the placement rule both read.
 *
 * THREE ABSENCES, KEPT APART. A reported `"0.0000"` is the exchange having
 * looked and found nothing, and draws at the floor — a measurement. A null is
 * the venue having stopped sending the field, which is a protocol change and
 * not an empty market; it draws as a ringed cell so it cannot be read as a
 * zero. And a leg with no strike is not on this axis at all, and is counted.
 *
 * The family's own totals are the payload's, never a sum over the legs that
 * answered: `open_interest_total` is withheld entirely when one leg carries no
 * figure, because a sum that skips a leg understates the family by exactly
 * that leg, and a share read against it comes out too large.
 */

import Figure, { FigureEmpty, Plot } from "./Figure";
import { money, placeStrikes } from "@/lib/coherence/strike-axis";
import type { CoherenceEventView, CoherenceMarketView } from "@/lib/coherence/types";

const HEIGHT = 178;
const MARGIN = { top: 14, right: 12, bottom: 30, left: 84 };
/** One ribbon's band, and the tallest a cell may draw inside it. */
const BAND = 44;
const BAR_MAX = BAND - 16;
/** The height a MEASURED zero draws at, so it is a mark rather than a gap. */
const FLOOR = 2;

const RIBBONS: ReadonlyArray<{
  name: string;
  of: (market: CoherenceMarketView) => string | null;
  unit: string;
}> = [
  { name: "open interest", of: (market) => market.open_interest, unit: "contracts outstanding" },
  { name: "traded", of: (market) => market.volume, unit: "contracts traded" },
  { name: "resting", of: (market) => market.liquidity, unit: "dollars resting" },
];

const CAPTION = "The same legs, sized three ways: what is held, what has traded, what is resting";

export default function LegSizes({ event }: { event: CoherenceEventView }) {
  const { placed, unplaced, lo, hi } = placeStrikes(event.markets);

  if (!placed.length || lo === null || hi === null) {
    return (
      <Figure
        caption={CAPTION}
        ariaLabel="No leg of this family carries a strike"
        missing={`No leg of this family carries a strike, so none can be placed on the price ladder's axis.`}
      >
        <FigureEmpty reason="Nothing to place on a strike axis." />
      </Figure>
    );
  }

  // Each ribbon's own maximum, and how many legs it could not read. A ribbon
  // whose every leg is null has no maximum and draws as a rule of rings.
  const scales = RIBBONS.map((ribbon) => {
    const values = placed.map((leg) => money(ribbon.of(leg.market)));
    const known = values.filter((value): value is number => value !== null);
    return {
      ribbon,
      values,
      peak: known.length ? Math.max(...known) : null,
      unreported: values.length - known.length,
    };
  });

  const blind = scales.filter((scale) => scale.peak === null);
  const totals = [
    event.open_interest_total === null
      ? "the family's open interest is withheld: one leg carries no figure, and a sum over the legs that answered would understate it"
      : `${event.open_interest_total} contracts outstanding across the family`,
    event.liquidity_total === null
      ? "resting dollars are withheld for the same reason"
      : `${event.liquidity_total} resting`,
  ].join(", and ");

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={
        `${placed.length} legs of ${event.event_ticker} on the same strike axis as the prices above, `
        + `in three ribbons: ${RIBBONS.map((ribbon) => ribbon.name).join(", ")}`
      }
      reading={`${placed.length} legs on the strike axis above — ${totals}.`}
      missing={
        blind.length
          ? `${blind.map((scale) => scale.ribbon.name).join(" and ")} ${blind.length === 1 ? "is" : "are"} not`
            + " reported for any leg of this family, so that ribbon is a rule of rings rather than a row of sizes."
          : null
      }
      notes={[
        "Each ribbon is normalised to its own maximum. These are three units — contracts outstanding,"
        + " contracts traded, dollars resting — and the venue publishes them disagreeing with each other:"
        + " a leg can rest no dollars while carrying open interest and traded volume. One scale across"
        + " them would invent a comparison the exchange does not make.",
        "What is comparable is the SHAPE along the strike axis, which is the same axis the prices above"
        + " are drawn on: where the interest sits, whether anything traded there, and whether there is"
        + " anything to trade against now.",
        scales.some((scale) => scale.unreported && scale.peak !== null)
          ? scales
              .filter((scale) => scale.unreported && scale.peak !== null)
              .map((scale) => `${scale.unreported} legs report no ${scale.ribbon.name}`)
              .join("; ")
            + ". Those cells are drawn ringed at the floor: the venue stopped sending the field, which is a"
            + " protocol change rather than an empty market, and a reported 0.0000 — the exchange having"
            + " looked and found nothing — draws filled at the floor beside them."
          : "Every leg reports every size, so no cell on this figure is a ring.",
        unplaced
          ? `${unplaced} legs carry no strike and are not on this axis; they are still in the family the test ran on.`
          : "",
      ].filter(Boolean)}
    >
      <Plot height={HEIGHT}>
        {(width) => {
          const plotW = width - MARGIN.left - MARGIN.right;
          const span = hi - lo || 1;
          const x = (strike: number) => MARGIN.left + ((strike - lo) / span) * plotW;
          const cell = Math.max(1.5, Math.min(14, plotW / placed.length - 1));
          return (
            <>
              {scales.map((scale, band) => {
                const base = MARGIN.top + band * BAND + BAND - 12;
                return (
                  <g key={scale.ribbon.name}>
                    <text x={MARGIN.left - 8} y={base + 3} textAnchor="end" className="coh-legsize__name">
                      {scale.ribbon.name}
                    </text>
                    <line x1={MARGIN.left} x2={width - MARGIN.right} y1={base} y2={base}
                          className="coh-legsize__base" />
                    {placed.map((leg, index) => {
                      const value = scale.values[index];
                      // A ring for a field the venue stopped sending; a filled
                      // cell at the floor for a zero it measured.
                      const high = value === null || scale.peak === null || scale.peak === 0
                        ? FLOOR
                        : FLOOR + (value / scale.peak) * (BAR_MAX - FLOOR);
                      return (
                        <rect
                          key={leg.market.ticker}
                          x={x(leg.strike) - cell / 2}
                          y={base - high}
                          width={cell}
                          height={high}
                          className={`coh-legsize__cell${value === null ? " is-null" : ""}`}
                        />
                      );
                    })}
                  </g>
                );
              })}
              {/* ONE MARK PER LEG, not per cell: a reader walks legs, and the
                  three figures for a leg are one answer. The group spans the
                  ribbons, so its box is the column the reader is pointing at. */}
              {placed.map((leg) => (
                <g key={`mark-${leg.market.ticker}`} className="coh-legsize__leg">
                  <rect
                    x={x(leg.strike) - cell / 2}
                    y={MARGIN.top}
                    width={cell}
                    height={RIBBONS.length * BAND - 12}
                    className="coh-legsize__column"
                  />
                  <title>{legReading(leg.market)}</title>
                </g>
              ))}
              <text x={MARGIN.left + plotW / 2} y={HEIGHT - 8} textAnchor="middle" className="coh-svg-note">
                strike, the same axis as the prices above — ▪ measured, ▫ not reported
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}

/** Every size this leg carries, each under its own name and none derived from another. */
function legReading(market: CoherenceMarketView): string {
  const parts = RIBBONS.map((ribbon) => {
    const raw = ribbon.of(market);
    return raw === null
      ? `${ribbon.name} not reported — the venue stopped sending the field, a protocol change rather than an empty market`
      : `${ribbon.name} ${raw} ${ribbon.unit}`;
  });
  return `${market.yes_sub_title || market.ticker}: ${parts.join("; ")}`;
}
