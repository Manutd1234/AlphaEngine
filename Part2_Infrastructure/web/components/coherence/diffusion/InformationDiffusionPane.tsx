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
 * The switcher lives one level up, in `ArmSection`, and hands this pane the view
 * it should draw. TWO views since 2026-08-25, down from four: Absorption (the
 * chips and the curve) and Control (the attrition and control-percentile bars,
 * labelled for what it is FOR rather than what it is called). Meetings and
 * Mechanism left for a section of their own — they answer what each decision
 * did, which is a different question from how fast a stage is absorbed.
 *
 * THE CONTROL DID NOT LEAVE WITH THEM, and that is the decision this file
 * records. It is what "faster" is faster than, and a reader able to reach the
 * decay curve without ever meeting it could read a half-life off it and leave
 * with a shape mistaken for a finding.
 *
 * The pane takes no `active` prop: it starts nothing that needs gating, and the
 * one read it draws is owned and gated by `DiffusionConsole`.
 */

import Figure, { FigureEmpty, StateChip } from "../Figure";
import { STAGE_TERMINAL_MIN, STAGE_WORD, absorptionNotice, absorptionReady } from "./AbsorptionGate";
import AbsorptionCurve from "./AbsorptionCurve";
import FloorDistribution from "./FloorDistribution";
import StageBars from "./StageBars";
import type { AbsorptionRead, StageRun } from "./types";


function ratio(read: AbsorptionRead): string | null {
  const release = read.stages.find((stage) => stage.stage === "release")?.median_half_life_s;
  const call = read.stages.find((stage) => stage.stage === "call")?.median_half_life_s;
  if (!release || !call) return null;
  return `${(call / release).toFixed(1)}x`;
}


export default function InformationDiffusionPane({ view, read, error }: {
  view: "absorption" | "floor";
  read: AbsorptionRead | null;
  error: string | null;
}) {
  // One gate, shared with the Meetings section, so the two cannot word the same
  // absence differently. The predicate is what narrows `read` for everything
  // below it, rather than a non-null assertion at each use.
  const notice = absorptionNotice(read, error);
  if (!absorptionReady(read)) return notice;

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
