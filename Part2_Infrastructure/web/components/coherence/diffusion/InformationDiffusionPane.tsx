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
 */

import { useState } from "react";

import Figure, { FigureEmpty, StateChip } from "../Figure";
import AbsorptionCurve from "./AbsorptionCurve";
import FindingsPane from "./FindingsPane";
import StageBars from "./StageBars";
import StageTimeline from "./StageTimeline";
import type { AbsorptionRead, StageRun } from "./types";

const STAGE_TERMINAL_MIN = 30;
const STAGE_GAP_MIN = 30;

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
    .slice(-24)
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
          Every meeting with a measured stage, newest first. A blank stage never moved enough to
          measure, which is a property of the decision rather than of the data.
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

export default function InformationDiffusionPane({ read, error }: {
  read: AbsorptionRead | null;
  error: string | null;
}) {
  const [view, setView] = useState<"absorption" | "findings" | "mechanism">("absorption");

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

  return (
    <div className="diff-pane">
      <div className="seg" role="group" aria-label="Diffusion view">
        <button type="button" aria-pressed={view === "absorption"} onClick={() => setView("absorption")}>
          Absorption
        </button>
        <button type="button" aria-pressed={view === "findings"} onClick={() => setView("findings")}>
          Findings
        </button>
        <button type="button" aria-pressed={view === "mechanism"} onClick={() => setView("mechanism")}>
          Mechanism
        </button>
      </div>

      {/* The absorption chips belong to the absorption question. On the
          findings view they would sit above a second chip row about something
          else, and eight tiles in a line read as one summary of one thing. */}
      {view === "findings" ? null : (
      <div className="coh-status__chips">
        <StateChip mark="●" word="Stages measured" value={String(measured)} tone="muted" />
        <StateChip mark="◌" word="Below the floor"
                   value={String(read.stages.reduce((t, s) => t + s.no_signal, 0))} tone="muted" />
        <StateChip mark={gap ? "→" : "◌"} word="Conference slower by"
                   value={gap ?? "not yet"} tone={gap ? "warn" : "muted"} />
        <StateChip mark="✓" word="Terminal" value={`${STAGE_TERMINAL_MIN} min, both stages`} tone="muted" />
      </div>
      )}

      {view === "findings" ? (
        <FindingsPane active />
      ) : view === "mechanism" ? (
        <Figure
          caption="Why a rate decision can be measured twice"
          ariaLabel={`Two stages ${STAGE_GAP_MIN} minutes apart, each measured over its own ${STAGE_TERMINAL_MIN} minute window`}
          reading="Both windows are the same length and each is measured from its own start, so a difference between them is a difference in absorption rather than in the grid."
          missing="Sub-minute horizons are drawn but never measured: no free bar source resolves them."
        >
          <StageTimeline gapMinutes={STAGE_GAP_MIN} terminalMinutes={STAGE_TERMINAL_MIN} />
        </Figure>
      ) : (
        <>
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

          <StageBars stages={read.stages} />
          <EventTable runs={read.runs} />
        </>
      )}
    </div>
  );
}
