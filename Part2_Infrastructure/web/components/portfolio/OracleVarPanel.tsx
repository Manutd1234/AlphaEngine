"use client";

import { useCallback, useEffect, useState } from "react";

import { fmt, usd } from "@/lib/format";

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
}: {
  equity: number;
  /** From the measured covariance model, so both figures share one input. */
  annualVol: number | null;
  sandbox: boolean;
}) {
  const [horizonDays, setHorizonDays] = useState(30);
  const [result, setResult] = useState<OracleVarResponse | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    if (annualVol === null) return;
    setRunning(true);
    try {
      const response = await fetch("/api/oracle/var", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equity, sigma: annualVol, mu: 0.08, days: horizonDays, simulations: 20000 }),
      });
      setResult((await response.json()) as OracleVarResponse);
    } catch {
      setResult({
        state: "unavailable",
        code: "network",
        error: "The request did not complete. The workspace may be offline.",
      });
    } finally {
      setRunning(false);
    }
  }, [annualVol, equity, horizonDays]);

  // Runs once the volatility input exists, and again when the horizon changes.
  // Not on every equity tick: this spends database CPU, and a VaR that
  // re-simulates on each poll is noise, not information.
  useEffect(() => {
    void run();
  }, [run]);

  const clientVar = annualVol === null
    ? null
    // The parametric comparison, on the same horizon and the same volatility:
    // 2.326σ is the 99th percentile of the standard normal.
    : 2.326 * annualVol * Math.sqrt(horizonDays / 365) * equity;

  const divergence = result?.state === "ok" && clientVar
    ? (result.var99 - clientVar) / clientVar
    : null;

  return (
    <div className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Independent computation</span>
          <h2>In-database Monte Carlo VaR</h2>
        </div>
        <label className="rail-toggle">
          Horizon
          <select
            value={horizonDays}
            onChange={(event) => setHorizonDays(Number(event.target.value))}
            aria-label="Forecast horizon in days"
          >
            <option value={1}>1 day</option>
            <option value={10}>10 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
      </div>
      <p className="sub">
        Simulated by Oracle 23ai, not by this browser. It is a <strong>terminal-value</strong> GBM
        VaR over the horizon — a different question from the one-day book VaR above, so the two are
        shown side by side rather than merged.
      </p>

      {annualVol === null ? (
        <p className="muted">
          Waiting for the covariance model. Both figures use the same measured volatility, so
          neither runs until it exists.
        </p>
      ) : result === null || running ? (
        <div className="skeleton" style={{ height: 96 }} />
      ) : result.state === "unavailable" ? (
        <div className="banner warn" role="status">
          <span aria-hidden>!</span>
          <div>
            <strong>Not computed.</strong> {result.error}
            {" "}The client-side figure above is unaffected — it never depended on this.
          </div>
        </div>
      ) : (
        <>
          <div className="tiles stability-tiles">
            <div className="stat-tile">
              <div className="stat-tile__label">Oracle VaR 99</div>
              <div className="num stat-tile__value" data-tone="neg">{usd(result.var99, 0)}</div>
              <div className="stat-tile__note">{result.pathsUsed.toLocaleString()} paths · {horizonDays}d</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile__label">Parametric VaR 99</div>
              <div className="num stat-tile__value">{clientVar ? usd(clientVar, 0) : "—"}</div>
              <div className="stat-tile__note">2.326σ·√t, same volatility</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile__label">Divergence</div>
              <div
                className="num stat-tile__value"
                data-tone={divergence !== null && Math.abs(divergence) > 0.15 ? "neg" : undefined}
              >
                {divergence === null ? "—" : `${divergence > 0 ? "+" : ""}${fmt(divergence * 100, 1)}%`}
              </div>
              <div className="stat-tile__note">simulated vs closed form</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile__label">Expected equity</div>
              <div className="num stat-tile__value">{usd(result.expectedEquity, 0)}</div>
              <div className="stat-tile__note">mean terminal value · {result.computedInMs}ms</div>
            </div>
          </div>
          <p className="sub">
            {divergence !== null && Math.abs(divergence) > 0.15
              ? "The two methods disagree by more than 15%. That is the interesting number: lognormal "
                + "terminal values are skewed, so the simulation should sit below the symmetric "
                + "closed form at long horizons — a large gap in the other direction means one of "
                + "the inputs is wrong."
              : "The two agree within sampling error, which is what a correct implementation of both "
                + "looks like."}
            {sandbox && " Book is the generated sandbox, so the equity input is not a real position."}
          </p>
        </>
      )}
    </div>
  );
}
