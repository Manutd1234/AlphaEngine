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

import { useMemo, useState, type CSSProperties } from "react";

import { fmt, pct, usd } from "@/lib/format";
import {
  SCENARIOS,
  type ReturnsBySymbol,
  type RiskPosition,
  applyScenario,
  manualShocks,
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
  /**
   * Hand-set moves in PERCENT, keyed by symbol. `"*"` is a legal key and means
   * every instrument not named — applyScenario already understands it.
   *
   * SPARSE ON PURPOSE. A record seeded to zero for every position cannot tell
   * "the operator set this to flat" from "the operator never touched it", and
   * that distinction decides whether the instrument is PINNED at zero or moved
   * by its measured beta. Seeding would silently pin every untouched name flat
   * — the mirror image of the beta = 1 mistake this panel was built to avoid,
   * removing real exposure instead of inventing it.
   *
   * Keyed by symbol rather than index so it survives a position closing under
   * it. Empty means no override at all, so a named scenario is live.
   */
  const [manual, setManual] = useState<Record<string, number>>({});

  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];

  const manualSymbols = Object.keys(manual);
  const manualActive = manualSymbols.length > 0;
  /** True when something is set for the propagation reference, directly or by wildcard. */
  const referenceShocked = referenceSymbol in manual || "*" in manual;

  /* Removing the key rather than setting it to zero. A row at 0 is "this does
     not move"; a removed row is "propagate it by beta". Different claims. */
  const clearSymbol = (symbol: string) =>
    setManual((prev) => {
      const next = { ...prev };
      delete next[symbol];
      return next;
    });

  // The scenario magnitudes are historical, which makes them plausible on
  // average and unconditioned on today. The regime is the missing input.
  const regime = useMemo(
    () => volatilityRegime(returns[referenceSymbol] ?? []),
    [returns, referenceSymbol],
  );

  const result = useMemo(() => {
    const shocks = manualActive ? manualShocks(manual) : scenario.shocks;
    return applyScenario(positions, equity, shocks, returns, referenceSymbol);
  }, [scenario, manual, manualActive, positions, equity, returns, referenceSymbol]);

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
      const outcome = applyScenario(positions, equity, s.shocks, returns, referenceSymbol);
      return {
        id: s.id,
        label: s.label,
        pnl: outcome.totalPnl,
        ret: outcome.totalReturn,
        breaches: outcome.projectedEquity < haltEquity,
      };
    })
    .sort((a, b) => a.pnl - b.pnl),
  [positions, equity, returns, referenceSymbol, haltEquity]);

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
            aria-pressed={!manualActive && s.id === scenarioId}
            onClick={() => {
              setScenarioId(s.id);
              setManual({});
            }}
          >
            {s.label}
          </button>
        ))}
        {/* The segment control must always show WHICH shocks produced the
            numbers below. Moving a slider unpresses every named scenario —
            correct, the numbers are no longer the preset's — but a control with
            no lit segment reads as broken state, not as a fifth state. So the
            fifth state is a segment: lit exactly when hand shocks are active,
            disabled (not absent) otherwise, per the same rule that keeps
            Guided-tier controls visible-but-collapsed rather than missing. */}
        <button
          type="button"
          className="stress-scenarios__custom"
          aria-pressed={manualActive}
          disabled={!manualActive}
          title={
            manualActive
              ? `Scoring your ${manualSymbols.length} hand shock${manualSymbols.length === 1 ? "" : "s"} — clear them to return to “${scenario.label}”.`
              : "Move a slider below to set a hand shock; this lights up while one is set."
          }
        >
          Hand shocks
        </button>
      </div>

      <p className="sub">
        {manualActive
          ? `Hand shocks on ${manualSymbols.length} instrument${manualSymbols.length === 1 ? "" : "s"} — a hypothesis you are setting directly.`
          : scenario.description}
      </p>

      {regime && (
        <div className={`regime-bar regime-${regime.regime.toLowerCase()}`}>
          <span className="regime-tag">{regime.regime}</span>
          <span className="regime-read">
            {referenceSymbol} realised vol {pct(regime.currentVol, 1)} annualised — the{" "}
            {ordinal(Math.round(regime.percentile * 100))} percentile of its own last{" "}
            {regime.observations} windows, {fmt(regime.ratio, 2)}× its baseline of{" "}
            {pct(regime.baselineVol, 1)}.
          </span>
          <p className="regime-note">{regime.note}</p>
        </div>
      )}

      <div className="stress-manual">
        <div className="stress-manual__head">
          <span className="stress-subhead">Hand shocks</span>
          <button
            type="button"
            className="stress-manual__clear"
            disabled={!manualActive}
            onClick={() => setManual({})}
          >
            {manualActive
              ? `Clear ${manualSymbols.length} hand shock${manualSymbols.length === 1 ? "" : "s"} → “${scenario.label}”`
              : "No hand shocks set"}
          </button>
        </div>
        <p className="research-note">
          Set a move for any instrument. Anything left untouched moves by its measured beta against{" "}
          {referenceSymbol}; “everything else” names a move for the rest directly. A row set to 0% is
          pinned flat, which is a different claim from leaving it alone.
        </p>
        <div className="stress-manual__grid">
          {[...positions.map((p) => p.symbol), "*"].map((symbol) => (
            <ShockRow
              key={symbol}
              symbol={symbol}
              label={symbol === "*" ? "Everything else" : symbol.replace("USDT", "")}
              value={manual[symbol]}
              onChange={(v) => setManual((prev) => ({ ...prev, [symbol]: v }))}
              onClear={() => clearSymbol(symbol)}
            />
          ))}
        </div>
      </div>

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

      <div className="table-wrap" tabIndex={0}>
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
                    // `?? 0` here printed "β 0.00" for a beta this panel could
                    // not measure — the exact invention the header refuses.
                    <span className="muted">{p.beta == null ? "β —" : `β ${fmt(p.beta, 2)}`}</span>
                  ) : p.symbol in manual ? (
                    <span className="muted" title="Set by hand on the slider above">pinned</span>
                  ) : p.appliedMove !== 0 ? (
                    <span className="muted">shocked</span>
                  ) : referenceShocked ? (
                    <span className="muted" title="Beta could not be measured from available history, so no move was assumed">
                      not measurable
                    </span>
                  ) : (
                    /* The beta may be perfectly measurable — there is simply no
                       reference move for it to propagate from. Calling that "not
                       measurable" blames the data for a gap in the hypothesis. */
                    <span
                      className="muted"
                      title={`No move is set for ${referenceSymbol}, so there is nothing for a beta to propagate from. Set the reference, or use “everything else”.`}
                    >
                      not propagated
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
      <div className="table-wrap" tabIndex={0}>
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
            {ranked.map((row, index) => (
              <tr
                key={row.id}
                className={`stagger-reveal${row.id === scenarioId && !manualActive ? " is-best" : ""}`}
                style={{ "--stagger-i": index } as CSSProperties}
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
          Held flat: {unmeasured.map((p) => p.symbol).join(", ")}.{" "}
          {referenceShocked
            ? "No beta could be measured for these from available history. The total above is understated by whatever they would have moved — assuming a beta of 1 for them would have produced a larger, more confident and less true number."
            : `Nothing is set for ${referenceSymbol}, so there is no reference move for a beta to propagate. Set it, or use “everything else”, to move the rest of the book.`}
        </p>
      )}
    </div>
  );
}

/**
 * One instrument's hand shock.
 *
 * `value === undefined` is the unset state and renders as β rather than 0 —
 * the visible half of the sparse-record decision above. Clearing removes the
 * key; it never writes a zero, because a zero is a claim.
 */
function ShockRow({
  symbol,
  label,
  value,
  onChange,
  onClear,
}: {
  symbol: string;
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
  onClear: () => void;
}) {
  const set = value !== undefined;
  return (
    <div className={`shock-row${set ? " is-set" : ""}`}>
      <div className="shock-row__head">
        <span>{label}</span>
        <strong
          className="num"
          style={{ color: !set ? undefined : value < 0 ? "var(--critical-text)" : "var(--success-text)" }}
        >
          {set ? `${value > 0 ? "+" : ""}${value}%` : "β"}
        </strong>
        <button
          type="button"
          className="shock-row__clear"
          onClick={onClear}
          disabled={!set}
          aria-label={`Clear the ${label} shock`}
        >
          ×
        </button>
      </div>
      <input
        type="range"
        min={-50}
        max={50}
        step={1}
        value={value ?? 0}
        aria-label={`Shock ${symbol === "*" ? "every unnamed instrument" : symbol} by percent`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
