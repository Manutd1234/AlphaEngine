"use client";

/**
 * Which parts of the cost model change the answer — this project's thesis plot.
 *
 * The same recorded tape is replayed under four configurations. `no_fees` is the
 * test every bot in this space ships with — buy the basket if it costs less than
 * a dollar. `full` is the real thing: three fee components, charged per fill,
 * at an ordinary account's balance precision. The gap between them is how many
 * opportunities the naive test invents.
 *
 * It is not a P&L estimate and does not pretend to be. Replaying an arbitrage
 * engine over its own recorded quotes cannot say what it would have earned,
 * because it could not have traded against every quote it recorded. It can say
 * what each model would have SEEN, and that is the question worth asking of a
 * cost model nobody has ablated.
 */

import { useMeasuredWidth } from "@/components/chart-kit";
import type { CoherenceAblation, CoherenceReplay } from "@/lib/coherence/types";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import Figure, { FigureEmpty, StateChip } from "./Figure";

const HEIGHT = 120;
const ROW_HEIGHT = 22;

function Bars({ ablations }: { ablations: CoherenceAblation[] }) {
  const [plotRef, plotW] = useMeasuredWidth<HTMLDivElement>(720);
  const peak = Math.max(...ablations.map((row) => row.worth_doing), 1);
  const naive = ablations.find((row) => row.name === "no_fees");
  const full = ablations.find((row) => row.name === "full");
  const invented = (naive?.worth_doing ?? 0) - (full?.worth_doing ?? 0);

  if (!ablations.some((row) => row.violations > 0)) {
    return (
      <Figure
        caption="Tradable arbitrages found, by how much of the cost model is switched on"
        ariaLabel="No configuration found a violation on this tape"
        reading="No configuration found a violation on this tape, which is the ordinary answer: real prices on this exchange are usually coherent. The comparison becomes informative once the tape has caught one."
      >
        <FigureEmpty reason="No violations recorded yet — nothing to separate the models on." />
      </Figure>
    );
  }

  const height = Math.max(HEIGHT, ablations.length * ROW_HEIGHT + 20);

  return (
    <Figure
      caption="Tradable arbitrages found, by how much of the cost model is switched on"
      ariaLabel={`Four configurations compared; the naive test finds ${naive?.worth_doing ?? 0} and the full model finds ${full?.worth_doing ?? 0}`}
      reading={
        invented > 0
          ? `Turning the fee model off reports ${invented} more tradable arbitrage(s) than turning it on. Those are not opportunities the engine missed — they are opportunities that do not exist, and a bot without a fee model would have traded every one of them.`
          : "The naive and fee-aware tests agree on this tape."
      }
    >
      <div ref={plotRef} style={{ width: "100%" }}>
        <svg viewBox={`0 0 ${plotW} ${height}`} width={plotW} height={height} className="coh-ablation">
        {ablations.map((row, index) => {
          const width = (row.worth_doing / peak) * (plotW - 140);
          const y = 6 + index * ROW_HEIGHT;
          return (
            <g key={row.name}>
              <text x="0" y={y + 8} className="coh-ablation__label">
                {row.name}
              </text>
              <rect
                x="96"
                y={y}
                width={Math.max(0.4, width)}
                height={12}
                className={`coh-ablation__bar ${row.name === "no_fees" ? "is-naive" : ""}`}
              />
              <text x={Math.min(plotW - 6, 100 + width)} y={y + 9} className="coh-ablation__value">
                {row.worth_doing}
              </text>
            </g>
          );
        })}
        </svg>
      </div>
    </Figure>
  );
}

export default function AblationPane({ active }: { active: boolean }) {
  const { data, error } = useCoherenceRead<CoherenceReplay>("/api/gateway/coherence/replay?limit=20000", active);

  if (error && !data) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The tape could not be replayed: {error}
      </p>
    );
  }
  if (!data) return <p className="console-empty muted">Replaying the tape…</p>;
  if (data.state === "empty") {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span> {data.notes[0] ?? "The tape is empty."}
      </p>
    );
  }

  return (
    <div className="coh-ablation-pane">
      <div className="coh-status__chips">
        <StateChip mark="●" word="Books replayed" value={String(data.rows)} tone="muted" />
        <StateChip mark="◇" word="Families tested" value={String(data.observations)} tone="muted" />
        <StateChip mark="→" word="Tape spans" value={`${data.span_seconds}s`} tone="muted" />
      </div>

      <Bars ablations={data.ablations} />

      <div className="table-wrap">
        <table className="coh-table">
          <caption className="coh-table__caption">
            Every configuration, over the same tape. `worth_doing` counts violations whose net edge survives that
            configuration&rsquo;s fees.
          </caption>
          <thead>
            <tr>
              <th scope="col">Configuration</th>
              <th scope="col">What it models</th>
              <th scope="col" className="num">Violations</th>
              <th scope="col" className="num">Tradable</th>
              <th scope="col" className="num">Gross</th>
              <th scope="col" className="num">Net</th>
            </tr>
          </thead>
          <tbody>
            {data.ablations.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                <td>{row.description}</td>
                <td className="num">{row.violations}</td>
                <td className="num">{row.worth_doing}</td>
                <td className="num">{row.gross_total}</td>
                <td className="num">{row.net_total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="coh-event__note">{data.headline}</p>
      {data.notes.map((note, index) => (
        <p className="coh-event__note" key={`${index}-${note}`}>
          <span aria-hidden="true">◌</span> {note}
        </p>
      ))}
    </div>
  );
}
