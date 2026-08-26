"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import NumberTicker from "@/components/common/NumberTicker";
import OracleVarTrend, {
  ORACLE_TREND_RESERVE, TREND_MAX_OBSERVATIONS, observationKey, type OracleVarObservation,
} from "@/components/risk/OracleVarTrend";
import StatTile from "@/components/StatTile";
import { fmt, usd } from "@/lib/format";
import { useOracleVarCadence } from "@/lib/oracle/use-var-cadence";
import {
  GBM_EXPECTED_ANNUAL_RETURN, ORACLE_CADENCE_S, ORACLE_DEADLINE_MS, ORACLE_REFUSED_CADENCE_S,
  VOL_BUCKET, type OracleVarOk, type OracleVarResponse, type OracleVarUnavailable,
} from "@/lib/oracle/var-request";
import { gbmTerminalVar99 } from "@/lib/portfolio-risk";

/**
 * A second, independent VaR — computed inside Oracle 23ai, not in this
 * browser. Two implementations of one accounting are two chances to be wrong
 * and one chance to notice, so a disagreement wider than the sampling error IS
 * the finding. They are not interchangeable, and the copy says so: this is a
 * terminal-value GBM VaR over a horizon, the client-side figure a one-day VaR
 * on the current book. An unreachable database is `unavailable`, never a zero —
 * "your risk is nil" is a different fact, and that is what the provider layer
 * is for.
 *
 * IT RE-RUNS ON A CADENCE, which is what this pass added. The only trigger was
 * a change of inputs: on the live book there are no positions, so no
 * volatility, so it had never once run; on the sandbox the generated book is
 * memoised on its seed, so it ran once and held that answer for the life of the
 * tab under a chrome claiming a live feed. The interval, its cost against the
 * Always-Free tier and why a repeat is a measurement are all argued in
 * `lib/oracle/var-request.ts`.
 */
export default function OracleVarPanel({
  equity, annualVol: measuredAnnualVol, sandbox, horizonDays, positionCount, live,
}: {
  equity: number;
  /** From the measured covariance model, so both figures share one input. */
  annualVol: number | null;
  sandbox: boolean;
  /** RiskWorkspace's shared horizon state, rendered as a seg above this card
   *  and above the bootstrap card on the Monte Carlo subtab. */
  horizonDays: number;
  /** Open positions. Read only to EXPLAIN a missing model: a flat book has no
   *  weights, so `annualVol` arrives null, indistinguishable at this boundary
   *  from a model still being measured. */
  positionCount: number;
  /** Whether this is the subtab on screen, and the gate on the cadence: eight
   *  stay mounted behind `display: none`, so an ungated loop would spend Oracle
   *  CPU on seven panels nobody is looking at. */
  live: boolean;
}) {
  /**
   * The last COMPLETED simulation, carried with the inputs it ran on.
   *
   * Two pieces of state rather than one `result`, and this was the reported
   * grey screen: `result === null || running` drew a skeleton, and `running`
   * covers a whole nine-second request. `DeskSourceMachine` states the doctrine
   * — a failed or in-flight poll demotes the payload to `cached` and keeps the
   * numbers — and this borrows its vocabulary rather than inventing a second.
   * The inputs travel with the answer because `cached` must mean something
   * exact: computed for THAT book and THOSE inputs. Under a cadence that stops
   * being a nicety — the card re-simulates twice a minute, so an answer that
   * did not survive its replacement would grey it twice a minute too.
   */
  const [held, setHeld] = useState<{ answer: OracleVarOk; key: string; sandbox: boolean } | null>(null);
  /** The most recent refusal: it describes the last ATTEMPT, never the figures
   *  on screen, which is why it is not in `held`. Cleared by success. */
  const [refusal, setRefusal] = useState<OracleVarUnavailable | null>(null);
  const [running, setRunning] = useState(false);
  /** Which scheduled tick the panel is answering. The cadence does not fetch;
   *  it bumps this, and the effect below — which already carries the
   *  supersede-and-abort discipline — treats a new tick as a new horizon: one
   *  code path, one cancellation rule. `tick` is the same number readable by
   *  `record` without joining its dependency list, which is the quantisation
   *  contract `risk-stability.test.ts` pins literally; a fourth name there
   *  would rebuild the recorder, and with it `run`, twice a minute for nothing.
   *  Reading it as the answer lands is correct, because a superseded run
   *  returns before it records. */
  const [runNonce, setRunNonce] = useState(0);
  const tick = useRef(0);
  /** Every completed request, in arrival order, drawn by the chart: the desk
   *  asked to see the figure MOVE and a tile shows only where it stopped. */
  const [observations, setObservations] = useState<OracleVarObservation[]>([]);
  /* SVG in user units, so the chart needs a real width; the box below reserves it. */
  // Quantised so a live book repolling every 15s does not re-simulate on every
  // equity tick — the restraint MonteCarloDistribution credits this panel with
  // sharing. A sub-$1,000 move does not move a 99th percentile read.
  const equityForRun = Math.round(equity / 1_000) * 1_000 || equity;
  // Bucketed, and it KEEPS THE PROP'S NAME on purpose: `annualVol` is the
  // identifier the run and record dependency lists carry, and those lists are
  // the quantisation contract `risk-stability.test.ts` pins literally. A new
  // name would leave the raw double in the deps: the defect VOL_BUCKET
  // describes, still shipping, with a constant beside it.
  const annualVol = measuredAnnualVol === null
    ? null : Math.round(measuredAnnualVol * VOL_BUCKET) / VOL_BUCKET;
  /** What is being asked for now, read against the held answer's own key on the
   *  first render after a change, before the effect has fired. */
  const requestKey = annualVol === null
    ? null : observationKey(equityForRun, annualVol, horizonDays);

  /**
   * One completed attempt, folded into the trend.
   *
   * Keyed on the inputs AND on the tick that asked for it; the second half is
   * this pass's correction. The key was the inputs alone, so a repeat at
   * unchanged inputs overwrote its own point, and a panel whose inputs never
   * change (a memoised sandbox book, a live book at rest) could re-run all
   * afternoon and still draw one dot. That is backwards:
   * `oracle/02_monte_carlo.sql` seeds nothing, so a repeat is an INDEPENDENT
   * draw whose spread is the sampling error the divergence tile prices.
   *
   * The tick still collapses one thing and only that: StrictMode double-invokes
   * the effect for a single tick, so both invocations carry one key and the
   * second replaces the first rather than claiming two observations of one
   * draw. It is the second guard — `run`'s abort discipline already stops the
   * superseded twin recording at all — and a genuine repeat is a later tick, so
   * it appends. An unavailable answer is recorded too, as a `null`: dropping it
   * would draw a continuous series across a database that was not answering.
   */
  const record = useCallback(
    (answer: OracleVarResponse) => {
      if (annualVol === null) return;
      const a = answer.state === "ok" ? answer.assumptions : null;
      const point: OracleVarObservation = {
        key: `${observationKey(equityForRun, annualVol, horizonDays)}@${tick.current}`,
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
    // saying the inputs or the tick changed under this request, and produces
    // nothing at all — no state, no observation. Without it a horizon changed
    // mid-flight leaves the old request free to land after the new one and
    // overwrite a newer answer, while asking an Always-Free ADB for two
    // 20,000-path runs at once.
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
      // A superseded run must not clear the flag: its replacement already set it.
      if (!superseded?.aborted) setRunning(false);
    }
  }, [annualVol, equityForRun, horizonDays, record, sandbox]);

  // The clock: gated on this being the subtab on screen and on there being a
  // model, slowed while the database refuses. It starts nothing itself; it
  // asks the effect below for one more run.
  useOracleVarCadence({
    enabled: live && annualVol !== null, refused: refusal !== null,
    onDue: () => setRunNonce((n) => n + 1),
  });

  // Runs once the volatility input exists, again when the horizon or bucketed
  // model changes, and again on every cadence tick. The cleanup cancels a
  // request whose inputs, or whose tick, no longer exist.
  useEffect(() => {
    tick.current = runNonce;
    const superseded = new AbortController();
    void run(superseded.signal);
    return () => superseded.abort();
  }, [run, runNonce]);

  // Live and Sandbox share no positions, so a held answer from across the
  // toggle is a reading of a different book: discarded, not demoted. The stamp
  // is taken inside `run`, where it describes the book the REQUEST was issued
  // for — read at landing time it would caption a live answer as sandbox the
  // moment someone toggled.
  const sim = held !== null && held.sandbox === sandbox ? held.answer : null;
  /**
   * The parametric comparison prices the SAME model the database simulates —
   * the lognormal terminal quantile, same drift, same volatility, same 365-day
   * year — so the only thing left between the two is sampling error, which is
   * what the divergence tile measures. It reads the response's ECHOED
   * assumptions, not this component's request: the route clamps, and a clamped
   * input read against the unclamped original reads as method disagreement.
   */
  const assumptions = sim?.assumptions ?? null;
  const clientVar = assumptions === null ? null
    : gbmTerminalVar99(assumptions.equity, assumptions.mu, assumptions.sigma, assumptions.days);

  /** The same closed form on the inputs about to be REQUESTED. This is what
   *  makes the card instant while staying honest: pure arithmetic in this
   *  browser, on screen before the database has been asked. It is deliberately
   *  NOT `clientVar` and must never become the divergence baseline, for the
   *  reason above — it prices the inputs unclamped. */
  const requestedVar = annualVol === null ? null
    : gbmTerminalVar99(equityForRun, GBM_EXPECTED_ANNUAL_RETURN, annualVol, horizonDays);
  // `clientVar > 0` is the division guard, not zero-coercion: both formulae
  // floor at zero under an extreme drift, and a ratio against that floor would
  // be noise, so the tile renders the dash instead.
  const divergence = sim !== null && clientVar !== null && clientVar > 0
    ? (sim.var99 - clientVar) / clientVar : null;
  const disagrees = divergence !== null && Math.abs(divergence) > 0.15;
  /** `lib/data-tier`'s word for what is on screen: returned earlier, carried with what it ran on. */
  const cached = sim !== null && (running || refusal !== null || held?.key !== requestKey);
  const ranOn = sim === null ? "" : `${usd(sim.assumptions.equity, 0)} over ${sim.assumptions.days} d`;
  /** The cadence the chart is fed at, null when nothing is scheduled: no model,
   *  or this is not the panel on screen. The chart says which, in words. */
  const everySeconds = !live || annualVol === null ? null
    : refusal !== null ? ORACLE_REFUSED_CADENCE_S : ORACLE_CADENCE_S;
  /** A dash, never a zero. A floored VaR is a real $0, so this tests null. */
  const money = (value: number | null) => (value === null ? "—" : usd(value, 0));
  /** One sentence in one slot, so a change of state changes the words and not
   *  the height: a banner appearing here would displace the chart below. */
  const status = sim === null
    ? "Simulating 20,000 paths in the database, which takes seconds. The parametric figure beside "
      + "it is priced in this browser and is already final."
    : refusal !== null ? `Not refreshed: ${refusal.error}`
      + ` The figures above are the last completed simulation, ${ranOn}, kept rather than blanked.`
      + ` Retrying every ${ORACLE_REFUSED_CADENCE_S} seconds until it answers.`
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
            each tile states the horizon its own figure ran over. */}
        <span>{horizonDays}-day horizon</span>
      </div>
      {/* Not decoration: a VaR without its horizon is the wrong number. */}
      <p className="sub">
        Simulated by Oracle 23ai: a <strong>terminal-value</strong> GBM VaR over the horizon, not
        the one-day book VaR on the Risk engine section.
      </p>

      {/* One space-reserving box around EVERY state after the heading, the
          pre-model one included. The card used to swap a 96px skeleton for a
          ~190px result on each run, and the waiting line used to sit OUTSIDE
          this box, so a Live/Sandbox toggle — which nulls `annualVol` while the
          covariance re-fetches — dropped the card to one sentence and sprang
          back to 192px a second later. No skeleton branch is left: a grey
          rectangle is strictly less than a true number, dashed. */}
      <div style={{ minHeight: 192 }}>
        {annualVol === null ? (
          /* Two absences, two sentences. A flat book and a model still being
             measured both arrive as `annualVol === null`, and the panel answered
             both with the waiting line — which on the live book, where there are
             no positions until someone trades, is a promise that never resolves.
             The reader is owed the named cause, and that it is not a fault. */
          <p className="muted">
            {positionCount === 0
              ? "Nothing to simulate: this book holds no open position, so the covariance model "
                + "has no weights to measure and neither figure has a volatility to stand on. "
                + "That is the correct reading of a flat book rather than a fault, and no "
                + "request is sent while it holds. Switch the book source above to the sandbox "
                + "to watch the simulation run."
              : "Waiting for the covariance model: both figures need its measured volatility."}
          </p>
        ) : sim === null && refusal !== null && !running ? (
          <div className="banner warn" role="status">
            <span aria-hidden>!</span>
            <div>
              <strong>Not computed.</strong> {refusal.error}
              {" "}The Risk engine section&apos;s own figure is unaffected.
            </div>
          </div>
        ) : (
          <>
            {/* Every note reads the answer's ECHOED assumptions, never the
                current props: while a re-run is in flight the two differ, and a
                tile labelled with a horizon it did not run over is worse than
                a stale one. */}
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
          own re-runs, and because the procedure seeds nothing a repeat at
          unchanged inputs is a fresh draw. Reserved so it holds its height
          whether it holds the chart, the measuring frame, or the sentence
          saying what it is waiting for. */}
      {/* The observer went with the prop: `Plot` measures its own box. */}
      <div style={{ minHeight: ORACLE_TREND_RESERVE }}>
        {observations.length > 0 && (
          <OracleVarTrend
            observations={observations}
            horizonDays={horizonDays}
            everySeconds={everySeconds}
          />
        )}
      </div>

      {/* The live figure the next run stands on, and the two things that start
          one. The quantisation stays — a VaR re-simulated on every 15s poll is
          noise — but it was for a long time the ONLY trigger, which is how a
          card under a chrome claiming a live-pushed book held four figures
          still for the life of a tab. The cadence sentence reads `everySeconds`
          rather than the healthy constant, so a card that is retrying slowly,
          or not running at all, cannot promise a rate it is not keeping. */}
      <p className="sub oracle-var-live num">
        Book equity <NumberTicker value={equity} format={(value) => usd(value, 0)} />; the next
        simulation runs when it crosses into the next $1,000.
        {everySeconds === null
          ? " Nothing else is scheduled: this panel simulates only while it is the section on "
            + "screen with a volatility model to run against."
          : ` It re-runs every ${everySeconds} seconds besides, so the trend below accumulates `
            + "independent draws rather than holding one answer."}
      </p>
    </div>
  );
}
