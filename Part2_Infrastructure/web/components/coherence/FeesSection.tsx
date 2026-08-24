"use client";

/**
 * Fees — one section, three questions, one switcher.
 *
 * What a real position pays, what shape that cost has, and what the answer
 * looks like when the cost model is switched off. The three used to stack in
 * one column with no divider. They are one argument in three shapes, so they
 * get a `.seg` rather than a second `<WorkspaceSubtabs>`: a nested rail fights
 * the first over the `--rail-h` publisher, as `CoherenceConsole` records.
 *
 * BOTH READS LIVE HERE, each gated on the view that needs it. The replay is the
 * largest read on this tab — 20,000 rows — and it used to run on every visit to
 * Fees, including the two views that never show it. Holding the reads at this
 * level also means switching view does not throw a payload away and ask the
 * gateway for it again, and it is what lets one chip row above the views state
 * a fact from each.
 *
 * The section owns which worked example is selected, because that choice is
 * what the fees query is built from; the picker that changes it is drawn inside
 * the worked-example view, where it is the only `.seg` on screen beside this
 * one.
 */

import { useState } from "react";

import type { CoherenceFees, CoherenceReplay } from "@/lib/coherence/types";
import { feesRoute, replayRoute } from "@/lib/coherence/routes";
import PaneHead from "./PaneHead";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import AblationPane from "./AblationPane";
import FeesPane, { EXAMPLES, feesExceedNotional, type FeeExample, type FeesView } from "./FeesPane";
import { StateChip } from "./Figure";

/** The pane's own two views, plus the ablation. One list, one source. */
type View = FeesView | "ablation";

/**
 * The measurement, or the reason this row cannot state it yet.
 *
 * Never a zero and never a bare blank: a gated read has not failed, it has not
 * been asked, and those are different answers.
 */
function framing(value: string | null, live: boolean, error: string | null): string {
  if (value != null) return value;
  if (error) return "the read failed";
  return live ? "reading…" : "not read on this view";
}

export default function FeesSection({ active }: { active: boolean }) {
  const [view, setView] = useState<View>("example");
  const [example, setExample] = useState<FeeExample>(EXAMPLES[0]);

  const fees = useCoherenceRead<CoherenceFees>(
    feesRoute(example.price, example.contracts, example.fills),
    active && (view === "example" || view === "shape"),
  );
  const replay = useCoherenceRead<CoherenceReplay>(
    replayRoute(),
    active && view === "ablation",
  );

  const share = fees.data?.net_as_fraction_of_notional ?? null;
  const overNotional = feesExceedNotional(share);
  const span = replay.data ? `${replay.data.span_seconds}s` : null;

  return (
    <section className="card console-card coh-fees" aria-labelledby="coherence-fees-heading">
      <PaneHead
        kicker="Fees"
        title="What a real position pays"
        id="coherence-fees-heading"
        note={span ? `replay spans ${span}` : "three-component cost model"}
        lede={
          <>
            Three components, and the one nobody models is the largest: on Kalshi&rsquo;s own documented example the
            rounding fee is nineteen times the trading fee and the net exceeds the notional traded. Ablation replays
            the tape under four cost models, <code>no_fees</code> among them.
          </>
        }
      />
      <div className="seg" role="group" aria-label="Fees view">
        <button type="button" aria-pressed={view === "example"} onClick={() => setView("example")}>
          Worked example
        </button>
        <button type="button" aria-pressed={view === "shape"} onClick={() => setView("shape")}>
          Cost shape
        </button>
        <button type="button" aria-pressed={view === "ablation"} onClick={() => setView("ablation")}>
          Ablation
        </button>
      </div>

      {/* One chip row for the section, not one per pane. Of the six chips the
          two panes carried between them, four restated a cell of a table
          directly beneath: net fee and notional traded ARE the per-fill Total
          row, and books replayed and families tested now open the ablation
          table's caption. What is left is the two facts no table states. */}
      <div className="coh-status__chips">
        <StateChip
          mark={share == null ? "◌" : overNotional ? "▲" : "◇"}
          word="Fee as a share of notional"
          value={framing(share, view !== "ablation", fees.error)}
          tone={overNotional ? "critical" : "muted"}
        />
        <StateChip
          mark={span == null ? "◌" : "→"}
          word="Tape spans"
          value={framing(span, view === "ablation", replay.error)}
          tone="muted"
        />
      </div>

      {view === "ablation" ? (
        <AblationPane replay={replay.data} error={replay.error} />
      ) : (
        <FeesPane
          fees={fees.data}
          error={fees.error}
          view={view}
          example={example}
          onExample={setExample}
        />
      )}
    </section>
  );
}
