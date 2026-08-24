"use client";

/**
 * Per-route response time inside the gateway process.
 *
 * `platform.route_latency.routes[]` has carried p50, p95, p99, samples and
 * errors per route since the ops snapshot existed, and the console reduced the
 * whole array to one number: the slowest route's p95, printed as a sentence. A
 * reader could see that something was slow and not which thing.
 *
 * NOT `CategoryBars`, and this is the one thing worth reading the code for.
 * That component sums its segments into a total — correct for the composition
 * it was built for, wrong here, because percentiles are NESTED rather than
 * additive: p50 is inside p95 is inside p99. Stacking them would draw every bar
 * roughly three times too long and the chart would be confidently wrong. So
 * this draws a span, not a stack.
 *
 * The p99 tick is a `stroke`, deliberately: the existing forced-colors rule
 * catches `svg path[stroke]`, so the mark survives high-contrast mode. Every
 * bar prints its own numbers beside it, so colour is never the only carrier.
 */

import { Grid, linearScale, ticks, useMeasuredWidth } from "@/components/chart-kit";
import type { GatewayOpsSnapshot } from "@/components/systems/types";

/** The same floor the rest of the desk uses before it states a percentile. */
const MIN_SAMPLES = 20;
const ROW_H = 30;
const MARGIN = { top: 8, right: 132, bottom: 26, left: 148 };

type Route = GatewayOpsSnapshot["route_latency"]["routes"][number];

export default function RouteLatencyBars({
  platform,
}: {
  platform: GatewayOpsSnapshot | undefined;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>(720);

  if (!platform) {
    return (
      <section className="card console-card">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">In-process timing</span>
            <h2>Route response time</h2>
          </div>
        </div>
        <p className="muted">
          No gateway ops snapshot in this deployment. Route latency is measured inside the FastAPI
          process, leaving nothing to read here — a missing observer, not a slow desk.
        </p>
      </section>
    );
  }

  const routes = [...platform.route_latency.routes].sort((a, b) => b.p95_ms - a.p95_ms);
  const plottable = routes.filter((route) => route.samples >= MIN_SAMPLES);
  const windowMinutes = Math.round(platform.route_latency.window_seconds / 60);

  if (!routes.length) {
    return (
      <section className="card console-card">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">In-process timing</span>
            <h2>Route response time</h2>
          </div>
        </div>
        <p className="muted">
          The gateway answered but has recorded no route timing in the last {windowMinutes} minutes.
          A quiet process, not a broken one.
        </p>
      </section>
    );
  }

  // One shared domain across every row, so the bars compare. Per-row scaling
  // would make the slowest route look identical to the fastest.
  const top = Math.max(...plottable.map((r) => r.p99_ms), 1) * 1.08;
  const height = MARGIN.top + routes.length * ROW_H + MARGIN.bottom;
  const plotW = Math.max(140, width - MARGIN.left - MARGIN.right);
  const x = linearScale(0, top, MARGIN.left, MARGIN.left + plotW);
  const xTicks = ticks(0, top, 4);

  const label = (route: Route) => route.route.replace(/^\/api\//, "");

  return (
    <section className="card console-card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">In-process timing</span>
          <h2>Route response time</h2>
        </div>
        <span className="section-note">{routes.length} routes, {windowMinutes}-minute window</span>
      </div>

      <div ref={ref}>
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img"
          aria-label={`Response time by gateway route, ${routes.length} routes over a ${windowMinutes} minute window`}>
          <Grid
            yTicks={[]} yScale={() => 0}
            x0={MARGIN.left} x1={MARGIN.left + plotW} format={() => ""}
          />
          {xTicks.map((tick) => (
            <g key={tick}>
              <line x1={x(tick)} x2={x(tick)} y1={MARGIN.top} y2={MARGIN.top + routes.length * ROW_H}
                stroke="var(--grid)" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={x(tick)} y={height - 8} textAnchor="middle" fontSize={13}
                fill="var(--text-muted)" fontFamily="var(--mono)">
                {Math.round(tick)}ms
              </text>
            </g>
          ))}

          {routes.map((route, index) => {
            const y = MARGIN.top + index * ROW_H;
            const mid = y + ROW_H / 2;
            const thin = route.samples < MIN_SAMPLES;

            return (
              <g key={route.route}>
                <text x={MARGIN.left - 10} y={mid} textAnchor="end" dominantBaseline="middle"
                  fontSize={13} fill="var(--text-secondary)" fontFamily="var(--mono)">
                  {label(route)}
                </text>

                {thin ? (
                  // Numbers without geometry: too few calls to shape a
                  // distribution, and a bar would imply one.
                  <text x={MARGIN.left + 4} y={mid} dominantBaseline="middle" fontSize={13}
                    fill="var(--text-muted)" fontFamily="var(--mono)">
                    n={route.samples}/{MIN_SAMPLES} — too thin to plot
                  </text>
                ) : (
                  <>
                    <rect x={x(0)} y={mid - 5} width={Math.max(1, x(route.p50_ms) - x(0))} height={10}
                      fill="var(--series-1)" rx={2}>
                      <title>{`${route.route} p50 ${Math.round(route.p50_ms)}ms`}</title>
                    </rect>
                    <rect x={x(route.p50_ms)} y={mid - 5}
                      width={Math.max(1, x(route.p95_ms) - x(route.p50_ms))} height={10}
                      fill="color-mix(in srgb, var(--series-1) 38%, var(--surface-2))" rx={2}>
                      <title>{`${route.route} p95 ${Math.round(route.p95_ms)}ms`}</title>
                    </rect>
                    {/* stroke, not fill — the forced-colors rule targets it */}
                    <path d={`M${x(route.p99_ms)},${mid - 8}L${x(route.p99_ms)},${mid + 8}`}
                      stroke="var(--critical-text)" strokeWidth={1.5}>
                      <title>{`${route.route} p99 ${Math.round(route.p99_ms)}ms`}</title>
                    </path>
                  </>
                )}

                <text x={MARGIN.left + plotW + 8} y={mid} dominantBaseline="middle" fontSize={10}
                  fill="var(--text-muted)" fontFamily="var(--mono)">
                  {thin
                    ? `p50 ${Math.round(route.p50_ms)}`
                    : `${Math.round(route.p50_ms)}/${Math.round(route.p95_ms)}/${Math.round(route.p99_ms)}`}
                  {` n=${route.samples}`}
                  {route.errors_total > 0 ? `, ${route.errors_total} ${route.errors_total === 1 ? "error" : "errors"}` : ""}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <ul className="legend">
        <li><i aria-hidden style={{ background: "var(--series-1)" }} /> p50</li>
        <li><i aria-hidden style={{ background: "color-mix(in srgb, var(--series-1) 38%, var(--surface-2))" }} /> to p95</li>
        <li><i aria-hidden style={{ background: "var(--critical-text)" }} /> p99</li>
      </ul>

      {/* No window figure here: the section-note above this card already prints
          "{routes} routes, {windowMinutes}-minute window", and a note that
          repeats its own heading is read twice and learned once.

          What is left is a scope caveat and a reading key, and both are already
          carried on screen without it. The card's kicker reads "In-process
          timing" directly above the chart, so the measurement boundary is not
          lost while this is closed; and a row too thin to plot draws its own
          "n=…/20 — too thin to plot" inside the SVG, which is where the reading
          key is actually needed. Folded, not cut: the exact wording is one
          click away for a reader who wants the boundary stated in full. */}
      <details className="disclosure">
        <summary>Which span of the request does this time cover?</summary>
        <p className="research-note">
          Measured <strong>inside the gateway process</strong>: handler time, not the round trip a
          browser pays and not exchange order-to-ack. Sorted slowest first by p95; a route with fewer
          than {MIN_SAMPLES} samples prints its numbers and draws no bar.
        </p>
      </details>
    </section>
  );
}
