"use client";

import { useId, useState } from "react";

import type { CoherenceCertificate, CoherenceEventView } from "@/lib/coherence/types";
import { decimalLabel } from "@/lib/coherence/decimals";
import { DOLLAR_CC, fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";

import Figure from "./Figure";
import { useBasketScenario } from "./use-basket-scenario";
import styles from "./BasketScenarioTerminal.module.css";

const W = 760;
const H = 252;
const PAD = { left: 44, right: 18, top: 20, bottom: 32 } as const;

function cumulative(values: readonly number[]): number[] {
  let total = 0;
  return values.map((value) => (total += value));
}

function centicentVector(values: ReadonlyArray<string | null | undefined>): number[] | null {
  const parsed = values.map(toCenticents);
  return parsed.every((value): value is number => value != null) ? parsed : null;
}

function path(values: readonly number[], maxY: number): string {
  const spanX = W - PAD.left - PAD.right;
  const spanY = H - PAD.top - PAD.bottom;
  return values.map((value, index) => {
    const x = PAD.left + (values.length < 2 ? spanX / 2 : (index / (values.length - 1)) * spanX);
    const y = PAD.top + (1 - value / maxY) * spanY;
    return `${index ? "L" : "M"}${x},${y}`;
  }).join(" ");
}

function decimals(step: number): number {
  const text = String(step);
  return text.includes(".") ? Math.min(4, text.length - text.indexOf(".") - 1) : 2;
}

export default function BasketScenarioTerminal({
  event,
  certificate,
}: {
  event: CoherenceEventView;
  certificate: CoherenceCertificate;
}) {
  const scenario = useBasketScenario(event);
  const [selected, setSelected] = useState(0);
  const outcomeId = useId();
  const paperAskId = useId();
  const count = event.markets.length;
  const liveCc = scenario ? centicentVector(event.markets.map((market) => market.yes_ask)) : null;
  const paperCc = scenario ? centicentVector(scenario.asks.map(String)) : null;

  if (!event.mutually_exclusive || !count) {
    const reason = !event.mutually_exclusive
      ? "The exchange did not mark this family mutually exclusive, so one outcome per state cannot be assumed."
      : "The exchange returned no outcomes, so there is no quote vector to simulate.";
    return (
      <Figure
        caption="Basket quote simulator — cumulative cost by outcome"
        ariaLabel={`Basket quote simulator withheld for ${event.event_ticker}: ${reason}`}
        reading="A paper basket is shown only when the event defines an explicit, non-empty outcome set."
        missing={reason}
        readout={<span>scenario withheld</span>}
      >
        <div className={styles.unavailable} role="status">
          <strong>Scenario withheld</strong>
          <span>{reason}</span>
        </div>
      </Figure>
    );
  }

  if (!scenario || !liveCc || !paperCc) {
    return (
      <Figure
        caption="Basket quote simulator — cumulative cost by outcome"
        ariaLabel="Basket quote simulator unavailable because at least one live offer is missing"
        reading="A gross basket cost needs one reported YES offer for every outcome."
        missing="At least one offer is absent. No missing quote is coerced to a zero-dollar leg."
        readout={<span>quotes incomplete</span>}
      >
        <div className={styles.unavailable} role="status">
          <strong>Scenario withheld</strong>
          <span>Wait for a complete offer vector, then adjust the paper basket.</span>
        </div>
      </Figure>
    );
  }

  const active = Math.min(selected, count - 1);
  const liveRun = cumulative(liveCc);
  const paperRun = cumulative(paperCc);
  const liveTotalCc = liveRun[liveRun.length - 1];
  const paperTotalCc = paperRun[paperRun.length - 1];
  const grossGapCc = DOLLAR_CC - paperTotalCc;
  const maxY = Math.max(DOLLAR_CC * 1.08, ...liveRun, ...paperRun) * 1.03;
  const market = event.markets[active];
  const reportedStep = Number(market.price_grid);
  const step = Number.isFinite(reportedStep) && reportedStep > 0 ? reportedStep : 0.01;
  const priceDigits = decimals(step);
  const liveTotalLabel = fromCenticents(liveTotalCc) ?? "—";
  const paperTotalLabel = fromCenticents(paperTotalCc) ?? "—";
  const grossGapValue = fromCenticents(grossGapCc) ?? "—";
  const grossGapLabel = `${grossGapCc > 0 ? "+" : ""}${grossGapValue}`;
  const liveAskLabel = decimalLabel(market.yes_ask, priceDigits);
  const paperAskLabel = decimalLabel(fromCenticents(paperCc[active]), priceDigits);
  const x = PAD.left + (count < 2 ? (W - PAD.left - PAD.right) / 2 : (active / (count - 1)) * (W - PAD.left - PAD.right));
  const y = PAD.top + (1 - paperRun[active] / maxY) * (H - PAD.top - PAD.bottom);
  const certificateAge = certificate.observed_age_s == null ? "age not reported" : `${Math.round(certificate.observed_age_s)}s old`;

  return (
    <Figure
      caption="Basket quote simulator — cumulative cost by outcome"
      ariaLabel={`Live offers total ${liveTotalLabel} dollars. Paper offers total ${paperTotalLabel} dollars across ${count} outcomes.`}
      reading="The dashed line is the guaranteed $1 payoff. Blue is a local gross-cost scenario; it is never sent to the solver or venue."
      missing="Fees and executable depth are excluded from this paper overlay. The live certificate remains the authoritative result."
      readout={<span className="num">{`${count} outcomes; ${grossGapLabel} gross gap`}</span>}
    >
      <div className={styles.terminal}>
        <div className={styles.statusBar}>
          <span>Universe quote vector</span>
          <code>{event.event_ticker}</code>
          <span>Certificate {certificateAge}</span>
        </div>

        <div className={styles.metricGrid}>
          <div>
            <small>Venue basket</small>
            <strong>${liveTotalLabel}</strong>
            <span>best YES offers</span>
          </div>
          <div>
            <small>Paper basket</small>
            <strong>${paperTotalLabel}</strong>
            <span>{scenario.moved ? "scenario active" : "matches venue"}</span>
          </div>
          <div>
            <small>Gross gap to $1</small>
            <strong className={grossGapCc > 0 ? styles.positive : styles.negative}>
              {grossGapLabel}
            </strong>
            <span>{grossGapCc > 0 ? "before fees" : "no gross cover edge"}</span>
          </div>
        </div>

        <div className={styles.workbench}>
          <div className={styles.chart} role="img" aria-label="Cumulative live and paper basket cost lines with a one-dollar reference">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} className={styles.axis} />
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={PAD.top + (1 - DOLLAR_CC / maxY) * (H - PAD.top - PAD.bottom)}
                y2={PAD.top + (1 - DOLLAR_CC / maxY) * (H - PAD.top - PAD.bottom)}
                className={styles.dollar}
              />
              <path d={path(liveRun, maxY)} className={styles.baseline} />
              <path d={path(paperRun, maxY)} className={styles.scenario} />
              {liveRun.map((value, index) => {
                const pointX = PAD.left + (count < 2 ? (W - PAD.left - PAD.right) / 2 : (index / (count - 1)) * (W - PAD.left - PAD.right));
                const pointY = PAD.top + (1 - value / maxY) * (H - PAD.top - PAD.bottom);
                return <circle key={`live-${event.markets[index].ticker}`} cx={pointX} cy={pointY} r={3} className={styles.baselinePoint} />;
              })}
              {paperRun.map((value, index) => {
                const pointX = PAD.left + (count < 2 ? (W - PAD.left - PAD.right) / 2 : (index / (count - 1)) * (W - PAD.left - PAD.right));
                const pointY = PAD.top + (1 - value / maxY) * (H - PAD.top - PAD.bottom);
                return <circle key={`paper-${event.markets[index].ticker}`} cx={pointX} cy={pointY} r={3} className={styles.scenarioPoint} />;
              })}
              <line x1={x} x2={x} y1={PAD.top} y2={H - PAD.bottom} className={styles.cursor} />
              <circle cx={x} cy={y} r={5} className={styles.point} />
              <text x={PAD.left} y={14}>cumulative cost</text>
              <text x={W - PAD.right} y={H - 8} textAnchor="end">outcome {active + 1}/{count}</text>
              <text x={W - PAD.right} y={PAD.top + (1 - DOLLAR_CC / maxY) * (H - PAD.top - PAD.bottom) - 6} textAnchor="end">$1 payoff</text>
            </svg>
          </div>

          <div className={styles.inspector}>
            <output className="sr-only" aria-live="polite" aria-atomic="true">
              Outcome {active + 1}, {market.yes_sub_title || market.ticker}: live ask {liveAskLabel}; paper ask {paperAskLabel}.
            </output>
            <small>Selected outcome {String(active + 1).padStart(2, "0")}</small>
            <h3>{market.yes_sub_title || market.ticker}</h3>
            <div className={styles.quoteReadout}>
              <span><small>Live ask</small><strong>{liveAskLabel}</strong></span>
              <span><small>Paper ask</small><strong>{paperAskLabel}</strong></span>
            </div>
            <div className={styles.scrubber}>
              <label htmlFor={outcomeId}>Inspect outcome</label>
              <input
                id={outcomeId}
                type="range"
                min={0}
                max={Math.max(0, count - 1)}
                step={1}
                value={active}
                onChange={(event_) => setSelected(Number(event_.target.value))}
              />
            </div>
            <div className={styles.priceControl}>
              <label htmlFor={paperAskId}>Paper YES ask</label>
              <input
                id={paperAskId}
                type="range"
                min={0}
                max={1}
                step={step}
                value={scenario.asks[active]}
                onChange={(event_) => scenario.setAsk(active, Number(event_.target.value))}
              />
            </div>
            <p>Grid {decimalLabel(market.price_grid, priceDigits)}. Paper prices persist across Cover, Basket, and Size.</p>
            <div className={styles.actions}>
              <button type="button" onClick={() => setSelected(Math.max(0, active - 1))} disabled={active === 0}>Previous</button>
              <button type="button" onClick={() => setSelected(Math.min(count - 1, active + 1))} disabled={active === count - 1}>Next</button>
              <button type="button" onClick={scenario.reset} disabled={!scenario.moved}>Reset paper</button>
            </div>
          </div>
        </div>
      </div>
    </Figure>
  );
}
