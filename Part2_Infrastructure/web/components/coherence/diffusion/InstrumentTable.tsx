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
          evidence. Every figure here is measured without reference to absorption speed.
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
        </tbody>
      </table>
    </div>
  );
}
