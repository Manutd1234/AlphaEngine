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

import type { CoherenceCalibrationHistory } from "@/lib/coherence/types-lab";
import { calibrationHistoryRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import Figure, { FigureEmpty, StateChip } from "./Figure";
import { useMeasuredWidth } from "@/components/chart-kit";

const HEIGHT = 170;
const MARGIN = { top: 14, right: 10, bottom: 24, left: 10 };
const NS_PER_MS = 1_000_000;

function clock(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

export default function CalibrationTrend({ active }: { active: boolean }) {
  const { data, error } = useCoherenceRead<CoherenceCalibrationHistory>(calibrationHistoryRoute(), active);
  const [plotRef, width] = useMeasuredWidth<HTMLDivElement>(720);

  if (error && !data) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The score history could not be read: {error}
      </p>
    );
  }
  if (!data) return <p className="console-empty muted">Reading the recorded scores…</p>;
  if (data.state !== "ok" || !data.points.length) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span>{" "}
        {data.notes[0] ?? "No score has been recorded yet."}
      </p>
    );
  }

  const points = data.points.map((point) => ({
    ts: point.ts_ns,
    skill: point.skill == null ? null : Number(point.skill),
    engine: point.engine,
    markets: point.markets,
    detail: point.detail,
  }));
  const scored = points.filter((point) => point.skill != null && Number.isFinite(point.skill));
  const refused = points.length - scored.length;

  if (!scored.length) {
    return (
      <Figure
        caption="The settled score over time"
        ariaLabel="No recorded run produced a score"
        missing={`All ${points.length} recorded runs declined to score, each with its reason. That is a record of the recorder running against a corpus that will not score, which is a different fact from a gap in the record.`}
      >
        <FigureEmpty reason="Nothing scoreable has been recorded yet." />
      </Figure>
    );
  }

  const first = points[0].ts;
  const last = points[points.length - 1].ts;
  const span = Math.max(1, last - first);
  const low = Math.min(0, ...scored.map((point) => point.skill as number));
  const high = Math.max(1, ...scored.map((point) => point.skill as number));

  const plotWidth = Math.max(1, width - MARGIN.left - MARGIN.right);
  const base = HEIGHT - MARGIN.bottom;
  const x = (ts: number) => MARGIN.left + ((ts - first) / span) * plotWidth;
  const y = (value: number) => base - ((value - low) / (high - low)) * (base - MARGIN.top);

  // Broken at gaps, never bridged. Each unbroken run is its own path with its
  // own hover line, which is the idiom `IndexPane` uses for the same reason.
  const segments: Array<{ d: string; from: number; to: number; count: number }> = [];
  let current: { d: string; from: number; to: number; count: number } | null = null;
  for (const point of points) {
    if (point.skill == null) {
      if (current) segments.push(current);
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
  if (current) segments.push(current);

  const engines = [...new Set(points.map((point) => point.engine))];

  return (
    <>
      <div className="coh-status__chips">
        <StateChip mark="●" word="Recorded runs" value={String(points.length)} tone="muted" />
        <StateChip mark="✓" word="Scored" value={String(scored.length)} tone="good" />
        <StateChip
          mark={refused ? "◌" : "✓"}
          word="Declined"
          value={refused ? String(refused) : "none"}
          tone={refused ? "warn" : "muted"}
        />
        <StateChip mark="◇" word="Engine" value={engines.join(", ")} tone={engines.length > 1 ? "warn" : "muted"} />
      </div>

      <Figure
        caption="Brier skill on the settled corpus, as it was recorded"
        ariaLabel={`${scored.length} recorded skills between ${clock(first / NS_PER_MS)} and ${clock(last / NS_PER_MS)} UTC`}
        reading={
          engines.length > 1
            ? "This series holds more than one engine. `tape` is a forecast test and `final_trade` is not, so the two halves are not one measurement and the line between them is not a trend."
            : "Zero is no better than always quoting the base rate; one is perfect. The record begins where the recorder began."
        }
        missing={[
          "The series accrues forward only: nothing back-fills it, so the first point is where the recorder started rather than where the venue did.",
          refused
            ? `${refused} of ${points.length} runs could not be scored and are drawn as gaps, never as zeroes — a line closed over one would claim a score nobody took.`
            : "",
        ].filter(Boolean).join(" ")}
      >
        <div ref={plotRef} style={{ width: "100%" }}>
          <svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(0)} y2={y(0)} className="coh-gauge__zero">
              <title>Zero skill: no better than always quoting the base rate.</title>
            </line>
            {segments.map((segment) => (
              <path key={segment.d.slice(0, 24)} d={segment.d} fill="none" className="coh-index__line">
                <title>
                  {`${segment.count} unbroken run(s), ${clock(segment.from / NS_PER_MS)} to ${clock(segment.to / NS_PER_MS)} UTC`}
                </title>
              </path>
            ))}
            <text x={MARGIN.left} y={y(0) - 3} className="coh-svg-note">no better than the base rate</text>
            <text x={MARGIN.left} y={HEIGHT - 6} className="coh-ladder__tick">{clock(first / NS_PER_MS)} UTC</text>
            <text x={width - MARGIN.right} y={HEIGHT - 6} textAnchor="end" className="coh-ladder__tick">
              {clock(last / NS_PER_MS)} UTC
            </text>
          </svg>
        </div>
      </Figure>
    </>
  );
}
