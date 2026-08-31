/**
 * The audit half of the linked absorption workbench.
 *
 * `AbsorptionCurve` is the pointer-and-keyboard instrument. This companion
 * keeps the estimator and every exact horizon value open beneath it, from the
 * same payload and without another selector or request. The table distinguishes
 * the gateway's mean from the browser-derived middle 50% explicitly: one is a
 * wire aggregate, the other is provenance over the run cells behind its band.
 */

import { absorptionWorkbenchEvidence, type AbsorptionStage } from "@/lib/coherence/absorption-workbench";
import { secondsLabel } from "@/lib/coherence/decimals";
import { pct } from "@/lib/format";

import styles from "./AbsorptionWorkbench.module.css";
import type { StageRun, StageSummary } from "./types";

const STAGES: readonly AbsorptionStage[] = ["release", "call"];
const STAGE_WORD: Record<AbsorptionStage, string> = {
  release: "Statement",
  call: "Press conference",
};

interface AbsorptionWorkbenchProps {
  horizons: readonly string[];
  release: readonly (number | null)[];
  call: readonly (number | null)[];
  stages: readonly StageSummary[];
  runs: readonly StageRun[];
}

function crossingValue(crossing: ReturnType<typeof absorptionWorkbenchEvidence>["crossings"][AbsorptionStage]): string {
  return crossing.state === "ok" ? secondsLabel(crossing.value) : "not resolved";
}

function crossingBasis(crossing: ReturnType<typeof absorptionWorkbenchEvidence>["crossings"][AbsorptionStage]): string {
  if (crossing.state !== "ok") return crossing.reason ?? crossing.state.replaceAll("_", " ");
  return `log-grid interpolation between ${secondsLabel(crossing.lower)} and ${secondsLabel(crossing.upper)}`;
}

function bandLabel(band: { p25: number | null; p75: number | null }): string {
  return band.p25 == null || band.p75 == null ? "—" : `${pct(band.p25)}–${pct(band.p75)}`;
}

export default function AbsorptionWorkbench({ horizons, release, call, stages, runs }: AbsorptionWorkbenchProps) {
  const evidence = absorptionWorkbenchEvidence(horizons, release, call, runs);
  const rows = evidence.rows.flatMap((row) => STAGES.map((stage) => ({
    horizon: row.horizon,
    stage,
    cell: row[stage],
  })));

  return (
    <section className={styles.evidence} aria-labelledby="absorption-workbench-heading">
      <header className={styles.heading}>
        <p className={styles.eyebrow}>Estimator audit</p>
        <h3 id="absorption-workbench-heading">Crossing, observed spread and exact horizon values</h3>
        <p className={styles.lede}>
          The 50% crossing uses the parity-tested log-horizon estimator. The shaded middle 50% is observed
          run-to-run spread at a horizon, not a confidence interval, and its population is reported below.
        </p>
      </header>

      <div className={styles.cards}>
        {STAGES.map((stage) => {
          const summary = stages.find((row) => row.stage === stage);
          const crossing = evidence.crossings[stage];
          return (
            <article className={styles.card} key={stage}>
              <h4>{STAGE_WORD[stage]}</h4>
              <dl>
                <dt>Median resolved run half-life</dt>
                <dd>{summary?.median_half_life_s != null
                  ? secondsLabel(summary.median_half_life_s)
                  : `not measured${summary?.reason ? ` — ${summary.reason}` : ""}`}</dd>
                <dt>Mean-curve 50% crossing</dt>
                <dd>{crossingValue(crossing)}</dd>
                <dt>Crossing basis</dt>
                <dd>{crossingBasis(crossing)}</dd>
                <dt>Stage population</dt>
                <dd>{summary
                  ? `${summary.measured} measured; ${summary.no_signal} no signal; ${summary.other} other refusal`
                  : "not reported"}</dd>
              </dl>
            </article>
          );
        })}
      </div>

      <div
        className="table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Exact absorption values; scroll horizontally"
      >
        <table className={`coh-table ${styles.table}`}>
          <caption className="coh-table__caption">
            Payload means and the middle 50% of floor-cleared run cells. A dash is missing, never zero.
          </caption>
          <thead>
            <tr>
              <th scope="col">Horizon</th>
              <th scope="col">Stage</th>
              <th scope="col" className="num">Payload mean</th>
              <th scope="col" className="num">Middle 50%</th>
              <th scope="col" className="num">Cells</th>
              <th scope="col">Record provenance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.horizon}-${row.stage}`}>
                <th scope="row">{row.horizon}</th>
                <td>{STAGE_WORD[row.stage]}</td>
                <td className="num">{pct(row.cell.mean)}</td>
                <td className="num">{bandLabel(row.cell.band)}</td>
                <td className="num">{row.cell.band.n}</td>
                <td>{row.cell.provenance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
