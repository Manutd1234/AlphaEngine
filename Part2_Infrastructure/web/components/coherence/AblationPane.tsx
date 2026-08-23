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
 *
 * The replay itself is read by `FeesSection`, which gates it on this view being
 * the one on screen: at 20,000 rows it is the largest read on the tab and it
 * used to run on every visit to Fees, including the two views that never show
 * it.
 */

import { useMeasuredWidth } from "@/components/chart-kit";
import type { CoherenceAblation, CoherenceReplay } from "@/lib/coherence/types";
import Figure, { FigureEmpty } from "./Figure";

const HEIGHT = 120;
const ROW_HEIGHT = 22;
const CAPTION = "Tradable arbitrages found, by how much of the cost model is switched on";

/**
 * What the replay could not test, and therefore could not draw.
 *
 * `untestable` is counted per configuration, so the worst of them is the honest
 * bound: the chart used to omit these rows without saying it had.
 */
function untestableNote(ablations: CoherenceAblation[]): string | null {
  const worst = ablations.reduce((most, row) => Math.max(most, row.untestable), 0);
  if (worst === 0) return null;
  return `Up to ${worst} observation(s) could not be tested in a single configuration and are counted in no bar.`;
}

function Bars({ ablations }: { ablations: CoherenceAblation[] }) {
  const [plotRef, plotW] = useMeasuredWidth<HTMLDivElement>(720);
  const peak = Math.max(...ablations.map((row) => row.worth_doing), 1);
  const naive = ablations.find((row) => row.name === "no_fees");
  const full = ablations.find((row) => row.name === "full");
  const invented = (naive?.worth_doing ?? 0) - (full?.worth_doing ?? 0);
  const missing = untestableNote(ablations);

  if (!ablations.some((row) => row.violations > 0)) {
    return (
      <Figure
        caption={CAPTION}
        ariaLabel={`Bar chart, ${ablations.length} configurations, no bars drawn`}
        reading="No configuration found a violation on this tape, which is the ordinary answer: real prices on this exchange are usually coherent. The comparison becomes informative once the tape has caught one."
        missing={missing}
      >
        <FigureEmpty reason="Nothing yet to separate the models on." />
      </Figure>
    );
  }

  const height = Math.max(HEIGHT, ablations.length * ROW_HEIGHT + 20);

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={`${ablations.length} configurations compared; the naive test finds ${naive?.worth_doing ?? 0} and the full model finds ${full?.worth_doing ?? 0}`}
      reading={
        invented > 0
          ? `Fees off reports ${invented} more tradable arbitrage(s) than fees on. Those are not opportunities the engine missed — they are opportunities that do not exist, and a bot without a fee model would have traded every one.`
          : "The naive and fee-aware tests agree on this tape."
      }
      missing={missing}
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

export default function AblationPane({
  replay,
  error,
}: {
  /** The replayed tape, or null until the gateway answers. */
  replay: CoherenceReplay | null;
  error: string | null;
}) {
  const heading = <h4>What each cost model would have seen</h4>;

  if (error && !replay) {
    return (
      <div className="coh-ablation-pane">
        {heading}
        <p className="console-empty">
          <span aria-hidden="true">✕</span> The tape could not be replayed: {error}
        </p>
      </div>
    );
  }
  if (!replay) {
    return (
      <div className="coh-ablation-pane">
        {heading}
        <p className="console-empty muted">Replaying the tape…</p>
      </div>
    );
  }
  if (replay.state === "empty") {
    return (
      <div className="coh-ablation-pane">
        {heading}
        <p className="console-empty">
          <span aria-hidden="true">◌</span> {replay.notes[0] ?? "The tape is empty."}
        </p>
      </div>
    );
  }

  return (
    <div className="coh-ablation-pane">
      {heading}

      <Bars ablations={replay.ablations} />

      {/* The books-replayed and families-tested counts were two chips over this
          table. They are facts about the tape the caption already introduces,
          so they are stated once, there. */}
      <div className="table-wrap">
        <table className="coh-table">
          <caption className="coh-table__caption">
            Every configuration, over the same tape — {replay.rows} books replayed, {replay.observations} families
            tested. <code>worth_doing</code> counts violations whose net edge survives that configuration&rsquo;s fees.
          </caption>
          <thead>
            <tr>
              <th scope="col">Configuration</th>
              <th scope="col">What it models</th>
              <th scope="col" className="num">Violations</th>
              <th scope="col" className="num"><code>worth_doing</code></th>
              <th scope="col" className="num">Gross</th>
              <th scope="col" className="num">Net</th>
            </tr>
          </thead>
          <tbody>
            {replay.ablations.map((row) => (
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

      <p className="coh-event__note">{replay.headline}</p>
      {replay.notes.map((note, index) => (
        <p className="coh-event__note" key={`${index}-${note}`}>
          <span aria-hidden="true">◌</span> {note}
        </p>
      ))}
    </div>
  );
}
