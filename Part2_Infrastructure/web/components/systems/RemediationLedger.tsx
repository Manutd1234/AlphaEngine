"use client";

/**
 * What has actually happened — the History pane of Remediation, one click from
 * the controls that make it happen.
 *
 * NOT a second `TraceConsole`. That component is pinned to exactly one instance
 * on this tab — reliability has one correlated event stream — and it is the
 * wrong shape anyway: a log viewer shows lines, and this needs the PAIRING
 * between them, which is a different derivation over the same events.
 *
 * TWO LOGS, NEVER MERGED. One is this function instance's bounded ring, which
 * resets on redeploy and on Clear telemetry. The other is the gateway's
 * append-only audit store, which survives both. Interleaving them would let a
 * reader take a durable claim off a volatile line — the same hazard
 * TraceConsole's `origin` tagging exists to prevent.
 *
 * The trend is deliberately narrower than fleet MTTR: recovery duration for
 * completed open→closed pairs retained by this instance. Open incidents break
 * the line instead of becoming zeroes, and eviction stays visible because the
 * longest incidents are the likeliest to lose their opening event first.
 */

import { useCallback, useEffect, useState } from "react";

import CategoryBars, { type BarRow } from "@/components/charts/CategoryBars";
import { Grid, XAxis, linePath, linearScale, ticks, useMeasuredWidth } from "@/components/chart-kit";
import DonutChart, { type DonutSlice } from "@/components/common/DonutChart";
import type { TraceEvent } from "@/lib/observability";
import {
  MIN_COMPLETED_FOR_TREND,
  MIN_TRIPS_FOR_RATE,
  deriveRecoveryTrend,
  deriveRemediation,
  recoveryTrendXPositions,
} from "@/lib/remediation";
import { usePolling } from "@/lib/use-polling";

const POLL_MS = 15_000;
const TREND_HEIGHT = 168;
const TREND_MARGIN = { top: 12, right: 24, bottom: 28, left: 58 };
const TREND_TIME = { hour: "2-digit", minute: "2-digit" } as const;
interface EventsResponse {
  events: TraceEvent[];
  cursor: { oldest: number; latest: number; retained: number; capacity: number };
  instance: string;
  dropped: boolean;
}

function duration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  return `${Math.round(s / 60)}m`;
}

export default function RemediationLedger({ active }: { active: boolean }) {
  const [data, setData] = useState<EventsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trendRef, trendWidth] = useMeasuredWidth<HTMLDivElement>(680, data?.cursor.latest ?? 0);

  const load = useCallback(async () => {
    try {
      // Cursor 0: the whole retained ring, because the pairing needs openings
      // that predate whatever this component last saw.
      const response = await fetch("/api/system/events?since=0&limit=500", { cache: "no-store" });
      if (!response.ok) throw new Error(`events unavailable (${response.status})`);
      setData((await response.json()) as EventsResponse);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "events unavailable");
    }
  }, []);

  useEffect(() => {
    // Gated, exactly as TraceConsole is: section panels stay mounted, so an
    // ungated poll would keep running behind a subtab nobody is reading. The
    // caller's flag now carries the pane as well as the section — a reader on
    // Mutations or Recovery is not reading this either.
    if (!active) return;
    void load();
  }, [active, load]);

  /* The pane gate above was doing half the job: a reader sitting on this pane
     who switched to another application still had a 15s poll running, and a
     refusing gateway was asked four times a minute forever. */
  usePolling({ tick: load, intervalMs: POLL_MS, maxBackoffMs: 120_000, enabled: active });

  const model = deriveRemediation(
    data?.events ?? [],
    data?.cursor ?? { oldest: 1, latest: 0, retained: 0, capacity: 0 },
  );
  const truncated = model.truncated || Boolean(data?.dropped);
  const trend = deriveRecoveryTrend(model.pairs);
  const trendView = trend.completed >= MIN_COMPLETED_FOR_TREND
    ? (() => {
        const width = Math.max(280, trendWidth);
        const x0 = TREND_MARGIN.left;
        const x1 = width - TREND_MARGIN.right;
        const baseline = TREND_HEIGHT - TREND_MARGIN.bottom;
        const peak = Math.max(...trend.points.map((point) => point.elapsedMs ?? 0));
        const ceiling = Math.max(1_000, peak * 1.08);
        const y = linearScale(0, ceiling, baseline, TREND_MARGIN.top);
        const xPositions = recoveryTrendXPositions(trend.points, x0, x1);
        return {
          width, x0, x1, baseline, y, xPositions,
          yTicks: ticks(0, ceiling, 4),
          times: trend.points.map((point) => point.openedAt),
          points: trend.points.map((point, index) => ({
            x: xPositions[index],
            y: point.elapsedMs == null ? null : y(point.elapsedMs),
          })),
        };
      })()
    : null;

  const byProvider = new Map<string, { auto: number; operator: number; open: number }>();
  for (const pair of model.pairs) {
    const bucket = byProvider.get(pair.provider) ?? { auto: 0, operator: 0, open: 0 };
    if (pair.by === "operator") bucket.operator += 1;
    else if (pair.by === "automatic") bucket.auto += 1;
    else bucket.open += 1;
    byProvider.set(pair.provider, bucket);
  }

  const rows: BarRow[] = [...byProvider.entries()].map(([provider, counts]) => ({
    label: provider,
    note: `${counts.auto + counts.operator + counts.open} trip${
      counts.auto + counts.operator + counts.open === 1 ? "" : "s"}`,
    segments: [
      { label: "recovered automatically", value: counts.auto, color: "var(--status-good)" },
      { label: "recovered by operator", value: counts.operator, color: "var(--series-1)" },
      { label: "still open", value: counts.open, color: "var(--status-critical)" },
    ],
  }));

  return (
    <section className="card console-card remediation-ledger">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Recorded, not asserted</span>
          <h2>Circuit history</h2>
        </div>
        <span className="section-note">
          {data ? `${data.cursor.retained}/${data.cursor.capacity} retained` : "loading"}
        </span>
      </div>

      {/* A failed poll DEMOTES this panel, it never erases it — the same
          asymmetry `DeskSourceMachine` pins for the cockpit. Forking the whole
          body on `error` swapped the retained history for a one-line apology
          on every failed poll, so a route refusing every other request had the
          charts alternating with an error card four times a minute. The
          error-only reading is legitimate exactly once: when the ring has
          never been read. */}
      {error && (
        <p className="muted" role="status">
          {error}.{" "}
          {data
            ? "The figures below are from the last successful read of this instance's ring."
            : "The ledger reads this instance's own event ring, so an unreachable route breaks the reader, not the desk."}
        </p>
      )}

      {/* Not the no-trips line: before the first read settles there is no
          evidence either way, and "No circuit has tripped" is a finding. */}
      {!data && !error && (
        <p className="muted">This instance&rsquo;s event ring has not been read yet.</p>
      )}

      {data && !model.trips && (
        <p className="muted">
          No circuit has tripped on this instance since it started — a short window and a bounded
          ring, not a reliability record.
        </p>
      )}

      {data && model.trips > 0 && (
        <>
          {/* The ring is gated on the SAME constant that withholds the rate.
              `DonutChart` prints a rounded share beside every legend row, so an
              ungated ring at one trip would print the exact "100%" the module
              refuses two lines below — the sample size talking, not the desk. */}
          {model.trips >= MIN_TRIPS_FOR_RATE && (
            <div className="dependency-charts">
              <div>
                <span className="field">How each trip ended</span>
                <DonutChart
                  slices={[
                    {
                      label: "closed automatically",
                      value: model.recoveredAutomatically,
                      colour: "var(--status-good)",
                    },
                    {
                      label: "closed by operator",
                      value: model.recoveredByOperator,
                      colour: "var(--series-1)",
                    },
                    { label: "still open", value: model.stillOpen, colour: "var(--status-critical)" },
                  ] satisfies DonutSlice[]}
                  total={model.trips}
                  centreValue={String(model.trips)}
                  centreLabel="paired trips"
                  ariaLabel="Circuit trips by how each closed"
                  emptyNote="No circuit has tripped on this instance."
                />
              </div>
            </div>
          )}

          <dl className="remediation-ledger__facts">
            {model.trips < MIN_TRIPS_FOR_RATE && (
              <div><dt>Circuit trips</dt><dd className="num">{model.trips}</dd></div>
            )}
            <div>
              <dt>Closed again</dt>
              <dd className="num">
                {model.recoveredAutomatically + model.recoveredByOperator}
                {model.rate != null ? `, ${Math.round(model.rate * 100)}%` : ""}
              </dd>
            </div>
            <div><dt>Still open</dt><dd className="num">{model.stillOpen}</dd></div>
            <div>
              <dt>Time open</dt>
              <dd className="num">
                {model.medianCloseMs != null
                  ? `median ${duration(model.medianCloseMs)}`
                  : "—"}
                {model.longestCloseMs != null ? `; longest ${duration(model.longestCloseMs)}` : ""}
              </dd>
            </div>
          </dl>

          {model.rate == null && (
            <p className="muted">
              A recovery rate is withheld below {MIN_TRIPS_FOR_RATE} trips — one out of one rendered
              as 100% is the sample size talking, not the desk.
            </p>
          )}

          <div className="remediation-ledger__trend" ref={trendRef}>
            <p className="console-subhead" id="remediation-mttr-title">
              Bounded retained-window MTTR proxy
              <small>
                {` — ${trend.completed} completed; ${trend.incomplete} incomplete; `}
                {trend.meanMs == null ? "mean unavailable" : `mean ${duration(trend.meanMs)}`}
              </small>
            </p>
            {trendView ? (
              <>
                <svg
                  width="100%"
                  height={TREND_HEIGHT}
                  viewBox={`0 0 ${trendView.width} ${TREND_HEIGHT}`}
                  role="img"
                  aria-labelledby="remediation-mttr-title"
                  aria-describedby="remediation-mttr-desc"
                >
                  <desc id="remediation-mttr-desc">
                    Recovery duration for {trend.completed} completed circuit incidents in this
                    instance&apos;s retained event window. {trend.incomplete} incomplete incidents are
                    excluded from the mean and break the line.
                  </desc>
                  <Grid
                    yTicks={trendView.yTicks}
                    yScale={trendView.y}
                    x0={trendView.x0}
                    x1={trendView.x1}
                    format={duration}
                  />
                  <path
                    d={linePath(trendView.points)}
                    fill="none"
                    stroke="var(--series-1)"
                    strokeWidth={1.75}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {trendView.points.map((point, index) => point.y == null ? null : (
                    <circle
                      key={`${trend.points[index].provider}-${trend.points[index].openedAt}`}
                      cx={point.x}
                      cy={point.y}
                      r={3}
                      fill="var(--series-1)"
                    />
                  ))}
                  <XAxis
                    points={trendView.times}
                    xPositions={trendView.xPositions}
                    y={trendView.baseline}
                    x0={trendView.x0}
                    x1={trendView.x1}
                    format={(time) => new Date(time).toLocaleTimeString("en-GB", TREND_TIME)}
                  />
                </svg>
                <div className="legend">
                  <span><i style={{ background: "var(--series-1)" }} /> completed recovery duration</span>
                  <span className="muted">gaps are incomplete incidents, excluded from the proxy</span>
                </div>
              </>
            ) : (
              <p className="muted console-empty">
                Fewer than {MIN_COMPLETED_FOR_TREND} completed incidents are retained. A single
                recovery is a duration, not a trend; incomplete incidents are excluded rather than
                plotted as zero.
              </p>
            )}
          </div>

          <CategoryBars
            rows={rows}
            ariaLabel="Circuit trips by provider and how each closed"
            emptyNote="No provider has tripped."
          />

          <details className="disclosure">
            <summary>Every matched trip and closure, with times and how each closed</summary>
          <div className="table-wrap" tabIndex={0}>
            <table>
              <caption className="sr-only">Matched circuit trips and recoveries</caption>
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col">Opened</th>
                  <th scope="col">Closed</th>
                  <th scope="col" className="num">Open for</th>
                  <th scope="col">How</th>
                </tr>
              </thead>
              <tbody>
                {model.pairs.map((pair) => (
                  <tr key={`${pair.provider}-${pair.openedAt}`}>
                    <td><strong>{pair.provider}</strong></td>
                    <td className="num">{new Date(pair.openedAt).toLocaleTimeString("en-GB", { hour12: false })}</td>
                    <td className="num">
                      {pair.closedAt
                        ? new Date(pair.closedAt).toLocaleTimeString("en-GB", { hour12: false })
                        : "—"}
                    </td>
                    <td className="num">{pair.elapsedMs != null ? duration(pair.elapsedMs) : "—"}</td>
                    <td>
                      {pair.by === "operator"
                        ? <span className="pill pill--warn">operator</span>
                        : pair.by === "automatic"
                          ? <span className="pill pill--live">probe</span>
                          : <span className="pill pill--stop">still open</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </details>
        </>
      )}

      {(model.drills.simulated > 0 || model.drills.cleared > 0) && (
        <p className="muted">
          {model.drills.simulated} simulated outage{model.drills.simulated === 1 ? "" : "s"} and{" "}
          {model.drills.cleared} clearance{model.drills.cleared === 1 ? "" : "s"} in this window,
          counted separately: a drill is self-inflicted, so clearing one is not a recovery.
        </p>
      )}

      {/* Scope and truncation stay visible because they change how the figure
          above may be read; the mechanism and bias explanation may fold. */}
      <p className="research-note">
        <strong>Completed pairs only; this is not fleet MTTR or an SLA.</strong>
        {truncated && " Lines have already been evicted here, so the counts above are a floor."}
      </p>

      <details className="disclosure">
        <summary>Why this trend is a bounded proxy</summary>
        <p className="research-note">
          The sample surviving a bounded ring is biased short: long incidents are likelier to lose
          their opening event before they close. The line describes retained matched pairs, not a
          durable history.
        </p>
      </details>

      {/* Pairing mechanics are separate from the visible scope statement: they
          explain why this retained-window measurement cannot leave the instance. */}
      <details className="disclosure">
        <summary>How the pairing works, and what these numbers are not</summary>
        <p className="research-note">
          Pairing needs both the trip and its closure still in this instance&rsquo;s{" "}
          {data?.cursor.capacity ?? 600}-event ring, shared with dispatch, cache and quota traffic;
          a long outage loses its opening line first.
        </p>
        <p className="research-note">
          A diagnostic for one function instance, reset by redeploy and by Clear telemetry, never
          an SLA. A closure is not a fix: a circuit may re-open three failures later.
        </p>
      </details>
    </section>
  );
}
