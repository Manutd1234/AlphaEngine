"use client";

/**
 * Each meeting's own half-life, and the four columns a reader checking one
 * meeting needs.
 *
 * SPLIT OUT OF `InformationDiffusionPane` ON 2026-08-25, when the four-view
 * announcement arm became two sections. This is the whole of what `meetings`
 * draws, and the seam is the one the pane already had: nothing here reads the
 * stage summaries or the curve, only the runs.
 *
 * The strip is the view and the table is its audit. Statement half-life per
 * meeting is what a reader comes here for, so it is drawn open; the press
 * conference stage, the size of the move and the no-news percentile are
 * per-row provenance and fold behind a summary that COUNTS them, so nobody
 * opens it to find out how big it is.
 */

import Figure, { Plot } from "../Figure";
import ValueStrip from "../ValueStrip";
import type { StageRun } from "./types";

/** The strip shows the tail of the ledger; its caption states the cap. */
const RECENT_MEETINGS = 24;

export default function MeetingTable({ runs }: { runs: StageRun[] }) {
  const byEvent = new Map<string, { release?: StageRun; call?: StageRun }>();
  for (const run of runs) {
    const key = `${run.source_ref}|${run.symbol}`;
    const entry = byEvent.get(key) ?? {};
    entry[run.stage] = run;
    byEvent.set(key, entry);
  }
  const rows = [...byEvent.entries()]
    .filter(([, pair]) => pair.release?.signal_state === "ok" || pair.call?.signal_state === "ok")
    .slice(-RECENT_MEETINGS)
    .reverse();

  if (!rows.length) return <MeetingsEmpty runs={runs} />;

  const cell = (run: StageRun | undefined) => {
    if (!run) return <td className="num">—</td>;
    if (run.signal_state !== "ok") {
      return (
        <td className="num muted" title={run.signal_reason ?? undefined}>
          below the floor
        </td>
      );
    }
    if (run.half_life_s == null) {
      return (
        <td className="num muted" title={run.half_life_state ?? undefined}>
          not resolved
        </td>
      );
    }
    return <td className="num">{Math.round(run.half_life_s)}s</td>;
  };

  const stripRows = rows.map(([key, pair]) => {
    const any = pair.release ?? pair.call!;
    const release = pair.release;
    const resolved = release?.signal_state === "ok" && release.half_life_s != null;
    return {
      label: `${any.source_ref.replace("fed:", "")} ${any.symbol}`,
      value: resolved ? Math.round(release!.half_life_s!) : null,
      text: resolved ? `${Math.round(release!.half_life_s!)}s` : "—",
      title: `${key.replace("fed:", "").replace("|", " ")}: statement ${resolved ? `half in ${Math.round(release!.half_life_s!)}s` : "not measured"}${pair.call?.half_life_s != null ? `, press conference ${Math.round(pair.call.half_life_s)}s` : ""}`,
      noBar: resolved
        ? undefined
        : !release
          ? "no statement stage"
          : release.signal_state !== "ok"
            ? "below the floor"
            : "not resolved",
    };
  });

  return (
    <>
    {/* The table's decisive column drawn (third review, 2026-08-24): how fast
        the statement was absorbed, meeting by meeting. */}
    <ValueStrip
      caption="Statement half-life, meeting by meeting, newest first"
      ariaLabel={`Statement half-life in seconds for the last ${rows.length} measured meetings`}
      rows={stripRows}
    />
    {/* Statement half-life per meeting is what the view is for, and the strip
        draws it, so the four remaining columns go behind a summary (fourth
        review of 2026-08-24): the press-conference stage, the size of the
        move, and where it sat against matched windows with no news. Per-row
        provenance for a reader checking one meeting, not the reading. */}
    <details className="disclosure">
      <summary>Both stages, the move and the no-news percentile for each meeting</summary>
    <div className="table-wrap">
      {/* FIXED, NOT AUTO, since 2026-08-25. Measured in Chrome at 1600px, the
          auto layout gave these six columns 179 · 124 · 313 · 417 · 238 · 253 —
          the widest 3.4x the narrowest — because `auto` sizes to the longest
          CELL and "Press conference half-life" is a long heading over a short
          number. The result was a jagged edge that also moved as the data
          changed. Twelfths, declared once here, hold whatever lands in them. */}
      <table className="coh-table table-fixed">
        <caption className="coh-table__caption">
          {`The last ${rows.length} meetings with a measured stage, of a cap of ${RECENT_MEETINGS}.`}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="w-2/12">Meeting</th>
            <th scope="col" className="w-1/12">Asset</th>
            <th scope="col" className="num w-2/12">Statement half-life</th>
            <th scope="col" className="num w-2/12">Press conference half-life</th>
            <th scope="col" className="num w-2/12">Statement move</th>
            <th scope="col" className="w-3/12">Against no news</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, pair]) => {
            const any = pair.release ?? pair.call!;
            const percentile = pair.release?.control_percentile;
            return (
              <tr key={key}>
                <th scope="row">{any.source_ref.replace("fed:", "")}</th>
                <td>{any.symbol}</td>
                {cell(pair.release)}
                {cell(pair.call)}
                <td className="num">
                  {pair.release?.terminal_return != null
                    ? `${(pair.release.terminal_return * 100).toFixed(2)}%`
                    : "—"}
                </td>
                <td className="num">
                  {percentile != null ? percentile.toFixed(2) : <span className="muted">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </details>
    </>
  );
}

/**
 * What the strip will hold, drawn before it holds anything.
 *
 * THE EMPTY BRANCH IS A DEPLOYMENT'S NORMAL STATE, not an edge one: a keyless
 * desk has read no announcement window at all, and this view used to answer
 * that with one grey sentence. The house rule is that an empty result is
 * REPORTED — and a report of an empty ledger can still say what the ledger is
 * for and what it will never hold.
 *
 * Every mark is a constant. The eight horizons are the study's own grid, and
 * the first two are drawn already refused because a sub-minute move cannot be
 * resolved from any free bar source whatever lands later — a property of the
 * grid against the bar interval, knowable with no data. Nothing here claims a
 * measurement.
 */
const GRID_LABELS = ["1s", "30s", "1m", "2m", "5m", "10m", "15m", "30m"];
const EMPTY_HEIGHT = 96;

function MeetingsEmpty({ runs }: { runs: StageRun[] }) {
  const read = runs.length;
  const refused = runs.filter((run) => run.signal_state !== "ok").length;
  return (
    <Figure
      caption="The horizons a meeting is measured at, and the two that never resolve"
      ariaLabel={`Eight horizons from one second to thirty minutes, the first two marked as never resolvable from a free source${read ? `, over ${read} stages read` : ""}`}
      reading={
        read
          ? `${read} ${read === 1 ? "stage has" : "stages have"} been read and ${refused} did not move enough to measure, so no row is drawn yet — a property of those decisions rather than of the data.`
          : "No announcement window has been recorded on this deployment yet, so there is nothing to rank; the grid below is what a meeting will be measured against when one is."
      }
      missing="The first two horizons stay unmeasured whatever lands: no free bar source resolves a move inside one minute."
    >
      <Plot height={EMPTY_HEIGHT}>
        {(width) => {
          const left = 18;
          const right = Math.max(left + 60, width - 18);
          const x = (index: number) => left + (index / (GRID_LABELS.length - 1)) * (right - left);
          const base = EMPTY_HEIGHT - 30;
          return (
            <>
              <line className="coh-ladder__axis" x1={left} x2={right} y1={base} y2={base} />
              {GRID_LABELS.map((word, index) => {
                const resolvable = index >= 2;
                return (
                  <g key={word}>
                    <circle
                      className={resolvable ? "diff-curve__dot" : "diff-curve__dot diff-curve__dot--gap"}
                      cx={x(index)} cy={base} r={3.5}
                    >
                      <title>
                        {resolvable
                          ? `${word}: a stage that clears the noise floor is measured here`
                          : `${word}: never resolved — no free bar source reaches inside one minute`}
                      </title>
                    </circle>
                    <text className="coh-ladder__tick" x={x(index)} y={base + 15} textAnchor="middle">{word}</text>
                    {resolvable ? null : (
                      <text className="coh-ladder__tick" x={x(index)} y={base - 9} textAnchor="middle">◌</text>
                    )}
                  </g>
                );
              })}
              <text className="coh-svg-note" x={left} y={18}>a meeting fills one row per stage</text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
