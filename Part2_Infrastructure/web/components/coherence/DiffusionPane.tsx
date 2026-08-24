"use client";

/**
 * How fast this market absorbs information — the honest gate on the engine.
 *
 * Every coherence violation is an episode: the prices admitted a Dutch book,
 * then they did not. The distribution of those lifetimes decides whether any of
 * this is a trading system or a screenshot. If the median is under the round
 * trip, the opportunity was never available and the race was lost before it was
 * entered — and that is worth knowing before an executor is built, not after.
 *
 * The survival curve is drawn from closed episodes only. An episode still
 * running is a lower bound on a lifetime, not a measurement, and mixing bounds
 * with measurements pulls the curve down by exactly the long tail it exists to
 * show.
 *
 * This section is also where the information-diffusion work lands. The samples
 * here and the samples from an earnings or rate-decision window are the same
 * shape — `lib/coherence/absorption.ts` is the contract — so one estimator runs
 * over both and the comparison between venues is the interesting part.
 *
 * One flat switcher, six peers, rather than a venue control with a per-arm
 * control stacked under it: two `.seg` controls in a column read as one broken
 * control, so the arm lives in the button's own words ("Kalshi survival")
 * instead of in a level of its own.
 *
 * FOUR PEERS UNTIL 2026-08-24, THEN THREE, THEN SIX, NOW SEVEN — every move
 * inside one day, and the last one is a return. Findings left in the morning to
 * be the `findings` rail section, because the study's verdict was the one result
 * on this engine a reader could not link to from behind a `.seg`; the merge that
 * afternoon brought it here as the seventh view, and `FindingsSection` — a
 * wrapper that existed only to give it a head — is deleted.
 * `RELOCATED_SECTIONS` is what still resolves `#coherence/findings`, and it
 * still resolves to this section: the split that evening left Diffusion on the
 * Proofs rail, where an absorption estimate is one of the things this engine
 * argues rather than one of the things the venue quotes.
 *
 * The second pass ("every single one of these tabs are so cluttered … i dont
 * want to keep scrolling") split what remained by the rule that one view is one
 * figure or one table: Absorption stacked the curve, the attrition bars and the
 * meetings table — three screens — and Kalshi episodes stacked the survival
 * curve over the episode table. Each stacked unit is a peer, and the reads did
 * not multiply: the ledger feeds Absorption, Noise floor and Meetings off one
 * gate, the episodes feed the two Kalshi views off another, Findings owns its
 * own and gates it on itself, and Mechanism still reads nothing at all.
 *
 * THE FOURTH REVIEW, and the one thing it changed about this section's shape:
 * nothing. Seven views, each already one figure or one table, so the pass was
 * the drawings and the hiding — every mark on the two custom SVGs here and on
 * the announcement arm's three now carries its own hover line, and the two
 * long tables (the meetings, the closed episodes) sit behind a `<details>`
 * whose summary counts their rows. The strips above them draw each table's
 * decisive column, which is what makes hiding the rest honest.
 *
 * SEVEN VIEWS IS THE WIDEST SWITCHER ON THE DESK — wider than Dutch book's six
 * — and `14r` says so at the wrap rule, which it did not until this pass: that
 * block named `.coh-certificate` and `.coh-calib` by hand and had been calling
 * six the widest since the hour it was written. It now wraps every
 * section-level seg on this tab by role.
 *
 * Findings keeps a switcher of its own — the dot plot, the findings table and
 * the instrument audit — because those three are readings of ONE study rather
 * than peers of the two arms, and flattening them would put ten buttons on this
 * section's rail with three of them belonging to a different question.
 */

import { useState } from "react";

import type { CoherenceEpisodes } from "@/lib/coherence/types";
import { absorptionRoute, episodesRoute } from "@/lib/coherence/routes";
import PaneHead from "./PaneHead";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import DiffusionGroups, { type DiffusionGroup } from "./diffusion/DiffusionGroups";
import type { AbsorptionRead } from "./diffusion/types";

/**
 * The three groups, in reading order, and the order is the argument.
 *
 * The announcement arm first because it is the measurement this section was
 * built for; the Kalshi episodes second because they are the same question
 * asked of a venue that publishes the mispricing itself; the findings last
 * because they are the verdict over both.
 *
 * What each group HOLDS is `GROUP_VIEWS` in `DiffusionGroups.tsx`, so this file
 * names the groups once and cannot offer one that draws nothing.
 */
const GROUPS: ReadonlyArray<[DiffusionGroup, string]> = [
  ["arm", "Announcement arm"],
  ["episodes", "Kalshi episodes"],
  ["findings", "Findings"],
];

export default function DiffusionPane({ active }: { active: boolean }) {
  const [group, setGroup] = useState<DiffusionGroup>("arm");
  // The GROUP is the gate. Each of the three is exactly one read — the ledger,
  // the episode tape, and the study's own — so pressing between two views of
  // one group re-arms nothing, and no two reads are ever in flight together.
  const onEpisodes = group === "episodes";
  const episodes = useCoherenceRead<CoherenceEpisodes>(episodesRoute(), active && onEpisodes);
  // Mechanism reads nothing at all: its drawing is made of two stage constants.
  // It rides the ledger's group anyway, because a view that fetches nothing
  // needs no gate of its own and a fourth group for one figure would put the
  // switcher back where this pass found it.
  const absorption = useCoherenceRead<AbsorptionRead>(absorptionRoute(), active && group === "arm");

  return (
    <section className="card console-card coh-diffusion" aria-labelledby="coherence-diffusion-heading">
      <PaneHead
        kicker="Diffusion"
        title="How fast information is absorbed"
        id="coherence-diffusion-heading"
        note="two arms, one estimator, one verdict"
        lede="Both arms measure how long until the move is finished — Kalshi over a published mispricing, the announcement arm over timestamped news."
      />

      {/* Three groups where there were seven flat views. `14r` called that row
          the widest control on the desk and gave it a wrap rule; this is the
          fix the wrap rule was standing in for. */}
      <div className="seg" role="group" aria-label="Diffusion group">
        {GROUPS.map(([name, label]) => (
          <button key={name} type="button" aria-pressed={group === name} onClick={() => setGroup(name)}>
            {label}
          </button>
        ))}
      </div>

      {/* `key` remounts on a group change so the view resets to the group's
          first, rather than an effect rendering the previous group's view for a
          frame — which across these groups is a frame of a figure drawn from a
          different read. */}
      <DiffusionGroups
        key={group}
        group={group}
        active={active}
        absorption={{ data: absorption.data, error: absorption.error }}
        episodes={{ data: episodes.data, error: episodes.error }}
      />
    </section>
  );
}
