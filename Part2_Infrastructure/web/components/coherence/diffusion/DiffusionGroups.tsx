"use client";

/**
 * The views inside one Diffusion group, and the control that moves between them.
 *
 * Diffusion had SEVEN views on one `.seg` — Absorption, Noise floor, Meetings,
 * Mechanism, Kalshi survival, Kalshi episodes, Findings — and `14r` recorded it
 * as the widest control on the desk, wider than Dutch book's six. Seven labels
 * in a divided well wrap mid-word at any card narrower than a desk, which is
 * what the wrap rule was buying and why the rule was never the fix.
 *
 * THE THREE GROUPS ARE THE THREE READS, which is the same seam Dutch book's
 * groups fall on and for the same reason. The section already gated its two
 * calls so that opening it paid for one and never both; grouping on any other
 * line would have split one read across two groups and re-armed it on a press.
 *
 *   Announcement arm   Absorption, Noise floor, Meetings, Mechanism
 *                      one `absorption` ledger read — and Mechanism reads
 *                      NOTHING, because its drawing is made of two constants
 *   Kalshi episodes    Survival, Episodes        one `episodes` read
 *   Findings           the study                 gates its own read
 *
 * FINDINGS IS ONE VIEW HERE AND KEEPS ITS OWN SWITCHER, which looks like an
 * exception and is the opposite. Its three panels — the dot plot, the findings
 * table, the instrument audit — are three readings of ONE study rather than
 * peers of the two arms, and flattening them into this control was what put ten
 * buttons on the section with three of them answering a different question.
 * `FindingsPane` owns them; this file offers no second control for that group,
 * exactly as Dutch book's Basket group offers none.
 *
 * THE LABELS LOST THEIR PREFIX. "Kalshi survival" and "Kalshi episodes" carried
 * the arm's name because the flat row had nowhere else to put it — the header
 * said so: "the arm lives in the button's own words instead of in a level of its
 * own." There is a level now, so the words go back to being views: Survival and
 * Episodes, under a group that says Kalshi.
 *
 * `.coh-views` is the wrapper, and it is load-bearing rather than decoration:
 * `14r` wraps section-level switchers through `.console-card > .seg`, a CHILD
 * combinator, so a control returned in a fragment would take the group row's
 * treatment and sit as its sibling. The argument is written out once in
 * `CertificateGroups.tsx`, which does the same job for Dutch book.
 */

import { useState } from "react";

import type { CoherenceEpisodes } from "@/lib/coherence/types";
import FindingsPane from "./FindingsPane";
import InformationDiffusionPane from "./InformationDiffusionPane";
import KalshiArm from "./KalshiArm";
import DiffusionSimulator from "./model/DiffusionSimulator";
import HalfLifeCalculator from "./model/HalfLifeCalculator";
import ModelFormulas from "./model/ModelFormulas";
import SpectrumExplorer from "./model/SpectrumExplorer";
import type { AbsorptionRead } from "./types";

export type DiffusionGroup = "arm" | "episodes" | "model" | "findings";

type ArmView = "absorption" | "floor" | "meetings" | "mechanism";
type EpisodeView = "survival" | "episodes";
type ModelView = "measurement" | "instrument" | "halflife" | "simulator" | "spectrum";
type DiffusionView = ArmView | EpisodeView | ModelView | "findings";

/**
 * Which views each group holds, in the order the reader meets them.
 *
 * The table is the type: a group cannot exist without views and a view cannot
 * belong to two groups, so the switcher cannot offer an option the branch does
 * not draw.
 */
export const GROUP_VIEWS: Record<DiffusionGroup, ReadonlyArray<[DiffusionView, string]>> = {
  arm: [
    ["absorption", "Absorption"],
    ["floor", "Noise floor"],
    ["meetings", "Meetings"],
    ["mechanism", "Mechanism"],
  ],
  episodes: [["survival", "Survival"], ["episodes", "Episodes"]],
  model: [
    ["measurement", "Measurement"],
    ["instrument", "Instrument"],
    ["halflife", "Half-life"],
    ["simulator", "Simulator"],
    ["spectrum", "Spectrum"],
  ],
  findings: [["findings", "Findings"]],
};

export default function DiffusionGroups({ group, active, absorption, episodes }: {
  group: DiffusionGroup;
  active: boolean;
  absorption: { data: AbsorptionRead | null; error: string | null };
  episodes: { data: CoherenceEpisodes | null; error: string | null };
}) {
  const views = GROUP_VIEWS[group];
  const [view, setView] = useState<DiffusionView>(views[0][0]);

  return (
    <div className="coh-views">
      {/* Drawn only where there is a choice. Findings holds one view and its
          own three-panel switcher, so a second control here would be a single
          segment that cannot be pressed, above a control that can. */}
      {views.length > 1 ? (
        <div className="seg" role="group" aria-label="Diffusion view">
          {views.map(([name, label]) => (
            <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {group === "model" ? (
        // Reads NOTHING. `gaussian.py` argues the closed form exists so the
        // instrument ships before the model does; a gateway call here would
        // contradict the thing the group is demonstrating.
        view === "measurement" || view === "instrument" ? <ModelFormulas part={view} />
          : view === "halflife" ? <HalfLifeCalculator />
            : view === "simulator" ? <DiffusionSimulator />
              : <SpectrumExplorer />
      ) : group === "findings" ? (
        <>
          {/* The verdict the study returned, said once, here. It is a sentence
              a reader has to meet before the dot plot means anything. */}
          <p className="sub">
            The absorption clock is predictable without the text at all — R² +0.14 out of sample — and the
            statement&rsquo;s spectrum adds nothing to it, a sharper and falsifiable claim, not &ldquo;nothing
            predicts anything&rdquo;.
          </p>
          <FindingsPane active={active} />
        </>
      ) : group === "episodes" ? (
        <KalshiArm data={episodes.data} error={episodes.error} view={view as EpisodeView} />
      ) : (
        <InformationDiffusionPane view={view as ArmView} read={absorption.data} error={absorption.error} />
      )}
    </div>
  );
}
