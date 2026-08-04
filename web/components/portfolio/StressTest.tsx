"use client";

/**
 * What breaks this book, and at what level.
 *
 * VaR answers "how bad is a bad day" from the distribution that has already
 * happened. It cannot answer "what if BTC gaps 20%", because that is a question
 * about a move the sample may not contain — and those are the moves that end
 * funds.
 *
 * Two design choices carry the honesty here:
 *
 *  - **Unshocked instruments move by a *measured* beta, or not at all.** The
 *    tempting default is beta = 1 for anything unmeasurable, which quietly
 *    invents exposure and produces a confident total. Positions whose beta could
 *    not be estimated are left flat and marked, so the number is understated
 *    rather than fabricated.
 *  - **The distance to the halt is shown, not just the P&L.** A −$740k loss
 *    means nothing on its own; "−$740k, which is 61% of the way to the
 *    drawdown limit that halts trading" is a decision.
 */

import { useMemo, useState } from "react";

import { fmt, pct, usd } from "@/lib/format";
import {
  SCENARIOS,
  type ReturnsBySymbol,
  type RiskPosition,
  applyScenario,
} from "@/lib/portfolio-risk";

interface StressTestProps {
  positions: RiskPosition[];
  equity: number;
  returns: ReturnsBySymbol;
  referenceSymbol: string;
  /** Fraction of start-of-day equity at which the gateway halts trading. */
  drawdownLimitPct: number;
  startOfDayEquity: number;
}

export default function StressTest({
  positions,
  equity,
  returns,
  referenceSymbol,
  drawdownLimitPct,
  startOfDayEquity,
}: StressTestProps) {
  const [scenarioId, setScenarioId] = useState<string>("crypto_cascade");
  const [manualShock, setManualShock] = useState<number | null>(null);

  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];

  const result = useMemo(() => {
    const shocks = manualShock === null
      ? scenario.shocks
      : [{ symbol: referenceSymbol, move: manualShock / 100 }];
    return applyScenario(positions, equity, shocks, returns, referenceSymbol);
  }, [scenario, manualShock, positions, equity, returns, referenceSymbol]);

  const haltEquity = startOfDayEquity * (1 - drawdownLimitPct);
  const breachesHalt = result.projectedEquity < haltEquity;
  // How far the shock carries the book toward the level that stops trading.
  const towardHalt = equity > haltEquity
    ? Math.max(0, Math.min(1, -result.totalPnl / (equity - haltEquity)))
    : 1;

  const unmeasured = result.perPosition.filter((p) => !p.viaBeta && p.appliedMove === 0);

  return (
    <div className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Scenario analysis</span>
          <h2>Stress test</h2>
        </div>
        <span>reference {referenceSymbol}</span>
      </div>

      <div className="seg research-seg stress-scenarios" role="group" aria-label="Stress scenario">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={manualShock === null && s.id === scenarioId}
            onClick={() => {
              setScenarioId(s.id);
              setManualShock(null);
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <p className="sub">{manualShock === null ? scenario.description : "Manual shock — a hypothesis you are setting directly."}</p>

      <label className="stress-slider">
        <span>
          Shock {referenceSymbol}
          <strong
            className="num"
            style={{
              color: (manualShock ?? 0) < 0 ? "var(--critical-text)" : "var(--success-text)",
            }}
          >
            {manualShock === null ? "—" : `${manualShock > 0 ? "+" : ""}${manualShock}%`}
          </strong>
        </span>
        <input
          type="range"
          min={-50}
          max={50}
          step={1}
          value={manualShock ?? 0}
          aria-label={`Shock ${referenceSymbol} by percent`}
          onChange={(event) => setManualShock(Number(event.target.value))}
        />
      </label>

      <div className={`stress-result ${result.totalPnl < 0 ? "is-loss" : "is-gain"}`}>
        <div>
          <span>Projected book impact</span>
          <strong className="num">
            {result.totalPnl >= 0 ? "+" : "−"}{usd(Math.abs(result.totalPnl), 0)}
          </strong>
          <small>{pct(result.totalReturn, 2)} of equity</small>
        </div>
        <div>
          <span>Equity after shock</span>
          <strong className="num">{usd(result.projectedEquity, 0)}</strong>
          <small>halt level {usd(haltEquity, 0)}</small>
        </div>
        <div>
          <span>Toward halt</span>
          <strong
            className="num"
            style={{ color: breachesHalt ? "var(--critical-text)" : towardHalt > 0.7 ? "var(--warning-text)" : undefined }}
          >
            {pct(towardHalt, 0)}
          </strong>
          <small>{breachesHalt ? "breaches the limit" : "of the cushion consumed"}</small>
        </div>
      </div>

      {breachesHalt && (
        <div className="banner error" role="alert">
          <span aria-hidden>■</span>
          <div>
            <strong>This scenario trips the daily drawdown limit.</strong> Equity would fall to{" "}
            {usd(result.projectedEquity, 0)}, below the {pct(drawdownLimitPct, 0)} halt level of{" "}
            {usd(haltEquity, 0)} — the gateway would stop trading before the book recovered.
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <caption className="sr-only">
            Per-position impact under the selected scenario, showing which moves were shocked
            directly and which were propagated by a measured beta.
          </caption>
          <thead>
            <tr>
              <th scope="col">Instrument</th>
              <th scope="col">Notional</th>
              <th scope="col">Move</th>
              <th scope="col">Source</th>
              <th scope="col">P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {result.perPosition.map((p) => (
              <tr key={p.symbol}>
                <td>{p.symbol}</td>
                <td className={p.signedNotional >= 0 ? "pos" : "neg"}>{usd(p.signedNotional, 0)}</td>
                <td>{pct(p.appliedMove, 1)}</td>
                <td>
                  {p.viaBeta ? (
                    <span className="muted">β {fmt(p.beta ?? 0, 2)}</span>
                  ) : p.appliedMove !== 0 ? (
                    <span className="muted">shocked</span>
                  ) : (
                    <span className="muted" title="Beta could not be measured from available history, so no move was assumed">
                      not measurable
                    </span>
                  )}
                </td>
                <td className={p.pnl >= 0 ? "pos" : "neg"}>
                  {p.pnl >= 0 ? "+" : "−"}{usd(Math.abs(p.pnl), 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unmeasured.length > 0 && (
        <p className="research-note">
          Held flat because no beta could be measured: {unmeasured.map((p) => p.symbol).join(", ")}.
          The total above is understated by whatever those would have moved — assuming a beta of 1 for
          them would have produced a larger, more confident and less true number.
        </p>
      )}

      <p className="research-note">
        The shock is an assumption; the propagation is not. Betas are measured from the same daily
        returns the risk engine uses. Scenario magnitudes are drawn from moves these markets have
        actually made — which makes them plausible, not predictions.
      </p>
    </div>
  );
}
