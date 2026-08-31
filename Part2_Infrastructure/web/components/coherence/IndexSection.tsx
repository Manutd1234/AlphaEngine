"use client";

/**
 * Coherence index — how far these prices are from admitting a probability, over time.
 *
 * A SECTION AGAIN, UNDER ITS PUBLISHED ID. `index` was published on
 * `origin/main`, folded into the Scorecard on 2026-08-24 because both answer
 * "were these prices right", and returns on 2026-08-25 because sharing a
 * question is not sharing a subject.
 *
 * What separates them is everything except the question. The Scorecard scores a
 * SETTLED corpus against what actually paid — once, after the fact, on markets
 * that have an answer. This measures the L1 distance from the quoted price
 * vector to the nearest one summing to a dollar, on every poll, on markets that
 * have not settled and may never. One is a verdict about the past; this is a
 * time series about the present, and it is the series nobody publishes for this
 * exchange.
 *
 * ONE READ SINCE 2026-08-25, AND ONE CLOCK. This section used to carry the
 * score trend as well, which read the calibration HISTORY — the settled past —
 * beside two views reading the index series, the unsettled present. Two clocks
 * under one label, gated apart but still filed together, and this header used
 * to say so. The trend is a reading of the settled corpus over time, so it went
 * to `corpus`, beside the corpus it describes.
 */


import IndexPane from "./IndexPane";
import PaneHead from "./PaneHead";
import ProofsViewControl from "./ProofsViewControl";

type IndexView = "series" | "families";

const VIEWS: ReadonlyArray<[IndexView, string]> = [
  ["series", "By poll"],
  ["families", "By family"],
];

export default function IndexSection({ active, view, onView }: { active: boolean; view: IndexView; onView: (next: IndexView) => void }) {

  return (
    <section className="card console-card coh-calib" aria-labelledby="coherence-index-heading">
      <PaneHead
        kicker="Coherence index"
        title="L1 distance from coherence"
        id="coherence-index-heading"
        note="each poll; unsettled"
        ledeSummary="Distance definition"
        lede="Zero admits a probability exactly; otherwise the readout is min_q ‖p − q‖₁."
      />

      {/* The control row is pinned (`14u`), so a reader deep in the body can
          switch view without scrolling back to the head. One row per section is
          the rule this rail already kept; wrapping it is what made it pinnable. */}
      <div className="coh-bar">
        <ProofsViewControl
          className="seg"
          label="Index view"
          options={VIEWS}
          value={view}
          onValue={onView}
        />
      </div>

      <IndexPane active={active} view={view} />
    </section>
  );
}
