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

import { useCallback, useEffect, useRef, useState } from "react";

import MlRunCapsule, {
  PBO_UNSTATED, type MlRunEvidence, type MlRunProvenance,
} from "@/components/research/MlRunCapsule";
import { runsView } from "@/components/research/runs-view";
import StatTile from "@/components/StatTile";
import { fmt } from "@/lib/format";
import { useDeskSource } from "@/lib/use-desk-source";
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

function Figure({ value, places = 2 }: { value: number | null; places?: number }) {
  // A missing figure is not a small one. "not computed" is what the corpus
  // stores and what this shows, rather than an em dash that reads as zero.
  if (value == null) return <span className="muted">not computed</span>;
  return <span className="num">{fmt(value, places)}</span>;
}

export default function FittedModels() {
  /*
   * The corpus list rides `DeskSourceMachine`, not a Load union: the union
   * this replaces blanked the table on every refresh and swapped it for a
   * failure card on one failed probe, so a flaky gateway alternated the two.
   * The machine holds the last measured list through any failure; `runsView`
   * decides what renders, and `research-stability.test.ts` replays the flap.
   */
  const corpus = useDeskSource<RunsPayload>();
  const { observe } = corpus;
  /** A read in flight — a button label, never a reason to blank the table. */
  const [reading, setReading] = useState(false);
  const readingNow = useRef(false);

  const refresh = useCallback(async () => {
    // One settled probe, observed once: `probeGateway` coalesces concurrent
    // callers, so an unguarded second call would feed the same outcome to the
    // machine twice and move the promotion streak on one packet.
    if (readingNow.current) return;
    readingNow.current = true;
    setReading(true);
    try {
      observe(await probeGateway<RunsPayload>("/api/gateway/research/ml/runs?limit=25"));
    } finally {
      readingNow.current = false;
      setReading(false);
    }
  }, [observe]);

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
            : `Fitted but not filed: ${String(result.reason ?? "unknown reason")}. The run is real; the corpus is unchanged.`);
          await refresh();
          return;
        }
        if (status === "failed") {
          setNotice("The fit failed. Nothing was filed.");
          return;
        }
      }
      setNotice("Still running; it appears here once it settles.");
    } finally {
      setFitting(false);
    }
  }, [refresh]);

  const view = runsView(corpus.state);
  const payload = view.kind === "runs" ? view.payload : null;
  const runs = payload ? payload.runs : [];
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
            {reading ? "Reading…" : "Refresh"}
          </button>
        </div>
      </div>

      {view.kind === "connecting" && (
        <p className="sub">Reading the research corpus…</p>
      )}

      {view.kind === "unreachable" && (
        <p className="sub">
          {/* The failure messages already end in a full stop; appending another
              gave "…cannot reach.. This says nothing". */}
          The research corpus could not be reached: {view.reason.replace(/\.$/, "")}. Not the
          same as no runs existing.
        </p>
      )}

      {view.kind === "runs" && view.caution !== null && (
        /* One sentence for the whole episode, independent of `caution.reason`
           on purpose — copy switching on it would alternate two sentences at
           the poll cadence. See runs-view.ts. */
        <p className="sub" role="status">
          The corpus is not answering reliably; this list is the last read that succeeded.
          Not the same as an empty corpus.
        </p>
      )}

      {notice && <p className="sub">{notice}</p>}

      {payload?.state === "unreadable" && (
        <p className="sub">
          A configured research corpus could not be read — a rejected key, a missing table, a
          stale schema cache. Not an empty corpus.
        </p>
      )}

      {payload?.state === "unavailable" && (
        <p className="sub">
          No research corpus is configured, so runs still execute but nothing is filed.
        </p>
      )}

      {payload?.state === "ok" && runs.length === 0 && (
        <p className="sub">
          The corpus is reachable and holds no supervised runs yet.
        </p>
      )}

      {succeeded.length > 0 && (
        /* The wrapper this row used to carry had no rule anywhere in
           globals.css — the name is deliberately not repeated here, so the
           dead-CSS scan cannot score a re-added rule as live off a comment —
           and three tiles for three short facts stacked full width with their
           borders touching. `.tiles` is the desk's tile row; the modifier
           gives it three tracks, the way `.stability-tiles` gives it four. */
        <div className="tiles ml-run-tiles">
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
          {/* A NAME, not a figure. The tile's value rung is `--fs-figure`,
              which set "numpy" in 26px of display type beside two tiles whose
              values are measurements. `.stat-word` steps the word down without
              hand-rolling a tile around it. */}
          <StatTile
            label="Engines"
            value={<span className="stat-word">{[...new Set(succeeded.map((r) => r.engine))].join(", ")}</span>}
            note="a fallback run is a different run"
          />
        </div>
      )}

      {chosen && <MlRunCapsule run={chosen} evidence={evidence} />}

      {runs.length > 0 && (
        <div className="table-wrap" tabIndex={0}>
          <table>
            <caption className="sr-only">
              Supervised research runs, newest first. Each model name shows that run in the
              capsule above.
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
                  {/* Not "not applicable", which this cell used to say for
                      every null. A run with a candidate grid computes a PBO
                      now, so a null means either that or too few ranked folds
                      — and nothing on the wire says which. "None filed" is
                      true of both; the reason names the pair. */}
                  <td>
                    {run.pbo == null
                      ? <span className="muted" title={PBO_UNSTATED}>none filed</span>
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

      {/* Two facts the columns cannot say: they are all out of sample, and a
          failed row can be asked why. */}
      <p className="research-note">
        Every figure here is out of sample; a <strong>failed</strong> run carries its reason on
        the status cell.
      </p>
    </div>
  );
}
