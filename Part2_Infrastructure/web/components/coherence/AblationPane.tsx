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

import { useState, type CSSProperties } from "react";

import type { CoherenceAblation, CoherenceReplay } from "@/lib/coherence/types";
import { replayRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import { groupDigits } from "@/lib/coherence/universe-metrics";
import { StateChip } from "./Figure";
import { useRovingListbox } from "./use-stable-selection-key";
import baseStyles from "./MarketInstruments.module.css";
import replayStyles from "./FeeReplayInstrument.module.css";

const styles = { ...baseStyles, ...replayStyles };

const CAPTION = "Tradable arbitrages found, by how much of the cost model is switched on";

type ReplayStyle = CSSProperties & {
  "--replay-survive"?: string;
  "--replay-reject"?: string;
  "--replay-untestable"?: string;
  "--replay-gross"?: string;
  "--replay-net"?: string;
};

function projected(value: number, sample: number): number {
  return Math.round(value * sample / 100);
}

function Bars({ ablations }: { ablations: CoherenceAblation[] }) {
  const modelKeys = ablations.map((row) => row.name);
  const [selectedKey, setSelectedKey, optionProps] = useRovingListbox(modelKeys);
  const [sample, setSample] = useState(100);
  const selected = Math.max(0, modelKeys.indexOf(selectedKey ?? ""));
  const naive = ablations.find((row) => row.name === "no_fees");
  const full = ablations.find((row) => row.name === "full");
  // A configuration the tape did not run is not a configuration that found
  // zero. With either missing there is no difference to report, and the
  // reading says so rather than announcing agreement (null-honest, 2026-08-26).
  const invented = naive && full ? naive.worth_doing - full.worth_doing : null;
  const active = ablations[selected] ?? ablations[0];
  const maxPopulation = Math.max(1, ...ablations.map((row) => row.violations + row.untestable));

  if (!ablations.some((row) => row.violations > 0)) {
    return (
      <figure className={styles.instrument} aria-label={`${ablations.length} configurations; no violation caught`}>
        <figcaption>{CAPTION}</figcaption>
        <p className={styles.empty}>◌ No configuration found a violation on this tape yet.</p>
      </figure>
    );
  }

  return (
    <figure className={styles.instrument} aria-label={`${ablations.length} cost-model configurations compared`}>
      <figcaption className={styles.instrumentHead}>
        <span><small>Counterfactual switchboard and replay simulator</small>{CAPTION}</span>
        <strong>{invented == null ? "—" : `${invented} invented`}</strong>
      </figcaption>
      <label className={styles.replayScrubber}>
        <span><strong>Replay sample</strong><small>A linear sensitivity projection; 100% is the measured tape.</small></span>
        <input type="range" min={10} max={100} step={10} value={sample}
               onChange={(event) => setSample(Number(event.target.value))} aria-label="Replay sample percentage" />
        <output className="num">{sample}%</output>
      </label>
      <div className={styles.replayGraph} role="listbox" aria-label="Inspect a replay configuration">
        <div className={styles.replayLegend} aria-hidden="true"><span data-kind="survive">survives costs</span><span data-kind="reject">rejected</span><span data-kind="unknown">untestable</span></div>
        {ablations.map((row, index) => {
          const survivors = projected(row.worth_doing, sample);
          const rejected = projected(Math.max(0, row.violations - row.worth_doing), sample);
          const untestable = projected(row.untestable, sample);
          const style = {
            "--replay-survive": `${survivors / maxPopulation * 100}%`,
            "--replay-reject": `${rejected / maxPopulation * 100}%`,
            "--replay-untestable": `${untestable / maxPopulation * 100}%`,
          } as ReplayStyle;
          return (
            <button type="button" key={row.name} role="option" className={styles.replayLane}
                    aria-selected={selectedKey === row.name} {...optionProps(row.name, index)} style={style}
                    onClick={() => setSelectedKey(row.name)}>
              <span className={styles.replayLaneLabel}><strong>{row.name.replaceAll("_", " ")}</strong><small>{row.description}</small></span>
              <span className={styles.replayTrack} aria-label={`${survivors} survive, ${rejected} rejected, ${untestable} untestable at ${sample}%`}>
                <i data-kind="survive" /><i data-kind="reject" /><i data-kind="unknown" />
              </span>
              <span className={`${styles.replayCount} num`}>{survivors}<small> survive</small></span>
            </button>
          );
        })}
      </div>
      {active ? (
        <output className={styles.modelReadout} aria-live="polite" aria-atomic="true">
          <span><small>Selected model</small><strong>{active.name}</strong><span className={styles.modelDescription}>{active.description}</span></span>
          <span><small>Violations seen</small><strong className="num">{projected(active.violations, sample)}</strong></span>
          <span><small>Survive costs</small><strong className="num">{projected(active.worth_doing, sample)}</strong></span>
          <span><small>Rejected</small><strong className="num">{projected(Math.max(0, active.violations - active.worth_doing), sample)}</strong></span>
          <span><small>Untestable</small><strong className="num">{projected(active.untestable, sample)}</strong></span>
        </output>
      ) : null}
      <p className="coh-figure__reading">{invented == null ? "The fee-free and full models cannot be compared on this tape." : invented > 0 ? `Fees off reports ${invented} opportunities that disappear once the full cost model is switched on.` : "The naive and fee-aware tests agree on this tape."}</p>
    </figure>
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
        <p className="console-empty muted" role="status" aria-busy="true">Replaying the tape…</p>
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
      <div className={`coh-status__chips ${styles.replayStatus}`}>
        <StateChip mark="→" word="Replay verdict" value={data.headline} tone="muted" />
        <StateChip mark="●" word="Tape replayed" value={`${data.rows} books over ${data.span_seconds}s`} tone="muted" />
      </div>

      {view === "comparison" ? (
        <Bars ablations={data.ablations} />
      ) : (
        <ReplayTable data={data} />
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
  const modelKeys = data.ablations.map((row) => row.name);
  const [selectedKey, setSelectedKey, optionProps] = useRovingListbox(modelKeys);
  const selected = Math.max(0, modelKeys.indexOf(selectedKey ?? ""));
  const active = data.ablations[selected] ?? data.ablations[0];
  const magnitude = (raw: string) => {
    const value = Number(raw);
    return Number.isFinite(value) ? Math.abs(value) : 0;
  };
  const scale = Math.max(1e-9, ...data.ablations.flatMap((row) => [magnitude(row.gross_total), magnitude(row.net_total)]));
  return (
    <>
      <figure className={styles.instrument} aria-label={`Fee replay display, ${data.ablations.length} configurations`}>
        <figcaption className={styles.instrumentHead}>
          <span><small>Gross-to-net bridge</small>Trace how each fee model moves recorded edge</span>
          <strong className="num">{groupDigits(String(data.rows))} books</strong>
        </figcaption>
        <div className={styles.edgeGraph} role="listbox" aria-label="Replay configurations">
          <div className={styles.edgeAxis} aria-hidden="true"><span>0</span><span>maximum absolute edge</span></div>
          {data.ablations.map((row, index) => {
            const style = {
              "--replay-gross": `${magnitude(row.gross_total) / scale * 100}%`,
              "--replay-net": `${magnitude(row.net_total) / scale * 100}%`,
            } as ReplayStyle;
            return (
            <button key={row.name} type="button" role="option" aria-selected={selectedKey === row.name}
                    className={styles.edgeLane} {...optionProps(row.name, index)} style={style}
                    onClick={() => setSelectedKey(row.name)}>
              <span className={styles.edgeLabel}><small>{String(index + 1).padStart(2, "0")}</small><strong>{row.name.replaceAll("_", " ")}</strong></span>
              <span className={styles.edgeTracks} aria-label={`Gross edge ${row.gross_total}; net edge ${row.net_total}`}>
                <i data-kind="gross"><b /></i><i data-kind="net" data-negative={Number(row.net_total) < 0 || undefined}><b /></i>
              </span>
              <span className={`${styles.edgeValue} num`}><small>gross {row.gross_total}</small><strong>net {row.net_total}</strong></span>
            </button>
          );})}
        </div>
        {active ? (
          <output className={styles.modelReadout} aria-live="polite" aria-atomic="true">
            <span><small>Model anatomy</small><strong>{active.name}</strong><span className={styles.modelDescription}>{active.description}</span></span>
            <span><small>Gross edge</small><strong className="num">{active.gross_total}</strong></span>
            <span><small>Net edge</small><strong className="num">{active.net_total}</strong></span>
            <span><small>Survive fees</small><strong className="num">{active.worth_doing}/{active.violations}</strong></span>
            <span><small>Untestable</small><strong className="num">{active.untestable}</strong></span>
          </output>
        ) : null}
      </figure>

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
