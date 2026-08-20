"use client";

import { useCallback, useEffect, useState } from "react";

import StatTile from "@/components/StatTile";
import { fmt, usd } from "@/lib/format";
import { gbmTerminalVar99 } from "@/lib/portfolio-risk";

interface OracleVarOk {
  state: "ok";
  var99: number;
  expectedEquity: number;
  pathsUsed: number;
  assumptions: { equity: number; mu: number; sigma: number; days: number; model: string };
  computedInMs: number;
}
interface OracleVarUnavailable {
  state: "unavailable";
  code: string;
  error: string;
}
type OracleVarResponse = OracleVarOk | OracleVarUnavailable;

/**
 * Longer than the gateway's 2.5s, on purpose: 20,000 in-database Monte Carlo
 * paths take seconds when everything is working, and aborting at 2.5s would
 * report a failure for work that was about to succeed.
 */
const ORACLE_DEADLINE_MS = 9000;

/**
 * The drift the simulation runs on: a modelled 8% expected annual return.
 *
 * One named constant, sent to the procedure and then read BACK off the
 * response's echoed assumptions by the closed-form comparison below — so the
 * two figures cannot quietly run on different drifts. That is the defect this
 * panel used to have: the request carried this 8% inline while the comparison
 * was the zero-drift z99·σ·√t shortcut, and at 30 days the drift term alone
 * (≈ equity·μ·T) showed up as a −22% "divergence" blamed on the inputs.
 */
const GBM_EXPECTED_ANNUAL_RETURN = 0.08;

/**
 * A second, independent VaR — computed inside Oracle 23ai rather than in this
 * browser.
 *
 * The point is NOT a prettier number. `lib/portfolio-risk.ts` already produces
 * VaR from the covariance model, and this repo's habit is that two
 * implementations of the same accounting are two chances to be wrong and one
 * chance to notice — the Python/TypeScript engine parity suite exists for the
 * same reason. When these disagree by more than the sampling error, the
 * disagreement is the finding.
 *
 * They are NOT interchangeable, and the copy says so rather than leaving a
 * reader to assume: this is a terminal-value GBM VaR over a horizon, the
 * client-side figure is a one-day VaR on the current book. Presenting them as
 * one number with two sources would be the actual error.
 *
 * Never rendered as a zero. An unreachable database is `unavailable`, which is
 * a different fact from "your risk is nil" — the distinction the whole
 * codebase's provider layer is built around.
 */
export default function OracleVarPanel({
  equity,
  annualVol,
  sandbox,
  horizonDays,
}: {
  equity: number;
  /** From the measured covariance model, so both figures share one input. */
  annualVol: number | null;
  sandbox: boolean;
  /** Owned by RiskWorkspace's shared horizon state, rendered as a seg above
   *  this card and above the bootstrap card on the Monte Carlo subtab, so the
   *  two loss estimates always answer over one horizon. */
  horizonDays: number;
}) {
  const [result, setResult] = useState<OracleVarResponse | null>(null);
  const [running, setRunning] = useState(false);

  // Quantised so a live book repolling every 15s does not re-simulate on every
  // equity tick — the restraint MonteCarloDistribution already credits this
  // panel with sharing. A sub-thousand-dollar equity move does not change a
  // 99th percentile read at this scale; a card that swapped its figures for a
  // skeleton on each poll did change, visibly, every fifteen seconds.
  const equityForRun = Math.round(equity / 1_000) * 1_000 || equity;

  const run = useCallback(async () => {
    if (annualVol === null) return;
    setRunning(true);
    /**
     * A deadline of its own, and a longer one than the gateway's 2.5s.
     *
     * This request asks an Autonomous Database to run 20,000 Monte Carlo paths
     * in-database; several seconds is a correct answer, not a failure, so the
     * shared gateway budget would abort work that was about to succeed. But
     * unbounded is still wrong: on Always-Free the ADB auto-stops, and a stopped
     * instance can leave a connection open long enough that this panel spun on
     * "running" indefinitely while the rest of Portfolio had already given up.
     *
     * Not routed through `probeGateway`: that coalesces by URL, which is right
     * for reads of one resource and wrong here, where two panels asking for
     * different horizons would be silently served each other's answer.
     */
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ORACLE_DEADLINE_MS);
    try {
      const response = await fetch("/api/oracle/var", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equity: equityForRun,
          sigma: annualVol,
          mu: GBM_EXPECTED_ANNUAL_RETURN,
          days: horizonDays,
          simulations: 20000,
        }),
        signal: controller.signal,
      });
      setResult((await response.json()) as OracleVarResponse);
    } catch {
      setResult({
        state: "unavailable",
        code: "network",
        // No parametric figure either: the comparison prices the assumptions
        // the database echoes back, so with no answer there is nothing
        // honest to price. The banner below names the VaR that is unaffected.
        error: controller.signal.aborted
          ? `The database did not answer within ${ORACLE_DEADLINE_MS / 1000}s. On Always-Free it may have auto-stopped.`
          : "The request did not complete. The workspace may be offline.",
      });
    } finally {
      clearTimeout(timer);
      setRunning(false);
    }
  }, [annualVol, equityForRun, horizonDays]);

  // Runs once the volatility input exists, and again when the horizon changes.
  // Not on every equity tick: this spends database CPU, and a VaR that
  // re-simulates on each poll is noise, not information.
  useEffect(() => {
    void run();
  }, [run]);

  /**
   * The parametric comparison prices the SAME model the database simulates —
   * the lognormal terminal quantile with the same drift, the same volatility
   * and the same 365-day horizon — so the only thing left between the two
   * figures is sampling error, which is what the divergence tile is for. It
   * reads the response's ECHOED assumptions rather than this component's own
   * request, because the route clamps its inputs and a clamped input read
   * against the unclamped original would surface as method disagreement.
   */
  const assumptions = result?.state === "ok" ? result.assumptions : null;
  const clientVar = assumptions === null
    ? null
    : gbmTerminalVar99(assumptions.equity, assumptions.mu, assumptions.sigma, assumptions.days);

  // `clientVar > 0` is the division guard, not zero-coercion: both formulae
  // floor at zero under an extreme drift, and a ratio against that floor
  // would be noise. The tile renders the dash instead.
  const divergence = result?.state === "ok" && clientVar !== null && clientVar > 0
    ? (result.var99 - clientVar) / clientVar
    : null;

  return (
    <div className="card" aria-busy={running}>
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Independent computation</span>
          <h2>In-database Monte Carlo VaR</h2>
        </div>
        {/* No control here: the workspace renders the shared horizon seg above
            this card, and again above the bootstrap card on the Monte Carlo
            subtab. The figure states its own horizon in the tile note below. */}
        <span>{horizonDays}-day horizon</span>
      </div>
      {/* Which database is this card's own fact; that it is not this browser
          is the heading's "In-database" and the kicker, twice already. The
          terminal-value/one-day distinction below is not decoration — a VaR
          without the horizon it answers over is the wrong number. */}
      <p className="sub">
        Simulated by Oracle 23ai: a <strong>terminal-value</strong> GBM VaR over the horizon, a
        different question from the one-day book VaR on the VaR &amp; model section.
      </p>

      {annualVol === null ? (
        <p className="muted">
          Waiting for the covariance model — both figures need its measured volatility, so neither
          runs until it exists.
        </p>
      ) : (
        /* One space-reserving box around every post-model state. The card used
           to swap a 96px skeleton for a ~190px result on each run, so a horizon
           change (and, before the equity quantisation above, every book poll)
           bounced whatever sat below it. The skeleton now fills the same box
           the tiles and their caption occupy, so a re-run changes the pixels,
           not the layout. */
        <div style={{ minHeight: 192 }}>
          {result === null || running ? (
            <div className="skeleton" style={{ height: 192 }} />
          ) : result.state === "unavailable" ? (
            <div className="banner warn" role="status">
              <span aria-hidden>!</span>
              <div>
                <strong>Not computed.</strong> {result.error}
                {" "}The workspace&apos;s own VaR on the VaR &amp; model section never depended on
                this and is unaffected.
              </div>
            </div>
          ) : (
            <>
              {/* `<StatTile>`, not four hand-typed copies of what it renders.
                  Note the null handling survives the move intact: a missing
                  parametric VaR or divergence renders "—", never a zero — and
                  a genuine floored-at-zero VaR renders as $0, which is why the
                  dash tests for null rather than falsiness. */}
              <div className="tiles stability-tiles">
                <StatTile
                  label="Oracle VaR 99"
                  value={usd(result.var99, 0)}
                  tone="neg"
                  note={`${result.pathsUsed.toLocaleString()} paths over ${horizonDays} d`}
                />
                <StatTile
                  label="Parametric VaR 99"
                  value={clientVar === null ? "—" : usd(clientVar, 0)}
                  note="closed form, same GBM drift and volatility"
                />
                <StatTile
                  label="Divergence"
                  value={divergence === null ? "—" : `${divergence > 0 ? "+" : ""}${fmt(divergence * 100, 1)}%`}
                  tone={divergence !== null && Math.abs(divergence) > 0.15 ? "neg" : undefined}
                  note="simulated vs closed form"
                />
                <StatTile
                  label="Expected equity"
                  value={usd(result.expectedEquity, 0)}
                  note={`mean terminal value; computed in ${result.computedInMs} ms`}
                />
              </div>
              <p className="sub">
                {divergence !== null && Math.abs(divergence) > 0.15
                  ? "The two methods disagree by more than 15%. Both price the same lognormal "
                    + "terminal distribution, one by simulation and one in closed form, so a gap "
                    + "this size is not sampling error: one of them is not running the inputs "
                    + "shown beside it, and that is the finding."
                  : "The two agree within sampling error, as two correct implementations "
                    + "should."}
                {sandbox && " Book is the generated sandbox, so the equity input is not a real position."}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
