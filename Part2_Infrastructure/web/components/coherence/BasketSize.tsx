"use client";

/**
 * How much is at stake on the watchlist, and where it sits.
 *
 * The composition rings above say WHAT the watchlist is and WHY a family does
 * or does not carry a basket price. Neither says how much. Until 2026-08-24 no
 * answer was possible: the universe payload carried prices and nothing else,
 * so a reader could see that a Fed basket costs $1.06 for a dollar of payoff
 * and had no way to learn whether anyone held a single contract of it.
 *
 * Kalshi publishes four size figures per market and `kalshi_parse.py` was
 * dropping all of them. They now reach the browser, and this is the card that
 * reads them: three figures, then a grid of where each family's open interest
 * is offered.
 *
 * ── THREE WAYS THIS CARD REFUSES TO LIE ────────────────────────────────────
 *
 * **A measured zero is not an absence.** Every watched market currently reports
 * `liquidity: "0.0000"` — the exchange looked and found no resting orders. That
 * is a fact and it prints as a zero. A field the venue stopped sending prints
 * as a dash with the reason beside it. Collapsing the two is `?? 0` wearing
 * different clothes, and it is the defect this codebase is most alert to.
 *
 * **A total is withheld when a family carries no figure.** Not reduced — 
 * withheld. A sum over the families that answered understates the watchlist by
 * exactly the ones it skipped, and a reader has no way to see the gap. The
 * count of what did answer rides in the note, so the dash is explained rather
 * than merely present.
 *
 * **A share against a zero denominator is undefined, not zero.** The crypto
 * ladder holds sixty outcomes and has never traded one, so its bands have no
 * shares to show. Printing 0% in each would say the size is somewhere else on
 * the watchlist; the row says the family has never traded instead.
 *
 * ── WHY THESE THREE FIGURES AND NOT A DERIVED ONE ──────────────────────────
 *
 * Each is read under its own name and never computed from another, because on
 * this venue they genuinely disagree: the Fed family reports zero resting
 * liquidity on legs carrying 164 contracts of open interest and 1,687 of
 * traded volume. A card that derived depth from open interest would print a
 * number the exchange never sent, and it would look entirely reasonable.
 *
 * ── NO NEW CSS, AND THAT IS DELIBERATE ─────────────────────────────────────
 *
 * The figures are `.coh-status__facts`, the same `<dl>` the composition card
 * above and the status pane already use, so a reader meets one grammar for "a
 * labelled number" on this tab. The grid is `.coh-table`. Cell shading is
 * `color-mix` over two house tokens — the idiom `.coh-pending__spread` already
 * uses — so it flips with `data-theme` rather than needing a dark ramp of its
 * own, and every shaded cell still prints its own percentage, because
 * forced-colors strips the fill entirely and a colour may never be the only
 * thing carrying a meaning.
 */

import type { CoherenceUniverse } from "@/lib/coherence/types";
import {
  activeContracts,
  bandEdges,
  basketValue,
  contractsLabel,
  dollarsLabel,
  exposureBands,
  liquidityDepth,
} from "@/lib/coherence/universe-metrics";
import { pct } from "@/lib/format";

/** Cents, exactly. Every band edge is a whole number of 1/8 dollars, so this
 *  never produces a repeating decimal — 0, 12.5, 25, 37.5 and so on. */
const centsOf = (cc: number) => cc / 100;

export default function BasketSize({ universe }: { universe: CoherenceUniverse }) {
  const value = basketValue(universe);
  const contracts = activeContracts(universe);
  const depth = liquidityDepth(universe);
  const events = universe.events;

  /**
   * Why a basket total covers only some of the watchlist.
   *
   * The two refusals are counted apart because they are different facts: a
   * family the exchange does not call mutually exclusive has no basket to
   * price, while one with an unquoted leg has a basket nobody can price.
   */
  const valueNote = value.totalCc == null
    ? "no watched family is priced as a basket, so there is no dollar to total"
    : [
        `${value.counted} of ${events.length} priced`,
        value.notExclusive ? `${value.notExclusive} not mutually exclusive` : "",
        value.unpriceable ? `${value.unpriceable} with an unquoted leg` : "",
      ].filter(Boolean).join(", ");

  /** A strict total's own explanation: what answered, or what did not. */
  const strictNote = (total: { totalCc: number | null; counted: number; absent: number }, noun: string) =>
    total.totalCc == null
      ? `${total.absent} of ${events.length} ${total.absent === 1 ? "family carries" : "families carry"} no figure, `
        + `so the ${noun} cannot be totalled`
      : `across ${total.counted} ${total.counted === 1 ? "family" : "families"}, as the exchange publishes it`;

  return (
    <>
      <dl className="coh-status__facts coh-facts--boxed">
        <div>
          <dt>Total basket value</dt>
          <dd className="num">{dollarsLabel(value.totalCc)}</dd>
          <dd className="coh-event__meta">{valueNote}</dd>
        </div>
        <div>
          <dt>Active contracts</dt>
          <dd className="num">{contractsLabel(contracts.totalCc)}</dd>
          <dd className="coh-event__meta">{strictNote(contracts, "open interest")}</dd>
        </div>
        <div>
          <dt>Liquidity depth</dt>
          <dd className="num">{dollarsLabel(depth.totalCc)}</dd>
          <dd className="coh-event__meta">{strictNote(depth, "resting order book")}</dd>
        </div>
      </dl>

      <div className="table-wrap" tabIndex={0}>
        <table className="coh-table">
          <caption className="coh-table__caption">
            Where each family&rsquo;s open interest is offered. A cell is that band&rsquo;s share of its own
            family, so rows compare within themselves and never against each other.
          </caption>
          <thead>
            <tr>
              <th scope="col">Family</th>
              {/* The edges, not a family's bands: the header exists before any
                  family is read, and reading it off events[0] made the columns
                  a property of whichever family happened to be first. */}
              {bandEdges().map((band) => (
                <th key={band.lowCc} scope="col" className="num">
                  {centsOf(band.lowCc)}c
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const bands = exposureBands(event);
              const undefinedShares = bands.every((band) => band.share == null);
              return (
                <tr key={event.event_ticker}>
                  <th scope="row">{event.event_ticker}</th>
                  {bands.map((band) => (
                    <td
                      key={band.lowCc}
                      className="num"
                      /* Both halves are theme variables, so the shade follows
                         data-theme with no dark ramp of its own. The printed
                         figure is what carries the meaning; the fill only
                         speeds up finding it, and forced-colors drops it. */
                      style={band.share == null ? undefined : {
                        background: `color-mix(in srgb, var(--series-1) ${pct(band.share, 0)}, var(--surface-1))`,
                      }}
                      title={`${event.event_ticker}, outcomes offered from ${centsOf(band.lowCc)}c to `
                        + `${centsOf(band.highCc)}c: ${contractsLabel(band.contractsCc)} contracts`}
                    >
                      {pct(band.share, 0)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {events.some((event) => exposureBands(event).every((band) => band.share == null)) ? (
        <p className="coh-event__note">
          <span aria-hidden="true">○</span> A row of dashes is a family that has never traded: with no open
          interest anywhere in it, a band&rsquo;s share of it is undefined rather than zero.
        </p>
      ) : null}
    </>
  );
}
