"use client";

/**
 * Replay and backfill — the orchestration the Data tab used to name as a gap.
 *
 * Two forms and two tables. Replay re-runs one capability for the desk symbol
 * through this workspace's own validated fetch path, cache bypassed, and
 * writes the contract result to the gateway's quality ledger; backfill
 * fetches bars for a date range, contract-checks them and merges the clean
 * series into the gateway's bar cache. Both are gateway jobs; the tables show
 * what the queue remembers (its in-process memory — the audit log keeps
 * status rows) and the configured schedule, invalid entries included, with
 * their errors.
 *
 * Every empty state says what it does not prove; every submit says what it
 * spends; every read goes through the gateway deadline.
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { GuardMode } from "@/components/systems/types";
import { formatDuration } from "@/lib/format";
import { INTERVALS } from "@/lib/types";
import { probeGateway } from "@/lib/use-gateway-connection";
import { usePolling } from "@/lib/use-polling";

const CAPABILITIES = ["quote", "bars", "news", "fundamentals"] as const;
/** The write's own deadline; longer than the read probe because the gateway forwards to the queue. */
const SUBMIT_DEADLINE_MS = 9_000;
type Capability = (typeof CAPABILITIES)[number];

interface JobRow {
  job_id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  message: string;
  submitted_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  backend: string;
  params: Record<string, unknown>;
  actor: string;
  summary: Record<string, unknown> | null;
}

interface JobsPayload {
  observed_at: string;
  backend: string;
  retained_in_process: boolean;
  executor_configured: boolean;
  jobs: JobRow[];
}

interface ScheduleRow {
  id: string;
  kind: "replay" | "backfill";
  expression: string;
  valid: boolean;
  cadence: string;
  next_due_at: string | null;
  last_run_at: string | null;
  last_job_id: string | null;
  last_outcome: string | null;
  error: string | null;
}

interface SchedulesPayload {
  observed_at: string;
  tick_seconds: number;
  executor_configured: boolean;
  max_backfill_bars: number;
  schedules: ScheduleRow[];
}

interface ReplayBackfillPanelProps {
  symbol: string;
  interval: string;
  pollMs: number;
  active: boolean;
  guard: GuardMode;
  operatorReady: boolean;
  operatorToken: string;
}

function utc(iso: string | null): string {
  if (!iso) return "—";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function duration(job: JobRow): string {
  if (!job.started_at) return "—";
  const end = job.finished_at ? Date.parse(job.finished_at) : null;
  if (end === null) return "running";
  return formatDuration(end - Date.parse(job.started_at), "ms");
}

function outcome(job: JobRow): string {
  if (job.status === "failed") return job.error ?? "failed";
  if (job.status !== "succeeded") return job.message || job.status;
  const s = job.summary ?? {};
  const persisted = typeof s.persisted_at === "string";
  const kind = job.kind === "data.replay" ? "replay" : "backfill";
  const parts: string[] = [];
  if (typeof s.outcome === "string") parts.push(s.outcome);
  if (kind === "replay") {
    if (typeof s.provider === "string") parts.push(s.provider);
    if (typeof s.latency_ms === "number") parts.push(`${Math.round(s.latency_ms)} ms`);
    if (typeof s.cache_state === "string") parts.push(`cache ${s.cache_state}`);
  } else {
    if (typeof s.rows_fetched === "number") parts.push(`${s.rows_fetched} rows fetched`);
    if (typeof s.rows_written === "number") parts.push(`${s.rows_written} written`);
    if (typeof s.provider === "string") parts.push(String(s.provider));
  }
  const contract = s.contract as { violations?: Array<{ check: string }> } | undefined;
  if (contract?.violations?.length) parts.push(contract.violations.map((v) => v.check).join(", "));
  return `${parts.join(", ")}${persisted ? "" : "; persisting…"}`;
}

const isoLocalDay = (offsetDays: number): string => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
};

export default function ReplayBackfillPanel({
  symbol, interval, pollMs, active, guard, operatorReady, operatorToken,
}: ReplayBackfillPanelProps) {
  const [jobs, setJobs] = useState<JobsPayload | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<SchedulesPayload | null>(null);
  const [schedulesError, setSchedulesError] = useState<string | null>(null);
  const [capability, setCapability] = useState<Capability>("quote");
  const [bfInterval, setBfInterval] = useState<string>(interval);
  const [from, setFrom] = useState(() => isoLocalDay(-2));
  const [to, setTo] = useState(() => isoLocalDay(0));
  const [busy, setBusy] = useState<"replay" | "backfill" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const locked = guard === "locked";
  const canSubmit = !locked && operatorReady && busy === null;

  const load = useCallback(async () => {
    const [j, s] = await Promise.all([
      probeGateway<JobsPayload>("/api/gateway/data/jobs?limit=25"),
      probeGateway<SchedulesPayload>("/api/gateway/data/schedules"),
    ]);
    if (j.ok) { setJobs(j.payload); setJobsError(null); } else { setJobsError(j.failure.timedOut ? "the gateway did not answer within the deadline" : j.failure.message); }
    if (s.ok) { setSchedules(s.payload); setSchedulesError(null); } else { setSchedulesError(s.failure.timedOut ? "the gateway did not answer within the deadline" : s.failure.message); }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  usePolling({
    tick: load,
    intervalMs: pollMs ?? 0,
    maxBackoffMs: 300_000,
    enabled: active && Boolean(pollMs),
  });

  const submit = async (kind: "replay" | "backfill", body: Record<string, unknown>) => {
    setBusy(kind);
    setNotice(null);
    // A hand-rolled deadline for the one write: probeGateway coalesces by URL
    // and is a GET; two submits in a row must not be served each other's
    // answer, and a gateway that accepts and never answers must not hold the
    // button in "Queuing…" forever.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUBMIT_DEADLINE_MS);
    try {
      const response = await fetch("/api/gateway/data/jobs", {
        method: "POST",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(operatorToken ? { Authorization: `Bearer ${operatorToken}` } : {}),
        },
        body: JSON.stringify({ kind, ...body }),
      });
      const payload = await response.json().catch(() => ({})) as { job_id?: string; error?: string; hint?: string };
      if (!response.ok) {
        setNotice(`${kind === "replay" ? "Replay" : "Backfill"} not queued: ${payload.error ?? `HTTP ${response.status}`}${payload.hint ? ` ${payload.hint}` : ""}`);
      } else {
        setNotice(`${kind === "replay" ? "Replay" : "Backfill"} queued as job ${payload.job_id}.`);
        void load();
      }
    } catch (error) {
      const timedOut = controller.signal.aborted;
      setNotice(`${kind === "replay" ? "Replay" : "Backfill"} not queued: ${timedOut ? "the gateway did not answer within the deadline" : error instanceof Error ? error.message : "request failed"}`);
    } finally {
      clearTimeout(timer);
      setBusy(null);
    }
  };

  const onReplay = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit("replay", { symbol, capability, interval, bars: 120 });
  };
  const onBackfill = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit("backfill", { symbol, interval: bfInterval, from_at: `${from}T00:00:00Z`, to_at: `${to}T00:00:00Z` });
  };

  const executor = jobs?.executor_configured ?? schedules?.executor_configured ?? null;

  return (
    <div className="card console-card" aria-labelledby="replay-backfill-heading">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Orchestration</span>
          <h2 id="replay-backfill-heading">Replay and backfill</h2>
        </div>
        <span className="section-note">
          {jobs ? `${jobs.backend} queue; ${jobs.jobs.length} recent ${jobs.jobs.length === 1 ? "job" : "jobs"}` : jobsError ? "queue unreachable" : "reading the queue"}
        </span>
      </div>

      {executor === false && (
        <div className="banner warn" role="status">
          <span aria-hidden>!</span>
          <div>
            <strong>Executor not configured.</strong> Replay and equity backfill run through this workspace&apos;s fetch path, which the gateway
            cannot reach without <code>WEB_WORKSPACE_URL</code>. Crypto backfill (Binance) still works.
          </div>
        </div>
      )}

      <div className="data-console-pair">
        <form onSubmit={onReplay} aria-label="Replay one capability">
          {/* "one capability" was the seg below and the submit button, which
              spells the chosen one out ("Replay quote"). */}
          <p className="console-subhead">Replay {symbol}<small className="muted"> — cache bypassed; the result lands in the quality ledger.</small></p>
          <div className="seg console-seg" role="group" aria-label="Capability to replay">
            {CAPABILITIES.map((item) => (
              <button key={item} type="button" aria-pressed={item === capability} onClick={() => setCapability(item)}>{item}</button>
            ))}
          </div>
          <div className="console-inspector__controls">
            <button type="submit" disabled={!canSubmit} title={locked ? "Operator actions are disabled on this deployment." : !operatorReady ? "Enter the operator token in Reliability → Remediation first." : undefined}>
              {busy === "replay" ? "Queuing…" : `Replay ${capability}`}
            </button>
          </div>
          {/* The subhead above already ends "the result lands in the quality
              ledger", and that ledger is the gateway's. Only the price is new. */}
          <p className="console-trace-cost">Spends one interactive provider call through this workspace.</p>
        </form>

        <form onSubmit={onBackfill} aria-label="Backfill bars">
          {/* "bars for a date range" was the interval select and the two date
              inputs directly below, plus the bar cap in the cost line. */}
          <p className="console-subhead">Backfill {symbol}<small className="muted"> — contract-checked, merged into the gateway&apos;s bar cache.</small></p>
          <div className="console-inspector__controls">
            <label className="console-check">
              <span className="sr-only">Interval</span>
              <select value={bfInterval} onChange={(e) => setBfInterval(e.target.value)} aria-label="Bar interval">
                {INTERVALS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From (UTC)" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To (UTC)" />
            <button type="submit" disabled={!canSubmit || from >= to} title={locked ? "Operator actions are disabled on this deployment." : !operatorReady ? "Enter the operator token in Reliability → Remediation first." : undefined}>
              {busy === "backfill" ? "Queuing…" : "Backfill"}
            </button>
          </div>
          <p className="console-trace-cost">
            Binance for a crypto pair, this workspace&apos;s registry for an equity; capped at {schedules?.max_backfill_bars ?? "the gateway's"} bars.
          </p>
        </form>
      </div>

      {notice && (
        <div className={`banner ${notice.includes("not queued") ? "error" : "warn"}`} role="status">
          <span aria-hidden>{notice.includes("not queued") ? "✕" : "●"}</span>
          <div>{notice}</div>
        </div>
      )}

      <p className="console-subhead">
        Recent jobs
        <small className="muted"> — the queue&apos;s in-process memory since the gateway started; the audit log keeps status rows.</small>
      </p>
      {jobsError && <p className="sub">The job list could not be read: {jobsError}. Nothing here says the queue is empty.</p>}
      {jobs && jobs.jobs.length === 0 && !jobsError && (
        <p className="sub">No replay or backfill job has been submitted since the gateway started.</p>
      )}
      {jobs && jobs.jobs.length > 0 && (
        <div className="table-wrap table-wrap--clamped">
          <table>
            <caption className="sr-only">Recent replay and backfill jobs.</caption>
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">Kind</th>
                <th scope="col">Params</th>
                <th scope="col">State</th>
                <th scope="col">Duration</th>
                <th scope="col">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {jobs.jobs.map((job) => (
                <tr key={job.job_id}>
                  <td className="num">{job.job_id}</td>
                  <td>{job.kind.replace("data.", "")}</td>
                  <td className="num">
                    {String(job.params.symbol ?? "")}
                    {typeof job.params.capability === "string" ? ` ${job.params.capability}` : ""}
                    {typeof job.params.interval === "string" && job.kind === "data.backfill" ? ` ${job.params.interval}` : ""}
                  </td>
                  <td>{job.status}{job.status === "running" && job.progress > 0 ? ` ${Math.round(job.progress * 100)}%` : ""}</td>
                  <td className="num">{duration(job)}</td>
                  <td className="console-wrap">{outcome(job)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="console-subhead">
        Schedule
        <small className="muted"> — config-driven (<code>DATA_SCHEDULES</code> on the gateway), ticked every {schedules ? `${schedules.tick_seconds} s` : "tick"}; invalid entries stay listed with their error.</small>
      </p>
      {schedulesError && <p className="sub">The schedule could not be read: {schedulesError}.</p>}
      {schedules && schedules.schedules.length === 0 && !schedulesError && (
        <p className="sub">No schedule is configured — set <code>DATA_SCHEDULES</code> on the gateway, for example <code>replay:quote:BTCUSDT@every=1h;backfill:ETHUSDT:1h:2d@daily=03:30</code>.</p>
      )}
      {schedules && schedules.schedules.length > 0 && (
        <ul className="console-skips" aria-label="Configured schedules">
          {schedules.schedules.map((s) => (
            <li key={s.id}>
              <strong><span aria-hidden>{s.valid ? "●" : "✕"}</span> {s.expression}</strong>
              <span className="console-skip__reason">
                {s.valid ? `next ${utc(s.next_due_at)}` : `invalid: ${s.error}`}
              </span>
              <small className="muted console-wrap">
                {s.last_run_at ? `last ran ${utc(s.last_run_at)} as ${s.last_job_id} (${s.last_outcome})` : "has not run since the gateway started"}
              </small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
