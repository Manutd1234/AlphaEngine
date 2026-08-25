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
import Figure, { FigureEmpty, Plot } from "../Figure";
import type { StageRun } from "./types";

const WORD: Record<string, string> = { release: "Statement", call: "Press conference" };
const MARK: Record<string, string> = { release: "●", call: "▲" };

/** Ten buckets across [0, 1]. A percentile of exactly 1 belongs in the last. */
const BUCKETS = 10;
const ROW = 108;
const HEAD = 20;
const HIST = 62;
const UNRANKED_W = 22;
const PAD = { top: 4, bottom: 6 };

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
      {/* SVG INSIDE `<Plot>` SINCE 2026-08-25. It was HTML with `title`
          ATTRIBUTES, and `useMarkReadout` collects SVG `<title>` CHILDREN, so
          every bucket here was reachable by mouse and by nothing else — the
          Control view measured 26 hoverable facts and 0 keyboard stops. The
          geometry is unchanged; the medium is what moved. */}
      <Plot height={PAD.top + stages.length * ROW + PAD.bottom} minWidth={420}>
        {(width) => (
          <>
            {stages.map((row, rowIndex) => {
              const top = PAD.top + rowIndex * ROW;
              const baseline = top + HEAD + HIST;
              const span = Math.max(120, width);
              const unrankedW = row.unranked ? UNRANKED_W : 0;
              const histW = span - (unrankedW ? unrankedW + 12 : 0);
              const bucketW = histW / BUCKETS;
              const label = WORD[row.stage] ?? row.stage;
              return (
                <g key={row.stage}>
                  <text className="diff-bars__svghead" x={0} y={top + 12}>
                    {MARK[row.stage]} {label}
                  </text>
                  {/* "11 of 42 ranked" rather than "11 ranked, 31 without a
                      percentile": the long form was CLIPPED at desk width when
                      this was a flex row. Same two numbers, and the denominator
                      is the more useful of them. */}
                  <text className="diff-bars__svgcount" x={span} y={top + 12} textAnchor="end">
                    {row.ranked} of {row.ranked + row.unranked} ranked
                  </text>

                  {row.counts.map((count, index) => {
                    const low = index / BUCKETS;
                    const high = (index + 1) / BUCKETS;
                    const h = tallest ? (count / tallest) * HIST : 0;
                    return (
                      <rect
                        key={low}
                        className={`coh-floor__svgbucket${index === BUCKETS / 2 ? " is-middle" : ""}`}
                        x={index * bucketW + 1}
                        y={baseline - h}
                        width={Math.max(1, bucketW - 2)}
                        height={h}
                      >
                        <title>
                          {`${count} run${count === 1 ? "" : "s"} at ${low.toFixed(1)}-${high.toFixed(1)}`
                            + ` — ${percentileWord((low + high) / 2)}`}
                        </title>
                      </rect>
                    );
                  })}

                  {row.unranked ? (
                    // FULL HEIGHT, NOT A SCALED ONE. This column is off the
                    // percentile axis by design — a missing rank is not a rank
                    // of zero — so scaling it against the tallest BUCKET was a
                    // category error twice over: it invited comparison with
                    // bars it cannot be compared to, and with 31 unranked runs
                    // against a tallest bucket of nine it computed 344% and
                    // drew a 217px bar inside a 64px row.
                    //
                    // It marks presence. The count is in the row head and in
                    // the readout, where a number belongs; the column says only
                    // "these are not on this scale".
                    <rect
                      className="coh-floor__svgbucket is-unranked"
                      x={span - unrankedW}
                      y={baseline - HIST}
                      width={unrankedW}
                      height={HIST}
                    >
                      <title>
                        {`${row.unranked} run${row.unranked === 1 ? "" : "s"} with no percentile`
                          + " — off this axis, so the height carries no reading"}
                      </title>
                    </rect>
                  ) : null}

                  <line className="diff-effect__axis" x1={0} x2={span} y1={baseline} y2={baseline} />
                  <text className="coh-svg-note" x={0} y={baseline + 16}>0.0 faster</text>
                  <text className="coh-svg-note" x={histW / 2} y={baseline + 16} textAnchor="middle">
                    0.5 indistinguishable
                  </text>
                  <text className="coh-svg-note" x={histW} y={baseline + 16} textAnchor="end">1.0 slower</text>
                </g>
              );
            })}
          </>
        )}
      </Plot>
    </Figure>
  );
}
