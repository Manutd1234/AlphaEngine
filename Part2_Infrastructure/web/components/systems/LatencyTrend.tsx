"use client";

/**
 * Upstream tail latency and error rate, over the poll window this tab observed.
 *
 * `useSystemHealth` has been accumulating a `latencyHistory` point on every
 * poll for as long as the hook has existed, and the only thing that ever read
 * it was a 96px sparkline in the overview's KPI deck. The reliability tab —
 * the one surface whose entire job is "is it degrading, and since when" —
 * rendered the p99 as a single scalar with no history at all.
 *
 * Two series, one plane: p99 in milliseconds on the left axis, error rate as a
 * shaded area against the right. They share an x because the question is
 * whether they move together; a slow provider and a failing provider are
 * different incidents, and the pair separates them at a glance.
 *
 * Samples with `n` below the significance floor are drawn as gaps rather than
 * zeroes. A percentile over three requests is not a percentile, and plotting it
 * flat at the axis would invent a recovery that never happened.
 */

import { useMemo } from "react";

import {
  Grid,
  XAxis,
  areaPath,
  extent,
  linePath,
  linearScale,
  ticks,
  useMeasuredWidth,
} from "@/components/chart-kit";
import { LATENCY_MIN_SAMPLES, type LatencyHistoryPoint } from "@/lib/overview-state";

const MARGIN = { top: 12, right: 48, bottom: 26, left: 48 };
const HEIGHT = 168;

export default function LatencyTrend({ history }: { history: LatencyHistoryPoint[] }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>(680);

  const view = useMemo(() => {
    // Only samples that clear the floor carry a usable percentile.
    const usable = history.filter((p) => p.p99 != null && p.n >= LATENCY_MIN_SAMPLES);
    if (usable.length < 2) return null;

    const innerW = Math.max(120, width - MARGIN.left - MARGIN.right);
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
    const x = linearScale(0, history.length - 1, MARGIN.left, MARGIN.left + innerW);

    // 8% headroom so the peak never rides the top edge of the plot, where a
    // line is easy to mistake for a clipped one.
    const [, observedPeak] = extent(usable.map((p) => p.p99));
    const hiLatency = Math.max(1, observedPeak * 1.08);
    const yLatency = linearScale(0, hiLatency, MARGIN.top + innerH, MARGIN.top);

    const hiError = Math.max(0.02, ...history.map((p) => p.errorRate));
    const yError = linearScale(0, hiError, MARGIN.top + innerH, MARGIN.top);

    // Contiguous runs only — a line drawn across a gap asserts a measurement
    // between two polls that nothing took.
    const runs: { x: number; y: number }[][] = [];
    let run: { x: number; y: number }[] = [];
    history.forEach((p, i) => {
      if (p.p99 != null && p.n >= LATENCY_MIN_SAMPLES) {
        run.push({ x: x(i), y: yLatency(p.p99) });
      } else if (run.length) {
        runs.push(run);
        run = [];
      }
    });
    if (run.length) runs.push(run);

    return {
      runs,
      errorArea: areaPath(
        history.map((p, i) => ({ x: x(i), y: yError(p.errorRate) })),
        MARGIN.top + innerH,
      ),
      yTicks: ticks(0, Math.max(1, hiLatency), 4),
      yLatency,
      x0: MARGIN.left,
      x1: MARGIN.left + innerW,
      baseline: MARGIN.top + innerH,
      times: history.map((p) => p.t),
      latest: usable[usable.length - 1],
      peak: Math.round(observedPeak),
      worstError: hiError,
    };
  }, [history, width]);

  return (
    <div className="card latency-trend">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Service level</span>
          <h2>Tail latency over the observed window</h2>
        </div>
        <span className="section-note">
          {view ? `${history.length} polls · peak p99 ${view.peak}ms` : "collecting samples"}
        </span>
      </div>

      <div ref={ref}>
        {view ? (
          <>
            <svg
              width="100%"
              height={HEIGHT}
              viewBox={`0 0 ${Math.max(width, 240)} ${HEIGHT}`}
              role="img"
              aria-label={
                `Upstream p99 latency across ${history.length} polls, peaking at ${view.peak} milliseconds`
                // Withheld rather than zeroed: `?? 0` told a screen-reader user
                // "currently 0 milliseconds" whenever p99 was unmeasured, which
                // is the fastest latency imaginable and the opposite of true.
                + (view.latest.p99 == null
                  ? ", currently not measured"
                  : `, currently ${Math.round(view.latest.p99)} milliseconds`)
                + ` with an error rate of ${(view.latest.errorRate * 100).toFixed(1)} percent.`
              }
            >
              <Grid
                yTicks={view.yTicks}
                yScale={view.yLatency}
                x0={view.x0}
                x1={view.x1}
                format={(v) => `${Math.round(v)}ms`}
              />
              <path d={view.errorArea} fill="var(--series-2)" fillOpacity={0.14} />
              {view.runs.map((run, i) => (
                <path
                  key={i}
                  d={linePath(run)}
                  fill="none"
                  stroke="var(--series-1)"
                  strokeWidth={1.75}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
              <XAxis
                points={view.times}
                y={view.baseline}
                x0={view.x0}
                x1={view.x1}
                format={(t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              />
            </svg>
            <div className="legend">
              <span><i style={{ background: "var(--series-1)" }} /> p99 latency</span>
              <span><i style={{ background: "var(--series-2)", opacity: 0.5 }} /> error rate (peak {(view.worstError * 100).toFixed(1)}%)</span>
              <span className="muted">gaps are polls below {LATENCY_MIN_SAMPLES} samples</span>
            </div>
          </>
        ) : (
          <p className="muted console-empty">
            Fewer than two polls have cleared the {LATENCY_MIN_SAMPLES}-sample floor. The window fills
            as the tab stays open; nothing is drawn from a percentile that thin.
          </p>
        )}
      </div>
    </div>
  );
}
