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
 * view it should draw. FOUR views since the second pass of 2026-08-24:
 * Absorption (the arm's chips and the curve), Noise floor (the attrition and
 * control-percentile bars), Meetings (the per-meeting table) and Mechanism
 * (the two-stage timeline, made of constants). They used to be one stacked
 * view three screens tall; each is now one figure or one table, per the
 * review that split them ("i dont want to keep scrolling or squint my eyes").
 * Three of the four read the same ledger — `DiffusionPane` owns that gate and
 * shares one read across them — and Mechanism still fetches nothing, so this
 * pane still takes no `active` prop: it starts nothing that needs gating.
 */

import Figure, { FigureEmpty, StateChip } from "../Figure";
import ValueStrip from "../ValueStrip";
import AbsorptionCurve from "./AbsorptionCurve";
import FloorDistribution from "./FloorDistribution";
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

export default function InformationDiffusionPane({ view, read, error }: {
  view: "absorption" | "floor" | "meetings" | "mechanism";
  read: AbsorptionRead | null;
  error: string | null;
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
          reading="Both windows are the same length and each is measured from its own start, so a difference between them is a difference in absorption, not in the grid."
          missing="Sub-minute horizons are drawn but never measured: no free bar source resolves them."
        >
          <StageTimeline gapMinutes={STAGE_GAP_MIN} terminalMinutes={STAGE_TERMINAL_MIN} />
        </Figure>
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
        {read.reason ?? "The absorption ledger is not configured — not the same as no events."}
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

  if (view === "floor") {
    return (
      <div className="diff-pane">
        <Figure
          caption="Stages that cleared the noise floor, and where they sat against windows with no news"
          ariaLabel={`Two bars for each of ${read.stages.length} stages: measured against refused, and the median percentile against matched no-news windows`}
          reading="Most rate decisions move neither stage two pre-event sigmas, so refused stages are drawn on the same bar at the same scale."
          missing={unresolved.length ? unresolved.join(" ") : null}
        >
          <StageBars stages={read.stages} />
        </Figure>

        {/* The two bars above are aggregates; this is the distribution behind
            the second of them. Same field, already on the wire, drawn per run
            rather than per stage — because "indistinguishable from an ordinary
            half hour" is a claim about a shape, and a median cannot show one. */}
        <FloorDistribution runs={read.runs} />
      </div>
    );
  }

  if (view === "meetings") {
    return (
      <div className="diff-pane">
        <EventTable runs={read.runs} />
      </div>
    );
  }

  return (
    <div className="diff-pane">
      {/* Two chips, not four. "Stages measured" and "Below the floor" were the
          column sums of the two attrition bars (the Noise floor view), so the
          summary and the drawing were saying one number twice. */}
      <div className="coh-status__chips">
        <StateChip mark={gap ? "→" : "◌"} word="Conference slower by"
                   value={gap ?? "not yet"} tone={gap ? "warn" : "muted"} />
        <StateChip mark="✓" word="Terminal" value={`${STAGE_TERMINAL_MIN} min, both stages`} tone="muted" />
      </div>

      <Figure
        caption="How much of each stage's move had arrived by each horizon"
        ariaLabel={`Absorbed fraction against horizon for both stages, over ${measured} measured stages`}
        // NO READING as of 2026-08-25. It said "the statement is half absorbed
        // in Ns and the press conference takes 4.4x as long" — which is the
        // chip above the figure ("Conference slower by 4.4x") and both curve
        // keys ("half in 166s", "half in 728s") read back to someone looking at
        // all three. Third telling of one comparison, on one screen.
        //
        // What the drawing genuinely cannot say is in `missing` below: WHY the
        // first two horizons are gaps. That is a fact about the sources, not
        // about the shape.
        reading={null}
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
    </div>
  );
}
