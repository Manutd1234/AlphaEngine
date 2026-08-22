/**
 * What one in-database VaR request IS: its shape, its budget, and how often it
 * may be asked for.
 *
 * Extracted from `components/portfolio/OracleVarPanel.tsx`, which sat one line
 * under the 400-line ceiling and could not take the cadence this pass adds.
 * The split is not arbitrary: everything here describes the REQUEST — the
 * response contract, the deadline it is bounded by, the drift it runs on, the
 * quantisation of its inputs and its repeat rate — while the panel keeps the
 * rendering and the honesty vocabulary. `lib/oracle/use-var-cadence.ts` is the
 * loop that reads the two intervals below; it is a separate module because it
 * needs React and this one deliberately does not.
 */

export interface OracleVarOk {
  state: "ok";
  var99: number; expectedEquity: number; pathsUsed: number; computedInMs: number;
  assumptions: { equity: number; mu: number; sigma: number; days: number; model: string };
}
export interface OracleVarUnavailable { state: "unavailable"; code: string; error: string }
export type OracleVarResponse = OracleVarOk | OracleVarUnavailable;

/**
 * Longer than the gateway's 2.5s, and not `probeGateway`: 20,000 in-database
 * paths take seconds, so the shared budget would abort work about to succeed,
 * while unbounded let a stopped Always-Free ADB hold this panel on "running"
 * for ever. `probeGateway` coalesces by URL, so two horizons would be served
 * each other's answer.
 */
export const ORACLE_DEADLINE_MS = 9000;

/**
 * The drift the simulation runs on: a modelled 8% expected annual return. One
 * named constant, sent to the procedure and read BACK off the echoed
 * assumptions by the panel's comparison, so the two figures cannot quietly run
 * on different drifts. That was the defect: the request carried this 8% inline
 * while the comparison was the zero-drift z99·σ·√t shortcut, and at 30 days
 * the drift term alone read as a −22% "divergence".
 */
export const GBM_EXPECTED_ANNUAL_RETURN = 0.08;

/**
 * Volatility is bucketed to a basis point before anything is keyed on it.
 *
 * The panel's equity quantisation was half a restraint, and alone it achieved
 * nothing. `annualVol` arrives as √(wᵀΣw)·√ann with weights w = signedNotional
 * ÷ equity, so a poll that moves a mark or the equity by a cent yields a new
 * double, `run` takes a new identity, and the effect fires another nine-second
 * simulation. That is why the card was reported as permanently grey: the
 * comment claimed a re-run on a model or horizon change while the arithmetic
 * delivered one every fifteen seconds.
 *
 * Measured against the closed form, and re-measured on every run by
 * `oracle-var-freshness.test.ts` rather than trusted here: a basis point of σ
 * moves this VaR by 0.014% at σ = 0.60 over 30 days, and by 0.004–0.040%
 * anywhere in σ ∈ [0.25, 1.2] over 1 to 90 days, while the simulation it feeds
 * locates the 1st percentile only to 0.43–1.12% at 20,000 paths — the sample
 * quantile's own standard error, √(p(1−p)/n) ÷ f(q). The bucket stays an order
 * of magnitude inside the noise of what it feeds. The rejected alternative,
 * debouncing on a timer, trades a wrong number for a late one.
 *
 * The bucket is what stops an INPUT TICK re-simulating. It is not, and never
 * was, what stops the panel re-running at all: that is the cadence below, and
 * conflating the two is what left this card frozen for the life of a tab.
 */
export const VOL_BUCKET = 10_000;

/**
 * How often the panel asks the database the SAME question again.
 *
 * WHY A REPEAT AT UNCHANGED INPUTS IS A MEASUREMENT
 * ------------------------------------------------------------------------
 * `oracle/02_monte_carlo.sql` draws `DBMS_RANDOM.NORMAL` with no SEED and
 * persists nothing, so every call is an independent 20,000-path draw of the
 * same distribution. Re-running on unchanged inputs therefore does not return
 * the previous answer with noise on it; it returns a fresh estimate whose
 * spread IS the sampling error the divergence tile prices. Reimplemented and
 * measured over 300 repeats: sd 1.11% of the figure at 1 day, 0.98% at 30,
 * 0.83% at 90. That is a visibly moving line, which is what the desk asked for
 * twice and what a panel keyed only on its inputs could never show.
 *
 * THE ARITHMETIC BEHIND 30 SECONDS
 * ------------------------------------------------------------------------
 * The cadence is NOT "as fast as the database can answer". Two numbers bound
 * it and they meet near half a minute:
 *
 *   - Cost. 2 runs a minute, 120 an hour, and a run is ~230 ms of database
 *     work (measured; the procedure draws one terminal value per path, so a
 *     90-day request costs no more than a 1-day one). 120 × 0.23 s = 27.6 s of
 *     database CPU per hour — 0.77% of the single always-available OCPU an
 *     Always-Free Autonomous Database provides. There is no per-request quota
 *     on that tier; CPU and the seven-day idle auto-stop are the real limits,
 *     and this spends under one percent of the first.
 *   - Legibility. The trend keeps 40 observations (`TREND_MAX_OBSERVATIONS`),
 *     which at this cadence is exactly twenty minutes of history in a 640-px
 *     plot. Ten seconds would fill the same plot with under seven minutes and
 *     triple the spend to show the same sd; two minutes would make a reader
 *     wait four minutes for the second point that turns a dot into a line.
 *
 * Both numbers are spent only while someone is looking: the panel gates the
 * loop on being the ACTIVE subtab, and `PollingController` pauses on a hidden
 * document. Eight subtabs stay mounted behind `display: none` for the life of
 * the workspace, so an ungated timer would have multiplied the figures above
 * by the number of panels a reader had ever opened.
 */
export const ORACLE_CADENCE_MS = 30_000;

/**
 * The cadence while the last attempt was refused, four times slower.
 *
 * A stopped Always-Free ADB fails at the 9s deadline, so the healthy cadence
 * would keep a request in flight a third of the time and buy 120 identical
 * refusals an hour. 30 attempts an hour still notices a database coming back
 * inside two minutes, which is the only thing this retry is for.
 *
 * REJECTED: `PollingController`'s own geometric backoff. It escalates on a
 * REJECTED tick, and this panel's `run` deliberately resolves on a refusal —
 * recording it as a null observation is the point, and throwing instead would
 * either lose that record or surface as an unhandled rejection in the effect
 * that also calls `run`. One honest step, named, beats a curve the loop cannot
 * actually see.
 */
export const ORACLE_REFUSED_CADENCE_MS = 120_000;

/** Seconds, for the copy that has to say the cadence out loud. Derived, never
 *  re-typed: a card promising a re-run "every 30 seconds" beside a loop set to
 *  45 is a lie no test would catch. */
export const ORACLE_CADENCE_S = Math.round(ORACLE_CADENCE_MS / 1000);
export const ORACLE_REFUSED_CADENCE_S = Math.round(ORACLE_REFUSED_CADENCE_MS / 1000);
