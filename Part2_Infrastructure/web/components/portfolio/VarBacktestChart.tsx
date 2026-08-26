"use client";

/**
 * The VaR model's out-of-sample record, drawn.
 *
 * The Kupiec block beside this reports eight scalars. They answer "did the
 * model fail more often than it should" and cannot answer "when", which is the
 * question a risk manager asks next — because Kupiec tests unconditional
 * *coverage* only. Three exceptions in one week and three spread over a year
 * produce the same green zone and are very different books. The rug along the
 * bottom shows that clustering for free.
 *
 * The band is one-sided. VaR is a loss quantile; a mirrored band would draw a
 * symmetric gain forecast the model never made and nobody scores, and would put
 * half the mark in the region where an exception is impossible. Same reasoning
 * as EquityChart's drawdown panel.
 */

import { useMemo, type ReactNode } from "react";

import {
  DEFAULT_MARGIN,
  Grid,
  XAxis,
  extent,
  linePath,
  linearScale,
  ticks,
} from "@/components/chart-kit";
import Figure, { Plot } from "@/components/coherence/Figure";
import { gutterFor } from "@/lib/coherence/label-metrics";
import { shortDate, usd } from "@/lib/format";
import type { VarBacktest, VarSeries } from "@/lib/portfolio-risk";

interface VarBacktestChartProps {
  series: VarSeries;
  /** The Kupiec verdict for the same points. May be null while `series` is not. */
  validation: VarBacktest | null;
  /** True when the notionals came from the generated sandbox book. */
  sandbox: boolean;
  /** Symbols excluded for want of history — the exception count is understated by them. */
  missing: string[];
  show99?: boolean;
  /**
   * Drawn under the band and above the exceptions table, inside this card.
   * The exceedance calendar is the other half of the same verdict, and a
   * sibling outside the card sat 34px narrower than the band it answers.
   */
  children?: ReactNode;
}

const HEIGHT = 230;
/** Height of the exception rug at the foot of the plot. */
const RUG = 6;

export default function VarBacktestChart({
  series,
  validation,
  sandbox,
  missing,
  show99 = true,
  children,
}: VarBacktestChartProps) {
  const points = series.points;

  // Only the width-FREE half stays memoised. The old memo keyed on width too,
  // which meant it recomputed on every resize anyway — what it was saving was
  // the extent over the points, and that is what is kept.
  const { y0, y1, lo, hi, yScale } = useMemo(() => {
    const m = DEFAULT_MARGIN;
    const y0 = HEIGHT - m.bottom;
    const y1 = m.top;
    // The band's lower edge is part of the extent: a forecast that never gets
    // near the realised series still has to be on screen, or the chart shows a
    // model that looks tighter than it is.
    const [lo, hi] = extent([
      ...points.map((p) => p.pnl),
      ...points.map((p) => -(show99 ? p.var99 : p.var95)),
      0,
    ]);
    return { y0, y1, lo, hi, yScale: linearScale(lo, hi, y0, y1) };
  }, [points, show99]);
  const yTicks = ticks(lo, hi, 5);
  // FOUND IN A BROWSER, 2026-08-26: `$100,000` drew as `00,000`. The default
  // left margin is 52px and nine monospace glyphs at the grid's 13px are ~76,
  // so the gutter was narrower than its own widest label and the UA clipped
  // the head of it. Sized from the labels now, as every figure on the desk
  // that draws row labels is. `Grid` ends a label 8px short of `x0`; the
  // clearance above that is room for a face that measures wider than the
  // digit class assumes. 720 is chart-kit's own fallback width and only
  // bounds the fraction of the plot a gutter may take.
  const x0 = gutterFor(yTicks.map((v) => usd(v, 0)), 720, 13, { min: DEFAULT_MARGIN.left, clearance: 14 });

  const exceptions = points.filter((p) => p.exception95);
  const dated = series.timesAligned && points.every((p) => p.t !== null);


  const stamp = (p: (typeof points)[number]) =>
    p.t === null ? `#${p.index}` : shortDate(p.t);

  return (
    /* `.card`, because this is a panel now rather than one of three siblings
       in a grid. `.var-backtest` and `.var-backtest__exceptions` have no rules
       in the stylesheet at all — they are hooks that were never given bodies,
       so every piece of chrome here comes from `.card`. */
    <div className="card var-backtest">
      <p className="console-subhead">
        Forecast against realised
        <small className="muted"> — where the model was breached, and whether breaches clustered.</small>
      </p>

      <div className="legend" style={{ marginBottom: 4 }}>
        <span>
          <i style={{ background: "var(--series-1)" }} aria-hidden /> Realised book P&amp;L
        </span>
        <span>
          <i style={{ background: "var(--diverging-neg)" }} aria-hidden /> VaR 95 forecast
        </span>
        {show99 && (
          <span>
            <i style={{ background: "var(--text-muted)" }} aria-hidden /> VaR 99, drawn but not scored
          </span>
        )}
        <span>
          <i style={{ background: "var(--critical-text)" }} aria-hidden /> Exception
        </span>
      </div>

      {/* Through `Figure` and `Plot` since 2026-08-26. This chart already had a
          crosshair and a multi-row tooltip of its own — hand-rolled from the
          same `useCrosshair` and `Tooltip` the plot's `sharedX` is built on —
          and what it lacked was everything AROUND them: a live region, a tab
          stop, arrow keys. So the tooltip is now the plot's `read`, the
          crosshair is the plot's, and the figure speaks. The touch-action rule
          that stopped a finger scrubbing the chart while scrolling is the
          plot's too. */}
      <Figure
        caption={`Rolling ${series.window}-bar 95% VaR against realised book P&L`}
        ariaLabel={
          `Rolling ${series.window}-bar 95% value-at-risk forecast against realised counterfactual `
          + `book profit and loss over ${points.length} days. ${exceptions.length} days breached the `
          + `forecast${validation ? `, against ${validation.expectedExceptions} expected` : ""}.`
        }
        reading="Every exception is measured downward from break-even; the shaded band is where the forecast said losses would stay, and a breach is a day that left it."
        missing={validation ? null : "No Kupiec validation for this window, so the breach count has no expected count to be judged against."}
      >
        <Plot
          height={HEIGHT}
          sharedX={(measured) => {
            const x1 = Math.max(x0 + 10, measured - DEFAULT_MARGIN.right);
            return {
              count: points.length,
              x0,
              x1,
              width: 186,
              read: (index) => {
                const p = points[index];
                return {
                  title: stamp(p),
                  rows: [
                    { label: "Book P&L", value: usd(p.pnl, 0) },
                    { label: "VaR 95", value: usd(-p.var95, 0) },
                    { label: "Breach", value: p.exception95 ? "yes" : "no" },
                  ],
                };
              },
            };
          }}
        >
          {(measured) => {
            const x1 = Math.max(x0 + 10, measured - DEFAULT_MARGIN.right);
            const xScale = linearScale(0, Math.max(1, points.length - 1), x0, x1);
            const pnlPath = linePath(points.map((p, i) => ({ x: xScale(i), y: yScale(p.pnl) })));
            const var95Path = linePath(points.map((p, i) => ({ x: xScale(i), y: yScale(-p.var95) })));
            const var99Path = linePath(points.map((p, i) => ({ x: xScale(i), y: yScale(-p.var99) })));
            // The region the forecast says losses should stay inside. Closed
            // against the zero rule rather than the axis floor, so the fill
            // means "inside the forecast" and not "anywhere below the top".
            const bandPathD = `${var95Path} L ${xScale(points.length - 1)} ${yScale(0)} L ${xScale(0)} ${yScale(0)} Z`;
            return (
              <>
          <Grid yTicks={yTicks} yScale={yScale} x0={x0} x1={x1} format={(v) => usd(v, 0)} />

          <path d={bandPathD} fill="color-mix(in oklab, var(--diverging-neg) 10%, transparent)" />

          {/* Break-even, drawn rather than left to a grid line: every exception
              is measured downward from here. */}
          <line
            x1={x0}
            x2={x1}
            y1={yScale(0)}
            y2={yScale(0)}
            stroke="var(--axis)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />

          {show99 && (
            <path
              d={var99Path}
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          )}

          <path d={var95Path} fill="none" stroke="var(--diverging-neg)" strokeWidth={1.25} />
          <path d={pnlPath} fill="none" stroke="var(--series-1)" strokeWidth={1.5} />

          {/* Exceptions are encoded twice — as a dot on the series and as a tick
              on the rug — because they are the only thing on this chart anyone
              acts on, and because the rug is what makes clustering visible. */}
          {points.map((p, i) =>
            p.exception95 ? (
              <g key={`ex-${p.index}`}>
                <circle
                  cx={xScale(i)}
                  cy={yScale(p.pnl)}
                  r={3.2}
                  fill="var(--critical-text)"
                  stroke="var(--surface-1)"
                  strokeWidth={1.5}
                >
                  <title>
                    {stamp(p)}: lost {usd(-p.pnl, 0)} against a {usd(p.var95, 0)} forecast
                  </title>
                </circle>
                <line
                  x1={xScale(i)}
                  x2={xScale(i)}
                  y1={y0}
                  y2={y0 - RUG}
                  stroke="var(--critical-text)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
              </g>
            ) : null,
          )}

          {/* Direct end-labels: chart-kit has no legend component, and one
              light-mode categorical slot sits below 3:1, so relief is required. */}
          {points.length > 0 && (
            <text
              x={x1 + 6}
              y={yScale(-points[points.length - 1].var95)}
              dominantBaseline="middle"
              fontSize={12}
              fontFamily="var(--mono)"
              fill="var(--diverging-neg)"
            >
              VaR95
            </text>
          )}

          <XAxis
            points={points.map((p, i) => (dated ? (p.t as number) : i))}
            /* The plot floor, as every sibling chart does. `HEIGHT - 8` put the
               axis line at 222 and XAxis draws its ticks at y + 15, so the
               labels landed at 237 inside a 230-tall viewBox and the UA clipped
               them: the date axis has never rendered. */
            y={y0}
            x0={x0}
            x1={x1}
            format={(v) => (dated ? shortDate(v) : `#${Math.round(v)}`)}
          />

              </>
            );
          }}
        </Plot>
      </Figure>

      {children}

      {/* The reason, not the axis. "#0, #12, #24" stays drawn above; what folds
          is why it reads that way, which a reader needs once. The summary sits
          directly under the axis and asks the question the ordinals prompt. */}
      {!dated && (
        <details className="disclosure">
          <summary>Why does the axis count observations?</summary>
          <p className="research-note">
            Dates are not shown: the instruments&apos; bar times did not agree at every index, so the
            axis is the observation number.
          </p>
        </details>
      )}

      {points.length < 60 && (
        <div className="banner warn" role="status">
          <span aria-hidden>!</span>
          <div>
            <strong>{points.length} scored days is a thin sample for a one-in-twenty event.</strong>{" "}
            A green zone at this sample size is weak evidence, not a validation.
          </div>
        </div>
      )}

      {missing.length > 0 && (
        <p className="research-note">
          {missing.join(", ")} {missing.length === 1 ? "is" : "are"} excluded for want of price
          history, so realised losses are understated and exceptions are <strong>undercounted;
          this model looks better than it is</strong>.
        </p>
      )}

      {/* The chart makes claims about numbers; this is those numbers. The ~300
          non-breach days are the null hypothesis and not a table anyone reads,
          so only the breaches are listed. */}
      <details className="var-backtest__exceptions">
        <summary>Exception days ({exceptions.length})</summary>
        {exceptions.length === 0 ? (
          <p className="research-note">
            No day in this window lost more than its own forecast. At 95% a model never breached
            is usually too wide.
          </p>
        ) : (
          <div className="table-wrap" tabIndex={0}>
            <table>
              <caption className="sr-only">
                Every day whose realised loss exceeded the rolling 95% value-at-risk forecast.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Realised P&amp;L</th>
                  <th scope="col">VaR 95 forecast</th>
                  <th scope="col">Excess</th>
                  <th scope="col">Trailing sigma</th>
                </tr>
              </thead>
              <tbody>
                {exceptions.map((p) => (
                  <tr key={p.index}>
                    <td>{stamp(p)}</td>
                    <td className="num neg">{usd(p.pnl, 0)}</td>
                    <td className="num">{usd(-p.var95, 0)}</td>
                    <td className="num neg">{usd(-(-p.pnl - p.var95), 0)}</td>
                    <td className="num">{usd(p.sigma, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      {/* THE SANDBOX CLAUSE IS NOT PART OF THE FOLD, and it used to be
          interpolated into the middle of the paragraph below — so folding that
          paragraph would have carried it along as a passenger. It says the
          notionals are invented, which is a safety statement and stays on
          screen at rest. It gets its own line rather than a fold. */}
      {sandbox && (
        <p className="research-note">
          Generated notionals, measured returns: real Binance closes on an invented book.
        </p>
      )}

      {/* Method, not measurement. Every figure this panel is read for — the
          band, the rug, the exception table, the Kupiec zone beside it — stays
          on screen; what folds is how the series was built and which estimator
          drew the band. Nobody sizes a position off this paragraph. */}
      <details className="disclosure">
        <summary>What window and which returns produced this forecast?</summary>
        <p className="research-note">
          Today&apos;s signed notionals replayed over {points.length + series.window} daily returns — a
          counterfactual about this book&apos;s composition, not what the desk earned.{" "}
          The forecast is a {series.window}-bar rolling sigma, a tighter window than the covariance
          behind the headline VaR above: related estimators, not the same one.
        </p>
      </details>
    </div>
  );
}
