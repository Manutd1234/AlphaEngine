"use client";

/**
 * The cover path for a real partition whose offer vector is incomplete.
 *
 * This is not the same refusal as a threshold ladder: settlement topology is
 * valid here, but an absent offer makes the whole cover unbuyable. Keeping this
 * in its own component keeps BasketWhatIf under the repository's file ceiling
 * and gives the missing-live-data branch a complete connected drawing.
 */

import type { CoherenceEventView } from "@/lib/coherence/types";
import Figure, { Plot } from "./Figure";

const CAPTION = "Buy every outcome: what the set costs against the dollar it pays";
const HEIGHT = 142;
const MIN_WIDTH = 800;
const BOX_H = 64;
const GAP = 32;
const DECISION_W = 126;

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

/** A partition with an absent offer is structurally valid but not buyable. */
export default function IncompleteExclusiveBasketStructure({ event }: { event: CoherenceEventView }) {
  const total = event.markets.length;
  const quoted = event.markets.filter((market) => market.yes_ask != null).length;
  const missing = total - quoted;

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={
        `${event.event_ticker} is a mutually exclusive family with ${total} outcomes. ${quoted} carry a yes offer `
        + `and ${missing} do not, so the complete cover cannot be bought or priced.`
      }
      readout={<span className="num">{`${quoted}/${total} offers; ${missing} missing`}</span>}
      reading={`${quoted} quoted leg${quoted === 1 ? "" : "s"} remain visible; the incomplete vector stops at the quote gate.`}
      missing={
        `${missing} of ${total} legs have no offer, so the basket cannot be bought as a whole and its cost is `
        + `unknowable rather than high.${event.basket_note ? ` ${event.basket_note}` : ""}`
      }
      notes={[
        "The family still passes the settlement-topology gate: exactly one outcome pays. It fails only because a complete executable offer vector was not observed.",
        "An absent offer is not zero and is not filled from a bid, midpoint, last trade, or neighbouring outcome.",
      ]}
      reserveInteractionRow={false}
    >
      <Plot height={HEIGHT} minWidth={MIN_WIDTH} scrollLabel={`Family-to-quote completeness path for ${event.event_ticker}`}>
        {(width) => {
          const diagramW = Math.min(width - 24, 960);
          const originX = (width - diagramW) / 2;
          const boxW = (diagramW - 2 * GAP - DECISION_W) / 2;
          const familyX = originX;
          const decisionX = familyX + boxW + GAP;
          const decisionCx = decisionX + DECISION_W / 2;
          const resultX = decisionX + DECISION_W + GAP;
          const y = 42;
          const cy = y + BOX_H / 2;

          return (
            <g data-basket-incomplete-path={event.event_ticker}>
              <text x={familyX} y={17} className="coh-figure__key">01 — FAMILY</text>
              <text x={decisionCx} y={17} textAnchor="middle" className="coh-figure__key">02 — QUOTE GATE</text>
              <text x={resultX} y={17} className="coh-figure__key">03 — OUTCOME</text>

              <FlowEdge id="family-to-quote-gate" x1={familyX + boxW} x2={decisionX} y={cy} />
              <FlowEdge id="quote-gate-to-outcome" x1={decisionX + DECISION_W} x2={resultX} y={cy} label="no" />

              <rect x={familyX} y={y} width={boxW} height={BOX_H} rx={6} className="coh-form__box">
                <title>{`${event.event_ticker}: ${total} mutually exclusive outcomes.`}</title>
              </rect>
              <text x={familyX + 8} y={y + 20} className="coh-form__title">{event.event_ticker}</text>
              <text x={familyX + 8} y={y + 42} className="coh-form__note">{`${total} exclusive outcomes`}</text>

              <polygon
                points={`${decisionCx},${y} ${decisionX + DECISION_W},${cy} ${decisionCx},${y + BOX_H} ${decisionX},${cy}`}
                className="coh-form__box"
              >
                <title>{`${quoted} of ${total} outcomes carry a yes offer; ${missing} are missing.`}</title>
              </polygon>
              <text x={decisionCx} y={cy - 5} textAnchor="middle" className="coh-form__title">all offers?</text>
              <text x={decisionCx} y={cy + 14} textAnchor="middle" className="coh-form__note">{`✕ ${missing} missing`}</text>

              <rect
                x={resultX}
                y={y}
                width={boxW}
                height={BOX_H}
                rx={6}
                className="coh-form__box"
                fill="url(#diff-hatch)"
              >
                <title>No total is calculated from a partial set of offers.</title>
              </rect>
              <text x={resultX + 8} y={y + 20} className="coh-form__title">✕ Cover withheld</text>
              <text x={resultX + 8} y={y + 42} className="coh-form__note">partial sum not shown</text>
            </g>
          );
        }}
      </Plot>
    </Figure>
  );
}
