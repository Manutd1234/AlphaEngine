"use client";

/**
 * Make a Dutch book yourself, and watch the theorem stop being a definition.
 *
 * The tab's first direct-manipulation figure. Every other figure on Proofs is
 * read; this one is operated, and it exists because the claim it carries is one
 * a sentence has been making badly. "A family admitting no probability measure
 * hands back a basket that wins in every state" is the page's own head, and a
 * reader who does not already know what that means is not helped by reading it
 * again — but dragging one leg's offer down until the six of them sum past a
 * dollar, and seeing the verdict flip, is the theorem in one gesture.
 *
 * NO SOLVER AND NO ROUTE. On a mutually exclusive family the legs are a
 * partition, so exactly one settles and the set pays exactly $1. The arbitrage
 * test is therefore whether the offers sum below a dollar — plain addition, and
 * the gateway already publishes the sum as `yes_ask_total` with `basket_note`
 * explaining it. `proofs-figures.test.ts` requires a figure to fetch nothing;
 * this one computes nothing the payload did not already contain.
 *
 * FIXED AXIS, NEVER SCALED TO THE DATA. The whole quantity is the distance from
 * one dollar, and a basket at 1.02 against one at 0.98 must not draw alike —
 * the argument `IdentityStrip` and `DollarBar` already make.
 *
 * IT DECLINES MORE OFTEN THAN IT DRAWS, and says why each time. A family that
 * is not mutually exclusive has no partition and its prices need not sum to
 * anything; a family with an unquoted leg cannot be bought as a whole at all,
 * which is a fact about the book and not a missing number. Both are the
 * gateway's own words, carried through rather than paraphrased.
 */

import { useState } from "react";

import Figure, { FigureEmpty, Plot, StateChip } from "./Figure";
import type { CoherenceEventView } from "@/lib/coherence/types";

const HEIGHT = 104;
const MARGIN = { top: 26, right: 12, bottom: 30, left: 12 };
/** The axis runs to here, so a basket may be dragged well past a dollar. */
const AXIS_MAX = 1.5;

/** Cents, not dollars: the exchange's own grid, and no float drift to explain. */
const centsOf = (raw: string | null): number | null => {
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
};

export default function BasketWhatIf({ event }: { event: CoherenceEventView }) {
  const quoted = event.markets.map((market) => centsOf(market.yes_ask));
  const initial = quoted.filter((c): c is number => c !== null);
  const [asks, setAsks] = useState<number[] | null>(null);
  const live = asks ?? initial;

  if (!event.mutually_exclusive) {
    return (
      <Figure
        caption={CAPTION}
        ariaLabel="This family is not a partition, so there is no basket to price"
        missing={event.basket_note
          ?? "This event is not mutually exclusive, so its outcomes are not a partition and their prices need not sum to anything."}
      >
        <FigureEmpty reason="Not a partition — no basket to buy." />
      </Figure>
    );
  }
  if (initial.length !== event.markets.length) {
    const missing = event.markets.length - initial.length;
    return (
      <Figure
        caption={CAPTION}
        ariaLabel="This family cannot be bought as a whole"
        missing={
          `${missing} of ${event.markets.length} legs have no offer, so the basket cannot be bought as a`
          + " whole and its cost is unknowable rather than high."
          + (event.basket_note ? ` ${event.basket_note}` : "")
        }
      >
        <FigureEmpty reason="A leg is unquoted — the basket has no price." />
      </Figure>
    );
  }

  const total = live.reduce((sum, c) => sum + c, 0) / 100;
  const start = initial.reduce((sum, c) => sum + c, 0) / 100;
  const arb = total < 1;
  const moved = asks !== null && live.some((c, i) => c !== initial[i]);

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={`The basket costs ${total.toFixed(2)} against a guaranteed one dollar`}
      reading={
        arb
          // NOT the phrase "wins in every state", deliberately.
          // `coherence-proof-claims.test.ts` pins that literal to exactly two
          // carriers — the page description and Basket's lede — and names them
          // as different objects on purpose. A third carrier would not be a
          // stronger claim, it would be the same claim said in one more place,
          // which is what the count exists to prevent.
          ? `Buying all ${live.length} outcomes costs ${total.toFixed(2)} for a guaranteed $1 — riskless`
            + " before fees. Basket draws that portfolio and prices it through all three fee components."
          : `Buying all ${live.length} outcomes costs ${total.toFixed(2)} for a guaranteed $1, so there is`
            + " nothing to buy. Selling the set whole would need a bid on every leg, which is the half"
            + " the venue does not publish."
      }
      notes={[
        moved
          ? `These are your prices, not the venue's — the read had them summing to ${start.toFixed(2)}.`
            + " Nothing here is sent anywhere; the sliders move a copy."
          : `The venue's own offers, summing to ${start.toFixed(2)}.`,
        "On a partition exactly one outcome settles, so the set pays exactly $1 whatever happens. That"
        + " is why the sum of the offers IS the test and no solver is needed for it.",
        "Offers only. A basket bought at the offer can be sold only into bids, and a leg with no bid"
        + " cannot be exited at any price — which is why a sum below a dollar is a Dutch book before"
        + " fees rather than a realised one.",
        event.basket_note ?? "",
      ].filter(Boolean)}
    >
      <div className="coh-status__chips">
        <StateChip
          mark={arb ? "▲" : "●"}
          word={arb ? "Costs less than it is certain to pay" : "Costs at least what it pays"}
          value={`$${total.toFixed(2)}`}
          tone={arb ? "warn" : "good"}
        />
        {moved ? (
          <StateChip mark="◇" word="Moved from the venue's prices" value={`was $${start.toFixed(2)}`} tone="muted" />
        ) : null}
      </div>

      <Plot height={HEIGHT}>
        {(width) => {
          const plotW = width - MARGIN.left - MARGIN.right;
          const x = (value: number) => MARGIN.left + (Math.min(value, AXIS_MAX) / AXIS_MAX) * plotW;
          let run = 0;
          return (
            <>
              {live.map((cents, index) => {
                const from = run / 100;
                run += cents;
                const to = run / 100;
                return (
                  <rect key={event.markets[index].ticker}
                        x={x(from)} y={MARGIN.top} width={Math.max(0.5, x(to) - x(from))}
                        height={HEIGHT - MARGIN.top - MARGIN.bottom}
                        className={`coh-whatif__leg${index % 2 ? " is-alt" : ""}`}>
                    <title>
                      {`${event.markets[index].yes_sub_title || event.markets[index].ticker}: ${(cents / 100).toFixed(2)}`}
                    </title>
                  </rect>
                );
              })}
              {/* The dollar the basket is certain to pay. Fixed, and the only
                  line on this figure that is not a price. */}
              <line x1={x(1)} x2={x(1)} y1={MARGIN.top - 8} y2={HEIGHT - MARGIN.bottom + 4}
                    className="coh-whatif__dollar" />
              <text x={x(1)} y={MARGIN.top - 12} textAnchor="middle" className="coh-svg-note">
                $1 guaranteed
              </text>
              <text x={x(Math.min(total, AXIS_MAX))} y={HEIGHT - MARGIN.bottom + 18} textAnchor="middle"
                    className="coh-whatif__total">
                {`$${total.toFixed(2)}`}
              </text>
            </>
          );
        }}
      </Plot>

      <div className="coh-whatif__controls">
        {live.map((cents, index) => (
          <label key={event.markets[index].ticker}>
            <span className="field">
              {`${event.markets[index].yes_sub_title || event.markets[index].ticker} — ${(cents / 100).toFixed(2)}`}
            </span>
            <input
              type="range" min={1} max={99} step={1} value={cents}
              onChange={(change) => {
                const next = [...live];
                next[index] = Number(change.target.value);
                setAsks(next);
              }}
            />
          </label>
        ))}
        {moved ? (
          <button type="button" className="coh-whatif__reset" onClick={() => setAsks(null)}>
            Back to the venue’s prices
          </button>
        ) : null}
      </div>
    </Figure>
  );
}

const CAPTION = "Buy every outcome: what the set costs against the dollar it pays";
