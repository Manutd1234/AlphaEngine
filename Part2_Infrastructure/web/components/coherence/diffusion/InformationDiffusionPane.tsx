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
import { absorptionBand, bandCoverage } from "@/lib/coherence/absorption-band";
import AbsorptionCurve from "./AbsorptionCurve";
import ReturnFan from "./ReturnFan";
import ClockAgreement from "./ClockAgreement";
import ControlRank from "./ControlRank";
import FloorDistance from "./FloorDistance";
import type { AbsorptionRead, StageRun } from "./types";


function ratio(read: AbsorptionRead): string | null {
  const release = read.stages.find((stage) => stage.stage === "release")?.median_half_life_s;
  const call = read.stages.find((stage) => stage.stage === "call")?.median_half_life_s;
  if (!release || !call) return null;
  return `${(call / release).toFixed(1)}x`;
}


export default function InformationDiffusionPane({ view, read, error }: {
  view: "absorption" | "floor" | "clocks";
  read: AbsorptionRead | null;
  error: string | null;
}) {
  // One gate, shared with the Meetings section, so the two cannot word the same
  // absence differently. The predicate is what narrows `read` for everything
  // below it, rather than a non-null assertion at each use.
  const notice = absorptionNotice(read, error);
  if (!absorptionReady(read)) return notice;

  // ONE CHIP ROW FOR ALL THREE VIEWS, hoisted 2026-08-25. It used to render
  // inside the Absorption branch only, so switching to Control or Clocks made
  // it disappear and switching back made it reappear — a row of facts blinking
  // in and out of a card that had not changed. Neither chip is about the
  // absorption VIEW: the ratio is the two stages' median half-lives over the
  // whole study, and the terminal window is a constant of both stages. So they
  // belong to the arm, and the arm is what they sit on now.
  //
  // Two chips, not four. "Stages measured" and "Below the floor" were the
  // column sums of the two attrition bars in the Control view, so the summary
  // and the drawing were saying one number twice.
  const gap = ratio(read);
  const chips = (
    <div className="coh-status__chips">
      <StateChip mark={gap ? "→" : "◌"} word="Conference slower by"
                 value={gap ?? "not yet"} tone={gap ? "warn" : "muted"} />
      <StateChip mark="✓" word="Terminal" value={`${STAGE_TERMINAL_MIN} min, both stages`} tone="muted" />
    </div>
  );

  // EACH VIEW DERIVES WHAT IT DRAWS AND NOTHING ELSE. These five used to be
  // computed together above the branches, so Control and Clocks both paid for
  // an absorption band neither renders — and that band is the most expensive
  // derivation on the tab. Nothing here is shared between the branches, so
  // there is no saving to trade away by moving them down.
  if (view === "floor") {
    return (
      <div className="diff-pane">
        {chips}
        {/* Two figures on the same idea: how far each stage sat from a line.
            The first is every REFUSED run's distance below the noise floor,
            read from the sigma its refusal sentence carries — the attrition
            block this replaced could say only that 82 and 77 were refused.
            The second is every RANKED run's percentile against matched
            no-news windows, as marks rather than the ten-bucket histogram of
            nineteen points at two values this replaced. */}
        <FloorDistance runs={read.runs} stages={read.stages} />
        <ControlRank runs={read.runs} />
      </div>
    );
  }

  if (view === "clocks") {
    return (
      <div className="diff-pane">
        {chips}
        {/* The control the tab argued in prose only: a stage measured on a clock
            built from OTHER windows, ranked against itself on the wall clock.
            Same read, no new field — `half_life_vol` has been on the wire since
            the arm shipped and was drawn nowhere. */}
        <ClockAgreement runs={read.runs} />
      </div>
    );
  }

  const measured = read.stages.reduce((total, stage) => total + stage.measured, 0);
  const measuredOn = (curve: (number | null)[]) => curve.filter((value) => value != null).length;
  const coverage = bandCoverage(absorptionBand(read.runs, "release", read.horizons));

  return (
    <div className="diff-pane">
      {chips}

      <Figure
        caption="How much of each stage's move had arrived by each horizon"
        // Carries the COVERAGE the curve's own label used to hold. That label
        // was inside this figure's `role="img"` element, which is presentational
        // to assistive technology, so it had never been read to anyone.
        ariaLabel={`Absorbed fraction against horizon for both stages, over ${measured} measured stages: `
          + `statement ${measuredOn(read.release_curve)} of ${read.horizons.length} horizons, `
          + `press conference ${measuredOn(read.call_curve)}, each with the middle half of its runs drawn behind it`}
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
        missing={[
          read.horizons.length && read.release_curve[0] == null
            ? "The first two horizons are drawn as gaps: no free source resolves a move inside one minute."
            : null,
          // The band and the line are drawn at the same weight whatever the
          // sample, so the count is the only thing that says which is which.
          // The "which overshoot makes them" clause left on 2026-08-27: the fan
          // below is the only figure on this view that SHOWS an overshoot, and
          // it carries the sentence.
          coverage
            ? `Each band is the middle half of ${coverage}; the line through it is a MEAN, so it can sit off-centre where the runs are skewed.`
            : null,
        ].filter(Boolean).join(" ") || null}
      >
        {read.runs.length ? (
          <AbsorptionCurve horizons={read.horizons} release={read.release_curve}
                           call={read.call_curve} stages={read.stages} runs={read.runs} />
        ) : (
          <FigureEmpty reason="No stage has been measured yet." />
        )}
      </Figure>

      {/* The curve's own denominator, drawn under it. `absorbed(h)` is a ratio
          against the terminal, so the figure above shows the SHAPE of an
          average approach and can say nothing about how big a move was, how
          much the cross-section spreads, or how often a path overshoots — and
          it is a mean over the 89 runs that cleared the floor, while the fan
          draws all 248. Paired here rather than given a view of its own for the
          reason `ArmSection` already argues about the noise floor: a reader who
          can reach the curve without meeting the raw paths reads a normalised
          mean as if it were the data. */}
      <ReturnFan read={read} />
    </div>
  );
}
