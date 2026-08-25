"use client";

/**
 * The instrument's own diagnostics, drawn against the thresholds they had to clear.
 *
 * REPLACES `InstrumentTable` AND THE STRIP THAT SAT ABOVE IT, and the reason is
 * what a look at the rendered view showed rather than what the source suggested.
 * The strip drew the two out-of-sample rows as bars; on this deployment both are
 * null, so it rendered two rows of "— — not measured" under a caption — a figure
 * carrying no information, and its row labels were clipped mid-word. Those same
 * two facts were then the last two rows of the table underneath it. So the view
 * opened on an empty drawing that duplicated part of the table below it.
 *
 * The table's own defect was its fifth column. "What failing it would mean" is
 * six fixed sentences that never change with the data, wrapped to three lines
 * each, and they were most of the view's height: 1,019px for six measurements.
 * They are not noise — they are the only way a reader outside the method can
 * tell a broken measurement from an honest null — so they move into a
 * disclosure rather than out of the tab.
 *
 * WHAT THE DRAWING ADDS THAT THE TABLE COULD NOT. A column of "✓ met" says a
 * threshold was cleared and cannot say by how much. Measured on the live read,
 * the four blind checks clear by wildly different margins — the representation
 * gate sits at nearly four times its floor, while the spread sits two per cent
 * over its own — and "both met" flattens that to one word. Each row is drawn on
 * its OWN nought-to-one scale, which every one of them already has natively
 * (an R², two indices out of ten, and a yes/no), so nothing is normalised into
 * existence to make the picture work.
 *
 * The two groups are the split the old caption spent forty-five words on. The
 * first four are measured blind to absorption speed, so reporting them cannot
 * manufacture a relationship with it. The last two ARE the headline, scored on
 * meetings the fit never saw — both stages of a meeting leave together, so a
 * statement can never help predict its own absorption.
 *
 * An unmeasured requirement is a gap with a reason beside it, never a bar of
 * length zero: "nothing predicts the clock" and "nobody has scored the clock
 * yet" are opposite readings and a zero-length bar draws them identically.
 */

import { Fragment } from "react";

import { fmt } from "@/lib/format";
import Figure from "../Figure";
import type { DiffusionStudy, GateCheck } from "./types";

/** Both diagnostics are reported on one nought-to-ten scale so they can be read
 *  against the same threshold. Ten means the readings span the sampler's own
 *  scale or more; for the rank it means every latent direction is carrying. */
const index = (ratio: number | null | undefined) =>
  ratio == null ? null : Math.min(10, ratio * 10);

interface Check {
  /** The requirement, as the reader meets it. */
  readonly what: string;
  /** The measurement, printed exactly. A dash when there is none. */
  readonly value: string;
  /** The threshold, printed exactly — carried into the hover and the label. */
  readonly needed: string;
  /** Where the measurement sits on this row's own nought-to-one scale. */
  readonly at: number | null;
  /** Where the threshold sits on that same scale. */
  readonly floor: number;
  readonly met: boolean | null;
  /** The margin in the row's own units, or why there is no measurement. */
  readonly room: string;
  /** What failing this row would have meant. Fixed prose; never data. */
  readonly why: string;
}

interface Group {
  readonly title: string;
  readonly rows: readonly Check[];
}

function groupsOf(study: DiffusionStudy, gate: GateCheck | null): Group[] {
  const spread = index(study.centroid_spread);
  const rank = study.effective_rank;
  const scored = study.skill_meetings;

  return [
    {
      title: "Measured blind to absorption speed",
      rows: [
        {
          what: "Recovers a known fact",
          value: gate?.r_squared != null
            ? `R² ${gate.r_squared >= 0 ? "+" : ""}${fmt(gate.r_squared, 2)}`
            : "—",
          needed: gate ? `≥ ${fmt(gate.floor, 2)}` : "—",
          at: gate?.r_squared == null ? null : Math.min(1, Math.max(0, gate.r_squared)),
          floor: gate ? Math.min(1, gate.floor) : 0,
          met: gate ? gate.state === "passed" : null,
          room: gate?.r_squared == null
            ? (gate?.reason ?? "the gate was not run")
            : `${fmt(gate.r_squared - gate.floor, 2)} clear of the ${fmt(gate.floor, 2)} floor`,
          why: "The encoding loses what the statement actually said.",
        },
        {
          what: "Uses its dimensions",
          value: rank != null ? `${fmt(rank, 2)} of 10` : "—",
          needed: "≥ 9 of 10",
          at: rank == null ? null : Math.min(1, rank / 10),
          floor: 0.9,
          met: rank == null ? null : rank >= 9,
          room: rank == null
            ? "no rank was reported"
            : `${fmt(rank - 9, 2)} of 10 clear of 9`,
          why: "The latent has collapsed onto a few directions and carries less than it claims.",
        },
        {
          what: "Readings spread out",
          value: spread != null ? `${fmt(spread, 2)} of 10` : "—",
          needed: "≥ 9 of 10",
          at: spread == null ? null : Math.min(1, spread / 10),
          floor: 0.9,
          met: spread == null ? null : spread >= 9,
          room: spread == null
            ? "no spread was reported"
            : `${fmt(spread - 9, 2)} of 10 clear of 9`,
          why: "Every event scores almost the same, so no regression could separate them.",
        },
        {
          // The one row with no continuous scale: the threshold is "none
          // refused", so the bar is full or it is not. Drawn with its tick at
          // the origin rather than given an invented denominator — the wire
          // carries no count of events OFFERED to compare against.
          what: "Scores every event",
          value: `${study.events} meetings`,
          needed: "no silent drops",
          at: study.events > 0 ? 1 : 0,
          floor: 0,
          met: study.events > 0,
          room: study.events > 0 ? "no event refused below the floor" : "no event was scored",
          why: "Events refused below the information floor would bias which meetings are tested.",
        },
      ],
    },
    {
      title: "The headline itself, scored out of sample",
      rows: [
        {
          // The target's own row, deliberately ABOVE the predictor's: a reader
          // who takes the last row as a result about the market has to pass
          // this one first, and if this one fails the last row means nothing.
          what: "The clock is predictable at all",
          value: study.skill_baseline_r2 != null
            ? `R² ${study.skill_baseline_r2 >= 0 ? "+" : ""}${fmt(study.skill_baseline_r2, 3)}`
            : "—",
          needed: "> 0, out of sample",
          at: study.skill_baseline_r2 == null
            ? null
            : Math.min(1, Math.max(0, study.skill_baseline_r2)),
          floor: 0,
          met: study.skill_baseline_r2 == null ? null : study.skill_baseline_r2 > 0,
          room: study.skill_baseline_r2 != null
            ? `${fmt(study.skill_baseline_r2, 3)} above a baseline that already knows the stage and the rate move`
            : `${scored} meetings scored out of sample`,
          why: "Nothing predicts absorption speed, so no null measured against it is about the text.",
        },
        {
          what: "The text predicts it",
          value: study.skill_gain != null
            ? `${study.skill_gain >= 0 ? "+" : ""}${fmt(study.skill_gain, 3)} R²`
              + (study.skill_shuffled_p != null ? `, p ${fmt(study.skill_shuffled_p, 2)}` : "")
            : "—",
          needed: "> 0, p < 0.05",
          at: study.skill_gain == null ? null : Math.min(1, Math.max(0, study.skill_gain)),
          floor: 0,
          met: study.skill_gain == null
            ? null
            : study.skill_gain > 0 && (study.skill_shuffled_p ?? 1) < 0.05,
          room: study.skill_gain != null
            ? `${fmt(study.skill_gain, 3)} R² on meetings the fit never saw`
            : "nothing to add to until the row above is measured",
          why: "The statement's information spectrum adds nothing to the stage and the rate move.",
        },
      ],
    },
  ];
}

function stateWord(met: boolean | null): string {
  return met == null ? "not measured" : met ? "met" : "not met";
}

function Row({ check }: { check: Check }) {
  const mark = check.met == null ? "◌" : check.met ? "✓" : "✗";
  const title = `${check.what}: ${check.value}, needed ${check.needed} — `
    + `${stateWord(check.met)}; ${check.room}`;
  return (
    <div className="diff-fit__row">
      <span className="diff-fit__what">{check.what}</span>
      <span className="diff-fit__value num">{check.value}</span>
      <span className={`diff-fit__track${check.at == null ? " is-absent" : ""}`} title={title}>
        {check.at == null ? null : (
          <>
            <span className="diff-fit__fill" style={{ width: `${(check.at * 100).toFixed(1)}%` }} />
            {/* The threshold, drawn on the same track rather than beside it:
                the reader's question is how far past the line the measurement
                sits, and a second track cannot answer a question about one. */}
            <span className="diff-fit__floor" style={{ left: `${(check.floor * 100).toFixed(1)}%` }} />
          </>
        )}
      </span>
      <span className="diff-fit__room">
        <span aria-hidden="true">{mark}</span> {check.room}
      </span>
    </div>
  );
}

export default function InstrumentFit({ study, gate }: {
  study: DiffusionStudy;
  gate: GateCheck | null;
}) {
  const groups = groupsOf(study, gate);
  const rows = groups.flatMap((group) => group.rows);
  const blind = groups[0].rows;
  const absent = rows.filter((check) => check.at == null);
  const allBlindMet = blind.every((check) => check.met === true);

  return (
    <div className="diff-fit">
      <Figure
        caption="Every requirement against the threshold it had to clear, on its own scale"
        // The whole table in one string, because everything below sits inside
        // the figure's `role="img"` and is presentational to a screen reader.
        ariaLabel={`${rows.length} requirements. ` + rows
          .map((check) => `${check.what}: ${check.value}, needed ${check.needed}, ${stateWord(check.met)}`)
          .join("; ")}
        // ONE LINE, because this rung is `--fs-title` across the engine
        // (`14q-markets-density.css`) and a three-clause reading at 17px is the
        // largest thing on the view, over the drawing it is meant to gloss.
        reading={allBlindMet
          ? "All four blind checks clear, and by very different margins: the gate has room to spare where the rank and the spread sit just past their floors."
          : "A check made blind to absorption speed has not cleared its threshold, so nothing above is evidence yet."}
        // The COUNT and the rule, not the reasons: each absent row already
        // carries its own beside its own track, and repeating them here is the
        // one-fact-said-twice this tab spent a pass removing.
        missing={absent.length
          ? `${absent.length} of ${rows.length} requirements have no measurement, and each says why on its own row `
            + "rather than drawing a bar of length zero."
          : null}
      >
        <div className="diff-fit__ladder">
          {groups.map((group) => (
            <div className="diff-fit__group" key={group.title}>
              <p className="diff-fit__grouphead">{group.title}</p>
              {group.rows.map((check) => <Row key={check.what} check={check} />)}
            </div>
          ))}
        </div>
      </Figure>

      {/* Six fixed sentences that never move with the data. They were the
          table's widest column and most of this view's height; folded, because
          a reader needs them once and not on every glance at the numbers. */}
      <details className="disclosure">
        <summary>{`What each requirement is guarding against, ${rows.length}`}</summary>
        <dl className="diff-fit__why">
          {rows.map((check) => (
            <Fragment key={check.what}>
              <dt>{check.what}</dt>
              <dd>{check.why}</dd>
            </Fragment>
          ))}
        </dl>
      </details>
    </div>
  );
}
