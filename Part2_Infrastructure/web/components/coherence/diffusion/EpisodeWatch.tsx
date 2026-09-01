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
 *
 * WHY A RESTART IS A GAP, and why the figure says so. The recorder is not a
 * service of its own: `main.py` starts it with `asyncio.create_task` inside
 * the gateway process, so every restart of the gateway port stops the poller
 * with it and the tape shows a hatched stretch from the last poll before to
 * the first poll after. On 2026-08-26 the tape carried eight such stretches
 * in one seven-hour window, because three desk sessions restarted the gateway
 * independently. That is the truth about the recorder, not a fault in it, and
 * the honest reading is to name the cause beside the count rather than let a
 * reader take eight outages for eight failures of the venue. Persisting the
 * poller's state across restarts would change what the tape MEANS — a gap it
 * did not see is still a gap — so it stays as it is, and says why.
 */

import Figure, { FigureEmpty, Plot, StateChip } from "../Figure";
import { episodeFloors, outagesOf, pollsOf, type PollCadence } from "./episode-cadence";
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

function bytes(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let scaled = value / 1024;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled.toFixed(scaled >= 10 ? 1 : 2)} ${units[unit]}`;
}

function clock(ms: number): string {
  return new Date(ms).toISOString().slice(5, 16).replace("T", " ");
}

export default function EpisodeWatch({ data, status, points }: {
  data: CoherenceEpisodes;
  status: CoherenceStatus | null;
  points: readonly CoherenceIndexPoint[];
}) {
  const recorder = status?.recorder ?? null;
  const roundTrip = Number(data.round_trip_s);
  // THE PAYLOAD SAYS WHICH IT CARRIES, since 2026-08-26. "assumed" is the query
  // parameter's default echoed back; "measured" is the median of the reads this
  // deployment has actually made. The figure must say the right thing in BOTH
  // cases — and for a while it did not: the header above was updated to say it
  // follows this field while the sentence below still called a measured 271ms
  // an assumption. A comment describing a fix is not the fix.
  const roundTripSource = data.round_trip_source ?? "assumed";
  const roundTripSamples = data.round_trip_samples ?? null;
  const pollSeconds = recorder?.poll_seconds ?? null;
  const snapshots = tapeCount(status, "book_snapshots");
  const indexRows = tapeCount(status, "coherence_index_rows");
  const recorded = tapeCount(status, "violation_episodes");
  const decisions = recorder?.certification_decisions ?? tapeCount(status, "certification_decisions");
  const recovered = recorder?.episodes_recovered ?? null;
  const campaign = recorder?.campaign ?? null;
  const campaignTarget = typeof campaign?.target === "number" ? campaign.target : null;
  const campaignSuccessful = typeof campaign?.successful === "number" ? campaign.successful : null;
  const campaignConfigured = campaign?.configured === true;
  const campaignComplete = campaign?.state === "complete";
  const campaignPollSeconds = typeof campaign?.poll_seconds === "number"
    ? campaign.poll_seconds
    : pollSeconds;
  const baselinePollSeconds = typeof campaign?.post_campaign_poll_seconds === "number"
    ? campaign.post_campaign_poll_seconds
    : pollSeconds;
  const campaignFromMs = typeof campaign?.first_completed_ts_ns === "number"
    ? campaign.first_completed_ts_ns / 1e6
    : null;
  const campaignThroughMs = campaignComplete && typeof campaign?.last_completed_ts_ns === "number"
    ? campaign.last_completed_ts_ns / 1e6
    : null;
  const storage = recorder?.storage ?? null;
  const storageState = storage?.state ?? null;
  const tapeBytes = typeof storage?.tape_bytes === "number" ? storage.tape_bytes : null;
  const freeBytes = typeof storage?.disk_free_bytes === "number" ? storage.disk_free_bytes : null;

  const cadence: PollCadence | null = pollSeconds && campaignPollSeconds && baselinePollSeconds
    ? {
        baselineSeconds: baselinePollSeconds,
        campaignSeconds: campaignPollSeconds,
        campaignFromMs,
        campaignThroughMs,
      }
    : null;
  const polls = cadence ? pollsOf(points, cadence) : [];
  const outages = cadence ? outagesOf(polls, cadence, OUTAGE_POLLS) : [];
  const floors = cadence && pollSeconds
    ? episodeFloors(cadence, pollSeconds, campaignConfigured)
    : null;
  const since = recorder?.seconds_since_last_poll ?? null;
  const first = polls.length ? polls[0].at : null;
  const last = polls.length ? polls[polls.length - 1].at : null;
  const missed = outages.reduce((total, gap) => total + gap.missed, 0);
  // Two polls to close, so this is the shortest lifetime the tape can record —
  // not one poll, which is what this figure used to imply.
  const floorReading = floors == null
    ? null
    : campaignConfigured && floors.campaign != null
      ? campaignComplete
        ? `During the bounded campaign the two-poll episode floor was ${seconds(floors.campaign)}. `
          + `The recorder is now back at the baseline, so its current floor is ${seconds(floors.current)}.`
        : `The active campaign's two-poll episode floor is ${seconds(floors.campaign)}. `
          + `The post-campaign baseline floor will be ${seconds(floors.baseline)}.`
      : `The current two-poll episode floor is ${seconds(floors.current)}.`;

  return (
    <>
      <Figure
        caption="Every poll the recorder has taken, and the one it is waiting on"
        ariaLabel={polls.length
          ? `${polls.length} polls from ${clock(first as number)} to ${clock(last as number)}, `
            + `${outages.length} stretches where the recorder was not looking, `
            + `and the current interval ${since == null ? "unknown" : `${Math.round(since)} of ${pollSeconds} seconds`} through`
          : "The recorder has taken no poll this read can see"}
        reading={polls.length && floorReading
          ? `Nothing has closed on this tape yet. ${floorReading} An absence here is a bound on what the `
            + "recorder can see, not evidence that nothing happened."
          : "The recorder has written no reading this view can place in time."}
        missing={[
          outages.length
            ? `${outages.length} stretch${outages.length === 1 ? "" : "es"} are hatched: the recorder was `
              + `not looking, and about ${missed} poll${missed === 1 ? "" : "s"} that would have fallen inside `
              + "them were never taken. A restart of the gateway is one of these — the recorder runs inside "
              + "that process — so a stretch here is not on its own evidence of the venue being away."
            : null,
          // Two honest sentences, one per source. The measured one still has a
          // caveat, and it is the gateway's own: what was timed is a READ, and
          // an order carries a signature, is written rather than read, and
          // queues behind a matching engine — so the number is a lower bound on
          // the cost of trading, and a verdict built on it is optimistic.
          !Number.isFinite(roundTrip)
            ? null
            : roundTripSource === "measured"
              ? `The ${seconds(roundTrip)} round trip is measured — the median of `
                + `${roundTripSamples != null ? `${roundTripSamples.toLocaleString("en-GB")} ` : ""}`
                + "reads this deployment has made — and a read is a lower bound on an order, which "
                + "carries a signature and queues behind a matching engine."
              : `The ${seconds(roundTrip)} round trip is an ASSUMPTION, not a reading — it is a query `
                + "parameter's default that the gateway echoes back, and nothing on this desk has timed it.",
        ].filter(Boolean).join(" ") || null}
      >
        {polls.length >= 2 && pollSeconds ? (
          <Plot height={HEIGHT}>
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

      {/* The live counters follow the watch they qualify, in the tab's own chip
          vocabulary. Each is a number the recorder actually holds; a missing
          one renders as a dash and says it was not read rather than as a zero. */}
      <div className="coh-status__chips coh-episode-watch-stats">
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
        <StateChip mark="✓" word="Polls this process" value={recorder ? String(recorder.polls) : "—"} tone="muted" />
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
        <StateChip
          mark="↔"
          word="Two-poll episode floors"
          value={floors == null
            ? "not read"
            : floors.campaign == null
              ? `current ${seconds(floors.current)}`
              : `campaign ${seconds(floors.campaign)}; baseline ${seconds(floors.baseline)}; current ${seconds(floors.current)}`}
          tone="muted"
        />
        <StateChip
          mark={campaignComplete ? "✓" : "→"}
          word="Observation campaign"
          value={campaignTarget == null || campaignSuccessful == null
            ? "not read"
            : `${campaignSuccessful.toLocaleString("en-GB")} / ${campaignTarget.toLocaleString("en-GB")} successful polls`}
          tone={campaignComplete ? "good" : "muted"}
        />
        <StateChip
          mark={decisions == null ? "◌" : "✓"}
          word="Certification decisions"
          value={decisions == null
            ? "not read"
            : `${decisions.toLocaleString("en-GB")} durable; ${recovered ?? 0} close${recovered === 1 ? "" : "s"} recovered`}
          tone="muted"
        />
        <StateChip
          mark={storageState === "guarded" ? "▲" : storageState === "ok" ? "✓" : "◌"}
          word="Storage guard"
          value={storageState == null
            ? "not read"
            : `${storageState}; ${bytes(tapeBytes)} tape; ${bytes(freeBytes)} free`}
          tone={storageState === "guarded" ? "warn" : storageState === "ok" ? "good" : "muted"}
        />
      </div>
    </>
  );
}
