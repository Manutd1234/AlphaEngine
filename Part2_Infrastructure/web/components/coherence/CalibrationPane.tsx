"use client";

/**
 * Scorecard — were the prices right, on the markets that have settled.
 *
 * ONE READ, ONE QUESTION, ONE CONTROL ROW, as of 2026-08-25. This section was
 * two groups over six views: "Once settled" and "Over time", the second being
 * the coherence index that had been folded in here on the argument that both
 * ask "were these prices right".
 *
 * That argument was true and it was not enough. The two halves share a QUESTION
 * and share nothing else: this one scores a settled corpus against what paid,
 * once, from `calibration`; the other measures a distance to the nearest
 * coherent price vector on every poll, from two different reads, on markets
 * that have not settled and may never. Different tape, different clock,
 * different failure. A group control that has to explain that in its own labels
 * is a control doing a section's work — which is what "Once settled" and "Over
 * time" were, and why they read as a second rail rather than as a switch.
 *
 * So the index is `IndexSection` now, under the id it was PUBLISHED with, and
 * this section keeps the three views of the one read it is named for. That
 * empties another entry out of `RELOCATED_SECTIONS` rather than adding one —
 * the fourth id this restructure has brought back for free.
 */


import type { CoherenceCalibration } from "@/lib/coherence/types-lab";
import { calibrationRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import CalibrationSettled, { type SettledView } from "./CalibrationSettled";
import PaneHead from "./PaneHead";
import ProofsViewControl from "./ProofsViewControl";
import ProofsTransportNotice from "./ProofsTransportNotice";

// Six short destinations keep each task within a single viewport: the
// headline verdict, equation, component scale, exact measures, reliability,
// and band records.
// `corpus` remains a member because `CorpusSection` renders the same settled
// shell with it.
const VIEWS: ReadonlyArray<[SettledView, string]> = [
  ["score", "Overview"],
  ["decomposition", "Equation"],
  ["components", "Component scale"],
  ["measures", "Measures"],
  ["reliability", "Reliability"],
  ["bands", "Bands"],
];

export default function CalibrationPane({ active, view, onView }: { active: boolean; view: SettledView; onView: (next: SettledView) => void }) {
  const read = useCoherenceRead<CoherenceCalibration>(calibrationRoute(), active);
  const { data, error } = read;

  return (
    <section className="card console-card coh-calib" aria-labelledby="coherence-calibration-heading">
      <PaneHead
        kicker="Scorecard"
        title="Settled Brier calibration"
        id="coherence-calibration-heading"
        note={data ? `${data.engine}; settled corpus` : "settled corpus"}
        ledeSummary="Calibration question"
        lede={
          <>
            Arbitrage-free does not mean calibrated: of contracts priced near 10¢, how many paid?
          </>
        }
      />

      {/* The control row is pinned (`14u`), so a reader deep in the body can
          switch view without scrolling back to the head. One row per section is
          the rule this rail already kept; wrapping it is what made it pinnable. */}
      <div className="coh-bar">
        <ProofsViewControl
          className="seg"
          label="Scorecard view"
          options={VIEWS}
          value={view}
          onValue={onView}
        />
      </div>

      <ProofsTransportNotice
        subject="Scorecard read"
        error={error}
        hasSnapshot={Boolean(data)}
        transport={read.transport}
        retryAt={read.retryAt}
        consecutiveFailures={read.consecutiveFailures}
        onRetry={read.refresh}
      />
      <CalibrationSettled data={data} error={error} view={view} />
    </section>
  );
}
