"use client";

/**
 * Where every measured stage sat against no-news windows — the whole distribution.
 *
 * `StageBars` beside this draws two aggregate bars per stage: how many cleared
 * the floor, and the MEDIAN percentile. A median is a summary of a distribution
 * rather than a picture of one, and here the picture is the argument. The
 * study's central claim is comparative — a stage is fast or slow *against
 * matched windows on prior days at the same clock time* — so whether those
 * comparisons cluster at one end, spread evenly, or pile up at 0.5 is the thing
 * a reader needs and cannot get from two numbers.
 *
 * NO NEW GATEWAY DATA. Every run in the absorption payload already carries its
 * own `control_percentile`; this is a second reading of a field that was already
 * on the wire and drawn only in aggregate. A figure that needed a new route
 * would have been a schema change wearing a chart's clothes.
 *
 * A RUN WITH NO PERCENTILE GETS ITS OWN COLUMN, outside the axis. That is the
 * house rule at its sharpest: a stage whose matched windows never cleared the
 * floor has NO percentile, and bucketing it at zero would place it at "faster
 * than every no-news window" — the exact opposite of what it means. It is
 * counted, labelled, and kept off the scale.
 *
 * THE WORDS COME FROM `StageBars`. `percentileWord` already owns the vocabulary
 * for this axis — "faster than nearly every no-news window",
 * "indistinguishable from a no-news window" — and importing it rather than
 * writing a second set is what stops two figures describing one number
 * differently.
 *
 * Bars are HTML rather than SVG, like `StageBars`, so the hover line every mark
 * on this tab carries is the element's own `title` attribute.
 */

import { percentileWord } from "./StageBars";
import Figure, { FigureEmpty } from "../Figure";
import type { StageRun } from "./types";

const WORD: Record<string, string> = { release: "Statement", call: "Press conference" };
const MARK: Record<string, string> = { release: "●", call: "▲" };

/** Ten buckets across [0, 1]. A percentile of exactly 1 belongs in the last. */
const BUCKETS = 10;

interface StageRow {
  stage: string;
  counts: number[];
  ranked: number;
  unranked: number;
}

function rows(runs: StageRun[]): StageRow[] {
  const byStage = new Map<string, StageRow>();
  for (const run of runs) {
    if (run.signal_state !== "ok") continue;
    const row = byStage.get(run.stage)
      ?? { stage: run.stage, counts: Array.from({ length: BUCKETS }, () => 0), ranked: 0, unranked: 0 };
    byStage.set(run.stage, row);
    if (run.control_percentile == null) {
      row.unranked += 1;
      continue;
    }
    const index = Math.min(BUCKETS - 1, Math.max(0, Math.floor(run.control_percentile * BUCKETS)));
    row.counts[index] += 1;
    row.ranked += 1;
  }
  // Statement before press conference, which is the order they happen in.
  return [...byStage.values()].sort((a, b) => (a.stage === "release" ? -1 : 1) - (b.stage === "release" ? -1 : 1));
}

export default function FloorDistribution({ runs }: { runs: StageRun[] }) {
  const stages = rows(runs);
  const measured = stages.reduce((total, row) => total + row.ranked, 0);

  if (!measured) {
    return (
      <Figure
        caption="Where each measured stage sat against matched windows with no news"
        ariaLabel="No stage has both cleared the noise floor and been ranked against control windows"
        missing="A stage is ranked only once it has cleared the floor AND enough matched windows cleared it too, so an empty distribution here is two conditions rather than one."
      >
        <FigureEmpty reason="No stage has been ranked against a control window yet." />
      </Figure>
    );
  }

  const tallest = Math.max(1, ...stages.flatMap((row) => row.counts));
  const unranked = stages.reduce((total, row) => total + row.unranked, 0);

  return (
    <Figure
      caption="Where each measured stage sat against matched windows with no news"
      ariaLabel={`Distribution of control percentiles in ${BUCKETS} buckets for ${stages.length} stages over ${measured} ranked runs`}
      reading="Mass at the left is absorption faster than an ordinary half hour; mass around the middle is a stage that finished no faster than the market finishes anything, whatever its half-life says in seconds."
      // LEADS WITH THE RATIO, because the ratio is the caveat. This used to
      // open "70 measured stages have no percentile", which gives a reader no
      // way to tell whether 70 is most of them or a handful — on the live
      // ledger it is 70 of 89, so the histogram above is drawn from 19 runs and
      // a reader who missed that is reading a distribution of the wrong thing.
      //
      // The sentence that followed it explained the IMPLEMENTATION — why an
      // unranked run is kept off the axis rather than bucketed at zero — which
      // is a decision about the code rather than a fact about the data, and it
      // now lives in the comment on that column instead.
      missing={
        unranked
          ? `Only ${measured} of ${measured + unranked} measured stages are ranked here: the rest had no `
            + "matched window clear the floor, so they sit in the column off the axis rather than at zero."
          : null
      }
    >
      <div className="diff-bars">
        {stages.map((row) => (
          <div className="diff-bars__row" key={row.stage}>
            <div className="diff-bars__head">
              <span aria-hidden="true">{MARK[row.stage]}</span> {WORD[row.stage] ?? row.stage}
              <span className="diff-bars__count">
                {/* "11 of 42 ranked" rather than "11 ranked, 31 without a
                    percentile": the long form was CLIPPED at desk width — the
                    head is a flex row and the right-hand text had nowhere to
                    go, so it lost the word that made it mean anything. Same two
                    numbers, and the denominator is the more useful of them. */}
                {row.ranked} of {row.ranked + row.unranked} ranked
              </span>
            </div>

            <div className="coh-floor__buckets" role="img"
                 aria-label={`${WORD[row.stage] ?? row.stage}: ${row.ranked} runs across ${BUCKETS} percentile buckets`}>
              {row.counts.map((count, index) => {
                const low = index / BUCKETS;
                const high = (index + 1) / BUCKETS;
                return (
                  <span
                    key={low}
                    className={`coh-floor__bucket${index === BUCKETS / 2 ? " is-middle" : ""}`}
                    style={{ height: `${(count / tallest) * 100}%` }}
                    title={`${count} run(s) between ${low.toFixed(1)} and ${high.toFixed(1)} — ${percentileWord((low + high) / 2)}`}
                  />
                );
              })}
              {row.unranked ? (
                <span
                  className="coh-floor__bucket is-unranked"
                  style={{ height: `${(row.unranked / tallest) * 100}%` }}
                  title={`${row.unranked} run(s) with no percentile: no matched window cleared the floor, so they are not ranked at all`}
                />
              ) : null}
            </div>

            <div className="diff-bars__foot">
              <span className="coh-svg-note">0.0 faster</span>
              <span className="coh-svg-note">0.5 indistinguishable</span>
              <span className="coh-svg-note">1.0 slower</span>
            </div>
          </div>
        ))}
      </div>
    </Figure>
  );
}
