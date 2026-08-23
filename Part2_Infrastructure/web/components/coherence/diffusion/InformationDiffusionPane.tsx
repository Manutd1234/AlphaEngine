"use client";

/**
 * How fast a timestamped announcement reaches the price.
 *
 * The Kalshi half of this tab asks how long a coherence violation survives.
 * This half asks the same question of news: an announcement lands at a known
 * instant, the price moves, and the interesting number is not how far it moved
 * but how long it took to finish.
 *
 * A rate decision is the cleanest case available and it is free. It arrives in
 * two stages thirty minutes apart — a statement, then a press conference — both
 * public to the minute since January 2019, and BTC and ETH are quoted through
 * both with no session boundary and no auction. So the comparison needs no
 * vendor and no key, and it can return a flat answer rather than waiting a year
 * to accumulate one.
 *
 * Everything drawn here is measured. Where it is not measured it says so: the
 * sub-minute horizons have no free source and stay in the grid as gaps, and
 * every stage that failed the noise floor is counted on the same bar as the
 * ones that passed.
 *
 * The switcher lives one level up, in `DiffusionPane`, and hands this pane the
 * view it should draw. Three of the four views are here; only one of them
 * needs the absorption ledger, so the other two return before it is examined.
 */

import Figure, { FigureEmpty, StateChip } from "../Figure";
import AbsorptionCurve from "./AbsorptionCurve";
import FindingsPane from "./FindingsPane";
import StageBars from "./StageBars";
import StageTimeline from "./StageTimeline";
import type { AbsorptionRead, StageRun } from "./types";

const STAGE_TERMINAL_MIN = 30;
const STAGE_GAP_MIN = 30;
/** The event table shows the tail of the ledger; its caption states the cap. */
const RECENT_MEETINGS = 24;
const STAGE_WORD: Record<string, string> = { release: "statement", call: "press conference" };

function ratio(read: AbsorptionRead): string | null {
  const release = read.stages.find((stage) => stage.stage === "release")?.median_half_life_s;
  const call = read.stages.find((stage) => stage.stage === "call")?.median_half_life_s;
  if (!release || !call) return null;
  return `${(call / release).toFixed(1)}x`;
}

function EventTable({ runs }: { runs: StageRun[] }) {
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

  return (
    <div className="table-wrap">
      <table className="coh-table">
        <caption className="coh-table__caption">
          Meetings with a measured stage, newest first, capped at the last {RECENT_MEETINGS}. A blank
          stage never moved enough to measure, which is a property of the decision rather than of the data.
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
  );
}

export default function InformationDiffusionPane({ view, read, error, active }: {
  view: "absorption" | "mechanism" | "findings";
  read: AbsorptionRead | null;
  error: string | null;
  active: boolean;
}) {
  // The mechanism drawing is made of the two stage constants and nothing else.
  // It used to sit behind the absorption read because the venue gate was
  // shared; flat views let it wait on nothing and fetch nothing.
  if (view === "mechanism") {
    return (
      <div className="diff-pane">
        <Figure
          caption="Why a rate decision can be measured twice"
          ariaLabel={`Two stages ${STAGE_GAP_MIN} minutes apart, each measured over its own ${STAGE_TERMINAL_MIN} minute window`}
          reading="Both windows are the same length and each is measured from its own start, so a difference between them is a difference in absorption rather than in the grid."
          missing="Sub-minute horizons are drawn but never measured: no free bar source resolves them."
        >
          <StageTimeline gapMinutes={STAGE_GAP_MIN} terminalMinutes={STAGE_TERMINAL_MIN} />
        </Figure>
      </div>
    );
  }

  // `FindingsPane` owns the findings read and gates it on the `active` it is
  // handed. This branch is mounted only while the findings view is selected,
  // so leaving the view ends the poll rather than leaving it running behind a
  // tab nobody is looking at — which is what a hardcoded `active` used to do.
  if (view === "findings") {
    return (
      <div className="diff-pane">
        <FindingsPane active={active} />
      </div>
    );
  }

  if (error && !read) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The absorption ledger could not be read: {error}
      </p>
    );
  }
  if (!read) return <p className="console-empty muted">Reading the absorption ledger…</p>;
  if (read.state !== "ok") {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span>{" "}
        {read.reason ?? "The absorption ledger is not configured. That is not the same as no events."}
      </p>
    );
  }

  const measured = read.stages.reduce((total, stage) => total + stage.measured, 0);
  const gap = ratio(read);
  // Named so the bars figure can say which stage has no median and why, in the
  // one place a reader is already asking it: under the drawing itself.
  const unresolved = read.stages
    .filter((stage) => stage.median_half_life_s == null)
    .map((stage) => `No median half-life for the ${STAGE_WORD[stage.stage] ?? stage.stage}: `
      + `${stage.reason ?? "the ledger gave no reason"}.`);

  return (
    <div className="diff-pane">
      {/* Two chips, not four. "Stages measured" and "Below the floor" were the
          column sums of the two bars directly below them, so the summary and
          the drawing were saying one number twice. */}
      <div className="coh-status__chips">
        <StateChip mark={gap ? "→" : "◌"} word="Conference slower by"
                   value={gap ?? "not yet"} tone={gap ? "warn" : "muted"} />
        <StateChip mark="✓" word="Terminal" value={`${STAGE_TERMINAL_MIN} min, both stages`} tone="muted" />
      </div>

      <Figure
        caption="How much of each stage's move had arrived by each horizon"
        ariaLabel={`Absorbed fraction against horizon for both stages, over ${measured} measured stages`}
        reading={
          gap
            ? `The statement is half absorbed in ${Math.round(read.stages.find((s) => s.stage === "release")!.median_half_life_s!)} seconds and the press conference takes ${gap} as long.`
            : null
        }
        missing={
          read.horizons.length && read.release_curve[0] == null
            ? "The first two horizons are drawn as gaps: no free source resolves a move inside one minute."
            : null
        }
      >
        {read.runs.length ? (
          <AbsorptionCurve horizons={read.horizons} release={read.release_curve}
                           call={read.call_curve} stages={read.stages} />
        ) : (
          <FigureEmpty reason="No stage has been measured yet." />
        )}
      </Figure>

      <Figure
        caption="How many stages cleared the noise floor, and where the ones that did sat against windows with no news in them"
        ariaLabel={`Two bars for each of ${read.stages.length} stages: measured against refused, and the median percentile against matched windows on prior days at the same clock time`}
        reading="Most rate decisions move neither stage two pre-event sigmas, so the refused stages are drawn on the same bar and at the same scale rather than left out of the count."
        missing={unresolved.length ? unresolved.join(" ") : null}
      >
        <StageBars stages={read.stages} />
      </Figure>

      <EventTable runs={read.runs} />
    </div>
  );
}
