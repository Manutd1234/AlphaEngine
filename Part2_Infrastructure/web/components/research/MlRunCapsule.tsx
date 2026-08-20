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
 * Two further fields are not on the run list this panel opens with. The feature
 * spec hash lives in `ml_features` and the per-fold purge and embargo in
 * `ml_folds`, both served by `GET /api/research/ml/runs/{run_id}`, which a
 * second request reads. Until it lands they are dashes that name where they
 * live rather than blanks: a purge that is absent and a purge of zero look
 * identical to a reader, and only one of them is safe.
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

/**
 * The two fields that decide whether the headline figures mean anything, read
 * from `GET /api/gateway/research/ml/runs/{runId}`.
 *
 * They are a separate type and a separate request because they are a separate
 * FACT: the list route does not carry them, and a capsule that filled them in
 * from anywhere else would be asserting a purge it had not read. Null here
 * still means withheld — the request has not landed, or the detail could not
 * be read — and never zero, because a fold that purged nothing and a fold
 * whose purge nobody recorded are opposite claims.
 */
export interface MlRunEvidence {
  spec_hash: string | null;
  /** Distinct purge values across the folds. One entry means every fold agreed. */
  purge_bars: number[];
  embargo_bars: number[];
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
  + "which this panel has not read back yet. A model is its features, so two runs are "
  + "only comparable once their spec hashes are.";

const NO_PURGE =
  "Purge and embargo are recorded per fold on the run detail record, "
  + "GET /api/research/ml/runs/{run_id}, which this panel has not read back yet. An "
  + "out-of-sample Sharpe from an unpurged fold is not out of sample.";

/**
 * Why a run can carry a null here — BOTH reasons, because the row cannot say
 * which one it is.
 *
 * This read "not applicable" for every null, which was true only while every
 * supervised run fitted a single configuration. A run with a candidate grid now
 * computes a PBO, so a null has become ambiguous: `modules/ml/selection.py`
 * returns one for a single configuration (it does not apply) and one for fewer
 * than `MIN_RANKED_FOLDS` ranked folds (it could not be computed), and
 * `modules/ml/fit.py` writes the sentence for each onto the FIT JOB's result.
 * Neither `MLRunSummary` nor `MLRunDetail` carries `pbo_basis` or `pbo_reason`,
 * so a run read back out of the corpus has the null and not the cause.
 *
 * Naming one cause would be inventing a distinction this app cannot read, and
 * "not applicable" is the flattering half of it — it tells a reader there was
 * nothing to compute when the figure may simply have failed to compute. So the
 * cell states both and claims neither.
 *
 * Exported because the table beside this capsule reports the same null, and one
 * string is what stops the two from drifting apart.
 */
export const PBO_UNSTATED =
  "No PBO is filed for this run, and the corpus records the null without its cause. "
  + "Either it does not apply — PBO ranks a selected configuration against the "
  + "alternatives it was selected from, and this run fitted one — or it could not be "
  + "computed, because too few folds ranked their selection for the fraction to be a "
  + "probability.";

const ENGINE_MEANING: Record<string, string> = {
  numpy: "The hand-rolled engine, used when the optional scikit-learn extra was absent. "
    + "This is a different run from an sklearn one and must not be ranked against it.",
  sklearn: "The optional scikit-learn extra was present and fitted this run.",
};

/** "12" for one agreed value, "12–20" when the folds differ. */
function describeGaps(values: number[]): string {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? `${low}` : `${low}–${high}`;
}

const GAPS_MEANING =
  "Bars dropped from the end of each training window because their labels reach "
  + "into the test window (purge), and from the start of the window that follows "
  + "a test window because serial correlation runs both ways (embargo). A range "
  + "means the folds did not agree. Zero is a claim, not an absence.";

export default function MlRunCapsule({ run, evidence }: {
  run: MlRunProvenance;
  /** Null until the detail request lands, or when it could not be read. */
  evidence?: MlRunEvidence | null;
}) {
  return (
    <>
      <div className="research-provenance" aria-label="Fitted model reproducibility capsule">
        <div className="research-provenance__lead">
          <span className="page-kicker">Reproducibility capsule</span>
          <strong>A fitted model is its seed, its code and its bars.</strong>
          <small>
            Run <code title={run.id}>{run.id.slice(0, 8)}</code>, {run.status}. Choose another
            row below to read its provenance.
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
            <dd>
              {evidence?.spec_hash == null
                ? <Withheld short="on the run detail" reason={NO_FEATURES} />
                : <code title={evidence.spec_hash}>{evidence.spec_hash.slice(0, DIGEST)}</code>}
            </dd>
          </div>
          <div>
            <dt>Purge</dt>
            <dd>
              {evidence == null || evidence.purge_bars.length === 0
                ? <Withheld short="on the run detail" reason={NO_PURGE} />
                : (
                  <span className="num" title={GAPS_MEANING}>
                    {describeGaps(evidence.purge_bars)} purged,{" "}
                    {describeGaps(evidence.embargo_bars)} embargoed
                  </span>
                )}
            </dd>
          </div>
          <div>
            <dt>PBO</dt>
            <dd>
              {run.pbo == null
                ? <Withheld short="none filed" reason={PBO_UNSTATED} />
                : <span className="num">{fmt(run.pbo, 2)}</span>}
            </dd>
          </div>
        </dl>
      </div>

      {/* 94 words, and most of them re-read the labels above. What is left is
          the one thing the columns cannot say for themselves: which four of
          them are the re-run set, and what a dash means. Each dash already
          carries its own cause on `title`. */}
      <p className="research-note">
        Re-running this model takes four of the fields above: seed, build, engine and dataset
        hash. A dash is a value withheld with its reason, never a zero.
      </p>
    </>
  );
}
