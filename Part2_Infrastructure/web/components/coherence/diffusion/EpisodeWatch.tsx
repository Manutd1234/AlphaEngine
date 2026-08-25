"use client";

/**
 * The recorder's own clock: when it has looked, when it did not, and when it
 * looks next.
 *
 * THE EMPTY TAPE IS THE LIVE CASE, not an edge one. `/api/coherence/episodes`
 * answers `state: "empty"` here — no violation has opened and closed — so this
 * is what the section shows anyone looking at the desk today.
 *
 * WHAT THIS REPLACED, and why it had to go. The previous figure drew three
 * bands on a log axis: what an episode could never outlive, what might be
 * missed, and what would be recorded. Measured on the live desk it had five
 * marks, every one of them restating one of two constants, and NOTHING was
 * encoded in y. Worse, its own label guard was `x1 - x0 > 96`, and the leftmost
 * band spans 9.3% of the plot — so that label needed a plot wider than 1,030px
 * and was never drawn at any desk width. It read as one enormous rectangle with
 * an unlabelled sliver at each end.
 *
 * AND IT ASSERTED TWO THINGS THAT ARE NOT TRUE.
 *
 * `round_trip_s` was not a measurement. The route declared it
 * `Query(default="0.240")` and `lib/coherence/routes.ts` never passed it, so
 * the desk drew the server echoing its own default back, labelled as though
 * something had timed it. It was named an ASSUMPTION here, and on 2026-08-26
 * the gateway started timing its own reads — so the payload now says WHICH it
 * carries and the figure follows `round_trip_source` rather than assuming.
 *
 * A MEASURED READ IS STILL A LOWER BOUND ON AN ORDER, which is why the word
 * even in the measured case names the reads it came from. An order carries a
 * signature, is written rather than read, and queues behind a matching engine.
 *
 * The recordable floor is two polls, not one. `episodes.py:37` sets
 * `POLLS_TO_CLOSE = 2` and `closed_ts_ns` is the SECOND coherent poll's
 * timestamp, so at a 300s cadence nothing shorter than about ten minutes can be
 * recorded at all. The old reading said "shorter than one poll", which
 * understated the blind spot by half.
 *
 * WHAT IS DRAWN NOW IS THE WATCH ITSELF, on two rows with two honest scales.
 * The top row is every poll the recorder has taken across the tape's real span,
 * one mark each — including the stretches where it was not looking, which are
 * hatched rather than left blank. The bottom row is the interval in progress.
 * Both are live; neither invents an episode, a lifetime or a threshold.
 *
 * The two rows do NOT share an x axis and are not drawn as though they do. A
 * poll interval is 300s against a tape spanning about twenty-seven hours — 0.3%
 * of the width — so putting the countdown on the time axis would render it
 * invisible and imply a precision the drawing does not have.
 */

import Figure, { FigureEmpty, Plot, StateChip } from "../Figure";
import type {
  CoherenceEpisodes,
  CoherenceIndexPoint,
  CoherenceStatus,
} from "@/lib/coherence/types";

const HEIGHT = 190;
const MARGIN = { top: 46, right: 20, bottom: 34, left: 20 };
const TAPE_H = 26;
// 122, not 108. At 108 the second row's own label sat in the tape's end-label
// box — measured, "the interval in progress" overlapped "08-24 13:07" at every
// width, because the two rows were eleven pixels apart and one is 13px type
// over a 10px tick.
const NEXT_TOP = 122;
const NEXT_H = 12;
/** A gap wider than this many polls is the recorder not looking, not jitter. */
const OUTAGE_POLLS = 2;

/** Read a count off the untyped `tape` bag without inventing a zero for it. */
function tapeCount(status: CoherenceStatus | null, key: string): number | null {
  const value = status?.tape?.[key];
  return typeof value === "number" ? value : null;
}

function seconds(value: number): string {
  if (value < 1) return `${Math.round(value * 1000)}ms`;
  if (value < 90) return `${value % 1 === 0 ? value : value.toFixed(1)}s`;
  if (value < 5400) return `${Math.round(value / 60)}m`;
  return `${(value / 3600).toFixed(1)}h`;
}

function clock(ms: number): string {
  return new Date(ms).toISOString().slice(5, 16).replace("T", " ");
}

interface Poll {
  /** Milliseconds, from the first reading in the cluster. */
  readonly at: number;
  /** How many events the recorder read on that visit. */
  readonly readings: number;
}

/**
 * The readings, clustered back into the polls that wrote them.
 *
 * Each poll writes one reading per EVENT, not one per family, so 757 readings
 * are 218 visits. Anything closer together than a poll interval belongs to the
 * same visit; the cut is deliberately generous because a poll takes real time
 * to walk its watchlist.
 */
function pollsOf(points: readonly CoherenceIndexPoint[], pollSeconds: number): Poll[] {
  const stamps = points
    .map((point) => Number(point.ts_ns) / 1e6)
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
  if (!stamps.length) return [];

  const cut = Math.max(1, pollSeconds) * 1000 * 0.5;
  const out: Poll[] = [{ at: stamps[0], readings: 1 }];
  for (let i = 1; i < stamps.length; i += 1) {
    const last = out[out.length - 1];
    if (stamps[i] - last.at > cut) out.push({ at: stamps[i], readings: 1 });
    else out[out.length - 1] = { at: last.at, readings: last.readings + 1 };
  }
  return out;
}

/** The stretches between polls where the recorder was not looking. */
function outagesOf(polls: readonly Poll[], pollSeconds: number) {
  const limit = Math.max(1, pollSeconds) * 1000 * OUTAGE_POLLS;
  const out: Array<{ from: number; to: number }> = [];
  for (let i = 1; i < polls.length; i += 1) {
    if (polls[i].at - polls[i - 1].at > limit) out.push({ from: polls[i - 1].at, to: polls[i].at });
  }
  return out;
}

export default function EpisodeWatch({ data, status, points }: {
  data: CoherenceEpisodes;
  status: CoherenceStatus | null;
  points: readonly CoherenceIndexPoint[];
}) {
  const recorder = status?.recorder ?? null;
  const roundTrip = Number(data.round_trip_s);
  const pollSeconds = recorder?.poll_seconds ?? null;
  const snapshots = tapeCount(status, "book_snapshots");
  const indexRows = tapeCount(status, "coherence_index_rows");
  const recorded = tapeCount(status, "violation_episodes");

  const polls = pollSeconds ? pollsOf(points, pollSeconds) : [];
  const outages = pollSeconds ? outagesOf(polls, pollSeconds) : [];
  const since = recorder?.seconds_since_last_poll ?? null;
  const first = polls.length ? polls[0].at : null;
  const last = polls.length ? polls[polls.length - 1].at : null;
  const missed = outages.reduce(
    (total, gap) => total + Math.round((gap.to - gap.from) / 1000 / Math.max(1, pollSeconds ?? 1)) - 1,
    0,
  );
  // Two polls to close, so this is the shortest lifetime the tape can record —
  // not one poll, which is what this figure used to imply.
  const floor = pollSeconds ? pollSeconds * 2 : null;

  return (
    <>
      {/* The live counters, in the tab's own chip vocabulary. Each is a number
          the recorder actually holds; a missing one renders as a dash and says
          it was not read rather than as a zero. */}
      <div className="coh-status__chips">
        <StateChip
          mark={recorder?.running ? "●" : "○"}
          word="Recorder"
          value={recorder ? (recorder.running ? "watching" : "stopped") : "not read"}
          tone={recorder?.running ? "good" : "muted"}
        />
        <StateChip
          mark="→"
          word="Families watched"
          value={recorder?.watchlist.length ? recorder.watchlist.join(", ") : "—"}
          tone="muted"
        />
        <StateChip mark="✓" word="Polls taken" value={recorder ? String(recorder.polls) : "—"} tone="muted" />
        <StateChip
          mark="✓"
          word="Book snapshots"
          value={snapshots == null ? "—" : snapshots.toLocaleString("en-GB")}
          tone="muted"
        />
        <StateChip
          mark="●"
          word="Index readings"
          value={indexRows == null ? "—" : indexRows.toLocaleString("en-GB")}
          tone="muted"
        />
        <StateChip
          mark={recorded ? "✓" : "◌"}
          word="Episodes recorded"
          value={recorded == null ? "—" : String(recorded)}
          tone={recorded ? "good" : "muted"}
        />
      </div>

      <Figure
        caption="Every poll the recorder has taken, and the one it is waiting on"
        ariaLabel={polls.length
          ? `${polls.length} polls from ${clock(first as number)} to ${clock(last as number)}, `
            + `${outages.length} stretches where the recorder was not looking, `
            + `and the current interval ${since == null ? "unknown" : `${Math.round(since)} of ${pollSeconds} seconds`} through`
          : "The recorder has taken no poll this read can see"}
        reading={polls.length && floor
          ? `Nothing has closed on this tape yet. A violation has to survive two polls to be recorded at `
            + `all — about ${seconds(floor)} at this cadence — so an absence here is a bound on what the `
            + "recorder can see, not evidence that nothing happened."
          : "The recorder has written no reading this view can place in time."}
        missing={[
          outages.length
            ? `${outages.length} stretch${outages.length === 1 ? "" : "es"} are hatched: the recorder was `
              + `not looking, and about ${missed} poll${missed === 1 ? "" : "s"} that would have fallen inside `
              + "them were never taken."
            : null,
          Number.isFinite(roundTrip)
            ? `The ${seconds(roundTrip)} round trip is an ASSUMPTION, not a reading — it is a query `
              + "parameter's default that the gateway echoes back, and nothing on this desk has timed it."
            : null,
        ].filter(Boolean).join(" ") || null}
      >
        {polls.length >= 2 && pollSeconds ? (
          <Plot height={HEIGHT} minWidth={420}>
            {(width) => {
              const span = Math.max(60, width - MARGIN.left - MARGIN.right);
              const from = first as number;
              const to = Math.max(last as number, from + 1);
              const x = (at: number) => MARGIN.left + ((at - from) / (to - from)) * span;
              const tapeTop = MARGIN.top;
              const ratio = since == null ? null : Math.min(1.4, since / pollSeconds);

              return (
                <>
                  <text className="coh-svg-label" x={0} y={tapeTop - 22}>
                    the watch, {seconds((to - from) / 1000)} of it
                  </text>
                  <text className="diff-watch__count" x={MARGIN.left + span} y={tapeTop - 22} textAnchor="end">
                    {polls.length} polls
                  </text>

                  {/* The stretches first, so a tick drawn inside one still sits
                      over it rather than under. */}
                  {outages.map((gap) => (
                    <rect
                      key={gap.from}
                      className="diff-watch__outage"
                      x={x(gap.from)}
                      y={tapeTop}
                      width={Math.max(1, x(gap.to) - x(gap.from))}
                      height={TAPE_H}
                    >
                      <title>
                        {`Not looking for ${seconds((gap.to - gap.from) / 1000)}, from ${clock(gap.from)}`}
                      </title>
                    </rect>
                  ))}

                  <line className="coh-ladder__axis" x1={MARGIN.left} x2={MARGIN.left + span}
                        y1={tapeTop + TAPE_H} y2={tapeTop + TAPE_H} />

                  {polls.map((poll) => (
                    <line
                      key={poll.at}
                      className="diff-watch__poll"
                      x1={x(poll.at)}
                      x2={x(poll.at)}
                      y1={tapeTop}
                      y2={tapeTop + TAPE_H}
                    >
                      <title>{`${clock(poll.at)} — ${poll.readings} event${poll.readings === 1 ? "" : "s"} read`}</title>
                    </line>
                  ))}

                  <text className="coh-ladder__tick" x={MARGIN.left} y={tapeTop + TAPE_H + 15}>
                    {clock(from)}
                  </text>
                  <text className="coh-ladder__tick" x={MARGIN.left + span} y={tapeTop + TAPE_H + 15}
                        textAnchor="end">
                    {clock(to)}
                  </text>

                  {/* ITS OWN SCALE, and said so. One interval is 0.3% of the
                      span above; drawn up there it would be invisible and would
                      imply a precision this has not got. */}
                  <text className="coh-svg-label" x={0} y={NEXT_TOP - 10}>the interval in progress</text>
                  <rect className="diff-watch__track" x={MARGIN.left} y={NEXT_TOP}
                        width={span} height={NEXT_H} />
                  {ratio == null ? null : (
                    <rect
                      className={`diff-watch__elapsed${ratio > 1 ? " is-overdue" : ""}`}
                      x={MARGIN.left}
                      y={NEXT_TOP}
                      width={Math.max(1, Math.min(1, ratio) * span)}
                      height={NEXT_H}
                    >
                      <title>
                        {ratio > 1
                          ? `${seconds(since as number)} since the last poll, past the ${seconds(pollSeconds)} cadence`
                          : `${seconds(since as number)} of ${seconds(pollSeconds)} — next poll in ${seconds(pollSeconds - (since as number))}`}
                      </title>
                    </rect>
                  )}
                  <text className="coh-ladder__tick" x={MARGIN.left + span} y={NEXT_TOP + NEXT_H + 14}
                        textAnchor="end">
                    {since == null
                      ? "cadence not read"
                      : ratio != null && ratio > 1
                        ? `overdue by ${seconds((since as number) - pollSeconds)}`
                        : `next poll in ${seconds(pollSeconds - (since as number))}`}
                  </text>
                </>
              );
            }}
          </Plot>
        ) : (
          <FigureEmpty reason="Fewer than two polls carry a timestamp, so there is no watch to draw yet." />
        )}
      </Figure>
    </>
  );
}
