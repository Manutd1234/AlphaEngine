"use client";

/**
 * The prices the coherence test is about, which this section never drew.
 *
 * Coherence test argues that a family's quotes do or do not admit a probability
 * measure, and at 574px it was the thinnest section on the tab — while the
 * universe payload it already warms carries every leg's two sides, its strike,
 * its open interest and a stated reason on each missing quote. The section made
 * a claim about prices and showed none of them.
 *
 * TWO LADDERS, NOT ONE CURVE. Kalshi publishes resting YES and NO bids; the
 * offer is a reading of the opposite ladder. So a leg has up to two prices and
 * frequently one — measured on the live watchlist, KXHIGHNY-26AUG25 has four of
 * six legs with no bid at all, and every one of KXBTCD-26AUG2517's eighty legs
 * has a bid and NO ask. A figure that drew "the price" would be empty for one
 * of those families and half-empty for the other. Each side is drawn where it
 * exists, the two are joined where both do, and the gap between them IS the
 * spread — which is why an unquoted side is a missing mark and never a mark at
 * zero: the spread is unknowable, not wide.
 *
 * FIXED DOLLAR AXIS, nought to one. Scaling to the data would make a family
 * priced 0.98–1.02 look like one priced 0.02–0.98, and the distance from a
 * dollar is the entire subject. `IdentityStrip` and `DollarBar` made the same
 * call for the same reason.
 *
 * SIZED BY OPEN INTEREST, which appears nowhere else in this repository. A leg
 * quoted at a tick with a thousand contracts outstanding and a leg quoted at
 * the same tick with none are not the same evidence, and the test weights them
 * identically. Zero is drawn at a floor radius rather than omitted: nobody
 * holding a contract is a measurement, not a missing one.
 *
 * IT MUST SURVIVE 188 STRIKES. KXBTCD-26AUG2513 has 188 legs — the family that
 * turned `StateCoverage` into a hatched grey block under a green suite. There
 * are no per-leg labels here, so density costs marks rather than legibility;
 * what degrades is that the strike axis labels its ends and nothing between.
 */

import Figure, { FigureEmpty, Plot } from "./Figure";
import { money, placeStrikes } from "@/lib/coherence/strike-axis";
import type { CoherenceEventView, CoherenceMarketView } from "@/lib/coherence/types";
import { groupDigits } from "@/lib/coherence/universe-metrics";

const HEIGHT = 236;
const MARGIN = { top: 18, right: 12, bottom: 34, left: 44 };
const R_MIN = 1.6;
const R_MAX = 6;

export default function LadderPrices({ event }: { event: CoherenceEventView }) {
  // The placement rule is `strike-axis`'s, shared with `LegSizes` under this
  // figure: two drawings over one x extent must agree about where a leg is.
  const { placed: legs, unplaced, lo, hi } = placeStrikes(event.markets);
  const placed = legs.map((leg) => ({
    market: leg.market,
    strike: leg.strike,
    bid: money(leg.market.yes_bid),
    ask: money(leg.market.yes_ask),
  }));
  const quoted = placed.filter((row) => row.bid !== null || row.ask !== null);

  if (!quoted.length || lo === null || hi === null) {
    return (
      <Figure
        caption={CAPTION}
        ariaLabel="No leg of this family carries a quote"
        missing={
          placed.length
            ? `All ${placed.length} legs are unquoted on both sides, so there is no price to draw — `
              + "not a family priced at zero."
            : `No leg of this family carries a strike, so none can be placed on a price ladder.`
        }
      >
        <FigureEmpty reason="Nothing quoted on either side." />
      </Figure>
    );
  }

  // NULL OPEN INTEREST IS NOT ZERO OPEN INTEREST, and the payload's own type
  // says so: "0.0000" is the exchange having looked and found nothing, null is
  // the venue having stopped sending the field. Coercing the second to the
  // first draws a protocol change as an empty market.
  const sizes = placed.map((row) => money(row.market.open_interest));
  const oiMax = Math.max(...sizes.filter((v): v is number => v !== null), 1);
  const unsized = sizes.filter((v) => v === null).length;

  const noBid = placed.filter((row) => row.bid === null).length;
  const noAsk = placed.filter((row) => row.ask === null).length;
  const both = placed.filter((row) => row.bid !== null && row.ask !== null).length;
  const reasons = [...new Set(placed.filter((r) => r.market.unquoted_reason).map((r) => r.market.unquoted_reason as string))];

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={`${placed.length} legs of ${event.event_ticker} on a nought-to-one dollar axis`}
      reading={
        `${placed.length} legs, ${both} quoted on both sides.`
        + (event.yes_ask_total
          ? ` Buying every outcome costs ${event.yes_ask_total} for a guaranteed $1.`
          : "")
        + " Mark area is open interest, so a tick nobody holds and a tick a thousand contracts sit on"
        + " are drawn as the different evidence they are."
      }
      notes={[
        noAsk || noBid
          ? `${[noAsk ? `${noAsk} legs have no ask` : "", noBid ? `${noBid} have no bid` : ""]
              .filter(Boolean).join(" and ")}. A missing side is drawn as a missing mark, never as one`
            + " at zero — the spread there is unknowable, not wide."
            + (reasons.length ? ` The venue's reason: ${reasons.join("; ")}.` : "")
          : "Every leg is quoted on both sides, so no mark on this figure is missing a partner.",
        event.basket_note ?? "",
        unplaced
          ? `${unplaced} legs carry no strike and are not drawn; they are still in the family the test ran on.`
          : "",
        "Open interest is contracts outstanding, not dollars resting: it says how much has been held,"
        + " never how much can be traded now. A zero draws at the floor radius because nobody holding"
        + " a contract is a measurement, not a missing one.",
        unsized
          ? `${unsized} legs report no open interest at all — the venue stopped sending the field, which`
            + " is a protocol change rather than an empty market — and are drawn ringed at the floor"
            + " radius, so they cannot be read as legs nobody holds."
          : "",
      ].filter(Boolean)}
    >
      <Plot height={HEIGHT}>
        {(width) => {
          const plotW = width - MARGIN.left - MARGIN.right;
          const base = HEIGHT - MARGIN.bottom;
          const span = hi - lo || 1;
          const x = (strike: number) => MARGIN.left + ((strike - lo) / span) * plotW;
          const y = (price: number) => base - price * (base - MARGIN.top);
          const r = (n: number) => R_MIN + Math.sqrt(n / oiMax) * (R_MAX - R_MIN);
          return (
            <>
              {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
                <g key={tick}>
                  <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)}
                        className="coh-ladderprice__grid" />
                  <text x={MARGIN.left - 6} y={y(tick) + 4} textAnchor="end" className="coh-ladderprice__tick">
                    {tick.toFixed(2)}
                  </text>
                </g>
              ))}
              {placed.map((row) => {
                const cx = x(row.strike);
                const held = money(row.market.open_interest);
                const sized = held !== null;
                // An unsized leg draws at the floor radius, ringed rather than
                // filled, so it cannot be read as a leg nobody holds.
                const size = sized ? r(held) : R_MIN;
                return (
                  <g key={row.market.ticker} className="coh-ladderprice__leg">
                    {row.bid !== null && row.ask !== null ? (
                      <line x1={cx} x2={cx} y1={y(row.bid)} y2={y(row.ask)} className="coh-ladderprice__spread" />
                    ) : null}
                    {row.bid !== null ? (
                      <circle cx={cx} cy={y(row.bid)} r={size}
                              className={`coh-ladderprice__bid${sized ? "" : " is-unsized"}`} />
                    ) : null}
                    {row.ask !== null ? (
                      <circle cx={cx} cy={y(row.ask)} r={size}
                              className={`coh-ladderprice__ask${sized ? "" : " is-unsized"}`} />
                    ) : null}
                    <title>{legReading(row)}</title>
                  </g>
                );
              })}
              <text x={MARGIN.left} y={HEIGHT - 8} className="coh-ladderprice__tick">{fmtStrike(lo)}</text>
              <text x={width - MARGIN.right} y={HEIGHT - 8} textAnchor="end" className="coh-ladderprice__tick">
                {fmtStrike(hi)}
              </text>
              <text x={MARGIN.left + plotW / 2} y={HEIGHT - 8} textAnchor="middle" className="coh-svg-note">
                strike, ● bid, ○ ask
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}

const CAPTION = "Both sides of every leg, on one dollar axis, sized by open interest";

const fmtStrike = (value: number): string =>
  groupDigits(String(value));

function legReading(row: {
  market: CoherenceMarketView;
  strike: number | null;
  bid: number | null;
  ask: number | null;
}): string {
  const sides = row.bid !== null && row.ask !== null
    ? `bid ${row.market.yes_bid}, ask ${row.market.yes_ask}, spread ${row.market.spread ?? "—"}`
    : row.bid !== null
      ? `bid ${row.market.yes_bid}, no ask`
      : `ask ${row.market.yes_ask}, no bid`;
  const size = row.market.open_interest === null
    ? "open interest not reported"
    : `${row.market.open_interest} contracts outstanding`;
  const why = row.market.unquoted_reason ? ` — ${row.market.unquoted_reason}` : "";
  return `${row.market.yes_sub_title || row.market.ticker}: ${sides}; ${size}${why}`;
}
