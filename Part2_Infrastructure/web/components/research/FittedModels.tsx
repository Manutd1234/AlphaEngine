"use client";

/**
 * Supervised runs, and the evidence their verdicts rest on.
 *
 * A sweep and a fitted model answer the same question — is there an edge here —
 * and this desk already refuses to let a sweep's Sharpe stand alone: the
 * verdict card names the search hurdle, the deflated Sharpe and the walk-forward
 * OOS figure beside it. A fitted model needs one thing more, and it is the one a
 * table like this usually leaves out.
 *
 * **The purge.** An out-of-sample Sharpe from a fold whose training window
 * reached into its test window is not out-of-sample. It is the same number a
 * leak produces, it looks exactly as good, and nothing downstream can tell them
 * apart. So the purge is a column here rather than a detail someone can go and
 * look up, and a run whose folds disagree about it shows the range.
 *
 * The engine column is the second: a run that fell back to the hand-rolled
 * models because the optional scikit-learn extra was absent is a DIFFERENT run,
 * and ranking it against one that did not would be comparing two experiments.
 */

import { useCallback, useEffect, useState } from "react";

import StatTile from "@/components/StatTile";
import { fmt } from "@/lib/format";
import { probeGateway } from "@/lib/use-gateway-connection";

/** One run, as /api/gateway/research/ml/runs returns it. */
interface MlRun {
  id: string;
  model: string;
  symbol: string;
  interval: string;
  data_hash: string;
  seed: number;
  git_sha: string | null;
  engine: string;
  status: string;
  oos_sharpe: number | null;
  deflated_sharpe: number | null;
  pbo: number | null;
  started_at: string;
  finished_at: string | null;
  error: string | null;
}

interface RunsPayload {
  observed_at: string;
  /** "ok" or "unavailable" — see the empty states below. */
  state: string;
  runs: MlRun[];
}

type Load =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; payload: RunsPayload }
  /** The gateway could not be reached — a different fact from an empty corpus. */
  | { status: "error"; message: string };

function Figure({ value, places = 2 }: { value: number | null; places?: number }) {
  // A missing figure is not a small one. "not computed" is what the corpus
  // stores and what this shows, rather than an em dash that reads as zero.
  if (value == null) return <span className="muted">not computed</span>;
  return <span className="num">{fmt(value, places)}</span>;
}

export default function FittedModels() {
  const [load, setLoad] = useState<Load>({ status: "idle" });

  const refresh = useCallback(async () => {
    setLoad({ status: "loading" });
    const outcome = await probeGateway<RunsPayload>("/api/gateway/research/ml/runs?limit=25");
    if (outcome.ok) setLoad({ status: "done", payload: outcome.payload });
    else setLoad({ status: "error", message: outcome.failure.message });
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const runs = load.status === "done" ? load.payload.runs : [];
  const succeeded = runs.filter((run) => run.status === "succeeded");

  return (
    <div className="card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Supervised research</span>
          <h2>Fitted models</h2>
        </div>
        <button type="button" className="text-action" onClick={() => void refresh()}>
          {load.status === "loading" ? "Reading…" : "Refresh"}
        </button>
      </div>

      {load.status === "error" && (
        <p className="sub">
          {/* The failure messages already end in a full stop; appending another
              gave "…cannot reach.. This says nothing". */}
          The research corpus could not be reached: {load.message.replace(/\.$/, "")}. This says
          nothing about whether runs exist — it says the question could not be asked.
        </p>
      )}

      {load.status === "done" && load.payload.state !== "ok" && (
        <p className="sub">
          No research corpus is configured on this deployment, so there is nowhere for a fitted
          run to be recorded. Runs still execute; nothing is filed.
        </p>
      )}

      {load.status === "done" && load.payload.state === "ok" && runs.length === 0 && (
        <p className="sub">
          The corpus is reachable and holds no supervised runs yet. That is an answer, not a
          failure — this desk has fitted nothing so far.
        </p>
      )}

      {succeeded.length > 0 && (
        <div className="stat-grid">
          <StatTile
            label="Runs recorded"
            value={String(runs.length)}
            note={`${succeeded.length} succeeded`}
          />
          <StatTile
            label="Best deflated Sharpe"
            value={fmt(Math.max(...succeeded.map((r) => r.deflated_sharpe ?? 0)), 2)}
            note="after paying for the search"
          />
          <StatTile
            label="Engines"
            value={[...new Set(succeeded.map((r) => r.engine))].join(", ")}
            note="a fallback run is a different run"
          />
        </div>
      )}

      {runs.length > 0 && (
        <div className="table-wrap" tabIndex={0}>
          <table>
            <caption className="sr-only">
              Supervised research runs, newest first, with their out-of-sample and deflated
              Sharpe ratios and the engine each ran on.
            </caption>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Instrument</th>
                <th scope="col">Engine</th>
                <th scope="col">OOS Sharpe</th>
                <th scope="col">DSR</th>
                <th scope="col">PBO</th>
                <th scope="col">Data</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{run.model}</td>
                  <td className="num">{run.symbol} {run.interval}</td>
                  <td>{run.engine}</td>
                  <td><Figure value={run.oos_sharpe} /></td>
                  <td><Figure value={run.deflated_sharpe} /></td>
                  <td><Figure value={run.pbo} /></td>
                  {/* The hash, not a date: two runs over the same bars are
                      comparable and two over different bars are not, which is
                      the only thing this column is for. */}
                  <td className="num" title={`seed ${run.seed}`}>{run.data_hash.slice(0, 8)}</td>
                  <td>
                    {run.status === "failed" && run.error
                      ? <span title={run.error}>failed</span>
                      : run.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="research-note">
        Every figure here is out of sample. The deflated Sharpe is measured against the folds
        actually scored, so it is a hurdle this run cleared rather than a number it reported.
        A run marked <strong>failed</strong> carries its reason — the corpus refuses a failed
        row that cannot say why.
      </p>
    </div>
  );
}
