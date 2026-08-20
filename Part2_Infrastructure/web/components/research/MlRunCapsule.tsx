"use client";

/**
 * What it would take to re-run one fitted model, stated where the run is read.
 *
 * The Research tab already carries a reproducibility capsule, and it is built
 * for a sweep: instrument, dataset fingerprint, window, search size, runtime,
 * build. A fitted model cannot borrow it, because three of the fields that
 * decide whether an ML run is reproducible have no counterpart in a sweep, and
 * `ml_runs` records each one for a stated reason:
 *
 *   - `seed` is NOT NULL with no default. A run that cannot say which seed
 *     produced it cannot be re-run, and an irreproducible ML result is an
 *     anecdote.
 *   - `git_sha` is beside `data_hash` because a fitted model is a function of
 *     the code that fitted it in a way a moving average is not: two runs with
 *     the same data_hash and different shas are two different experiments.
 *   - `engine` is numpy or sklearn. A run that fell back to the hand-rolled
 *     engine is a different run and must say so rather than being silently
 *     comparable to one that did not.
 *
 * `data_hash` is the field both capsules share, and it means the same thing in
 * each — the exact bars the run saw — which is what makes a sweep and a fit
 * over one window comparable rather than merely adjacent.
 *
 * Two further fields belong here and are not on the wire this panel reads. The
 * feature spec hash lives in `ml_features`, the per-fold purge and embargo in
 * `ml_folds`, and both are served only by `GET /api/research/ml/runs/{run_id}`,
 * for which this app has no proxy route. They are rendered as dashes that name
 * where they live rather than left out: a purge that is absent and a purge of
 * zero look identical to a reader, and only one of them is safe.
 */

import { fmt } from "@/lib/format";

/** The provenance half of one row of `ml_runs`, as the run list returns it. */
export interface MlRunProvenance {
  id: string;
  model: string;
  symbol: string;
  interval: string;
  /** The exact bars the run saw. Same meaning as a sweep's dataset hash. */
  data_hash: string;
  /**
   * Typed nullable although the column forbids it. A corpus that answered with
   * no seed would be a corpus this panel must not present as reproducible, and
   * an unconditional `{run.seed}` would render that as an empty cell.
   */
  seed: number | null;
  /** The tree that fitted it. Null on a build made without git. */
  git_sha: string | null;
  engine: string;
  pbo: number | null;
  status: string;
}

/** How many characters of a digest a reader can compare at a glance. */
const DIGEST = 12;

/**
 * A field with no value, and why — never a blank, never a stand-in figure.
 *
 * The dash carries the absence and the muted phrase carries the cause; the
 * full sentence rides on `title`, which the print stylesheet also expands.
 */
function Withheld({ reason, short }: { reason: string; short: string }) {
  return (
    <>
      —{" "}
      <span className="muted" title={reason}>{short}</span>
    </>
  );
}

const NO_SEED =
  "The corpus returned this run without a seed, which its own schema forbids. "
  + "Treat the run as irreproducible rather than assuming a default.";

const NO_SHA =
  "This run was fitted by a build with no git tree to record, so the code that "
  + "produced it cannot be named. The bars are still pinned by the dataset hash.";

const NO_FEATURES =
  "The feature spec hash is on the run detail record, GET /api/research/ml/runs/{run_id}, "
  + "which this app does not proxy. A model is its features, so two runs are only "
  + "comparable once their spec hashes are.";

const NO_PURGE =
  "Purge and embargo are recorded per fold on the run detail record, "
  + "GET /api/research/ml/runs/{run_id}, which this app does not proxy. An "
  + "out-of-sample Sharpe from an unpurged fold is not out of sample.";

/**
 * Why every ML run in this corpus carries a null here, from modules/ml/fit.py.
 *
 * Exported because the table beside this capsule reports the same null, and
 * fit.py's own comment is the argument for keeping the two in one place: "a
 * null column with no explanation reads as a figure that failed to compute
 * rather than one that does not apply".
 */
export const PBO_NOT_APPLICABLE =
  "Not applicable: PBO ranks a selected configuration against the "
  + "alternatives it was selected from, and this run fitted one.";

const ENGINE_MEANING: Record<string, string> = {
  numpy: "The hand-rolled engine, used when the optional scikit-learn extra was absent. "
    + "This is a different run from an sklearn one and must not be ranked against it.",
  sklearn: "The optional scikit-learn extra was present and fitted this run.",
};

export default function MlRunCapsule({ run }: { run: MlRunProvenance }) {
  return (
    <>
      <div className="research-provenance" aria-label="Fitted model reproducibility capsule">
        <div className="research-provenance__lead">
          <span className="page-kicker">Reproducibility capsule</span>
          <strong>A fitted model is its seed, its code and its bars.</strong>
          <small>
            Run <code title={run.id}>{run.id.slice(0, 8)}</code>, {run.status}. Choose another
            model in the table below to read its provenance here.
          </small>
        </div>
        <dl>
          <div>
            <dt>Model</dt>
            <dd>{run.model}</dd>
          </div>
          <div>
            <dt>Instrument</dt>
            <dd className="num">{run.symbol} at {run.interval}</dd>
          </div>
          <div>
            <dt>Dataset</dt>
            <dd><code title={run.data_hash}>{run.data_hash.slice(0, DIGEST)}</code></dd>
          </div>
          <div>
            <dt>Seed</dt>
            <dd className="num">
              {run.seed == null
                ? <Withheld short="no seed filed" reason={NO_SEED} />
                : run.seed}
            </dd>
          </div>
          <div>
            <dt>Build</dt>
            <dd>
              {run.git_sha == null
                ? <Withheld short="built without git" reason={NO_SHA} />
                : <code title={run.git_sha}>{run.git_sha.slice(0, DIGEST)}</code>}
            </dd>
          </div>
          <div>
            <dt>Engine</dt>
            <dd title={ENGINE_MEANING[run.engine]}>{run.engine}</dd>
          </div>
          <div>
            <dt>Features</dt>
            <dd><Withheld short="on the run detail" reason={NO_FEATURES} /></dd>
          </div>
          <div>
            <dt>Purge</dt>
            <dd><Withheld short="on the run detail" reason={NO_PURGE} /></dd>
          </div>
          <div>
            <dt>PBO</dt>
            <dd>
              {run.pbo == null
                ? <Withheld short="not applicable" reason={PBO_NOT_APPLICABLE} />
                : <span className="num">{fmt(run.pbo, 2)}</span>}
            </dd>
          </div>
        </dl>
      </div>

      <p className="research-note">
        Re-running this model exactly takes four of the fields above — the seed, the build that
        fitted it, the engine it ran on, and the bars the dataset hash names. Two more belong here
        and are dashed rather than dropped: the feature spec hash and the per-fold purge and
        embargo are both recorded, and only the run detail record serves them, which nothing on
        this deployment reads. PBO is null on every supervised run by design, and the dash says so
        rather than leaving a gap that reads as a figure which failed to compute.
      </p>
    </>
  );
}
