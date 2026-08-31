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

import { Grid, linearScale, ticks } from "@/components/chart-kit";
import Figure, { Plot } from "@/components/coherence/Figure";
import type { GatewayOpsSnapshot } from "@/components/systems/types";

/** The same floor the rest of the desk uses before it states a percentile. */
const MIN_SAMPLES = 20;
const ROW_H = 30;
const MARGIN = { top: 8, right: 132, bottom: 26, left: 148 };
const DISTRIBUTION_HEIGHT = 168;
const DISTRIBUTION_MARGIN = { top: 12, right: 18, bottom: 30, left: 52 };

type Route = GatewayOpsSnapshot["route_latency"]["routes"][number];

/**
 * An empirical CDF rather than a histogram. Route p99s are one aggregate per
 * route, so there are commonly only three or four observations; binning that
 * sample creates one peak-height bar per bin and paints a solid rectangle.
 * The stepped line preserves every observed value and shows the distribution
 * without pretending those route summaries are raw request samples.
 */
function RouteP99Distribution({ routes }: { routes: Route[] }) {
  const ordered = [...routes].sort((a, b) => a.p99_ms - b.p99_ms);
  const lo = ordered[0].p99_ms;
  const hi = ordered[ordered.length - 1].p99_ms;
  const span = Math.max(hi - lo, Math.max(hi, 1) * 0.04);
  const domainLo = Math.max(0, lo - span * 0.08);
  const domainHi = hi + span * 0.08;
  const xTicks = ticks(domainLo, domainHi, 5);
  const yTicks = [0.25, 0.5, 0.75, 1];

  return (
    <div className="route-p99-distribution">
      <Figure
        caption="Distribution of route p99s"
        ariaLabel="Distribution across measured gateway route p99 values"
        reading="One observed p99 per route. This compares routes; it is not raw request latency and is not traffic-weighted."
      >
        <Plot height={DISTRIBUTION_HEIGHT}>
          {(measured) => {
            const x0 = DISTRIBUTION_MARGIN.left;
            const x1 = Math.max(x0 + 40, measured - DISTRIBUTION_MARGIN.right);
            const y0 = DISTRIBUTION_HEIGHT - DISTRIBUTION_MARGIN.bottom;
            const y1 = DISTRIBUTION_MARGIN.top;
            const x = linearScale(domainLo, domainHi, x0, x1);
            const y = linearScale(0, 1, y0, y1);
            let path = `M${x(domainLo)},${y(0)}`;
            ordered.forEach((route, index) => {
              path += ` H${x(route.p99_ms)} V${y((index + 1) / ordered.length)}`;
            });
            path += ` H${x(domainHi)}`;

            return (
              <>
                <Grid
                  yTicks={yTicks}
                  yScale={y}
                  x0={x0}
                  x1={x1}
                  format={(value) => `${Math.round(value * 100)}%`}
                />
                {xTicks.map((tick) => (
                  <g key={tick} aria-hidden="true">
                    <line
                      className="route-p99-distribution__grid"
                      x1={x(tick)}
                      x2={x(tick)}
                      y1={y1}
                      y2={y0}
                    />
                    <text
                      x={x(tick)}
                      y={DISTRIBUTION_HEIGHT - 8}
                      textAnchor="middle"
                      fill="var(--text-muted)"
                      fontSize={13}
                      fontFamily="var(--mono)"
                    >
                      {Math.round(tick * 100) / 100}
                    </text>
                  </g>
                ))}
                <line
                  className="route-p99-distribution__axis"
                  x1={x0}
                  x2={x1}
                  y1={y0}
                  y2={y0}
                />
                <path className="route-p99-distribution__cdf" d={path} />
                {ordered.map((route, index) => (
                  <circle
                    key={route.route}
                    className="route-p99-distribution__mark"
                    cx={x(route.p99_ms)}
                    cy={y((index + 1) / ordered.length)}
                    r={4}
                  >
                    <title>{`${route.route} p99 ${route.p99_ms.toFixed(2)}ms`}</title>
                  </circle>
                ))}
              </>
            );
          }}
        </Plot>
      </Figure>
    </div>
  );
}

export default function RouteLatencyBars({
  platform,
}: {
  platform: GatewayOpsSnapshot | undefined;
}) {

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

      {/* THROUGH `Figure` AND `Plot` SINCE 2026-08-26, and the reason is not
          decoration. This drawing carried a `<title>` on all three marks of
          every row and had no way to say any of them: a `<title>` is a native
          tooltip, reachable with a mouse and by nothing else — not from a
          keyboard, not on a touch screen, and not to a screen reader. Fourteen
          drawings across five tabs were in that state and NONE of them carried
          a live region. `Plot` walks the titles this file already wrote, so the
          figure gets a crosshair, one tab stop, arrow-key mark walking and a
          spoken readout by having done nothing; `Figure` puts the region
          OUTSIDE the `role="img"` wrapper, where assistive technology can
          reach it. */}
      <Figure
        caption="Response time by gateway route, slowest first"
        ariaLabel={`Response time by gateway route, ${routes.length} routes over a ${windowMinutes} minute window`}
        reading="Each bar is a span, not a stack: p50 sits inside p95 sits inside p99, and the tick is the tail."
      >
        <Plot height={height}>
          {(measured) => {
            // Scales move inside, because the width is the plot's now rather
            // than a `useMeasuredWidth` this file kept for itself.
            const plotW = Math.max(140, measured - MARGIN.left - MARGIN.right);
            const x = linearScale(0, top, MARGIN.left, MARGIN.left + plotW);
            const xTicks = ticks(0, top, 4);
            return (
              <>
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
                      fill="color-mix(in srgb, var(--series-1) 55%, var(--surface-2))"
                      stroke="var(--surface-1)" strokeWidth={1} rx={2}>
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
              </>
            );
          }}
        </Plot>
      </Figure>

      <ul className="legend">
        <li><i aria-hidden style={{ background: "var(--series-1)" }} /> p50</li>
        <li><i aria-hidden style={{
          background: "color-mix(in srgb, var(--series-1) 55%, var(--surface-2))",
          border: "1px solid var(--border)",
          height: 5,
        }} /> to p95</li>
        <li><i aria-hidden style={{ background: "var(--critical-text)" }} /> p99</li>
      </ul>

      {plottable.length >= 2 ? (
        <RouteP99Distribution routes={plottable} />
      ) : (
        <div className="route-p99-distribution">
          <h3>Distribution of route p99s</h3>
          <p className="muted">Need two routes with at least {MIN_SAMPLES} samples; n={plottable.length}.</p>
        </div>
      )}

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
