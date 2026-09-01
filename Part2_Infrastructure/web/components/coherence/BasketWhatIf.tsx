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

import Figure, { FigureEmpty, Plot, StateChip } from "./Figure";
import type { CoherenceEventView } from "@/lib/coherence/types";
import { DOLLAR_CC, fromCenticents, sumPrices, toCenticents } from "@/lib/coherence/fixed-point";
import { useBasketScenario } from "./use-basket-scenario";
import IncompleteExclusiveBasketStructure from "./IncompleteExclusiveBasketStructure";

const HEIGHT = 104;
const MARGIN = { top: 26, right: 12, bottom: 30, left: 12 };
/** The axis runs to here, so a basket may be dragged well past a dollar. */
const AXIS_MAX = 1.5;
const STRUCTURE_HEIGHT = 142;
const STRUCTURE_MIN_WIDTH = 800;
const STRUCTURE_BOX_H = 64;
const STRUCTURE_GAP = 32;
const STRUCTURE_DECISION_W = 126;

function FlowEdge({
  id,
  x1,
  x2,
  y,
  label,
}: {
  id: string;
  x1: number;
  x2: number;
  y: number;
  label?: string;
}) {
  return (
    <g className="coh-form__arrow" data-basket-flow-edge={id}>
      <line x1={x1} x2={x2 - 8} y1={y} y2={y} />
      <polygon points={`${x2 - 8},${y - 4} ${x2},${y} ${x2 - 8},${y + 4}`} />
      {label ? (
        <text x={(x1 + x2) / 2} y={y - 8} textAnchor="middle" className="coh-form__note">
          {label}
        </text>
      ) : null}
    </g>
  );
}

/**
 * A non-exclusive family still carries a complete live reading; what it lacks
 * is the one-winner settlement topology that makes "buy every outcome" a $1
 * cover. Keep the quotes visible and draw the refusal as a connected decision,
 * instead of replacing all of that evidence with an empty box.
 */
function NonExclusiveBasketStructure({ event }: { event: CoherenceEventView }) {
  const total = event.markets.length;
  const quotedAsks = event.markets.filter((market) => market.yes_ask != null).length;
  const quotedBids = event.markets.filter((market) => market.yes_bid != null).length;
  const twoSided = event.markets.filter(
    (market) => market.yes_ask != null && market.yes_bid != null,
  ).length;
  const thresholds = event.markets.filter(
    (market) => market.floor_strike != null || market.cap_strike != null,
  ).length;
  const isLadder = total > 0 && thresholds === total;
  const topology = isLadder ? "Threshold ladder" : "Non-exclusive family";
  const topologyDetail = isLadder
    ? `${thresholds} strike contract${thresholds === 1 ? "" : "s"}`
    : "one-winner flag absent";

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={
        `${event.event_ticker} returned ${total} market records: ${quotedAsks} carry a yes offer, `
        + `${quotedBids} carry a yes bid, and ${twoSided} are two-sided. The settlement topology is `
        + `${topology.toLowerCase()}, not a mutually exclusive partition, so no one-dollar cover is invented.`
      }
      readout={<span className="num">{`${quotedAsks}/${total} offers; ${quotedBids}/${total} bids`}</span>}
      reading={
        `${total} live market record${total === 1 ? "" : "s"} reached the browser; the path withholds only `
        + "the invalid cover, not the quote evidence."
      }
      missing={event.basket_note
        ?? "This event is not mutually exclusive, so its prices need not sum to anything and no $1 payoff is invented."}
      notes={[
        "The quote counts are venue observations, including explicit one-sided books; an absent side remains absent rather than becoming zero.",
        isLadder
          ? "A threshold can win wherever another threshold wins. Lattice reads the linked strikes as a survival curve; Basket cannot relabel them as disjoint outcomes."
          : "The exchange did not mark these contracts as a one-winner partition. Without that settlement guarantee, adding their offers is not a cover price.",
      ]}
      reserveInteractionRow={false}
    >
      <Plot
        height={STRUCTURE_HEIGHT}
        minWidth={STRUCTURE_MIN_WIDTH}
        scrollLabel={`Quote-to-cover eligibility path for ${event.event_ticker}`}
      >
        {(width) => {
          const diagramW = Math.min(width - 24, 1120);
          const originX = (width - diagramW) / 2;
          const boxW = (diagramW - 3 * STRUCTURE_GAP - STRUCTURE_DECISION_W) / 3;
          const booksX = originX;
          const topologyX = booksX + boxW + STRUCTURE_GAP;
          const decisionX = topologyX + boxW + STRUCTURE_GAP;
          const decisionCx = decisionX + STRUCTURE_DECISION_W / 2;
          const resultX = decisionX + STRUCTURE_DECISION_W + STRUCTURE_GAP;
          const y = 42;
          const cy = y + STRUCTURE_BOX_H / 2;

          return (
            <>
              <text x={booksX} y={17} className="coh-figure__key">01 — QUOTES</text>
              <text x={topologyX} y={17} className="coh-figure__key">02 — SETTLEMENT</text>
              <text x={decisionCx} y={17} textAnchor="middle" className="coh-figure__key">03 — GATE</text>
              <text x={resultX} y={17} className="coh-figure__key">04 — OUTCOME</text>

              <FlowEdge id="quotes-to-topology" x1={booksX + boxW} x2={topologyX} y={cy} />
              <FlowEdge id="topology-to-gate" x1={topologyX + boxW} x2={decisionX} y={cy} />
              <FlowEdge id="gate-to-outcome" x1={decisionX + STRUCTURE_DECISION_W} x2={resultX} y={cy} label="no" />

              <rect x={booksX} y={y} width={boxW} height={STRUCTURE_BOX_H} rx={6} className="coh-form__box">
                <title>{`${quotedAsks} yes offers, ${quotedBids} yes bids, ${twoSided} two-sided markets out of ${total}.`}</title>
              </rect>
              <text x={booksX + 8} y={y + 20} className="coh-form__title">Venue books</text>
              <text x={booksX + 8} y={y + 40} className="coh-form__note">
                {`${quotedAsks}/${total} offers; ${quotedBids}/${total} bids`}
              </text>
              <text x={booksX + 8} y={y + 55} className="coh-form__note">{`${twoSided} two-sided`}</text>

              <rect x={topologyX} y={y} width={boxW} height={STRUCTURE_BOX_H} rx={6} className="coh-form__box">
                <title>{`${topology}: ${topologyDetail}.`}</title>
              </rect>
              <text x={topologyX + 8} y={y + 20} className="coh-form__title">{topology}</text>
              <text x={topologyX + 8} y={y + 42} className="coh-form__note">{topologyDetail}</text>

              <polygon
                points={`${decisionCx},${y} ${decisionX + STRUCTURE_DECISION_W},${cy} ${decisionCx},${y + STRUCTURE_BOX_H} ${decisionX},${cy}`}
                className="coh-form__box"
              >
                <title>The exchange's mutually-exclusive partition flag is false.</title>
              </polygon>
              <text x={decisionCx} y={cy - 4} textAnchor="middle" className="coh-form__title">partition?</text>
              <text x={decisionCx} y={cy + 14} textAnchor="middle" className="coh-form__note">✕ no</text>

              <rect
                x={resultX}
                y={y}
                width={boxW}
                height={STRUCTURE_BOX_H}
                rx={6}
                className="coh-form__box"
                fill="url(#diff-hatch)"
              >
                <title>The quote evidence remains visible, but no flat one-dollar cover is calculated.</title>
              </rect>
              <text x={resultX + 8} y={y + 20} className="coh-form__title">✕ Cover withheld</text>
              <text x={resultX + 8} y={y + 42} className="coh-form__note">quotes kept; no sum</text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}

export default function BasketWhatIf({ event }: { event: CoherenceEventView }) {
  const scenario = useBasketScenario(event);

  if (!event.mutually_exclusive) {
    return <NonExclusiveBasketStructure event={event} />;
  }
  if (!scenario) {
    return <IncompleteExclusiveBasketStructure event={event} />;
  }

  const { asks: live, moved } = scenario;
  const totalCc = sumPrices(live.map(String));
  const startCc = sumPrices(event.markets.map((market) => market.yes_ask));
  if (totalCc == null || startCc == null) {
    return (
      <Figure
        caption={CAPTION}
        ariaLabel="This basket scenario is not on the venue's price grid"
        missing="The paper vector could not be represented in exact centicents, so no total or verdict is shown."
      >
        <FigureEmpty reason="Paper vector off-grid — basket withheld." />
      </Figure>
    );
  }
  const total = totalCc / DOLLAR_CC;
  const totalLabel = fromCenticents(totalCc) as string;
  const startLabel = fromCenticents(startCc) as string;
  const arb = totalCc < DOLLAR_CC;

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={`The basket costs ${totalLabel} against a guaranteed one dollar`}
      reading={
        arb
          // NOT the phrase "wins in every state", deliberately.
          // `coherence-proof-claims.test.ts` pins that literal to exactly two
          // carriers — the page description and Basket's lede — and names them
          // as different objects on purpose. A third carrier would not be a
          // stronger claim, it would be the same claim said in one more place,
          // which is what the count exists to prevent.
          ? `${live.length} outcomes cost ${totalLabel} for a guaranteed $1 — a gross edge before fees.`
          : `${live.length} outcomes cost ${totalLabel} for $1, so the buy-side cover has no gross edge.`
      }
      notes={[
        moved
          ? `Paper prices; the venue total was ${startLabel}. Nothing is submitted.`
          : `Venue offers total ${startLabel}.`,
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
          value={"$" + totalLabel}
          tone={arb ? "warn" : "good"}
        />
        {moved ? (
          <StateChip mark="◇" word="Moved from the venue's prices" value={"was $" + startLabel} tone="muted" />
        ) : null}
      </div>

      <Plot height={HEIGHT}>
        {(width) => {
          const plotW = width - MARGIN.left - MARGIN.right;
          const x = (value: number) => MARGIN.left + (Math.min(value, AXIS_MAX) / AXIS_MAX) * plotW;
          let run = 0;
          return (
            <>
              {live.map((price, index) => {
                const from = run;
                run += price;
                const to = run;
                return (
                  <rect key={event.markets[index].ticker}
                        x={x(from)} y={MARGIN.top} width={Math.max(0.5, x(to) - x(from))}
                        height={HEIGHT - MARGIN.top - MARGIN.bottom}
                        className={`coh-whatif__leg${index % 2 ? " is-alt" : ""}`}>
                    <title>
                      {`${event.markets[index].yes_sub_title || event.markets[index].ticker}: ${fromCenticents(toCenticents(String(price))) ?? "—"}`}
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
                {"$" + totalLabel}
              </text>
            </>
          );
        }}
      </Plot>

      <div className="coh-whatif__controls">
        {live.map((price, index) => {
          const stepCc = toCenticents(event.markets[index].price_grid);
          const step = stepCc != null && stepCc > 0 ? stepCc / DOLLAR_CC : 0.01;
          return (
          <label key={event.markets[index].ticker}>
            <span className="field">
              {`${event.markets[index].yes_sub_title || event.markets[index].ticker} — ${fromCenticents(toCenticents(String(price))) ?? "—"}`}
            </span>
            <input
              type="range" min={0} max={1} step={step} value={price}
              onChange={(change) => {
                scenario.setAsk(index, Number(change.target.value));
              }}
            />
          </label>
          );
        })}
        {moved ? (
          <button type="button" className="coh-whatif__reset" onClick={scenario.reset}>
            Back to the venue’s prices
          </button>
        ) : null}
      </div>
    </Figure>
  );
}

const CAPTION = "Buy every outcome: what the set costs against the dollar it pays";
