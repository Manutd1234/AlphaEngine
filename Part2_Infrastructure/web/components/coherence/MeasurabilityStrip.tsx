"use client";

/**
 * How much of a recorded series is a reading, and how much is a gap.
 *
 * WHAT THIS DRAWS THAT A BROKEN LINE CANNOT. Both series on this tab refuse to
 * bridge a gap — `IndexPane`'s chart breaks at every unmeasurable poll and
 * `CalibrationTrend` at every run that declined to score — which is the right
 * refusal, since a line closed over a gap asserts a reading nobody took. But a
 * broken line is a poor picture of its own breaks: the gaps are white space
 * between segments, so coverage was legible only from a footnote that counted
 * them. On a thin watchlist the gaps are MOST of the record, and a reader who
 * takes that white space for "nothing happening" has the record backwards.
 *
 * So this is the same time axis with the coverage on it: a filled run is marks
 * that could be measured, an outlined one is marks that could not, and the two
 * are drawn end to end so their share is a length. It is deliberately short —
 * it is a series' legend about itself, not a second chart.
 *
 * TWO CALLERS, ONE STRIP, and the second is why it takes marks rather than a
 * payload. The index draws it under its line; the settled trend draws it in
 * place of a line, because on a corpus where nothing has settled every recorded
 * run declines to score and the trend's only other honest answer is an empty
 * frame under a caption. A record of the recorder RUNNING against a corpus that
 * will not score is a different fact from a gap in the record, and it is one
 * this strip can show where a line cannot.
 *
 * ITS OWN FILE BECAUSE `IndexPane` IS AT THE CEILING — 393 lines of the house's
 * 400 when this was written, and the rule here is to SPLIT rather than shave
 * prose to buy a line.
 *
 * A RUN IS CONTIGUOUS MARKS OF ONE KIND, NEVER A TIME BUCKET. Bucketing by
 * clock would merge a one-mark gap into the run beside it and draw a record
 * more continuous than the one that was kept. The x positions are the marks'
 * own timestamps, so an outage that lasted an hour is an hour wide.
 *
 * It fetches nothing: both callers already hold every mark, its timestamp and
 * the reason it could not be measured.
 */

import Figure, { FigureEmpty, Plot } from "./Figure";
import { clock } from "./IndexBasisChart";

const HEIGHT = 62;
const TRACK_Y = 16;
const TRACK_H = 18;
const PAD = 4;
/** The tape stores nanoseconds; a clock label wants milliseconds. */
const NS_PER_MS = 1_000_000;

/** One recorded moment, and whether it produced a number. */
export interface CoverageMark {
  ts: number;
  measured: boolean;
  /** Why it could not be measured, as the recorder wrote it. */
  detail: string | null;
}

interface Run extends CoverageMark {
  from: number;
  to: number;
  count: number;
}

/** Contiguous marks of one kind, in the order the tape kept them. */
export function runsOf(marks: CoverageMark[]): Run[] {
  const runs: Run[] = [];
  for (const mark of marks) {
    const last = runs[runs.length - 1];
    if (last && last.measured === mark.measured) {
      last.to = mark.ts;
      last.count += 1;
      continue;
    }
    runs.push({ ...mark, from: mark.ts, to: mark.ts, count: 1 });
  }
  return runs;
}

export default function MeasurabilityStrip({
  marks,
  /** The noun for one mark — "poll" on the index, "run" on the trend. */
  subject,
  caption,
  reading,
  notes = [],
}: {
  marks: CoverageMark[];
  subject: string;
  caption: string;
  /** Said only when the caller has something the share does not say. */
  reading?: string | null;
  notes?: readonly string[];
}) {
  const runs = runsOf(marks);
  const measured = marks.filter((mark) => mark.measured).length;
  const gaps = runs.filter((run) => !run.measured);

  if (!marks.length) {
    return (
      <Figure
        caption={caption}
        ariaLabel={`No ${subject} has been recorded`}
        missing={`Nothing has been recorded yet, so there is no record to describe.`}
      >
        <FigureEmpty reason={`No ${subject} recorded yet.`} />
      </Figure>
    );
  }

  const first = marks[0].ts;
  const last = marks[marks.length - 1].ts;
  const span = Math.max(1, last - first);
  const share = Math.round((measured / marks.length) * 100);

  return (
    <Figure
      caption={caption}
      ariaLabel={
        `${marks.length} ${subject}s between ${clock(first / NS_PER_MS)} and ${clock(last / NS_PER_MS)} UTC, `
        + `${measured} measured across ${runs.filter((run) => run.measured).length} unbroken runs`
      }
      reading={reading ?? `${share}% of the record is a reading; the outlined stretches are ${subject}s nobody could measure.`}
      notes={[
        gaps.length
          ? `${gaps.length} stretch(es) could not be measured, and each is kept with its reason rather than dropped.`
          : `Every ${subject} in this record could be measured.`,
        `A run is contiguous ${subject}s of one kind, never a time bucket: bucketing would merge a one-${subject} gap `
        + "into the run beside it and draw a record more continuous than the one that was kept.",
        ...notes,
      ]}
    >
      <Plot height={HEIGHT}>
        {(width) => {
          const track = Math.max(40, width - PAD * 2);
          const x = (ts: number) => PAD + ((ts - first) / span) * track;
          return (
            <>
              <rect x={PAD} y={TRACK_Y} width={track} height={TRACK_H} className="coh-combo__track" />
              {runs.map((run, index) => {
                // A single-mark run has no width of its own; it still has to be
                // visible, or a one-poll outage would vanish into the run beside
                // it and the record would look cleaner than it was.
                const from = x(run.from);
                const to = Math.max(x(run.to), from + 2);
                const when = `${clock(run.from / NS_PER_MS)} to ${clock(run.to / NS_PER_MS)} UTC`;
                const hover = run.measured
                  ? `${run.count} ${subject}(s) measured, ${when}`
                  : `${run.count} ${subject}(s) unmeasurable, ${when}`
                    + `${run.detail ? ` — ${run.detail}` : " — no reason recorded"}`;
                return (
                  <rect
                    key={`${run.from}-${index}`}
                    x={from}
                    y={TRACK_Y}
                    width={to - from}
                    height={TRACK_H}
                    className={run.measured ? "coh-surface__bar" : "coh-cover__gap"}
                  >
                    <title>{hover}</title>
                  </rect>
                );
              })}
              <text x={PAD} y={HEIGHT - 6} className="coh-ladder__tick">
                {clock(first / NS_PER_MS)} UTC
              </text>
              <text x={width - PAD} y={HEIGHT - 6} textAnchor="end" className="coh-ladder__tick">
                {clock(last / NS_PER_MS)} UTC
              </text>
              {/* The key names both marks in words, so nothing here means
                  anything by fill alone. */}
              <text x={width / 2} y={HEIGHT - 6} textAnchor="middle" className="coh-combo__key">
                ▪ measured ▫ unmeasurable
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
