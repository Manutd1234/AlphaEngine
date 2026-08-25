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
 * So: one read here, gated on the section, and one figure of its own — the
 * share of notional the fee comes to, which no table below states. The picker
 * that chooses the worked example is drawn inside the worked-example view; the
 * section owns WHICH example is chosen, because that choice is what the fees
 * query is built from.
 *
 * TWO CONTROL ROWS BECAME ONE ON 2026-08-25, and this section was the worst
 * case on the tab. It drew `.coh-status__chips` twice: the four views and the
 * example picker on the first, and the fee-share chip alone on the second — so
 * a reader met two full-width rows of chrome before the first drawing, and the
 * second row held a MEASUREMENT wearing a state chip's clothes. `SectionFrame`
 * has one control row and a KPI row under it, which is where a measurement
 * belongs and is the same tile grid Lattice and Stake answer in.
 *
 * THE CHIP'S WARNING SURVIVED THE MOVE, and it had to: "the net fee exceeds
 * the notional traded" is the section's most consequential reading and a tile
 * that printed 1.4200 with no mark would say nothing about it. The mark and
 * the words ride the tile's note, so the warning is legible with colour
 * stripped — which is what `forced-colors.test.ts` and the house rule require.
 */

import { useState } from "react";

import type { CoherenceFees } from "@/lib/coherence/types";
import type { CoherenceFeeCurve } from "@/lib/coherence/types-history";
import { feesCurveRoute, feesRoute } from "@/lib/coherence/routes";
import FeeCurve from "./FeeCurve";
import LiveTape from "./LiveTape";
import { toUnit } from "./FrechetBand";
import { useLiveSeries } from "@/lib/coherence/use-live-series";
import PaneHead from "./PaneHead";
import SectionFrame from "./SectionFrame";
import type { Reading } from "./KpiRow";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import AblationPane, { type AblationView } from "./AblationPane";
import FeesPane, { EXAMPLES, feesExceedNotional, type FeeExample, type FeesView } from "./FeesPane";

/** The venue's cost model, then what that cost does to the answer. */
type SectionView = FeesView | AblationView;

/** Which of the four are the replay's, so one predicate gates the 20,000 rows. */
const REPLAY_VIEWS: ReadonlyArray<SectionView> = ["comparison", "table"];

/** The four views, in the order they are pressed. */
const VIEWS: ReadonlyArray<[SectionView, string]> = [
  ["example", "Worked example"],
  ["shape", "Cost shape"],
  ["comparison", "Ablation"],
  ["table", "Replay table"],
];

export default function FeesSection(
  { active, view, onView }: { active: boolean; view: SectionView; onView: (next: SectionView) => void },
) {
  const [example, setExample] = useState<FeeExample>(EXAMPLES[0]);

  const onReplay = REPLAY_VIEWS.includes(view);
  // Not gated on the view: the chip below is drawn on all four, and this read
  // is one request against the fee endpoint rather than a tape replay.
  const fees = useCoherenceRead<CoherenceFees>(
    feesRoute(example.price, example.contracts, example.fills),
    active,
  );

  /* The whole curve, gated on the one view that draws it. The cheapest read on
     the tab — pure arithmetic on the gateway, no venue call and no tape — but
     still a read, and a section that fetched ninety-nine prices for a reader
     who came to see a worked example would be spending it for nothing. */
  const curve = useCoherenceRead<CoherenceFeeCurve>(
    feesCurveRoute(example.contracts, example.fills),
    active && view === "shape",
  );

  const share = fees.data?.net_as_fraction_of_notional ?? null;
  const overNotional = feesExceedNotional(share);

  /* The fee share over time, keyed by the WORKED EXAMPLE, because changing the
     example changes the question — a series that stepped from one example to
     another would draw the reader's own click as a move in the market. The
     reference is 1: the section's whole claim is that the net fee can exceed
     the notional traded, and a line at the notional is what makes "exceeds"
     something a reader can see rather than something they are told. */
  const shareTape = useLiveSeries(`fees:${example.id}:share`, fees.updatedAt, toUnit(share));

  /* The one figure neither table states, and it is answered on all four views
     because the read is one request against the fee endpoint rather than a tape
     replay. Null while the read is in flight or after it failed — never zero,
     which on this section would read as a free trade. */
  const kpis: Reading[] = [
    {
      label: "Fee as a share of notional",
      value: share,
      withheld: share == null && fees.error ? `the read failed, ${fees.error}` : undefined,
      note: overNotional ? (
        <>
          <span aria-hidden="true">▲</span> more than the notional traded
        </>
      ) : undefined,
    },
  ];

  return (
    <SectionFrame
      className="coh-fees"
      aria-labelledby="markets-fees-heading"
      head={
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
      }
      views={VIEWS}
      view={view}
      onView={onView}
      viewsLabel="Fees view"
      subject={
        /* A native `<select>` rather than the listbox the family and market
           pickers use, and the difference is the OPTIONS: four fixed prose
           labels that never change with the read, where those two choose from a
           live roster whose rows carry a shard, a strike or a verdict. A
           `<select>` renders one string per option, which is exactly what this
           needs and not enough for those. It is the desk's own filter grammar —
           the same label-beside-control `.coh-universe__filter` the Universe
           asset filter uses. */
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
      }
      kpis={kpis}
      kpiSource="this read"
    >
      {onReplay ? (
        <AblationPane view={view as AblationView} active={active && onReplay} />
      ) : (
        <FeesPane fees={fees.data} error={fees.error} view={view as FeesView} />
      )}

      {/* MEASURED, beside the modelled parabola rather than instead of it. That
          figure draws the trade fee's closed form and makes this tab's thesis —
          the naive test is furthest wrong in the middle of the book. This draws
          what the gateway's kernel actually charges at every price, so the
          rounding component the section opens by claiming is nineteen times the
          trading one becomes a gap a reader can see rather than a sentence they
          are asked to take. */}
      {view === "shape" ? <FeeCurve curve={curve.data} error={curve.error} /> : null}

      <LiveTape
        points={shareTape}
        caption={`What ${example.label.toLowerCase()} has cost as a share of its notional, poll by poll`}
        ariaLabel="The fee as a share of notional over the polls seen since this tab opened"
        reference={{ value: 1, label: "the notional traded" }}
        reading="Above the line the fee is larger than the position it is charged on, which is the claim this section opens with."
      />
    </SectionFrame>
  );
}
