"use client";

/**
 * What the score was computed on — the sample, and how it accrued.
 *
 * SPLIT OFF SCORECARD, WHICH WAS ANSWERING TWO QUESTIONS. "Were the prices
 * right" and "what were they right ABOUT" are different questions, and the
 * second is the one that decides whether the first means anything: a Brier
 * score is a score of whatever settled, so a corpus that is 81% one series is
 * a score of that series wearing the whole exchange's name. Scorecard ran to
 * 2,273px over three views — the tallest thing on the tab — and the third view
 * was this.
 *
 * IT ALSO TOOK THE SCORE TREND FROM `index`, and that was the point of moving
 * it rather than merely promoting a view. `index` read the calibration history
 * for its trend and the index series for its other two — the settled past and
 * the unsettled present, two clocks under one label, which its own header
 * admitted. The trend is a reading OF THE SETTLED CORPUS over time, so it
 * belongs beside the corpus rather than beside a live distance measure.
 *
 * TWO READS HERE, AND THAT IS NOT THE THING `index` WAS DOING. Both of these
 * describe one subject — the settled sample: what it is made of, and how it
 * grew. `index` carried two reads about two different subjects. Each is gated
 * on the view that draws it, so a reader on one never pays for the other.
 */


import type { CoherenceCalibration } from "@/lib/coherence/types-lab";
import { calibrationRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import CalibrationSettled from "./CalibrationSettled";
import CalibrationTrend from "./CalibrationTrend";
import PaneHead from "./PaneHead";
import ProofsViewControl from "./ProofsViewControl";
import ProofsTransportNotice from "./ProofsTransportNotice";

type CorpusView = "composition" | "trend";

const VIEWS: ReadonlyArray<[CorpusView, string]> = [
  ["composition", "Composition"],
  ["trend", "Score trend"],
];

export default function CorpusSection({ active, view, onView }: { active: boolean; view: CorpusView; onView: (next: CorpusView) => void }) {
  // Gated on the view, exactly as every other section on this rail gates its
  // reads: the trend draws from the history route inside `CalibrationTrend`,
  // so a reader who never opens Composition never asks for the settled read.
  const read = useCoherenceRead<CoherenceCalibration>(
    calibrationRoute(),
    active && view === "composition",
  );
  const { data, error } = read;

  return (
    <section className="card console-card coh-calib" aria-labelledby="coherence-corpus-heading">
      <PaneHead
        kicker="Corpus"
        title="Score composition"
        id="coherence-corpus-heading"
        note="settled sample accrual"
        ledeSummary="Sample caveat"
        lede="A Brier score inherits its settled sample; concentration decides what the score represents."
      />

      {/* The control row is pinned (`14u`), so a reader deep in the body can
          switch view without scrolling back to the head. One row per section is
          the rule this rail already kept; wrapping it is what made it pinnable. */}
      <div className="coh-bar">
        <ProofsViewControl
          className="seg"
          label="Corpus view"
          options={VIEWS}
          value={view}
          onValue={onView}
        />
      </div>

      {/* The branch IS the gate, and the compiler proves it: inside the else,
          `view` cannot be "trend", so a conjunction guarding on it would be one
          TypeScript reports as always true. An always-true guard reads like a
          gate and defends nothing, which is worse than having none. */}
      {view === "trend" ? (
        <CalibrationTrend active={active} />
      ) : (
        <>
          <ProofsTransportNotice
            subject="Corpus read"
            error={error}
            hasSnapshot={Boolean(data)}
            transport={read.transport}
            retryAt={read.retryAt}
            consecutiveFailures={read.consecutiveFailures}
            onRetry={read.refresh}
          />
          {error && !data ? null : <CalibrationSettled data={data} error={null} view="corpus" />}
        </>
      )}
    </section>
  );
}
