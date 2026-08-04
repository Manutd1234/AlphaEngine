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
  REGIME_SCALE_BOUNDS,
  SCENARIOS,
  type ReturnsBySymbol,
  type RiskPosition,
  applyScenario,
  scaleShocks,
  volatilityRegime,
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

const clampRatio = (r: number) =>
  Math.min(REGIME_SCALE_BOUNDS[1], Math.max(REGIME_SCALE_BOUNDS[0], r));

/** "85th", not "85%" — a percentile is a rank, and reading it as a share is the
 *  standard misreading this label exists to prevent. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
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
  const [conditionOnRegime, setConditionOnRegime] = useState(true);

  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];

  // The scenario magnitudes are historical, which makes them plausible on
  // average and unconditioned on today. The regime is the missing input.
  const regime = useMemo(
    () => volatilityRegime(returns[referenceSymbol] ?? []),
    [returns, referenceSymbol],
  );

  const result = useMemo(() => {
    const base = manualShock === null
      ? scenario.shocks
      : [{ symbol: referenceSymbol, move: manualShock / 100 }];
    // A manual shock is the operator's own hypothesis, stated in percent and
    // shown on the slider. Rescaling it would silently disagree with the number
    // they just set, so conditioning applies to the named scenarios only.
    const shocks = conditionOnRegime && manualShock === null ? scaleShocks(base, regime) : base;
    return applyScenario(positions, equity, shocks, returns, referenceSymbol);
  }, [scenario, manualShock, conditionOnRegime, regime, positions, equity, returns, referenceSymbol]);

  const haltEquity = startOfDayEquity * (1 - drawdownLimitPct);
  const breachesHalt = result.projectedEquity < haltEquity;
  // How far the shock carries the book toward the level that stops trading.
  const towardHalt = equity > haltEquity
    ? Math.max(0, Math.min(1, -result.totalPnl / (equity - haltEquity)))
    : 1;

  const unmeasured = result.perPosition.filter((p) => !p.viaBeta && p.appliedMove === 0);

  // Every named scenario scored on the same book. One scenario at a time
  // answers "how bad is this one"; a PM's actual question is "which of these
  // should I worry about", and that is a ranking.
  const ranked = useMemo(() => SCENARIOS
    .map((s) => {
      const shocks = conditionOnRegime ? scaleShocks(s.shocks, regime) : s.shocks;
      const outcome = applyScenario(positions, equity, shocks, returns, referenceSymbol);
      return {
        id: s.id,
        label: s.label,
        pnl: outcome.totalPnl,
        ret: outcome.totalReturn,
        breaches: outcome.projectedEquity < haltEquity,
      };
    })
    .sort((a, b) => a.pnl - b.pnl),
  [conditionOnRegime, regime, positions, equity, returns, referenceSymbol, haltEquity]);

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

      {regime && (
        <div className={`regime-bar regime-${regime.regime.toLowerCase()}`}>
          <span className="regime-tag">{regime.regime}</span>
          <span className="regime-read">
            {referenceSymbol} realised vol {pct(regime.currentVol, 1)} annualised — the{" "}
            {ordinal(Math.round(regime.percentile * 100))} percentile of its own last{" "}
            {regime.observations} windows, {fmt(regime.ratio, 2)}× its baseline of{" "}
            {pct(regime.baselineVol, 1)}.
          </span>
          <label className="regime-toggle">
            <input
              type="checkbox"
              checked={conditionOnRegime}
              disabled={manualShock !== null}
              onChange={(event) => setConditionOnRegime(event.target.checked)}
            />
            <span>
              Condition on regime
              {manualShock !== null && " (manual shock overrides)"}
            </span>
          </label>
          <p className="regime-note">
            {regime.note}
            {conditionOnRegime && manualShock === null && (
              clampRatio(regime.ratio) > 1 ? (
                <>
                  {" "}
                  Named scenarios are scaled up by {fmt(clampRatio(regime.ratio), 2)}× accordingly,
                  capped at {REGIME_SCALE_BOUNDS[1]}× so a thin sample cannot turn a scenario into
                  an unfalsifiable catastrophe.
                </>
              ) : (
                <>
                  {" "}
                  Scenarios are left at full size. Conditioning only ever scales a shock{" "}
                  <em>up</em>: relaxing the stress test because the market is quiet would report the
                  most reassuring number precisely when a compressed regime is closest to ending.
                </>
              )
            )}
          </p>
        </div>
      )}

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

      <h3 className="stress-subhead">Every scenario, ranked by loss</h3>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">
            Projected profit and loss for each named scenario against the current book.
          </caption>
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">P&amp;L</th>
              <th scope="col">Of equity</th>
              <th scope="col">Halts trading</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((row) => (
              <tr
                key={row.id}
                className={row.id === scenarioId && manualShock === null ? "is-best" : undefined}
              >
                <td>{row.label}</td>
                <td className={`num ${row.pnl >= 0 ? "pos" : "neg"}`}>
                  {row.pnl >= 0 ? "+" : "−"}{usd(Math.abs(row.pnl), 0)}
                </td>
                <td className="num">{pct(row.ret, 2)}</td>
                <td>
                  {/* icon + word, never colour alone */}
                  {row.breaches
                    ? <span style={{ color: "var(--critical-text)" }}><span aria-hidden>✕</span> yes</span>
                    : <span className="muted"><span aria-hidden>✓</span> no</span>}
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
