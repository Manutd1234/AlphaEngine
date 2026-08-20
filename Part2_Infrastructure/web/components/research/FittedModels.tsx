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

import MlRunCapsule, {
  PBO_NOT_APPLICABLE, type MlRunEvidence, type MlRunProvenance,
} from "@/components/research/MlRunCapsule";
import StatTile from "@/components/StatTile";
import { fmt } from "@/lib/format";
import { GATEWAY_DEADLINE_MS, probeGateway } from "@/lib/use-gateway-connection";

/**
 * One run, as /api/gateway/research/ml/runs returns it.
 *
 * The provenance half is `MlRunProvenance`, declared by the capsule that
 * renders it — the run's identity and the table's measurements are two
 * different readings of the same row, and only one of them is what a re-run
 * needs.
 */
/**
 * The two evidence-bearing halves of `MLRunDetail`, and nothing else.
 *
 * A narrow local type rather than the generated one: this component reads two
 * fields, and binding to the whole shape would make it fail to compile over
 * changes it does not care about.
 */
interface MlRunDetail {
  features?: { spec_hash?: string | null } | null;
  folds?: Array<{ purge_bars: number; embargo_bars: number }>;
}

interface MlRun extends MlRunProvenance {
  oos_sharpe: number | null;
  deflated_sharpe: number | null;
  started_at: string;
  finished_at: string | null;
  error: string | null;
}

interface RunsPayload {
  observed_at: string;
  /**
   * "ok" — the corpus was read; `runs` is what it holds, empty or not.
   * "unavailable" — no corpus is configured, so nothing was asked.
   * "unreadable" — a corpus is configured and the read failed.
   *
   * The third exists because the store used to turn a failed read into an
   * empty list, so a rejected key rendered as "this desk has fitted nothing".
   */
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

  /**
   * Queue a fit, then poll the job until it settles.
   *
   * The panel could only ever report an empty corpus because nothing could put
   * anything in it. `notice` says what happened in the desk's own terms: a run
   * whose numbers are real but whose filing failed is a different outcome from
   * a run that did not happen, and both are different from a corpus that is
   * not configured.
   */
  const [fitting, setFitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fit = useCallback(async () => {
    setFitting(true);
    setNotice(null);
    try {
      const queued = await fetch("/api/gateway/research/ml/fit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: "BTCUSDT", interval: "4h", bars: 1500, model: "ridge" }),
        // `probeGateway` is GET-only — it coalesces by URL, and collapsing two
        // writes would drop one. So the deadline it would have carried is
        // stated here instead: a gateway that accepts and never answers must
        // not leave this button reading "Fitting…" for the life of the tab.
        signal: AbortSignal.timeout(GATEWAY_DEADLINE_MS),
      });
      if (!queued.ok) {
        const body = await queued.json().catch(() => ({}));
        // Scoped to the fit on purpose. Rendered bare, this sat beside the
        // corpus-read message and read as a statement about the corpus — which
        // had answered 200. Two different requests, two different facts.
        const why = typeof body.error === "string" ? body.error : `HTTP ${queued.status}.`;
        setNotice(`The fit could not be queued: ${why}`);
        return;
      }
      const { job_id: jobId } = await queued.json() as { job_id: string };
      // A purged walk-forward over 1500 bars is seconds, not milliseconds.
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        const polled = await probeGateway<{ status?: string; result?: Record<string, unknown> }>(
          `/api/gateway/jobs/${encodeURIComponent(jobId)}`,
        );
        if (!polled.ok) continue;
        const status = polled.payload.status;
        if (status === "succeeded") {
          const result = polled.payload.result ?? {};
          setNotice(result.persisted
            ? null
            : `The model was fitted and not filed: ${String(result.reason ?? "unknown reason")}. The run is real; the corpus is unchanged.`);
          await refresh();
          return;
        }
        if (status === "failed") {
          setNotice("The fit failed. Nothing was filed.");
          return;
        }
      }
      setNotice("The fit is still running. It will appear here once it settles.");
    } finally {
      setFitting(false);
    }
  }, [refresh]);

  const runs = load.status === "done" ? load.payload.runs : [];
  const succeeded = runs.filter((run) => run.status === "succeeded");
  /** The deflated Sharpes that exist. A run without one did not score zero. */
  const deflated = succeeded
    .map((run) => run.deflated_sharpe)
    .filter((value): value is number => value != null);

  /**
   * Which run the capsule describes.
   *
   * Derived rather than kept in sync by an effect: a refresh that drops the
   * chosen run falls back to the newest one on the next render, so the capsule
   * can never point at a row the table no longer shows.
   */
  const [chosenId, setChosenId] = useState<string | null>(null);
  const chosen = runs.find((run) => run.id === chosenId) ?? runs[0] ?? null;

  /*
   * The feature spec and the fold gaps come from a SECOND request, because
   * they are a second fact: the list route does not carry them, and filling
   * them in from anywhere else would be asserting a purge nobody had read.
   *
   * Keyed by run id and cleared on every change, so the capsule never shows
   * one run's purge beside another run's seed while the request is in flight.
   * A failure leaves it null, which the capsule renders as withheld with the
   * reason — the same answer as "not fetched yet", because from the reader's
   * side they are the same: this desk cannot currently say.
   */
  const [evidence, setEvidence] = useState<MlRunEvidence | null>(null);
  useEffect(() => {
    setEvidence(null);
    if (!chosen) return;
    let live = true;
    void (async () => {
      const outcome = await probeGateway<MlRunDetail>(
        `/api/gateway/research/ml/runs/${encodeURIComponent(chosen.id)}`,
      );
      if (!live || !outcome.ok) return;
      const folds = outcome.payload.folds ?? [];
      setEvidence({
        spec_hash: outcome.payload.features?.spec_hash ?? null,
        purge_bars: [...new Set(folds.map((f) => f.purge_bars))].sort((a, b) => a - b),
        embargo_bars: [...new Set(folds.map((f) => f.embargo_bars))].sort((a, b) => a - b),
      });
    })();
    return () => { live = false; };
  }, [chosen?.id]);

  return (
    <div className="card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Supervised research</span>
          <h2>Fitted models</h2>
        </div>
        <div className="console-inspector__controls" style={{ marginBottom: 0 }}>
          <button type="button" onClick={() => void fit()} disabled={fitting}>
            {fitting ? "Fitting…" : "Fit a model"}
          </button>
          <button type="button" className="text-action" onClick={() => void refresh()}>
            {load.status === "loading" ? "Reading…" : "Refresh"}
          </button>
        </div>
      </div>

      {load.status === "error" && (
        <p className="sub">
          {/* The failure messages already end in a full stop; appending another
              gave "…cannot reach.. This says nothing". */}
          The research corpus could not be reached: {load.message.replace(/\.$/, "")}. This says
          nothing about whether runs exist — it says the question could not be asked.
        </p>
      )}

      {notice && <p className="sub">{notice}</p>}

      {load.status === "done" && load.payload.state === "unreadable" && (
        <p className="sub">
          A research corpus is configured on this deployment and could not be read — a rejected
          key, a missing table, or a schema cache that has not caught up. This says nothing about
          whether runs exist; it says the question could not be answered.
        </p>
      )}

      {load.status === "done" && load.payload.state === "unavailable" && (
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
          {/* `?? 0` inside the max reported "0.00" as the best hurdle cleared
              on a corpus where no run scored one — the most reassuring reading
              of no information at all. Runs without the figure are dropped
              from the max, and a max over nothing is dashed. */}
          <StatTile
            label="Best deflated Sharpe"
            value={deflated.length > 0 ? fmt(Math.max(...deflated), 2) : "—"}
            note={deflated.length > 0
              ? "after paying for the search"
              : "no succeeded run scored one"}
            tone={deflated.length > 0 ? undefined : "muted"}
          />
          <StatTile
            label="Engines"
            value={[...new Set(succeeded.map((r) => r.engine))].join(", ")}
            note="a fallback run is a different run"
          />
        </div>
      )}

      {chosen && <MlRunCapsule run={chosen} evidence={evidence} />}

      {runs.length > 0 && (
        <div className="table-wrap" tabIndex={0}>
          <table>
            <caption className="sr-only">
              Supervised research runs, newest first, with their out-of-sample and deflated
              Sharpe ratios and the engine each ran on. Each model name is a button that shows
              that run in the reproducibility capsule above.
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
                  <td>
                    <button
                      type="button"
                      className="text-action"
                      aria-pressed={chosen?.id === run.id}
                      onClick={() => setChosenId(run.id)}
                    >
                      {run.model}
                    </button>
                  </td>
                  <td className="num">{run.symbol} {run.interval}</td>
                  <td>{run.engine}</td>
                  <td><Figure value={run.oos_sharpe} /></td>
                  <td><Figure value={run.deflated_sharpe} /></td>
                  {/* Not "not computed": PBO is null on every supervised run
                      because it does not apply to a run that fitted one
                      configuration, and those are opposite readings of the
                      same empty cell. */}
                  <td>
                    {run.pbo == null
                      ? <span className="muted" title={PBO_NOT_APPLICABLE}>not applicable</span>
                      : <Figure value={run.pbo} />}
                  </td>
                  {/* The hash, not a date: two runs over the same bars are
                      comparable and two over different bars are not, which is
                      the only thing this column is for. The tooltip is the
                      whole digest — it used to be the seed, which had nowhere
                      else to appear and now has the capsule. */}
                  <td className="num" title={run.data_hash}>{run.data_hash.slice(0, 8)}</td>
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
