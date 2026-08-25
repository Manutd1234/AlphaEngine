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

  if (!rows.length) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span> No stage has cleared the noise floor yet.
      </p>
    );
  }

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
      <summary>{`Both stages, the move and the no-news percentile for each meeting, ${rows.length} rows`}</summary>
    <div className="table-wrap">
      <table className="coh-table">
        <caption className="coh-table__caption">
          Meetings with a measured stage, capped at the last {RECENT_MEETINGS}. A blank stage never
          moved enough to measure — a property of the decision, not of the data.
        </caption>
        <thead>
          <tr>
            <th scope="col">Meeting</th>
            <th scope="col">Asset</th>
            <th scope="col" className="num">Statement half-life</th>
            <th scope="col" className="num">Press conference half-life</th>
            <th scope="col" className="num">Statement move</th>
            <th scope="col">Against no news</th>
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