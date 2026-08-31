"use client";

/**
 * The settled score over time — the axis the Scorecard never had.
 *
 * `/api/coherence/calibration` scores whatever has settled and answers about one
 * moment. A reader could see that the venue is well calibrated and had no way to
 * ask the question that follows, which is whether it is getting better. This
 * draws the recorded series the gateway now keeps.
 *
 * THREE HONESTIES, and each is the same one the store makes, carried through to
 * the drawing rather than lost at the boundary:
 *
 * **A run that could not be scored is a GAP.** On a cold tape nothing has
 * settled, and those rows exist with null figures and a reason. The line is
 * broken at them rather than bridged, because a line closed over one would claim
 * a score nobody took — the same rule `IndexPane` follows for unmeasurable
 * polls, and the segment-and-gap idiom is reused from it rather than rewritten.
 *
 * **THE SERIES ACCRUES FORWARD ONLY.** Nothing back-fills it. The first point is
 * where the recorder started, not where the venue did, and a chart that did not
 * say so invites a reader to date the exchange's behaviour from it.
 *
 * **THE ENGINE TRAVELS WITH THE POINT.** A history can hold both: `tape` is a
 * forecast test and `final_trade` is not, so points from the two are marked
 * apart. One line through them would plot foresight and convergence as a single
 * measurement, which is the error `EngineBanner` exists to prevent at one
 * instant and this figure has to prevent across a series.
 */

import { decimalLabel } from "@/lib/coherence/decimals";
import { LinkedX } from "@/lib/coherence/linked-x";
import type { CoherenceCalibrationHistory } from "@/lib/coherence/types-lab";
import { calibrationHistoryRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import Figure, { Plot, StateChip } from "./Figure";
import MeasurabilityStrip from "./MeasurabilityStrip";
import CorpusAccrual from "./CorpusAccrual";
import CorpusHistory from "./CorpusHistory";
import SectionVerdict from "./SectionVerdict";
import ProofsTransportNotice from "./ProofsTransportNotice";

const HEIGHT = 170;
const MARGIN = { top: 14, right: 10, bottom: 24, left: 10 };
const NS_PER_MS = 1_000_000;

function clock(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

export default function CalibrationTrend({ active }: { active: boolean }) {
  const read = useCoherenceRead<CoherenceCalibrationHistory>(calibrationHistoryRoute(), active);
  const { data, error } = read;
  const notice = (
    <ProofsTransportNotice
      subject="Score history read"
      error={error}
      hasSnapshot={Boolean(data)}
      transport={read.transport}
      retryAt={read.retryAt}
      consecutiveFailures={read.consecutiveFailures}
      onRetry={read.refresh}
    />
  );

  if (error && !data) {
    return notice;
  }
  if (!data) return <SectionVerdict pending="Reading the recorded scores…" />;
  if (data.state !== "ok" || !data.points.length) {
    return <>{notice}<SectionVerdict pending={<><span aria-hidden="true">◌</span> {data.notes[0] ?? "No score has been recorded yet."}</>} /></>;
  }

  const points = data.points.map((point) => ({
    ts: point.ts_ns,
    skill: point.skill == null ? null : Number(point.skill),
    /** The wire's own string, printed from rather than through the float. */
    skillRaw: point.skill,
    engine: point.engine,
    markets: point.markets,
    detail: point.detail,
  }));
  const scored = points.filter((point) => point.skill != null && Number.isFinite(point.skill));
  const refused = points.length - scored.length;

  const engines = [...new Set(points.map((point) => point.engine))];

  // THE CHIPS COME FIRST WHATEVER HAPPENS NEXT. They were below this branch,
  // so on a corpus where nothing has settled — which is every keyless
  // deployment, and this section's DEFAULT view — the reader met an empty
  // frame with no counts and no band at all.
  const chips = (
    <SectionVerdict>
      <StateChip mark="●" word="Recorded runs" value={String(points.length)} tone="muted" />
      <StateChip mark="✓" word="Scored" value={String(scored.length)} tone={scored.length ? "good" : "muted"} />
      <StateChip
        mark={refused ? "◌" : "✓"}
        word="Declined"
        value={refused ? String(refused) : "none"}
        tone={refused ? "warn" : "muted"}
      />
      <StateChip mark="◇" word="Engine" value={engines.join(", ")} tone={engines.length > 1 ? "warn" : "muted"} />
    </SectionVerdict>
  );

  if (!scored.length) {
    // NOT AN EMPTY FRAME. Every recorded run declined to score, which is a real
    // record of the recorder RUNNING against a corpus that will not score — a
    // different fact from a gap in the record, and one the coverage strip can
    // draw where a line of no points cannot. This is the section's default view
    // on any deployment with nothing settled, so an empty frame here is the
    // dead pane the desk sweep exists to find.
    return (
      <>
        {notice}
        {chips}
        {/* WHAT THE CORPUS IS BECOMING, before what it is. On this branch every
            recorded run declined to score, so the only question worth asking is
            whether the corpus is filling and when it crosses — which is exactly
            what the view could not answer. */}
        <CorpusAccrual data={data} />
        <MeasurabilityStrip
          subject="run"
          caption="When the recorder ran, and what each run could score"
          marks={points.map((point) => ({
            ts: point.ts,
            measured: point.skill != null && Number.isFinite(point.skill),
            detail: point.detail,
          }))}
          reading={`All ${points.length} recorded runs declined to score — the recorder is running against a corpus that will not score, which is not the same as a gap in the record.`}
        />
        {/* NO SKILL DOES NOT MEAN NO RECORD. This branch used to end here, and
            on this deployment it is the branch that runs: 38 runs, skill null
            on every one. The same payload still carries Brier, base rate,
            uncertainty and the median horizon on 16 of them and a market count
            on all 38 — five measures that were on the wire while the view drew
            none of them. */}
        <CorpusHistory data={data} skillDrawnAbove={false} />
      </>
    );
  }

  const first = points[0].ts;
  const last = points[points.length - 1].ts;
  const span = Math.max(1, last - first);
  const low = Math.min(0, ...scored.map((point) => point.skill as number));
  const high = Math.max(1, ...scored.map((point) => point.skill as number));

  const base = HEIGHT - MARGIN.bottom;
  const y = (value: number) => base - ((value - low) / (high - low)) * (base - MARGIN.top);
  // THE ONE GEOMETRY: the segments and the crosshair both position through
  // it, so the rule lands on the run it names. Runs sit at their own stamps,
  // so the axis hands the readout its positions rather than assuming even
  // spacing.
  const xAt = (width: number) => (ts: number) =>
    MARGIN.left + ((ts - first) / span) * Math.max(1, width - MARGIN.left - MARGIN.right);
  const readAt = (index: number) => {
    const point = points[index];
    return {
      title: `Run ${index + 1} of ${points.length}, ${clock(point.ts / NS_PER_MS)} UTC`,
      rows: [
        point.skill == null
          ? { label: "Skill", value: `— declined${point.detail ? `: ${point.detail}` : ""}` }
          : { label: "Skill", value: decimalLabel(point.skillRaw, 4), raw: point.skill },
        { label: "Engine", value: point.engine },
        { label: "Markets", value: String(point.markets) },
      ],
    };
  };

  // Broken at gaps, never bridged. Each unbroken run is its own path with its
  // own hover line, which is the idiom `IndexPane` uses for the same reason.
  const segmentsAt = (width: number) => {
    const x = xAt(width);
    const out: Array<{ d: string; from: number; to: number; count: number }> = [];
    let current: { d: string; from: number; to: number; count: number } | null = null;
    for (const point of points) {
      if (point.skill == null) {
        if (current) out.push(current);
        current = null;
        continue;
      }
      if (current) {
        current.d += `L${x(point.ts).toFixed(2)},${y(point.skill).toFixed(2)}`;
        current.to = point.ts;
        current.count += 1;
      } else {
        current = { d: `M${x(point.ts).toFixed(2)},${y(point.skill).toFixed(2)}`, from: point.ts, to: point.ts, count: 1 };
      }
    }
    if (current) out.push(current);
    return out;
  };

  return (
    <>
      {notice}
      {chips}

      {/* ONE CROSSHAIR OVER BOTH: the skill line and the record of every
          measure under it are drawn from the same runs, so a pointer on
          either draws the run on both. */}
      <LinkedX>
      <Figure
        caption="Brier skill on the settled corpus, as it was recorded"
        ariaLabel={`${scored.length} recorded skills between ${clock(first / NS_PER_MS)} and ${clock(last / NS_PER_MS)} UTC`}
        reading={
          engines.length > 1
            ? "Two engines in one series: the line between them is not a trend, because a forecast test and a convergence test are not one measurement."
            // NOT the scale: the rule at zero already carries "no better than
            // the base rate" as an in-plot label, and the gauge on Scorecard
            // owns the range. What the drawing cannot say is what the quantity
            // IS, which is one identity.
            : "Skill = 1 − Brier / Uncertainty, so a run scores above zero only by beating the base rate on its own corpus."
        }
        notes={[
          "The series accrues forward only: nothing back-fills it, so the first point is where the recorder started rather than where the venue did.",
          refused
            ? `${refused} of ${points.length} runs could not be scored and are drawn as gaps, never as zeroes — a line closed over one would claim a score nobody took.`
            : "",
        ].filter(Boolean)}
      >
        <Plot
          height={HEIGHT}
          sharedX={(width) => {
            const x = xAt(width);
            return {
              count: points.length,
              x0: MARGIN.left,
              x1: width - MARGIN.right,
              positions: points.map((point) => x(point.ts)),
              read: readAt,
              width: 300,
              arriveAt: "last",
              link: "calibration-runs",
            };
          }}
        >
          {(width: number) => (
            <>
            {/* No title on the zero rule: the in-plot words beside it say what
                it is, and a title beside a shared axis would make the figure
                two instruments. */}
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(0)} y2={y(0)} className="coh-gauge__zero" />
            {segmentsAt(width).map((segment) => (
              // KEYED ON THE RUN'S START, not on its path data. The key is what
              // decides whether React reuses the node, and `.chart-draw` runs
              // `forwards` — so a key that changes on every resize would replay
              // the draw-in each time the column width moved. `from` is the
              // timestamp the run begins at: stable across a resize, different
              // for every run, and new when the data genuinely is.
              //
              // `pathLength={1}` is what makes one dash rule fit every path
              // whatever its real length. The reduce block collapses the
              // duration globally, so a reader who asked for less motion gets
              // the finished line and no animation at all.
              <path
                key={segment.from}
                d={segment.d}
                fill="none"
                pathLength={1}
                className="coh-index__line chart-draw"
              />
            ))}
            <text x={MARGIN.left} y={y(0) - 3} className="coh-svg-note">no better than the base rate</text>
            <text x={MARGIN.left} y={HEIGHT - 6} className="coh-ladder__tick">{clock(first / NS_PER_MS)} UTC</text>
            <text x={width - MARGIN.right} y={HEIGHT - 6} textAnchor="end" className="coh-ladder__tick">
              {clock(last / NS_PER_MS)} UTC
            </text>
            </>
          )}
        </Plot>
      </Figure>

      {/* HOW THE CORPUS IS ACCRUING, under the score it produced. The trend
          says how well the venue is calibrated; this says how much of a corpus
          that verdict rests on and whether it is growing. */}
      <CorpusAccrual data={data} />

      {/* THE OTHER SIX MEASURES, from the same payload. This route ships seven
          figures per run and this component drew one of them; the rest were on
          the wire the whole time. Skill stays the headline above and is in the
          panel's readout rather than its lanes, so the comparison is available
          and the claim is still made once. */}
      <CorpusHistory data={data} skillDrawnAbove />
      </LinkedX>
    </>
  );
}
