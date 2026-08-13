"use client";

/**
 * What has actually happened, beside the controls that make it happen.
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
 * NO TREND LINE, and the refusal is rendered where a reader would look for the
 * chart. Pairing needs both the opening and the closing still in a 600-event
 * ring shared with dispatch, cache and quota traffic; the longest outages are
 * the likeliest to lose their opening to eviction, so the surviving sample is
 * biased short and a line through it slopes toward a recovery time nobody
 * achieved. That is a wrong answer rather than an imprecise one.
 */

import { useCallback, useEffect, useState } from "react";

import CategoryBars, { type BarRow } from "@/components/charts/CategoryBars";
import DonutChart, { type DonutSlice } from "@/components/common/DonutChart";
import type { TraceEvent } from "@/lib/observability";
import { MIN_TRIPS_FOR_RATE, deriveRemediation } from "@/lib/remediation";

const POLL_MS = 15_000;

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
    // Gated, exactly as TraceConsole is: panels stay mounted, so an ungated
    // poll would keep running behind a subtab nobody is reading.
    if (!active) return;
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  const model = deriveRemediation(
    data?.events ?? [],
    data?.cursor ?? { oldest: 1, latest: 0, retained: 0, capacity: 0 },
  );
  const truncated = model.truncated || Boolean(data?.dropped);

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

      {error ? (
        <p className="muted">
          {error}. The ledger reads this instance&rsquo;s own event ring, so an unreachable route
          means the reader is broken rather than the desk.
        </p>
      ) : !model.trips ? (
        <p className="muted">
          No circuit has tripped on this instance since it started. That is an absence of evidence
          over a short window and a bounded ring — not a reliability record.
        </p>
      ) : (
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
                  ariaLabel="Circuit trips by how each was closed"
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
                {model.rate != null ? ` · ${Math.round(model.rate * 100)}%` : ""}
              </dd>
            </div>
            <div><dt>Still open</dt><dd className="num">{model.stillOpen}</dd></div>
            <div>
              <dt>Time open</dt>
              <dd className="num">
                {model.medianCloseMs != null
                  ? `median ${duration(model.medianCloseMs)}`
                  : "—"}
                {model.longestCloseMs != null ? ` · longest ${duration(model.longestCloseMs)}` : ""}
              </dd>
            </div>
          </dl>

          {model.rate == null && (
            <p className="muted">
              A recovery rate is withheld below {MIN_TRIPS_FOR_RATE} trips — one out of one rendered
              as 100% is the sample size talking, not the desk.
            </p>
          )}

          <CategoryBars
            rows={rows}
            ariaLabel="Circuit trips by provider and how each was closed"
            emptyNote="No provider has tripped."
          />

          <details className="disclosure">
            <summary>Every matched trip and closure, with times and how each was closed</summary>
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
          counted separately: a drill is self-inflicted, so clearing one is not a recovery from
          anything.
        </p>
      )}

      {/* The refusal, rendered where a reader would look for the chart. The
          headline stays on screen and the reasoning collapses — a one-line
          refusal is read, and a 600-character one is skipped, so this makes the
          refusal MORE prominent rather than less. */}
      <p className="research-note">
        <strong>No MTTR trend is drawn.</strong> The sample that survives a bounded ring is biased
        short, so a trend through it would slope toward a recovery time nobody achieved.
        {truncated && " Lines have already been evicted here, so the counts above are a floor."}
      </p>

      <details className="disclosure">
        <summary>Why a bounded event ring biases the surviving sample short</summary>
        <p className="research-note">
          Pairing needs both the trip and its closure still in this instance&rsquo;s{" "}
          {data?.cursor.capacity ?? 600}-event ring, which it shares with dispatch, cache and quota
          traffic — and a long outage is the likeliest to lose its opening line first. So the
          incidents that survive to be measured are disproportionately the ones that ended quickly.
          That is a wrong answer rather than an imprecise one, and no caption fixes a chart whose
          bias points the same way as the flattering conclusion.
        </p>
        <p className="research-note">
          This is a diagnostic for one function instance, reset by redeploy and by Clear telemetry,
          and never an SLA. A closure is also not a fix: one successful probe closes a circuit that
          may re-open three failures later.
        </p>
      </details>
    </section>
  );
}
