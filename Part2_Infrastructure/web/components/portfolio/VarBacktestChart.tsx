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

import { useMemo } from "react";

import {
  DEFAULT_MARGIN,
  Grid,
  Tooltip,
  XAxis,
  extent,
  linePath,
  linearScale,
  ticks,
  useCrosshair,
  useMeasuredWidth,
} from "@/components/chart-kit";
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
}: VarBacktestChartProps) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const points = series.points;

  const geometry = useMemo(() => {
    const m = DEFAULT_MARGIN;
    const x0 = m.left;
    const x1 = Math.max(x0 + 10, width - m.right);
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
    const xScale = linearScale(0, Math.max(1, points.length - 1), x0, x1);
    const yScale = linearScale(lo, hi, y0, y1);
    return { x0, x1, y0, y1, lo, hi, xScale, yScale };
  }, [points, width, show99]);

  const { x0, x1, y0, y1, lo, hi, xScale, yScale } = geometry;
  const crosshair = useCrosshair(points.length, x0, x1);
  const hovered = crosshair.index === null ? null : points[crosshair.index];

  const exceptions = points.filter((p) => p.exception95);
  const dated = series.timesAligned && points.every((p) => p.t !== null);

  const pnlPath = linePath(points.map((p, i) => ({ x: xScale(i), y: yScale(p.pnl) })));
  const var95Path = linePath(points.map((p, i) => ({ x: xScale(i), y: yScale(-p.var95) })));
  const var99Path = linePath(points.map((p, i) => ({ x: xScale(i), y: yScale(-p.var99) })));
  // The region the forecast says losses should stay inside. Closed against the
  // zero rule rather than the axis floor, so the fill means "inside the
  // forecast" and not "anywhere below the top of the chart".
  const bandPathD = `${var95Path} L ${xScale(points.length - 1)} ${yScale(0)} L ${xScale(0)} ${yScale(0)} Z`;

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

      <div ref={ref}>
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width="100%"
          height={HEIGHT}
          role="img"
          aria-label={
            `Rolling ${series.window}-bar 95% value-at-risk forecast against realised counterfactual `
            + `book profit and loss over ${points.length} days. ${exceptions.length} days breached the `
            + `forecast${validation ? `, against ${validation.expectedExceptions} expected` : ""}.`
          }
          {...crosshair.handlers}
          /* The crosshair is pointer-driven, so without this a finger dragging
             to scroll the page scrubs the chart instead. Matches the other
             three charts that already take pointer input. */
          style={{ touchAction: "pan-y" }}
        >
          <Grid yTicks={ticks(lo, hi, 5)} yScale={yScale} x0={x0} x1={x1} format={(v) => usd(v, 0)} />

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
              fontSize={10}
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

          {hovered && (
            <>
              <line
                x1={xScale(crosshair.index as number)}
                x2={xScale(crosshair.index as number)}
                y1={y1}
                y2={y0}
                stroke="var(--axis)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <Tooltip
                x={xScale(crosshair.index as number)}
                width={186}
                chartWidth={width}
                title={stamp(hovered)}
                rows={[
                  { label: "Book P&L", value: usd(hovered.pnl, 0), color: "var(--series-1)" },
                  { label: "VaR 95", value: usd(-hovered.var95, 0), color: "var(--diverging-neg)" },
                  {
                    label: "Breach",
                    value: hovered.exception95 ? "yes" : "no",
                    color: hovered.exception95 ? "var(--critical-text)" : undefined,
                  },
                ]}
              />
            </>
          )}
        </svg>
      </div>

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
