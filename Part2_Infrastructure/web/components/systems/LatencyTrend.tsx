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

import { useMemo, useState } from "react";

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
import { metricRow } from "@/lib/format";

const MARGIN = { top: 12, right: 48, bottom: 26, left: 48 };
/* 140, down from 168, on the day this card moved ABOVE the triage list — the
   arithmetic is in the comment at the top of ReliabilityAttention's return.
   MARGIN takes 38, so the plot is 102 user units against the 130 it had: four
   gridlines about 25 apart, still a shape a reader can date a degradation
   from. 28 of the card's 54px saving is here; the other 26 came from its
   packaging (14h-density-systems.css), which was taken first because it costs
   the data nothing. The floor is the 96px sparkline in the overview KPI deck:
   under that this stops being a second reading of the same series and becomes
   a smaller copy of the one the header already shows. */
const HEIGHT = 140;
const TIME_OPTIONS = { hour: "2-digit", minute: "2-digit" } as const;
const latencyTick = (value: number) => `${Math.round(value)}ms`;

export function latencyTrendIndexAt(
  clientX: number,
  left: number,
  width: number,
  count: number,
): number | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(left) || !Number.isFinite(width)
      || !Number.isFinite(count) || width <= 0 || count <= 0) return null;
  const fraction = Math.min(1, Math.max(0, (clientX - left) / width));
  return Math.round(fraction * Math.max(0, count - 1));
}

export function nextLatencyTrendIndex(current: number, keyCode: number, count: number): number | null {
  if (count <= 0) return null;
  if (keyCode === 36) return 0;
  if (keyCode === 35) return count - 1;
  if (keyCode === 39 || keyCode === 40) return Math.min(count - 1, current + 1);
  if (keyCode === 37 || keyCode === 38) return Math.max(0, current - 1);
  return null;
}

export default function LatencyTrend({ history }: { history: LatencyHistoryPoint[] }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>(680);
  const [pointed, setPointed] = useState<number | null>(null);

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
      positions: history.map((_, i) => x(i)),
      yError,
      latest: history[history.length - 1],
      peak: Math.round(observedPeak),
      worstError: hiError,
    };
  }, [history, width]);

  const active = view && pointed !== null
    ? Math.min(history.length - 1, Math.max(0, pointed))
    : null;
  const activePoint = active === null ? null : history[active];
  const activeMeasured = activePoint?.p99 != null && activePoint.n >= LATENCY_MIN_SAMPLES;

  return (
    /* `.section-heading compact`, the grammar every other panel on this tab
       uses — kicker, title, then the note that acts on the panel. This card
       alone wore `.portfolio-card-heading`, which sets its own min-height and
       rule, so the first card of the section was the one card whose head sat
       at a different height from all seventeen below it. */
    <section className="card latency-trend" aria-labelledby="reliability-latency-trend-title">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Service level</span>
          <h2 id="reliability-latency-trend-title">Tail latency over the observed window</h2>
        </div>
        <span className="section-note">
          {view ? `${history.length} polls; peak p99 ${view.peak}ms` : "collecting samples"}
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
              tabIndex={0}
              onFocus={() => setPointed((current) => current ?? history.length - 1)}
              onBlur={() => setPointed(null)}
              onKeyDown={(event) => {
                if (event.keyCode === 27) {
                  setPointed(null);
                  event.currentTarget.blur();
                  return;
                }
                const next = nextLatencyTrendIndex(pointed ?? history.length - 1, event.keyCode, history.length);
                if (next === null) return;
                event.preventDefault();
                setPointed(next);
              }}
              onPointerMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const boxWidth = Math.max(width, 240);
                const plotLeft = rect.left + (view.x0 / boxWidth) * rect.width;
                const plotWidth = ((view.x1 - view.x0) / boxWidth) * rect.width;
                setPointed(latencyTrendIndexAt(
                  event.clientX,
                  plotLeft,
                  plotWidth,
                  history.length,
                ));
              }}
              onPointerLeave={() => setPointed(null)}
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
                format={latencyTick}
              />
              <path d={view.errorArea} fill="var(--series-2)" fillOpacity={0.14} />
              {view.runs.map((run, i) => (
                <g key={i}>
                  <path
                    className="latency-trend__band"
                    d={areaPath(run, view.baseline)}
                  />
                  <path
                    d={linePath(run)}
                    fill="none"
                    stroke="var(--series-1)"
                    strokeWidth={1.75}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </g>
              ))}
              {active !== null && activePoint && (
                <g className="protected-chart-reading" data-linked="true">
                  <line
                    x1={view.positions[active]}
                    x2={view.positions[active]}
                    y1={MARGIN.top}
                    y2={view.baseline}
                  />
                  <circle
                    cx={view.positions[active]}
                    cy={view.yError(activePoint.errorRate)}
                    r={3}
                    fill="var(--series-2)"
                  />
                  {activeMeasured && activePoint.p99 != null && (
                    <circle
                      cx={view.positions[active]}
                      cy={view.yLatency(activePoint.p99)}
                      r={3}
                      fill="var(--series-1)"
                    />
                  )}
                </g>
              )}
              <XAxis
                points={view.times}
                y={view.baseline}
                x0={view.x0}
                x1={view.x1}
                format={(t) => new Date(t).toLocaleTimeString([], TIME_OPTIONS)}
              />
            </svg>
            {activePoint && (
              <output className="protected-chart-output num" aria-live="polite">
                {metricRow([
                  new Date(activePoint.t).toLocaleTimeString([], TIME_OPTIONS),
                  activeMeasured && activePoint.p99 != null ? latencyTick(activePoint.p99) : "—",
                  `${(activePoint.errorRate * 100).toFixed(1)}%`,
                  activePoint.n,
                ])}
              </output>
            )}
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
    </section>
  );
}
