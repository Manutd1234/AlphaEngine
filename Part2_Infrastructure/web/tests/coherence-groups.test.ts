/**
 * The two-level control: a section's seg carries GROUPS, a child carries VIEWS.
 *
 * "Too many fragmented, flat subtabs causing horizontal visual clutter."
 *
 * Three Proofs sections opened on a flat row of segments wider than any control
 * on the desk — Diffusion at seven, Dutch book at six, Scorecard at five — and
 * `14r` carried a rule whose only job was to let those rows WRAP rather than
 * shrink their type. A wrap rule is what a switcher needs once it has stopped
 * being a row a reader can take in, so it is the symptom rather than the fix.
 *
 * The fix is a level. The section's own seg names two or three groups; the child
 * named here draws the views inside the chosen one. The shape is not new on this
 * engine — `SurfacePane` nests a Stake switcher inside its Lattice one, and
 * `FindingsPane` has always kept its own three views, because three readings of
 * ONE study are not peers of the arms beside them.
 *
 * WHY THIS IS ITS OWN FILE. `coherence-sections.test.ts` owns the rail, the
 * relocation table and the read gates, and it was at 389 of 400 lines when this
 * contract needed a home. The house rule is to SPLIT rather than shave prose, and
 * the seam is real: that file asserts a section EXISTS and is wired, this one
 * asserts how its switcher is SHAPED.
 *
 * WHAT IS PINNED, and each of the four is a different way the shape could rot:
 *
 *  1. The section file draws exactly ONE seg, and it is the GROUP control. Two
 *     segs as siblings in the section's grid is the "two `.seg` controls in a
 *     column read as one broken control" that `DiffusionPane`'s own header
 *     rejected before any of this was built.
 *  2. The child draws exactly ONE seg, and it is the VIEW control. Naming the
 *     child rather than raising a count is the point: "expect 2 anywhere" would
 *     let any section grow a second control in silence.
 *  3. Every group label and every view label is still reachable, read across the
 *     PAIR. A label may move file without this suite deciding it was deleted;
 *     what is defended is that a reader can still reach all of them, since for
 *     the folded ids these labels are the only route that exists.
 *  4. The slow read is gated on the GROUP, not on the view inside it. That is
 *     what makes the grouping free rather than expensive: each group is exactly
 *     one gateway read, so pressing between two views of one group re-arms
 *     nothing.
 *
 * DERIVED, NEVER OBSERVED. There is no DOM here (CLAUDE.md, fact 6). This proves
 * the control is wired the way it claims; whether two levels READ as two levels
 * wants a human at a viewport, and that is said in the plan rather than pretended
 * at here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read } from "./helpers/workspace-sources";

/** The 400-line ceiling, restated so a split shows up here as well as in file-size. */
const CEILING = 400;

interface TwoLevel {
  /** The section component, which owns the group control. */
  readonly pane: string;
  /** The child that owns the view control. */
  readonly child: string;
  /** `aria-label` on each of the two segs. */
  readonly groupLabel: string;
  readonly viewLabel: string;
  /** Every group name, as the reader sees it. */
  readonly groups: readonly string[];
  /** Every view name across both files. */
  readonly views: readonly string[];
  /**
   * The expression that derives the gate from the GROUP, and the two gated
   * reads. Pinned as source because the property — one slow call per group,
   * never two — is not observable without a network.
   */
  readonly gate: RegExp;
  readonly gated: readonly RegExp[];
}

const SECTIONS: Record<string, TwoLevel> = {
  certificate: {
    pane: "../components/coherence/CertificatePane.tsx",
    child: "../components/coherence/CertificateGroups.tsx",
    groupLabel: "Certificate group",
    viewLabel: "Certificate view",
    groups: ["Coherence test", "Basket", "Parlays"],
    views: ["Verdict", "Proof", "Certificate", "Bands", "Parlays", "Bounds"],
    gate: /const onParlays = group === "parlays"/,
    gated: [/active && !onParlays/, /active=\{active && onParlays\}/],
  },
  diffusion: {
    pane: "../components/coherence/DiffusionPane.tsx",
    child: "../components/coherence/diffusion/DiffusionGroups.tsx",
    groupLabel: "Diffusion group",
    viewLabel: "Diffusion view",
    // Seven views on one row was the widest control on the desk, and `14r` said
    // so at its wrap rule. The three groups are the three READS: the absorption
    // ledger, the episode tape, and the study that gates its own.
    groups: ["Announcement arm", "Kalshi episodes", "Model", "Findings"],
    views: [
      "Absorption", "Noise floor", "Meetings", "Mechanism", "Survival", "Episodes",
      "Formulas", "Half-life", "Simulator", "Spectrum",
    ],
    gate: /const onEpisodes = group === "episodes"/,
    gated: [/active && onEpisodes/, /active && group === "arm"/],
  },
  calibration: {
    pane: "../components/coherence/CalibrationPane.tsx",
    child: "../components/coherence/CalibrationGroups.tsx",
    groupLabel: "Calibration group",
    viewLabel: "Calibration view",
    // Two groups, and they are the two questions the section was folded from:
    // was the price right ONCE SETTLED, and how far from coherent OVER TIME.
    // Two sections used to ask a reader to discover they were one; two groups
    // say it on the control.
    groups: ["Once settled", "Over time"],
    views: ["Score", "Bands", "Corpus", "Index series", "Index families"],
    gate: /const onIndex = group === "time"/,
    gated: [/active && !onIndex/, /active=\{active && onIndex\}/],
  },
};

describe("a crowded section splits its switcher into two levels", () => {
  for (const [id, section] of Object.entries(SECTIONS)) {
    describe(id, () => {
      it("the section draws one seg, and it names the groups", () => {
        const pane = read(section.pane);
        assert.equal(
          (pane.match(/className="seg[ "]/g) ?? []).length,
          1,
          `${id} draws more than one .seg in its own file — the second control belongs in ${section.child}`,
        );
        assert.match(pane, new RegExp(`aria-label="${section.groupLabel}"`));
        for (const label of section.groups) {
          assert.ok(pane.includes(`"${label}"`), `${id} lost its ${label} group`);
        }
      });

      it("the child draws one seg, and it is the view control", () => {
        const child = read(section.child);
        assert.equal(
          (child.match(/className="seg[ "]/g) ?? []).length,
          1,
          `${section.child} draws more than one .seg`,
        );
        assert.match(child, new RegExp(`aria-label="${section.viewLabel}"`));
      });

      it("every view is still reachable, across the pair", () => {
        // Read as one string on purpose: which FILE names a view is a design
        // decision that may change, and a guard that fails on the move would be
        // loosened until it meant nothing. That a reader can reach it is the
        // property being defended.
        const both = read(section.pane) + read(section.child);
        for (const label of section.views) {
          assert.ok(both.includes(`"${label}"`), `${id} lost its ${label} view`);
        }
      });

      it("the slow read is gated on the group, not on the view inside it", () => {
        const pane = read(section.pane);
        assert.match(
          pane,
          section.gate,
          `${id} derives its gate from the view again — it is the GROUP that decides which read runs, `
          + "or a reader pressing between two views of one group re-arms a call already answered",
        );
        for (const gated of section.gated) assert.match(pane, gated);
      });

      it("the engine banner stands over the settled group only", () => {
        // The whole settled half turns on one field a reader will not think to
        // check: `engine` says WHEN the price was read, and `final_trade` scores
        // a price quoted moments before settlement. That caveat invalidates
        // Score, Bands and Corpus and says nothing about the index, which is a
        // distance between live quotes scored against nothing. Hoisting it over
        // both groups would put "these are not forecasts" above a figure making
        // no forecast claim; burying it per-view loses the SHAPE of the claim,
        // which is that it invalidates the whole half rather than two rows.
        if (id !== "calibration") return;
        const child = read(section.child);
        assert.match(child, /EngineBanner/, "the banner is not drawn by the group that owns the settled views");
        assert.doesNotMatch(
          read(section.pane),
          /<EngineBanner/,
          "the banner is drawn above the group control again, so it stands over the index too",
        );
      });

      it("neither file is over the ceiling, since splitting is what bought the level", () => {
        for (const file of [section.pane, section.child]) {
          const lines = read(file).split("\n").length;
          assert.ok(lines <= CEILING, `${file} is ${lines} lines, over the ${CEILING} ceiling`);
        }
      });
    });
  }
});
