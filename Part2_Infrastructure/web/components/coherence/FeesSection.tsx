"use client";

/**
 * Fees — one section, two views, one read.
 *
 * What a real position pays, and what shape that cost has. They are one
 * argument in two shapes, so they get a `.seg` rather than a second
 * `<WorkspaceSubtabs>`: a nested rail fights the first over the `--rail-h`
 * publisher, as `CoherenceConsole` records.
 *
 * FOUR VIEWS SINCE THE MERGE OF 2026-08-24, and the round trip is worth
 * recording. Ablation was the third view of this seg in the morning; the
 * promotion pass made it the `ablation` rail section, because the tape replayed
 * under four cost models answers its own question and no URL reached it from
 * behind a switcher; the merge that afternoon brought it home as two views,
 * Ablation and Replay table. The split that evening moved this whole section
 * onto Quotes and left the views alone — what the venue charges is a fact of
 * the venue, which is that tab's subject. What it keeps from the promotion is the
 * READ: `AblationPane` owns the 20,000-row replay and gates it on its own two
 * views, so this file still holds one `useCoherenceRead` rather than the two
 * and the `framing()` helper it carried when it had to say "not read on this
 * view" for a chip whose read was gated on a sibling.
 *
 * So: one read here, gated on the section, and one chip — the share of notional
 * the fee comes to, which is the only figure on the section that no table below
 * states. The picker that chooses the worked example is drawn inside the
 * worked-example view; the section owns WHICH example is chosen, because that
 * choice is what the fees query is built from.
 */

import { useState } from "react";

import type { CoherenceFees } from "@/lib/coherence/types";
import { feesRoute } from "@/lib/coherence/routes";
import PaneHead from "./PaneHead";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import AblationPane, { type AblationView } from "./AblationPane";
import FeesPane, { EXAMPLES, feesExceedNotional, type FeeExample, type FeesView } from "./FeesPane";
import { StateChip } from "./Figure";

/** The venue's cost model, then what that cost does to the answer. */
type SectionView = FeesView | AblationView;

/** Which of the four are the replay's, so one predicate gates the 20,000 rows. */
const REPLAY_VIEWS: ReadonlyArray<SectionView> = ["comparison", "table"];

export default function FeesSection({ active }: { active: boolean }) {
  const [view, setView] = useState<SectionView>("example");
  const [example, setExample] = useState<FeeExample>(EXAMPLES[0]);

  const onReplay = REPLAY_VIEWS.includes(view);
  // Not gated on the view: the chip below is drawn on all four, and this read
  // is one request against the fee endpoint rather than a tape replay.
  const fees = useCoherenceRead<CoherenceFees>(
    feesRoute(example.price, example.contracts, example.fills),
    active,
  );

  const share = fees.data?.net_as_fraction_of_notional ?? null;
  const overNotional = feesExceedNotional(share);

  return (
    <section className="card console-card coh-fees" aria-labelledby="markets-fees-heading">
      <PaneHead
        kicker="Fees"
        title="What a real position pays, and whether it changes the answer"
        id="markets-fees-heading"
        note="three components, charged per fill"
        lede={
          <>
            The component nobody models is the largest: on Kalshi&rsquo;s own example the rounding fee is
            nineteen times the trading fee and the net fee exceeds the notional traded.
          </>
        }
      />
      {/* ONE control row: the four views, and the example every one of them is
          priced from. They were TWO rows until 2026-08-25 — the seg here and a
          second seg of four worked examples inside the pane — which put two
          rows of chrome above the first figure and is the "information overload
          is too much" the reader reported. Same defect the lattice and the
          stake were carrying, and the same fix.

          The example picker is a native `<select>` rather than the listbox the
          family and market pickers use, and the difference is the OPTIONS: four
          fixed prose labels that never change with the read, where those two
          choose from a live roster whose rows carry a shard, a strike or a
          verdict. A `<select>` renders one string per option, which is exactly
          what this needs and not enough for those. It is the desk's own filter
          grammar — the same label-beside-control `.coh-universe__filter` the
          Universe asset filter uses. */}
      <div className="coh-status__chips">
        <div className="seg" role="group" aria-label="Fees view">
          <button type="button" aria-pressed={view === "example"} onClick={() => setView("example")}>
            Worked example
          </button>
          <button type="button" aria-pressed={view === "shape"} onClick={() => setView("shape")}>
            Cost shape
          </button>
          <button type="button" aria-pressed={view === "comparison"} onClick={() => setView("comparison")}>
            Ablation
          </button>
          <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>
            Replay table
          </button>
        </div>

        <label className="coh-universe__filter">
          <span>Worked example</span>
          <select
            value={example.id}
            onChange={(change) => setExample(EXAMPLES.find((item) => item.id === change.target.value) ?? EXAMPLES[0])}
          >
            {EXAMPLES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* The one figure neither table states. Its mark carries the warning, so
          "over the notional" survives colour being stripped. */}
      <div className="coh-status__chips">
        <StateChip
          mark={share == null ? "◌" : overNotional ? "▲" : "◇"}
          word="Fee as a share of notional"
          value={share ?? (fees.error ? "the read failed" : "reading…")}
          tone={overNotional ? "critical" : "muted"}
        />
      </div>

      {onReplay ? (
        <AblationPane view={view as AblationView} active={active && onReplay} />
      ) : (
        <FeesPane fees={fees.data} error={fees.error} view={view as FeesView} />
      )}
    </section>
  );
}
