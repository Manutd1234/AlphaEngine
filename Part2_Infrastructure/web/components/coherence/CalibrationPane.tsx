"use client";

/**
 * Scorecard — were the prices right, on the markets that have settled.
 *
 * ONE READ, ONE QUESTION, ONE CONTROL ROW, as of 2026-08-25. This section was
 * two groups over six views: "Once settled" and "Over time", the second being
 * the coherence index that had been folded in here on the argument that both
 * ask "were these prices right".
 *
 * That argument was true and it was not enough. The two halves share a QUESTION
 * and share nothing else: this one scores a settled corpus against what paid,
 * once, from `calibration`; the other measures a distance to the nearest
 * coherent price vector on every poll, from two different reads, on markets
 * that have not settled and may never. Different tape, different clock,
 * different failure. A group control that has to explain that in its own labels
 * is a control doing a section's work — which is what "Once settled" and "Over
 * time" were, and why they read as a second rail rather than as a switch.
 *
 * So the index is `IndexSection` now, under the id it was PUBLISHED with, and
 * this section keeps the three views of the one read it is named for. That
 * empties another entry out of `RELOCATED_SECTIONS` rather than adding one —
 * the fourth id this restructure has brought back for free.
 */

import { useState } from "react";

import type { CoherenceCalibration } from "@/lib/coherence/types-lab";
import { calibrationRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import CalibrationSettled, { type SettledView } from "./CalibrationSettled";
import PaneHead from "./PaneHead";

// TWO VIEWS, NOT THREE. `corpus` moved to its own section on 2026-08-25: what
// the score was computed on is a different question from what the score is,
// and this section was the tallest on the tab at 2,273px carrying both.
// `SettledView` keeps the third member because `CorpusSection` renders the
// same shell with it — the chips, the horizon and the four absences are corpus
// facts as much as score facts, and drawing them twice would be two answers.
const VIEWS: ReadonlyArray<[SettledView, string]> = [
  ["score", "Score"],
  ["bands", "Bands"],
];

export default function CalibrationPane({ active }: { active: boolean }) {
  const [view, setView] = useState<SettledView>("score");
  const { data, error } = useCoherenceRead<CoherenceCalibration>(calibrationRoute(), active);

  return (
    <section className="card console-card coh-calib" aria-labelledby="coherence-calibration-heading">
      <PaneHead
        kicker="Scorecard"
        title="Were the prices right, on what has settled"
        id="coherence-calibration-heading"
        note={data ? `${data.engine} prices` : "the settled corpus"}
        lede={
          <>
            A price vector can be arbitrage-free and still be wrong about the world, so this scores
            calibration instead: of the contracts priced near a dime, how many paid?
          </>
        }
      />

      {/* The control row is pinned (`14u`), so a reader deep in the body can
          switch view without scrolling back to the head. One row per section is
          the rule this rail already kept; wrapping it is what made it pinnable. */}
      <div className="coh-bar">
        <div className="seg" role="group" aria-label="Scorecard view">
          {VIEWS.map(([name, label]) => (
            <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <CalibrationSettled data={data} error={error} view={view} />
    </section>
  );
}
