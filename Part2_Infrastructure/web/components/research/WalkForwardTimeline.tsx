"use client";

/**
 * Walk-forward, fold by fold.
 *
 * The aggregate says `-0.87` and stops. That single number cannot distinguish
 * three completely different diagnoses: an edge that decayed steadily as the
 * market changed, an edge that was fine until one regime destroyed it, and an
 * edge that was never there and got lucky in-sample. Each implies a different
 * next experiment, so the folds are drawn side by side.
 *
 * Two design choices carry most of the meaning:
 *
 *  - **IS and OOS share one axis.** The gap between the paired bars *is* the
 *    overfitting, measured in the units the researcher already reads. Separate
 *    axes would let a fold that fell from 3.0 to 0.2 look like one that fell
 *    from 0.4 to 0.3.
 *  - **Efficiency is blank when in-sample lost money.** OOS ÷ IS with a negative
 *    denominator returns a positive ratio for a fold that lost in both windows,
 *    which reads as success. Those folds show a dash and are excluded from the
 *    median rather than being allowed to flatter it.
 */

import { fmt, pct } from "@/lib/format";
import { DEFAULT_MARGIN, Grid, extent, linearScale, ticks } from "@/components/chart-kit";
import Figure, { Plot } from "@/components/coherence/Figure";
import FoldLadder from "@/components/research/FoldLadder";
import type { WalkForwardReport } from "@/lib/types";

const LEVEL_TONE: Record<string, string> = {
  pass: "var(--success-text)",
  marginal: "var(--warning-text)",
  fail: "var(--critical-text)",
};

const LEVEL_GLYPH: Record<string, string> = { pass: "✓", marginal: "▲", fail: "✕" };

export default function WalkForwardTimeline({ report }: { report: WalkForwardReport }) {
  const folds = report.folds;

  if (!folds.length) {
    return (
      <div className="card">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Generalisation</span>
            <h2>Walk-forward timeline</h2>
          </div>
        </div>
        <p className="sub">
          Not enough bars to split into training and testing windows. Increase history depth or
          reduce the fold count.
        </p>
      </div>
    );
  }

  const height = 190;
  const m = { ...DEFAULT_MARGIN, right: 16, left: 46, bottom: 34 };
  const x0 = m.left;
  const y0 = height - m.bottom;
  const y1 = m.top;

  const values = folds.flatMap((f) => [f.isSharpe, f.oosSharpe]);
  const [lo, hi] = extent([...values, 0]);
  const yScale = linearScale(lo, hi, y0, y1);
  const yTicks = ticks(lo, hi, 4);
  const zero = yScale(0);


  return (
    <div className="card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Generalisation</span>
          <h2>Walk-forward timeline</h2>
        </div>
        {/* The fold count is the verdict's first clause below and its own tile. */}
      </div>

      <div
        className="stability-verdict"
        style={{ borderLeftColor: LEVEL_TONE[report.verdict.level] }}
        role="status"
      >
        <strong style={{ color: LEVEL_TONE[report.verdict.level] }}>
          <span aria-hidden>{LEVEL_GLYPH[report.verdict.level]}</span> {report.verdict.headline}
        </strong>
        <p>{report.verdict.detail}</p>
      </div>

      {/* At desk width the chart and its four gauge tiles share a row
          (14c-density-research.css); below the breakpoint both wrappers are
          unstyled divs and the stack reads exactly as before. DOM order is
          unchanged: legend, chart, tiles. */}
      <div className="walkforward-flank">
      <div className="walkforward-chart">
      <div className="legend" style={{ marginBottom: 6 }}>
        <span>
          <i style={{ background: "var(--series-1)" }} aria-hidden /> In-sample (parameters fitted here)
        </span>
        <span>
          <i style={{ background: "var(--series-2)" }} aria-hidden /> Out-of-sample (blind)
        </span>
      </div>

      {/* Through `Figure` and `Plot` since 2026-08-26, and the first instrument
          on this tab — Research drew five SVGs and none of them could be read
          by anything but a mouse. Each fold's pair carries its own words, so
          the question this figure exists to answer, "did it hold out of
          sample", is now answerable one fold at a time from a keyboard. */}
      <Figure
        caption={`In-sample against out-of-sample Sharpe, ${folds.length} folds`}
        ariaLabel={`In-sample and out-of-sample Sharpe for ${folds.length} walk-forward folds`}
        reading="The pair is the point: in-sample is what the fit saw, out-of-sample is what it did not, and the gap between them is what the walk-forward is measuring."
      >
        <Plot height={height}>
          {(measured) => {
            const x1 = Math.max(x0 + 40, measured - m.right);
            const slot = (x1 - x0) / folds.length;
            const barW = Math.max(4, Math.min(26, slot / 2.6));
            return (
              <>
          <Grid yTicks={yTicks} yScale={yScale} x0={x0} x1={x1} format={(v) => fmt(v, 1)} />
          {/* The zero line is the one that matters here, so it is drawn on top of
              the grid rather than being one hairline among several. */}
          <line
            x1={x0}
            x2={x1}
            y1={zero}
            y2={zero}
            stroke="var(--axis)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />

          {folds.map((f, i) => {
            const centre = x0 + slot * (i + 0.5);
            const isX = centre - barW - 1;
            const oosX = centre + 1;
            // THE MARK, and without it this figure had none: `Plot` walks
            // elements carrying their own `<title>`, and a chart of bars with
            // no words is a shape a reader cannot get a number off by any
            // means but a hover that shows nothing.
            const bar = (x: number, v: number, fill: string, which: string) => {
              const top = Math.min(yScale(v), zero);
              const h = Math.max(1, Math.abs(yScale(v) - zero));
              return (
                <rect x={x} y={top} width={barW} height={h} fill={fill} rx={2}>
                  <title>{`Fold ${f.fold} ${which}: Sharpe ${fmt(v, 2)}, on ${f.chosenFast}/${f.chosenSlow}`}</title>
                </rect>
              );
            };
            return (
              <g key={f.fold}>
                {bar(isX, f.isSharpe, "var(--series-1)", "in-sample")}
                {bar(oosX, f.oosSharpe, "var(--series-2)", "out-of-sample, blind")}
                <text
                  x={centre}
                  y={height - m.bottom + 14}
                  textAnchor="middle"
                  fontSize={13}
                  fontFamily="var(--mono)"
                  fill="var(--text-muted)"
                >
                  {f.fold}
                </text>
                <text
                  x={centre}
                  y={height - m.bottom + 27}
                  textAnchor="middle"
                  fontSize={10}
                  fontFamily="var(--mono)"
                  fill="var(--text-muted)"
                >
                  {f.chosenFast}/{f.chosenSlow}
                </text>
              </g>
            );
          })}
              </>
            );
          }}
        </Plot>
      </Figure>

      {/* The sharper question, under the Sharpe pair: not "did the number
          hold" but "where did the choice PLACE among every combination the
          fold scored". Same folds, one derivation each. */}
      <FoldLadder folds={folds} />
      </div>

      <div className="tiles stability-tiles">
        <div className="stability-tile">
          <span>Median efficiency</span>
          <strong
            className="num"
            style={{
              color:
                report.medianEfficiency === null
                  ? "var(--text-primary)"
                  : report.medianEfficiency >= 0.5
                    ? "var(--success-text)"
                    : "var(--critical-text)",
            }}
          >
            {report.medianEfficiency === null ? "—" : fmt(report.medianEfficiency, 2)}
          </strong>
          <small>OOS Sharpe ÷ IS Sharpe</small>
        </div>
        <div className="stability-tile">
          <span>Profitable folds</span>
          <strong className="num">
            {report.positiveFolds}/{report.totalFolds}
          </strong>
          <small>positive out-of-sample</small>
        </div>
        <div className="stability-tile">
          <span>Parameter persistence</span>
          <strong className="num">
            {report.parameterPersistence === null
              ? "—"
              : `${Math.round(report.parameterPersistence * 100)}%`}
          </strong>
          <small>folds re-picking the previous choice</small>
        </div>
        <div className="stability-tile">
          <span>Overfit probability</span>
          <strong
            className="num"
            style={{
              color:
                report.overfittingProbability === null
                  ? "var(--text-primary)"
                  : report.overfittingProbability > 0.5
                    ? "var(--critical-text)"
                    : report.overfittingProbability > 0.25
                      ? "var(--warning-text)"
                      : "var(--success-text)",
            }}
          >
            {report.overfittingProbability === null
              ? "—"
              : `${Math.round(report.overfittingProbability * 100)}%`}
          </strong>
          {/* Not "how often the strategy lost" — how often the *winner picked
              in-sample* landed in the worse half of the same grid out-of-sample.
              Above 50% the search is selecting noise. */}
          <small>folds where the pick ranked below median OOS</small>
        </div>
      </div>
      </div>

      {/* The one per-fold table on this tab. A second card below it used to
          repeat five of these columns for the same folds under its own
          heading; `FoldEfficiency extends WalkForwardFold`, so the two
          columns it alone carried — the train window and the OOS return —
          simply live here now. */}
      <div className="table-wrap" tabIndex={0}>
        <table>
          <caption className="sr-only">
            Walk-forward results, one row per fold.
          </caption>
          <thead>
            <tr>
              <th scope="col">Fold</th>
              <th scope="col">Train window</th>
              <th scope="col">Test window</th>
              <th scope="col">Params</th>
              <th scope="col">Drift</th>
              <th scope="col">IS Sharpe</th>
              <th scope="col">OOS Sharpe</th>
              <th scope="col">OOS return</th>
              <th scope="col">Efficiency</th>
            </tr>
          </thead>
          <tbody>
            {folds.map((f) => (
              <tr key={f.fold}>
                <td>{f.fold}</td>
                <td className="research-window muted">
                  {f.trainStart} → {f.trainEnd}
                </td>
                <td className="research-window">
                  {f.testStart} → {f.testEnd}
                </td>
                <td>
                  {f.chosenFast}/{f.chosenSlow}
                </td>
                <td>
                  {f.paramDrift === null ? (
                    <span className="muted">—</span>
                  ) : f.paramDrift === 0 ? (
                    <span className="muted">held</span>
                  ) : (
                    `${f.paramDrift} step${f.paramDrift === 1 ? "" : "s"}`
                  )}
                </td>
                <td className="num">{fmt(f.isSharpe, 2)}</td>
                <td className={f.oosSharpe >= 0 ? "pos" : "neg"}>{fmt(f.oosSharpe, 2)}</td>
                <td className={f.oosReturn >= 0 ? "pos" : "neg"}>{pct(f.oosReturn)}</td>
                <td>
                  {f.efficiency === null ? (
                    <span className="muted" title="In-sample Sharpe was not positive, so the ratio would mislead">
                      n/a
                    </span>
                  ) : (
                    fmt(f.efficiency, 2)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* The verdict above already reads this run's gap in words, and every
          fact this sentence carries is signalled by something the eye reaches
          first: the legend prints "In-sample (parameters fitted here)" and
          "Out-of-sample (blind)", and the table has explicit Train window and
          Test window columns. It is construction, not measurement, so it folds
          under a summary that names the two things it defines. */}
      <details className="disclosure">
        <summary>Which window does a fold trade, and what does the gap mean?</summary>
        <p className="research-note">
          Each fold trades the window <strong>after</strong> the one it fitted; the in-sample →
          out-of-sample gap is the overfitting.
        </p>
      </details>
    </div>
  );
}
