"use client";

/**
 * The Oracle VaR, moving.
 *
 * WHAT THIS IS A CHART OF, PRECISELY
 * ------------------------------------------------------------------------
 * Not a time series of risk. A series of THIS PANEL'S OWN RE-RUNS: one point
 * per distinct set of inputs the in-database simulation has been asked for
 * since the tab was opened. The distinction matters because the figure is a
 * terminal-value GBM VaR over a forward horizon, and the panel's copy is
 * careful to keep that apart from the one-day book VaR on the Risk engine
 * section. A chart that put those on one axis would undo that sentence, so
 * this one draws only the two figures that ARE comparable — the database's
 * simulated quantile and the closed form priced on the assumptions the
 * database echoed back — and the caption says what an observation is.
 *
 * WHY A REPEAT AT UNCHANGED INPUTS IS A POINT, NOT A DUPLICATE
 * ------------------------------------------------------------------------
 * This series used to be keyed on the inputs alone, so a re-run that asked the
 * same question overwrote its own point. That reading of "one observation, one
 * fact" was wrong about what the fact IS. `oracle/02_monte_carlo.sql` draws
 * `DBMS_RANDOM.NORMAL` with no SEED and persists nothing, so every call is an
 * independent 20,000-path draw: the answer to a repeated question is new
 * information, and the spread across repeats is the sampling error the panel's
 * divergence tile exists to price. Measured over 300 repeats of the procedure,
 * sd 1.11% of the figure at 1 day, 0.98% at 30, 0.83% at 90 — a visibly moving
 * line, and the reason the panel now re-runs on a cadence at all.
 *
 * What must still not happen is a chart inventing history, which is the failure
 * `EquityCurve` documents for its own backfill. React's StrictMode
 * double-invokes effects in development, so the panel keys each point on the
 * inputs AND on the cadence tick that asked for it: one tick's two invocations
 * fold together, a later tick appends. The panel's abort discipline already
 * stops the superseded twin recording at all; the key is the second guard.
 *
 * WHY ONLY THE CURRENT HORIZON IS DRAWN
 * ------------------------------------------------------------------------
 * A terminal-value VaR over 90 days and one over 1 day are different
 * measurements, not two readings of the same one; joining them with a line
 * would draw a jump in risk where only the question changed. Points at other
 * horizons are kept but not plotted, and the caption says how many are being
 * held back and why.
 *
 * ABSENCE
 * ------------------------------------------------------------------------
 * A run that could not compute a figure contributes a point whose value is
 * `null`. `linePath` breaks at nulls rather than bridging them, so the gap is
 * drawn as a gap and keeps its width; the foot of the plot carries a tick for
 * each one and the caption counts them. Nothing is ever plotted at zero to
 * stand in for a measurement that does not exist.
 */

import { DEFAULT_MARGIN, extent, linePath, linearScale, ticks, Grid, AnimatedPath } from "@/components/chart-kit";
import Figure, { Plot } from "@/components/coherence/Figure";
import { usd } from "@/lib/format";

/**
 * The identity of one REQUEST: the inputs a simulation stands on.
 *
 * Exported and used at every site that needs it, because the panel needs the
 * same string for two different jobs — the base of each observation's key, and
 * the test of whether the answer it is holding on screen still belongs to the
 * request it is showing a horizon for. Two hand-written templates that must
 * agree is one too many, and the failure would be silent: a key that drifted by
 * a space would mark a fresh answer as cached without erroring.
 *
 * It is the base of an observation's key and not the whole of it. The panel
 * suffixes the cadence tick, so a repeat at unchanged inputs is its own point.
 *
 * The volatility term arrives already bucketed by the panel — see its
 * `VOL_BUCKET` note. An unbucketed sigma here would make every book poll a new
 * key, which is the defect that comment records.
 */
export const observationKey = (equity: number, annualVol: number, horizonDays: number) =>
  `${equity}|${annualVol}|${horizonDays}`;

/** One completed attempt, whether or not it produced a figure. */
export interface OracleVarObservation {
  /**
   * `observationKey`'s `equity|sigma|days`, suffixed by the cadence tick that
   * asked for this draw. Unique per completed run, which is what lets repeats
   * at unchanged inputs accumulate; the suffix folds only StrictMode's twin.
   */
  key: string;
  at: number;
  horizonDays: number;
  /** The quantised equity the simulation actually stood on. */
  equity: number;
  /** Null when the database did not answer. Never zero for "unknown". */
  var99: number | null;
  /** The closed form over the same echoed assumptions. Null when there are none. */
  clientVar: number | null;
}

/**
 * How many observations the series keeps.
 *
 * Lives here, with the chart that draws them, rather than beside the panel's
 * fetch: it is a statement about what this plot can honestly show. A cap
 * rather than an unbounded array because the panel stays mounted for as long
 * as the tab is open, and forty is what the 640-px plot can render as
 * distinguishable marks. Against the panel's 30-second cadence that is exactly
 * twenty minutes of history — the window the two numbers were chosen to meet
 * at, argued in `lib/oracle/var-request.ts`. Beyond it the oldest point leaves,
 * and the caption counts what is DRAWN, so the chart never claims history it
 * has dropped.
 */
export const TREND_MAX_OBSERVATIONS = 40;

const HEIGHT = 132;
/** Height of the not-computed rug at the foot of the plot. */
const RUG = 5;
/** The reserved box, so a re-run repaints the chart and never moves the card. */
export const ORACLE_TREND_RESERVE = 156;

export default function OracleVarTrend({
  observations,
  horizonDays,
  everySeconds = null,
}: {
  observations: OracleVarObservation[];
  horizonDays: number;
  /**
   * Seconds between re-runs, or null when none is scheduled.
   *
   * The chart is a record of re-runs, so "how often does one happen" is the
   * one fact that turns every state here from a shrug into an answer: a plot
   * with nothing on it can say when its first point arrives, and a plot with
   * one point can say when it becomes a line. Passed rather than imported so
   * this component states the cadence the PANEL is actually running at —
   * slowed while the database refuses, stopped when this is not the section on
   * screen — instead of the healthy constant in every state.
   */
  everySeconds?: number | null;
}) {
  const shown = observations.filter((o) => o.horizonDays === horizonDays);
  const held = observations.length - shown.length;
  const heldNote = held > 0
    ? ` ${held} more answered a different horizon and are not on one scale with these.`
    : "";
  const missing = shown.filter((o) => o.var99 === null).length;

  /**
   * Nothing at THIS horizon, which is not the same as nothing at all.
   *
   * This was the reported defect and it is worth naming precisely. The reader
   * changes the horizon; the tiles above stay populated, because the panel
   * holds its last completed answer across a re-run by design; but `shown` is
   * filtered to the horizon being asked about, and until a run lands at the new
   * one it is empty. The branch then returned a single quiet line inside a
   * 156px reserve — no legend, no axis, no caption — so a card that was working
   * perfectly read as a broken box. The 1-observation case never looked broken
   * because its caption explains itself, and the fix is to hold this state to
   * the same standard: say what is missing, why, and what will end it.
   */
  if (shown.length === 0) {
    return (
      <p className="muted">
        No completed run at the {horizonDays}-day horizon yet, so there is no trend to draw.
        {everySeconds === null
          ? " No re-run is scheduled either: this panel simulates only while it is the section"
            + " on screen and has a measured volatility to run against."
          : ` The next re-run lands within ${everySeconds} seconds and draws the first point;`
            + " a line needs two, so the one after it draws the line."}
        {heldNote}
      </p>
    );
  }

  // Every attempt at this horizon failed. `extent` falls back to [0, 1] on an
  // all-null series, which would draw a dollar axis running from $0 to $1 — a
  // fabricated scale under a chart with no data on it. Reported instead.
  if (shown.every((o) => o.var99 === null && o.clientVar === null)) {
    return (
      <p className="muted">
        {shown.length} run{shown.length === 1 ? "" : "s"} at the {horizonDays}-day horizon, none of
        which returned a figure, so there is no scale to draw them on.
        {everySeconds === null ? "" : ` Retrying every ${everySeconds} seconds; the first answer`
          + " draws the axis with it."}
        {heldNote}
      </p>
    );
  }

  const m = DEFAULT_MARGIN;
  const x0 = m.left;
  const y0 = HEIGHT - m.bottom;
  const y1 = m.top;

  // Both series enter the extent. A closed form that sits well away from the
  // simulated quantile is the finding this panel exists to surface, so it must
  // be on screen rather than clipped to flatter the agreement.
  const [lo, hi] = extent([...shown.map((o) => o.var99), ...shown.map((o) => o.clientVar)]);
  const yScale = linearScale(lo, hi, y0, y1);

  const latest = shown[shown.length - 1];
  // Data identity, never width: `AnimatedPath` replays its draw when this
  // changes, and keying on a measured width would replay it on every resize.
  const drawKey = `${shown.length}-${latest.at}`;

  return (
    <div className="oracle-var-trend">
      <div className="legend">
        <span>
          <i style={{ background: "var(--series-1)" }} aria-hidden /> Simulated in Oracle 23ai
        </span>
        <span>
          <i style={{ background: "var(--text-muted)" }} aria-hidden /> Closed form, dashed
        </span>
        {missing > 0 && (
          <span>
            <i style={{ background: "var(--critical-text)" }} aria-hidden /> Not computed
          </span>
        )}
      </div>
      {/* Through `Figure` and `Plot` since 2026-08-26. The points carried their
          readings in `<title>` — including the ones that could not be computed,
          which is the reading that matters — and a `<title>` is reachable with
          a mouse and by nothing else. */}
      <Figure
        caption={`Terminal-value 99% VaR over ${horizonDays} days, simulated against the closed form`}
        ariaLabel={
          `Terminal-value 99% value-at-risk over a ${horizonDays}-day horizon across `
          + `${shown.length} re-run${shown.length === 1 ? "" : "s"} of this panel, simulated against `
          + `the closed form. ${missing} could not be computed. Latest simulated `
          + `${latest.var99 === null ? "not computed" : usd(latest.var99, 0)}.`
        }
        reading="The dashed line is the analytic answer; the question is how far the simulation sits from it, and the dash says which one is analytic without relying on colour."
        missing={missing > 0 ? `${missing} of ${shown.length} re-runs could not be computed, and are drawn as gaps rather than as zero.` : null}
      >
        <Plot height={HEIGHT}>
          {(measured) => {
            // Everything downstream of the right edge follows the measured
            // width, so it all belongs to the plot.
            const x1 = Math.max(x0 + 40, measured - m.right);
            const xScale = linearScale(0, Math.max(1, shown.length - 1), x0, x1);
            const oraclePoints = shown.map((o, i) => ({ x: xScale(i), y: o.var99 === null ? null : yScale(o.var99) }));
            const clientPoints = shown.map((o, i) => ({ x: xScale(i), y: o.clientVar === null ? null : yScale(o.clientVar) }));
            return (
              <>
        <Grid yTicks={ticks(lo, hi, 3)} yScale={yScale} x0={x0} x1={x1} format={(v) => usd(v, 0)} />

        {/* The closed form first and dashed, so the simulated line reads on
            top of it: the panel's question is how far the simulation sits from
            the analytic answer, and the dash says which one is analytic
            without relying on the colour to carry it. */}
        <path
          d={linePath(clientPoints)}
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
        <AnimatedPath
          drawKey={drawKey}
          d={linePath(oraclePoints)}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={1.75}
          strokeLinecap="round"
        />

        {/* Every observation gets a mark, so a single re-run is a point rather
            than an invisible line of length zero — and so a reader can count
            the observations on the chart instead of trusting the caption. */}
        {shown.map((o, i) =>
          o.var99 === null ? (
            <line
              key={o.key}
              x1={xScale(i)}
              x2={xScale(i)}
              y1={y0}
              y2={y0 - RUG}
              stroke="var(--critical-text)"
              strokeWidth={1.5}
              shapeRendering="crispEdges"
            >
              <title>Run {i + 1}: the database did not answer.</title>
            </line>
          ) : (
            <circle
              key={o.key}
              cx={xScale(i)}
              cy={yScale(o.var99)}
              r={i === shown.length - 1 ? 3.2 : 2}
              fill="var(--series-1)"
              stroke="var(--surface-1)"
              strokeWidth={1.25}
            >
              <title>
                Run {i + 1} on {usd(o.equity, 0)} of equity: {usd(o.var99, 0)}
              </title>
            </circle>
          ),
        )}
              </>
            );
          }}
        </Plot>
      </Figure>
      {/* The series says how much history it holds, in words, every time. A
          two-point line and a forty-point line look the same at a glance and
          mean very different things. */}
      <p className="sub num">
        {shown.length} observation{shown.length === 1 ? "" : "s"} of this panel re-running, oldest
        left{shown.length === 1 ? "; a line needs two, so the next re-run draws one" : ""}.
        {/* The cadence, and what a repeat at unchanged inputs means. Without
            the second half a reader watching the line wobble on a book that has
            not moved would reasonably read it as a bug in the panel; it is the
            Monte Carlo's own sampling error, which is the quantity the
            divergence tile above is measured against. */}
        {everySeconds !== null && ` One every ${everySeconds} seconds while this section is on `
          + "screen, and the simulation seeds nothing, so a repeat on unchanged inputs is an "
          + "independent draw: the spread between these points is its sampling error."}
        {missing > 0 && ` ${missing} could not be computed and are drawn as gaps, never as zero.`}
        {heldNote}
      </p>
    </div>
  );
}
