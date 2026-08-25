"use client";

/**
 * What the recorder is watching, and the window an episode has to survive to be
 * seen at all.
 *
 * THE EMPTY TAPE IS THE LIVE CASE, not an edge one. On this deployment
 * `/api/coherence/episodes` answers `state: "empty"` — no violation has opened
 * and closed — and the section drew one grey sentence for it. That sentence was
 * true and it was also the whole section for anyone looking at the desk today.
 *
 * WHAT IS DRAWN INSTEAD IS THE WATCH, and every number in it is live. The
 * recorder is running, it polls a watchlist on a fixed cadence, and the tape
 * counts what it has taken. "Nothing has closed yet" then reads as a report
 * with a denominator rather than as an absence.
 *
 * AND THE FIGURE IS THE THING THAT SENTENCE COULD NOT SAY. Two rules on one log
 * axis: the round trip a taker needs, and the recorder's own poll interval. The
 * span between them is the resolution gap — an episode shorter than one poll can
 * open and close entirely between two observations, so the tape cannot report
 * it and its absence from this section is not evidence that it did not happen.
 * That is a real limitation of the measurement and it is drawn rather than
 * confessed in a footnote.
 *
 * NOTHING HERE IS INVENTED. No episode is drawn, no lifetime is claimed, and
 * the axis is labelled with the two constants it is built from. An episode
 * earns a lifetime only by closing, which is the same refusal the survival
 * curve makes by using closed episodes alone.
 */

import Figure, { Plot, StateChip } from "../Figure";
import type { CoherenceEpisodes, CoherenceStatus } from "@/lib/coherence/types";

const HEIGHT = 138;
const MARGIN = { top: 34, right: 26, bottom: 26, left: 26 };

/** Read a count off the untyped `tape` bag without inventing a zero for it. */
function tapeCount(status: CoherenceStatus | null, key: string): number | null {
  const value = status?.tape?.[key];
  return typeof value === "number" ? value : null;
}

function seconds(value: number): string {
  if (value < 1) return `${Math.round(value * 1000)}ms`;
  if (value < 90) return `${value % 1 === 0 ? value : value.toFixed(1)}s`;
  return `${Math.round(value / 60)}m`;
}

/**
 * The two constants on one log axis, with the span between them named.
 *
 * Log because the two are three orders of magnitude apart — 240ms against five
 * minutes — and a linear axis would put the round trip on the left edge and say
 * nothing about the distance.
 */
function ResolutionAxis({ roundTrip, pollSeconds }: { roundTrip: number; pollSeconds: number }) {
  const low = Math.min(roundTrip, 0.1);
  const high = Math.max(pollSeconds, 1) * 4;
  const logLow = Math.log(low);
  const logHigh = Math.log(high);

  return (
    <Plot height={HEIGHT}>
      {(width) => {
        const plot = Math.max(1, width - MARGIN.left - MARGIN.right);
        const base = HEIGHT - MARGIN.bottom;
        const top = MARGIN.top;
        const x = (value: number) =>
          MARGIN.left + ((Math.log(Math.max(value, low)) - logLow) / (logHigh - logLow)) * plot;
        const ticks = [0.1, 1, 10, 60, 300, 900].filter((t) => t >= low && t <= high);

        // Three regions, left to right, each a claim about a lifetime landing
        // in it. The marks carry the meaning so it survives monochrome.
        const bands = [
          { from: low, to: roundTrip, mark: "✕", word: "never available", cls: "diff-watch__band--gone",
            title: `A lifetime under the ${seconds(roundTrip)} round trip was over before a taker could reach it` },
          { from: roundTrip, to: pollSeconds, mark: "◌", word: "may be missed", cls: "diff-watch__band--blind",
            title: `Between the round trip and one ${seconds(pollSeconds)} poll: takeable in principle, but it can open and close between two observations, so the tape would not hold it` },
          { from: pollSeconds, to: high, mark: "✓", word: "would be recorded", cls: "diff-watch__band--seen",
            title: `Longer than one ${seconds(pollSeconds)} poll: the recorder would observe it open and observe it close` },
        ];

        return (
          <>
            {bands.map((band) => {
              const x0 = x(band.from);
              const x1 = x(band.to);
              const mid = (x0 + x1) / 2;
              return (
                <g key={band.word}>
                  <rect className={`diff-watch__band ${band.cls}`} x={x0} y={top} width={Math.max(0, x1 - x0)} height={base - top}>
                    <title>{band.title}</title>
                  </rect>
                  {x1 - x0 > 96 ? (
                    <text className="coh-svg-note" x={mid} y={top + 20} textAnchor="middle">
                      {band.mark} {band.word}
                    </text>
                  ) : null}
                </g>
              );
            })}

            <line className="coh-ladder__axis" x1={MARGIN.left} x2={width - MARGIN.right} y1={base} y2={base} />

            {/* The two constants the regions are cut at, labelled above the
                plot rather than on the tick row, which the axis owns. */}
            <line className="coh-survival__median" x1={x(roundTrip)} x2={x(roundTrip)} y1={top} y2={base}>
              <title>{`Round trip assumed ${seconds(roundTrip)}`}</title>
            </line>
            <line className="coh-survival__half" x1={x(pollSeconds)} x2={x(pollSeconds)} y1={top} y2={base}>
              <title>{`The recorder polls every ${seconds(pollSeconds)}`}</title>
            </line>
            <text className="coh-axis__label" x={x(roundTrip)} y={top - 6} textAnchor="start">
              round trip {seconds(roundTrip)}
            </text>
            <text className="coh-axis__label" x={x(pollSeconds)} y={top - 6} textAnchor="end">
              poll {seconds(pollSeconds)}
            </text>

            {ticks.map((tick) => (
              <text key={tick} className="coh-ladder__tick" x={x(tick)} y={base + 14} textAnchor="middle">
                {seconds(tick)}
              </text>
            ))}
          </>
        );
      }}
    </Plot>
  );
}

/** The watch, drawn when the tape has nothing closed to draw instead. */
export default function EpisodeWatch({ data, status }: {
  data: CoherenceEpisodes;
  status: CoherenceStatus | null;
}) {
  const recorder = status?.recorder ?? null;
  const roundTrip = Number(data.round_trip_s);
  const pollSeconds = recorder?.poll_seconds ?? null;
  const snapshots = tapeCount(status, "book_snapshots");
  const indexRows = tapeCount(status, "coherence_index_rows");
  const recorded = tapeCount(status, "violation_episodes");

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

      {Number.isFinite(roundTrip) && pollSeconds ? (
        <Figure
          caption="What an episode has to outlive to be seen, and to be worth taking"
          ariaLabel={`A log axis in seconds carrying the ${seconds(roundTrip)} round trip and the ${seconds(pollSeconds)} poll interval, with the span below one poll shaded`}
          reading="Nothing has closed on this tape yet, and anything shorter than one poll would not have been recorded even if it had — so this is a watch rather than a count."
          missing="The shaded span is a bound on what this measurement can see, not a claim about what happened inside it."
        >
          <ResolutionAxis roundTrip={roundTrip} pollSeconds={pollSeconds} />
        </Figure>
      ) : (
        <p className="console-empty">
          <span aria-hidden="true">◌</span>{" "}
          {pollSeconds
            ? "The round trip is not on the wire, so the window an episode must outlive cannot be drawn."
            : "The recorder's poll cadence could not be read, so the observable window cannot be drawn."}
        </p>
      )}
    </>
  );
}
