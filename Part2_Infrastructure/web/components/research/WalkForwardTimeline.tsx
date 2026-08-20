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
import { DEFAULT_MARGIN, Grid, extent, linearScale, ticks, useMeasuredWidth } from "@/components/chart-kit";
import type { WalkForwardReport } from "@/lib/types";

const LEVEL_TONE: Record<string, string> = {
  pass: "var(--success-text)",
  marginal: "var(--warning-text)",
  fail: "var(--critical-text)",
};

const LEVEL_GLYPH: Record<string, string> = { pass: "✓", marginal: "▲", fail: "✕" };

export default function WalkForwardTimeline({ report }: { report: WalkForwardReport }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
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
          Not enough bars to split into training and testing windows. Increase the history depth or
          reduce the fold count.
        </p>
      </div>
    );
  }

  const height = 190;
  const m = { ...DEFAULT_MARGIN, right: 16, left: 46, bottom: 34 };
  const x0 = m.left;
  const x1 = Math.max(x0 + 40, width - m.right);
  const y0 = height - m.bottom;
  const y1 = m.top;

  const values = folds.flatMap((f) => [f.isSharpe, f.oosSharpe]);
  const [lo, hi] = extent([...values, 0]);
  const yScale = linearScale(lo, hi, y0, y1);
  const yTicks = ticks(lo, hi, 4);
  const zero = yScale(0);

  const slot = (x1 - x0) / folds.length;
  const barW = Math.max(4, Math.min(26, slot / 2.6));

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

      <div className="legend" style={{ marginBottom: 6 }}>
        <span>
          <i style={{ background: "var(--series-1)" }} aria-hidden /> In-sample (parameters fitted here)
        </span>
        <span>
          <i style={{ background: "var(--series-2)" }} aria-hidden /> Out-of-sample (blind)
        </span>
      </div>

      <div ref={ref}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={`In-sample and out-of-sample Sharpe for ${folds.length} walk-forward folds`}
        >
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
            const bar = (x: number, v: number, fill: string) => {
              const top = Math.min(yScale(v), zero);
              const h = Math.max(1, Math.abs(yScale(v) - zero));
              return <rect x={x} y={top} width={barW} height={h} fill={fill} rx={2} />;
            };
            return (
              <g key={f.fold}>
                {bar(isX, f.isSharpe, "var(--series-1)")}
                {bar(oosX, f.oosSharpe, "var(--series-2)")}
                <text
                  x={centre}
                  y={height - m.bottom + 14}
                  textAnchor="middle"
                  fontSize={12.5}
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
        </svg>
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

      {/* The one per-fold table on this tab. A second card below it used to
          repeat five of these columns for the same folds under its own
          heading; `FoldEfficiency extends WalkForwardFold`, so the two
          columns it alone carried — the train window and the OOS return —
          simply live here now. */}
      <div className="table-wrap" tabIndex={0}>
        <table>
          <caption className="sr-only">
            Per-fold walk-forward results: training and testing windows, chosen parameters,
            in-sample and out-of-sample Sharpe, out-of-sample return, efficiency, and parameter drift.
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
                <td>{fmt(f.isSharpe, 2)}</td>
                <td className={f.oosSharpe >= 0 ? "pos" : "neg"}>{fmt(f.oosSharpe, 2)}</td>
                <td className={f.oosReturn >= 0 ? "pos" : "neg"}>{pct(f.oosReturn)}</td>
                <td>
                  {f.efficiency === null ? (
                    <span className="muted" title="In-sample Sharpe was not positive, so the ratio would be misleading">
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
      {/* The verdict above already reads this run's gap in words. */}
      <p className="research-note">
        Each fold optimises on the train window and trades the <strong>next</strong>, unseen one; the
        in-sample → out-of-sample gap is the overfitting.
      </p>
    </div>
  );
}
