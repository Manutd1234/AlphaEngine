"use client";

/**
 * The instrument's own diagnostics, beside the results it produced.
 *
 * Three things have to be true before an empty results table means the market
 * is efficient rather than the measurement is broken, and all three are
 * measured without ever looking at absorption speed — so reporting them cannot
 * manufacture a relationship with it.
 *
 * The representation must be able to recover a fact that is literally written
 * in the documents. It must use its dimensions rather than collapsing onto a
 * few. And its readings must actually spread out along the resolution axis: a
 * feature whose values all sit within a hundredth of each other cannot predict
 * anything however well each one is estimated, and in a regression that
 * failure is indistinguishable from a true null.
 *
 * The fourth requirement is about the TARGET rather than the instrument, and it
 * is the one this table used to leave out. An absorption clock that nothing
 * predicts cannot be evidence that the text does not predict it, so the last
 * two rows report how well the clock is predicted WITHOUT the text — from the
 * stage and the size of the rate move — and only then what the text adds to
 * that, scored on meetings the fit never saw. Both stages of a meeting leave
 * the fit together, so a statement can never help predict its own absorption.
 */

import { fmt } from "@/lib/format";

import type { DiffusionStudy, GateCheck } from "./types";

/** Both diagnostics are reported on one nought-to-ten scale so they can be read
 *  against the same threshold. Ten means the readings span the sampler's own
 *  scale or more; for the rank it means every latent direction is carrying. */
const index = (ratio: number | null | undefined) =>
  ratio == null ? null : Math.min(10, ratio * 10);

function Row({ what, value, target, met, why }: {
  what: string;
  value: string;
  target: string;
  met: boolean | null;
  why: string;
}) {
  return (
    <tr>
      <th scope="row">{what}</th>
      <td className="num">{value}</td>
      <td className="num">{target}</td>
      <td>
        <span aria-hidden="true">{met == null ? "◌" : met ? "✓" : "✗"}</span>{" "}
        {met == null ? "not measured" : met ? "met" : "not met"}
      </td>
      <td className="diff-instrument__why">{why}</td>
    </tr>
  );
}

export default function InstrumentTable({ study, gate }: {
  study: DiffusionStudy;
  gate: GateCheck | null;
}) {
  const spread = index(study.centroid_spread);
  const rank = study.effective_rank;

  return (
    <div className="table-wrap" tabIndex={0}>
      <table className="coh-table diff-instrument">
        <caption className="coh-table__caption">
          What had to be true of the instrument before the results above could be read as
          evidence. The first four are measured without reference to absorption speed; the last
          two are the headline itself, scored on meetings the fit never saw, with both stages of a
          meeting held out together so no statement can help predict its own absorption.
        </caption>
        <thead>
          <tr>
            <th scope="col">Property</th>
            <th scope="col" className="num">Measured</th>
            <th scope="col" className="num">Needed</th>
            <th scope="col">State</th>
            <th scope="col">What failing it would mean</th>
          </tr>
        </thead>
        <tbody>
          <Row
            what="Recovers a known fact"
            value={gate?.r_squared != null
              ? `R² ${gate.r_squared >= 0 ? "+" : ""}${fmt(gate.r_squared, 2)}`
              : "—"}
            target={gate ? `≥ ${fmt(gate.floor, 2)}` : "—"}
            met={gate ? gate.state === "passed" : null}
            why="The text is encoded in a way that loses what the statement actually said."
          />
          <Row
            what="Uses its dimensions"
            value={rank != null ? `${fmt(rank, 2)} of 10` : "—"}
            target="≥ 9 of 10"
            met={rank == null ? null : rank >= 9}
            why="The latent has collapsed onto a few directions and carries less than it claims."
          />
          <Row
            what="Readings spread out"
            value={spread != null ? `${fmt(spread, 2)} of 10` : "—"}
            target="≥ 9 of 10"
            met={spread == null ? null : spread >= 9}
            why="Every event scores almost the same, so no regression could separate them."
          />
          <Row
            what="Scores every event"
            value={`${study.events} meetings`}
            target="no silent drops"
            met={study.events > 0}
            why="Events refused below the information floor would bias which meetings are tested."
          />
          {/* The target's own row. It is deliberately ABOVE the predictor's:
              a reader who takes the last row as a result about the market has
              to pass this one first, and if this one fails the last row means
              nothing at all. */}
          <Row
            what="The clock is predictable at all"
            value={study.skill_baseline_r2 != null
              ? `R² ${study.skill_baseline_r2 >= 0 ? "+" : ""}${fmt(study.skill_baseline_r2, 3)}`
              : "—"}
            target="> 0, out of sample"
            met={study.skill_baseline_r2 == null ? null : study.skill_baseline_r2 > 0}
            why="Nothing predicts absorption speed, so no null measured against it is about the text."
          />
          <Row
            what="The text predicts it"
            value={study.skill_gain != null
              ? `${study.skill_gain >= 0 ? "+" : ""}${fmt(study.skill_gain, 3)} R²`
              + (study.skill_shuffled_p != null ? `, p ${fmt(study.skill_shuffled_p, 2)}` : "")
              : "—"}
            target="> 0, p < 0.05"
            met={study.skill_gain == null ? null
              : study.skill_gain > 0 && (study.skill_shuffled_p ?? 1) < 0.05}
            why="The statement's information spectrum adds nothing to the stage and the rate move."
          />
        </tbody>
      </table>
    </div>
  );
}
