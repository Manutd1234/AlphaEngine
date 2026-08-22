"use client";

import { useCallback, useEffect, useState } from "react";

import { useMeasuredWidth } from "@/components/chart-kit";
import NumberTicker from "@/components/common/NumberTicker";
import OracleVarTrend, {
  ORACLE_TREND_RESERVE,
  TREND_MAX_OBSERVATIONS,
  observationKey,
  type OracleVarObservation,
} from "@/components/risk/OracleVarTrend";
import StatTile from "@/components/StatTile";
import { fmt, usd } from "@/lib/format";
import { gbmTerminalVar99 } from "@/lib/portfolio-risk";

interface OracleVarOk {
  state: "ok";
  var99: number; expectedEquity: number; pathsUsed: number; computedInMs: number;
  assumptions: { equity: number; mu: number; sigma: number; days: number; model: string };
}
interface OracleVarUnavailable { state: "unavailable"; code: string; error: string }
type OracleVarResponse = OracleVarOk | OracleVarUnavailable;

/**
 * Longer than the gateway's 2.5s, and not `probeGateway`: 20,000 in-database
 * paths take seconds, so the shared budget would abort work about to succeed,
 * while unbounded let a stopped Always-Free ADB hold this panel on "running"
 * for ever. `probeGateway` coalesces by URL, so two horizons would be served
 * each other's answer.
 */
const ORACLE_DEADLINE_MS = 9000;

/**
 * The drift the simulation runs on: a modelled 8% expected annual return. One
 * named constant, sent to the procedure and read BACK off the echoed
 * assumptions by the comparison below, so the two figures cannot quietly run
 * on different drifts. That was the defect: the request carried this 8% inline
 * while the comparison was the zero-drift z99·σ·√t shortcut, and at 30 days
 * the drift term alone read as a −22% "divergence".
 */
const GBM_EXPECTED_ANNUAL_RETURN = 0.08;

/**
 * Volatility is bucketed to a basis point before anything is keyed on it.
 *
 * The equity quantisation below was half a restraint, and alone it achieved
 * nothing. `annualVol` arrives as √(wᵀΣw)·√ann with weights w = signedNotional
 * ÷ equity, so a poll that moves a mark or the equity by a cent yields a new
 * double, `run` takes a new identity, and the effect fires another nine-second
 * simulation. That is why the card was reported as permanently grey: the
 * comment claimed a re-run on a model or horizon change while the arithmetic
 * delivered one every fifteen seconds, and it defeated the trend's key too,
 * appending a fresh observation of one fact on every poll.
 *
 * Measured against the closed form below, and re-measured on every run by
 * `oracle-var-freshness.test.ts` rather than trusted here: a basis point of σ
 * moves this VaR by 0.014% at σ = 0.60 over 30 days, and by 0.004–0.040%
 * anywhere in σ ∈ [0.25, 1.2] over 1 to 90 days, while the simulation it feeds
 * locates the 1st percentile only to 0.43–1.12% at 20,000 paths — the sample
 * quantile's own standard error, √(p(1−p)/n) ÷ f(q). The bucket stays an order
 * of magnitude inside the noise of what it feeds. The rejected alternative,
 * debouncing on a timer, trades a wrong number for a late one and still
 * appends duplicates.
 */
const VOL_BUCKET = 10_000;

/**
 * A second, independent VaR — computed inside Oracle 23ai, not in this
 * browser. The point is NOT a prettier number: two implementations of one
 * accounting are two chances to be wrong and one chance to notice, so a
 * disagreement wider than the sampling error IS the finding. They are not
 * interchangeable, and the copy says so: this is a terminal-value GBM VaR over
 * a horizon, the client-side figure a one-day VaR on the current book. An
 * unreachable database is `unavailable`, never a zero — "your risk is nil" is
 * a different fact, and that distinction is what the provider layer is for.
 */
export default function OracleVarPanel({
  equity,
  annualVol: measuredAnnualVol,
  sandbox,
  horizonDays,
}: {
  equity: number;
  /** From the measured covariance model, so both figures share one input. */
  annualVol: number | null;
  sandbox: boolean;
  /** RiskWorkspace's shared horizon state, rendered as a seg above this card
   *  and above the bootstrap card on the Monte Carlo subtab. */
  horizonDays: number;
}) {
  /**
   * The last COMPLETED simulation, carried with the inputs it ran on.
   *
   * Two pieces of state rather than one `result`, and this is the reported
   * defect. `result === null || running` drew a skeleton, and `running` covers
   * a whole nine-second request, so a re-run threw a good answer away to show a
   * grey box. The risk engine settled this already (`loading={riskLoading &&
   * !risk}` — the skeleton gated on having NOTHING to show) and
   * `DeskSourceMachine` states the doctrine: a failed or in-flight poll demotes
   * the payload to `cached` and keeps the numbers. Same vocabulary here, not a
   * second one. The inputs travel with the answer because `cached` must mean
   * something exact: these figures were computed for THAT book and THOSE
   * inputs, while the heading names the horizon being asked about now.
   */
  const [held, setHeld] = useState<{ answer: OracleVarOk; key: string; sandbox: boolean } | null>(null);
  /** The most recent refusal: it describes the last ATTEMPT, never the figures
   *  on screen, which is why it is not folded into `held`. Cleared by success. */
  const [refusal, setRefusal] = useState<OracleVarUnavailable | null>(null);
  const [running, setRunning] = useState(false);
  /** Every distinct request this panel has completed, in arrival order. Drawn
   *  by the chart because the desk asked to see the figure MOVE and a tile can
   *  only show where it stopped. Appended to, never reset: a re-run adds or
   *  updates one point and the series survives it. */
  const [observations, setObservations] = useState<OracleVarObservation[]>([]);
  /* SVG in user units, so the chart needs a real width; the box below reserves
     it so the measuring frame cannot collapse the card. */
  const [chartRef, chartWidth] = useMeasuredWidth<HTMLDivElement>();
  // Quantised so a live book repolling every 15s does not re-simulate on every
  // equity tick — the restraint MonteCarloDistribution already credits this
  // panel with sharing. A sub-$1,000 move does not move a 99th percentile read.
  const equityForRun = Math.round(equity / 1_000) * 1_000 || equity;
  // Bucketed, and it KEEPS THE PROP'S NAME on purpose: `annualVol` is the
  // identifier the run and record dependency lists carry, and those lists are
  // the quantisation contract `risk-stability.test.ts` pins literally. A new
  // name for the bucketed value would leave the raw double in the deps — the
  // defect VOL_BUCKET describes, still shipping, with a constant beside it.
  const annualVol = measuredAnnualVol === null
    ? null : Math.round(measuredAnnualVol * VOL_BUCKET) / VOL_BUCKET;
  /** What is being asked for now, read against the held answer's own key on the
   *  first render after a change — before the effect has even fired. */
  const requestKey = annualVol === null
    ? null : observationKey(equityForRun, annualVol, horizonDays);

  /**
   * One completed attempt, folded into the trend. Keyed on the INPUTS — equity
   * bucket, volatility bucket, horizon — so an identical request updates its
   * own point instead of appending a second observation of one fact; React
   * StrictMode double-invokes this in development, and without the key the
   * chart's first draw would be a two-point line built from one run. An
   * unavailable answer is recorded too, as a point whose value is `null`:
   * dropping it would draw a continuous series across a database that was not
   * answering, the same lie as plotting a zero. The chart breaks its line at
   * nulls and counts them in its caption.
   */
  const record = useCallback(
    (answer: OracleVarResponse) => {
      if (annualVol === null) return;
      const a = answer.state === "ok" ? answer.assumptions : null;
      const point: OracleVarObservation = {
        key: observationKey(equityForRun, annualVol, horizonDays),
        at: Date.now(),
        horizonDays,
        equity: equityForRun,
        var99: answer.state === "ok" ? answer.var99 : null,
        clientVar: a === null ? null : gbmTerminalVar99(a.equity, a.mu, a.sigma, a.days),
      };
      setObservations((kept) => {
        const at = kept.findIndex((o) => o.key === point.key);
        const next = at === -1 ? [...kept, point] : kept.map((o, i) => (i === at ? point : o));
        return next.length > TREND_MAX_OBSERVATIONS
          ? next.slice(next.length - TREND_MAX_OBSERVATIONS)
          : next;
      });
    },
    [annualVol, equityForRun, horizonDays],
  );

  const run = useCallback(async (superseded?: AbortSignal) => {
    if (annualVol === null) return;
    setRunning(true);
    // Two ways to stop, and they are different facts. The timer is the deadline
    // and produces a REPORTED failure; `superseded` is the effect's cleanup
    // saying the inputs changed under this request, and produces nothing at
    // all — no state, no observation. Before it, a horizon changed mid-flight
    // left the old request running, free to land after the new one and
    // overwrite a newer answer with an older one — the render-level twin of the
    // flap `risk-stability.test.ts` pins for the bootstrap worker — while
    // asking an Always-Free ADB for two 20,000-path runs at once.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ORACLE_DEADLINE_MS);
    const giveUp = () => controller.abort();
    superseded?.addEventListener("abort", giveUp, { once: true });
    try {
      const response = await fetch("/api/oracle/var", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equity: equityForRun, sigma: annualVol, mu: GBM_EXPECTED_ANNUAL_RETURN,
          days: horizonDays, simulations: 20000,
        }),
        signal: controller.signal,
      });
      const answer = (await response.json()) as OracleVarResponse;
      if (superseded?.aborted) return;
      if (answer.state === "ok") {
        setHeld({ answer, key: observationKey(equityForRun, annualVol, horizonDays), sandbox });
        setRefusal(null);
      } else setRefusal(answer);
      record(answer);
    } catch {
      // A request this component cancelled is not a database that failed to
      // answer; recording it as one would put a "not computed" tick on the
      // chart for a question nobody is asking any more.
      if (superseded?.aborted) return;
      const failure: OracleVarUnavailable = {
        state: "unavailable",
        code: "network",
        // No parametric figure moves with it: the comparison prices the
        // assumptions the database echoes back, so with no answer there is
        // nothing new to price. Figures already on screen stay, marked by the
        // status line as the last completed run.
        error: controller.signal.aborted
          ? `The database did not answer within ${ORACLE_DEADLINE_MS / 1000}s. On Always-Free it may have auto-stopped.`
          : "The request did not complete. The workspace may be offline.",
      };
      setRefusal(failure);
      record(failure);
    } finally {
      clearTimeout(timer);
      superseded?.removeEventListener("abort", giveUp);
      // A superseded run must not clear the flag: the run that replaced it has
      // already set it, and this `finally` lands after that.
      if (!superseded?.aborted) setRunning(false);
    }
  }, [annualVol, equityForRun, horizonDays, record, sandbox]);

  // Runs once the volatility input exists, and again when the horizon or the
  // bucketed model changes — not on every equity tick, not on every poll. The
  // cleanup cancels a request whose inputs no longer exist.
  useEffect(() => {
    const superseded = new AbortController();
    void run(superseded.signal);
    return () => superseded.abort();
  }, [run]);

  // Live and Sandbox share no positions, so a held answer from across the
  // toggle is not a cached reading of this book but a reading of a different
  // one: discarded, not demoted. The stamp is taken inside `run`, where it
  // describes the book the REQUEST was issued for — reading it at landing time
  // would caption a live answer as sandbox the moment someone toggled.
  const sim = held !== null && held.sandbox === sandbox ? held.answer : null;
  /**
   * The parametric comparison prices the SAME model the database simulates —
   * the lognormal terminal quantile, same drift, same volatility, same 365-day
   * year — so the only thing left between the two figures is sampling error,
   * which is what the divergence tile measures. It reads the response's ECHOED
   * assumptions rather than this component's request: the route clamps its
   * inputs, and a clamped input read against the unclamped original surfaces
   * as method disagreement.
   */
  const assumptions = sim?.assumptions ?? null;
  const clientVar = assumptions === null ? null
    : gbmTerminalVar99(assumptions.equity, assumptions.mu, assumptions.sigma, assumptions.days);

  /**
   * The same closed form on the inputs about to be REQUESTED, priced here.
   * This is what makes the card instant while staying honest: pure arithmetic
   * in this browser, microseconds, on screen before the database has been
   * asked — a real figure, not a placeholder shaped like one. It is
   * deliberately NOT `clientVar` and must never quietly become the divergence
   * baseline, for the reason directly above: it prices the inputs unclamped.
   * The divergence tile stays dashed until there is an answer to price against.
   */
  const requestedVar = annualVol === null ? null
    : gbmTerminalVar99(equityForRun, GBM_EXPECTED_ANNUAL_RETURN, annualVol, horizonDays);
  // `clientVar > 0` is the division guard, not zero-coercion: both formulae
  // floor at zero under an extreme drift, and a ratio against that floor would
  // be noise, so the tile renders the dash instead.
  const divergence = sim !== null && clientVar !== null && clientVar > 0
    ? (sim.var99 - clientVar) / clientVar
    : null;
  const disagrees = divergence !== null && Math.abs(divergence) > 0.15;
  /** `lib/data-tier`'s word for what is on screen: returned earlier, carried with what it ran on. */
  const cached = sim !== null && (running || refusal !== null || held?.key !== requestKey);
  const ranOn = sim === null ? "" : `${usd(sim.assumptions.equity, 0)} over ${sim.assumptions.days} d`;
  /** A dash, never a zero. A floored-at-zero VaR is $0, so this tests null. */
  const money = (value: number | null) => (value === null ? "—" : usd(value, 0));
  /** One sentence in one slot, so a change of state changes the words and not
   *  the height: a banner appearing here would displace the chart below. */
  const status = sim === null
    ? "Simulating 20,000 paths in the database, which takes seconds. The parametric figure beside "
      + "it is priced in this browser and is already final."
    : refusal !== null ? `Not refreshed: ${refusal.error}`
      + ` The figures above are the last completed simulation, ${ranOn}, kept rather than blanked.`
    : cached ? `Re-simulating. The figures above are the last completed run, ${ranOn}, and stay `
      + "until it answers."
    : disagrees ? "The two disagree by more than 15%. Both price the same lognormal terminal "
      + "distribution, so this is not sampling error: one is not running the inputs beside it."
    : "The two agree within sampling error.";

  return (
    <div className="card" aria-busy={running}>
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Independent computation</span>
          <h2>In-database Monte Carlo VaR</h2>
        </div>
        {/* The workspace renders the shared horizon seg above this card, so
            there is no control here. This span is the question being ASKED;
            each tile states the horizon its own figure ran over, which is a
            different thing while a re-run is in flight. */}
        <span>{horizonDays}-day horizon</span>
      </div>
      {/* Not decoration: a VaR without the horizon it answers over is the
          wrong number. */}
      <p className="sub">
        Simulated by Oracle 23ai: a <strong>terminal-value</strong> GBM VaR over the horizon, not
        the one-day book VaR on the VaR &amp; model section.
      </p>

      {/* One space-reserving box around EVERY state after the heading, the
          pre-model one included. The card used to swap a 96px skeleton for a
          ~190px result on each run, so a horizon change bounced whatever sat
          below it; and the waiting line used to sit OUTSIDE this box, so a
          Live/Sandbox toggle — which nulls `annualVol` while the covariance
          re-fetches — dropped the card to one sentence and sprang it back to
          192px a second later. No skeleton branch is left: its one honest job
          was the state with nothing at all to show, and the closed form took
          that job — a grey rectangle is less than a true number, dashed. */}
      <div style={{ minHeight: 192 }}>
        {annualVol === null ? (
          <p className="muted">
            Waiting for the covariance model: both figures need its measured volatility.
          </p>
        ) : sim === null && refusal !== null && !running ? (
          <div className="banner warn" role="status">
            <span aria-hidden>!</span>
            <div>
              <strong>Not computed.</strong> {refusal.error}
              {" "}The VaR &amp; model section&apos;s own figure is unaffected.
            </div>
          </div>
        ) : (
          <>
            {/* Every note reads the answer's ECHOED assumptions, never the
                current props: while a re-run is in flight the two differ, and a
                tile labelled with a horizon it did not run over is worse. */}
            <div className="tiles stability-tiles">
              <StatTile
                label="Oracle VaR 99" value={money(sim?.var99 ?? null)}
                tone={sim === null ? undefined : "neg"}
                note={sim === null ? "not computed yet; the database is simulating"
                  : `${sim.pathsUsed.toLocaleString()} paths over ${sim.assumptions.days} d`
                    + `${cached ? ", last completed run" : ""}`}
              />
              <StatTile
                label="Parametric VaR 99" value={money(sim === null ? requestedVar : clientVar)}
                note={sim === null
                  ? `closed form on the requested inputs, ${horizonDays} d, priced in this browser`
                  : "closed form, same GBM drift and volatility"}
              />
              <StatTile
                label="Divergence" tone={disagrees ? "neg" : undefined}
                value={divergence === null ? "—" : `${divergence > 0 ? "+" : ""}${fmt(divergence * 100, 1)}%`}
                note={sim === null ? "needs the simulated figure" : "simulated vs closed form"}
              />
              <StatTile
                label="Expected equity" value={money(sim?.expectedEquity ?? null)}
                note={sim === null ? "the simulation's mean terminal value"
                  : `mean terminal value; computed in ${sim.computedInMs} ms`}
              />
            </div>
            <p className="sub">
              {status}
              {sandbox && " Generated sandbox book, so the equity input is not a real position."}
            </p>
          </>
        )}
      </div>

      {/* The figure over time, in its own reserved box. Four tiles cannot show
          a value MOVING, only where it stopped; what moves here is this panel's
          own re-runs. Reserved for the same measured reason as the tiles — an
          unreserved chart would bounce everything below it on every re-run —
          and it holds its height whether it holds the chart, the measuring
          frame, or the sentence saying there is not yet a second observation. */}
      <div ref={chartRef} style={{ minHeight: ORACLE_TREND_RESERVE }}>
        {chartWidth > 0 && (
          <OracleVarTrend
            observations={observations}
            horizonDays={horizonDays}
            width={chartWidth}
          />
        )}
      </div>

      {/* The live figure the next run will stand on. The quantisation above is
          deliberate and stays — this spends database CPU and a VaR re-simulated
          on every poll is noise — but the card never said so, and a reader
          watching four figures hold still under a chrome claiming a live-pushed
          book read the whole tab as disconnected. */}
      <p className="sub oracle-var-live num">
        Book equity <NumberTicker value={equity} format={(value) => usd(value, 0)} />; the next
        simulation runs when it crosses into the next $1,000.
      </p>
    </div>
  );
}
