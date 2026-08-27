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
 * TWO VIEWS OF FEES AGAIN, and the read stayed here. This was the third option
 * of the Fees `.seg` until the promotion pass of 2026-08-24 made it a rail; the
 * merge later that day put it back as two of that section's four views —
 * Ablation, which is the bars, and Replay table, which is the arithmetic. What
 * the promotion moved and the merge kept is the READ: `FeesSection` used to own
 * the 20,000-row replay and gate it on a view, which is why it held two reads
 * and a `framing()` helper for "not read on this view". The pane that draws the
 * replay owns it, gated on the two views that draw it.
 *
 * The console warms nothing for it, deliberately, and says so beside
 * `SECTION_READS`: `/replay?limit=20000` is the largest read on the tab, and
 * warming on hover would spend it for a reader who came to see a fee.
 *
 * The bars and the table are two views rather than one column because stacked
 * they were two screens, and the reader's question ("how many opportunities does
 * the naive test invent") is answered by the bars alone. Neither draws a head:
 * `FeesSection` draws the section's one head, and the sentence that used to be
 * this pane's lede leads both views.
 */

import type { CoherenceAblation, CoherenceReplay } from "@/lib/coherence/types";
import { replayRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import Figure, { FigureEmpty, Plot, StateChip } from "./Figure";
import { statValue } from "@/lib/coherence/decimals";
import { HotSource, useHot } from "@/lib/coherence/use-hot";
import ValueStrip from "./ValueStrip";

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
  return `Up to ${worst} observation(s) per configuration could not be tested and are counted in no bar.`;
}

function Bars({ ablations }: { ablations: CoherenceAblation[] }) {
  const peak = Math.max(...ablations.map((row) => row.worth_doing), 1);
  const naive = ablations.find((row) => row.name === "no_fees");
  const full = ablations.find((row) => row.name === "full");
  // A configuration the tape did not run is not a configuration that found
  // zero. With either missing there is no difference to report, and the
  // reading says so rather than announcing agreement (null-honest, 2026-08-26).
  const invented = naive && full ? naive.worth_doing - full.worth_doing : null;
  const missing = untestableNote(ablations);

  if (!ablations.some((row) => row.violations > 0)) {
    return (
      <Figure
        caption={CAPTION}
        ariaLabel={`Bar chart, ${ablations.length} configurations, no bars drawn`}
        reading="No configuration found a violation on this tape yet, so there is nothing to separate the models on."
        missing={missing}
      >
        <FigureEmpty reason="No violation caught yet." />
      </Figure>
    );
  }

  const height = Math.max(HEIGHT, ablations.length * ROW_HEIGHT + 20);

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={`${ablations.length} configurations compared; ${naive ? `the naive test finds ${naive.worth_doing}` : "the naive test did not run"} and ${full ? `the full model finds ${full.worth_doing}` : "the full model did not run"}`}
      reading={
        invented === null
          ? `The tape ran ${!naive && !full ? "neither the fee-free nor the full-model" : naive ? "no full-model" : "no fee-free"} configuration, so the two cannot be compared.`
          : invented > 0
            ? `Fees off reports ${invented} more tradable arbitrage(s) than fees on — opportunities that do not exist.`
            : "The naive and fee-aware tests agree on this tape."
      }
      missing={missing}
    >
      {/* THROUGH `Plot` since 2026-08-27. It drew into its own `<svg>` over
          `useMeasuredWidth`, which is the shape that left the fee parabola and
          the strike ladder mouse-only: no tab stop, no arrow keys, no live
          region, and each bar's `<title>` reachable only by hovering it. The
          titles were already one per row, so the mark readout walks them as
          they stand — and the plot publishes the walked row into any
          `HotSource` above it, the way the strip beside the table does. */}
      <Plot height={height}>
        {(width) => (
          <g className="coh-ablation">
        {ablations.map((row, index) => {
          // 96px of label column against the longest configuration name the
          // gateway declares — "direct_member", 13 chars x 6.72px/char at the
          // 12px label rung (14r) = 87px — so no name is elided mid-word.
          const barW = (row.worth_doing / peak) * (width - 140);
          const y = 6 + index * ROW_HEIGHT;
          return (
            <g key={row.name}>
              <title>{`${row.name}: ${row.worth_doing} of ${row.violations} violations survive its fees`}</title>
              <text x="0" y={y + 8} className="coh-ablation__label">
                {row.name}
              </text>
              <rect
                x="96"
                y={y}
                width={Math.max(0.4, barW)}
                height={12}
                className={`coh-ablation__bar ${row.name === "no_fees" ? "is-naive" : ""}`}
              />
              <text x={Math.min(width - 6, 100 + barW)} y={y + 9} className="coh-ablation__value">
                {row.worth_doing}
              </text>
            </g>
          );
        })}
          </g>
        )}
      </Plot>
    </Figure>
  );
}

/** The bars, and the arithmetic under them. Two of the Fees section's four. */
export type AblationView = "comparison" | "table";

/** The lead sentence both views open with, and the claim they exist to make. */
function Lede() {
  return (
    <p className="sub">
      One of the four is <code>no_fees</code> — buy the basket if it costs under a dollar — the test every bot in
      this space ships with, and the gap to <code>full</code> is how many opportunities it invents.
    </p>
  );
}

export default function AblationPane({ view, active }: { view: AblationView; active: boolean }) {
  const { data, error } = useCoherenceRead<CoherenceReplay>(replayRoute(), active);

  if (error && !data) {
    return (
      <div className="coh-ablation-pane">
        <Lede />
        <p className="console-empty">
          <span aria-hidden="true">✕</span> The tape could not be replayed: {error}
        </p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="coh-ablation-pane">
        <Lede />
        <p className="console-empty muted">Replaying the tape…</p>
      </div>
    );
  }
  if (data.state === "empty") {
    return (
      <div className="coh-ablation-pane">
        <Lede />
        <p className="console-empty">
          <span aria-hidden="true">◌</span> {data.notes[0] ?? "The tape is empty."}
        </p>
      </div>
    );
  }

  return (
    <div className="coh-ablation-pane">
      <Lede />

      {/* One chip, not four. Books replayed and families tested are facts about
          the tape the table's caption already introduces, and the span rides
          with it — so what is left is the engine's own headline. */}
      <div className="coh-status__chips">
        <StateChip mark="→" word="Replay verdict" value={data.headline} tone="muted" />
        <StateChip mark="●" word="Tape replayed" value={`${data.rows} books over ${data.span_seconds}s`} tone="muted" />
      </div>

      {view === "comparison" ? (
        <Bars ablations={data.ablations} />
      ) : (
        /* The provider, and it wraps a CHILD rather than this component's own
           body: a component cannot consume the context it renders, so the pair
           that shares the index has to live one level down. */
        <HotSource>
          <ReplayTable data={data} />
        </HotSource>
      )}
    </div>
  );
}

/**
 * The strip, the table and the one index they share.
 *
 * These are the same six configurations in the same order, drawn once as
 * lengths and once as figures, and until 2026-08-26 a reader comparing them
 * had to hold a row's position in their head while moving between the two.
 * Now the hand is the link, in both directions: the strip publishes the mark
 * it is showing (it draws through `Plot`, which puts its hot index in the
 * context), and the rows below publish theirs, so hovering either lights the
 * other. A stroke, never a fill — hot is where the hand is, not a meaning.
 */
function ReplayTable({ data }: { data: CoherenceReplay }) {
  const { hot, setHot } = useHot();
  return (
    <>
      {/* The table's decisive column, drawn: what each cost model says the
          whole tape netted. The Comparison bars count opportunities; this
          strip prices them, which is the other half of the ablation. */}
      <ValueStrip
        hot={hot}
        caption="Net edge per configuration over the whole tape, against zero"
        ariaLabel={`Net total per configuration for ${data.ablations.length} cost models`}
        rows={data.ablations.map((row) => ({
          label: row.name,
          value: statValue(row.net_total),
          text: row.net_total,
          title: `${row.name}: ${row.violations} violations, ${row.worth_doing} worth doing, gross ${row.gross_total}, net ${row.net_total}`,
          noBar: statValue(row.net_total) == null ? "not readable" : undefined,
        }))}
      />
      <div className="table-wrap" tabIndex={0}>
        <table className="coh-table">
          <caption className="coh-table__caption">
            The same tape under every configuration — {data.rows} books, {data.observations} families.{" "}
            <code>worth_doing</code> counts violations whose net edge survives the fees.
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
            {data.ablations.map((row, index) => (
              <tr
                key={row.name}
                className={index === hot ? "is-hot" : undefined}
                onPointerEnter={() => setHot(index)}
                onPointerLeave={() => setHot(null)}
                onFocus={() => setHot(index)}
                onBlur={() => setHot(null)}
              >
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

      {/* The gateway's own notes describe the tape the table reads, so they
          travel with it rather than trailing both views — and since the fourth
          pass of 2026-08-24 they travel FOLDED. They qualify the replay rather
          than answering it, and the reader who wants them is the reader already
          checking a number in the table above. */}
      {data.notes.length ? (
        <details className="disclosure">
          <summary>
            How this tape was replayed, {data.notes.length}{" "}
            {data.notes.length === 1 ? "note" : "notes"} from the gateway
          </summary>
          {data.notes.map((note, index) => (
            <p className="coh-event__note" key={`${index}-${note}`}>
              <span aria-hidden="true">◌</span> {note}
            </p>
          ))}
        </details>
      ) : null}
    </>
  );
}
