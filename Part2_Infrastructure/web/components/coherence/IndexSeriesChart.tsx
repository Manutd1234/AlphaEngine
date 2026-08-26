"use client";

/**
 * The index tape, one lane per series — because one line was three claims.
 *
 * `IndexPane`'s chart mapped every point to `{ts, cc}` and dropped
 * `series_ticker`, `event_ticker` and `engine` before drawing. Measured against
 * the live tape on 2026-08-26, that single line was pooling:
 *
 *   - TWO SERIES, interleaved point by point — KXBTCD (442) and KXHIGHNY (317),
 *     so consecutive marks on the "trend" were usually different series;
 *   - TWENTY-FIVE distinct families inside them, so the point-to-point movement
 *     was mostly WHICH FAMILY was polled on that tick;
 *   - THREE estimators — isotonic (434), ask_side (287), mid_sum (4) —
 *     alternating in runs of one and two across 478 changes, so nearly every
 *     segment of the line crossed a method boundary.
 *
 * A line drawn through that has the shape of a time series and the content of a
 * scatter in poll order. `CalibrationTrend` already treats two engines in one
 * series as a thing to warn about; this tape had three and said nothing.
 *
 * WHAT IS FIXED AND WHAT IS ONLY DISCLOSED. The series split is drawn: two
 * lanes, so no segment joins two series. The families and the estimators inside
 * a lane are COUNTED IN THE NOTES rather than split further — twenty-five lanes
 * would be unreadable, `IndexFamilies` already carries the per-family reading,
 * and breaking the line at every estimator change would leave 478 fragments of
 * one and two points, which is a truer picture of the record and an unreadable
 * one. Saying what is pooled is the house's other answer to that, and it is the
 * one taken here.
 *
 * ONE Y SCALE ACROSS BOTH LANES, on purpose: this is the same quantity in the
 * same units — L1 distance in dollars — so a lane sitting higher than the other
 * IS the reading. Per-lane scales would hide exactly the comparison the split
 * was made to allow.
 */

import { fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceIndexPoint } from "@/lib/coherence/types";
import type { SharedXRow } from "@/lib/coherence/use-shared-x-readout";
import Figure, { FigureEmpty, Plot } from "./Figure";
import { clock, thin, type IndexPoint } from "./IndexBasisChart";

const NS_PER_MS = 1_000_000;
const LANE_H = 132;
const LANE_GAP = 26;
const MARGIN = { top: 20, right: 4, bottom: 22, left: 4 };

interface Lane {
  series: string;
  points: IndexPoint[];
  raw: CoherenceIndexPoint[];
}

/** Distinct values of a field, most common first, as "value (n)". */
function tally(points: readonly CoherenceIndexPoint[], pick: (p: CoherenceIndexPoint) => string): string[] {
  const counts = new Map<string, number>();
  for (const point of points) {
    const key = pick(point) || "unrecorded";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, n]) => `${key} (${n})`);
}

/**
 * Everything true at one poll, for the crosshair: each lane's reading at that
 * stamp or the reason there is none, the estimators that produced them, the
 * families polled. A lane with no point at the stamp was NOT POLLED, which is
 * a different absence from a poll that could not be measured, and both are
 * said in words rather than drawn as a zero.
 */
function readAt(
  index: number,
  stamps: readonly number[],
  lanes: readonly Lane[],
  byStamp: ReadonlyMap<number, CoherenceIndexPoint[]>,
) {
  const stamp = stamps[index];
  const at = byStamp.get(stamp) ?? [];
  const rows: SharedXRow[] = lanes.map((lane) => {
    const point = at.find((p) => (p.series_ticker || "unrecorded") === lane.series);
    if (!point) return { label: lane.series, value: "— not polled" };
    const cc = toCenticents(point.ci);
    return cc == null
      ? { label: lane.series, value: `— not measured${point.detail ? `: ${point.detail}` : ""}` }
      : { label: lane.series, value: fromCenticents(cc) ?? "—", raw: cc };
  });
  const engines = [...new Set(at.filter((p) => toCenticents(p.ci) != null).map((p) => p.engine || "unrecorded"))];
  if (engines.length) rows.push({ label: "Estimator", value: engines.join(", ") });
  rows.push({ label: "Families", value: [...new Set(at.map((p) => p.event_ticker))].join(", ") || "—" });
  return { title: `Poll ${index + 1} of ${stamps.length}, ${clock(stamp / NS_PER_MS)} UTC`, rows };
}

export default function IndexSeriesChart({ points, stamps }: {
  points: CoherenceIndexPoint[];
  /**
   * The distinct poll stamps, ascending — derived ONCE by the pane and shared
   * with the coverage strip under this chart, so both figures count the same
   * polls and a crosshair on one is a crosshair on the other.
   */
  stamps: readonly number[];
}) {
  const lanes: Lane[] = [];
  for (const point of points) {
    const series = point.series_ticker || "unrecorded";
    let lane = lanes.find((l) => l.series === series);
    if (!lane) { lane = { series, points: [], raw: [] }; lanes.push(lane); }
    lane.raw.push(point);
    lane.points.push({ ts: point.ts_ns, cc: toCenticents(point.ci), flagged: false });
  }
  lanes.sort((a, b) => b.raw.length - a.raw.length);

  const measured = points.filter((p) => toCenticents(p.ci) != null);
  if (!lanes.length || !measured.length) {
    return (
      <Figure caption={CAPTION} ariaLabel="No index reading could be measured">
        <FigureEmpty reason="Nothing measurable recorded yet." />
      </Figure>
    );
  }

  // ONE scale for every lane — same quantity, same units.
  const peak = Math.max(...measured.map((p) => toCenticents(p.ci) as number), 1);
  const first = Math.min(...points.map((p) => p.ts_ns));
  const last = Math.max(...points.map((p) => p.ts_ns));
  const span = Math.max(1, last - first);
  const height = MARGIN.top + lanes.length * (LANE_H + LANE_GAP) + MARGIN.bottom;

  const engines = tally(measured, (p) => p.engine);
  const families = new Set(points.map((p) => p.event_ticker)).size;

  const byStamp = new Map<number, CoherenceIndexPoint[]>();
  for (const point of points) {
    const at = byStamp.get(point.ts_ns);
    if (at) at.push(point);
    else byStamp.set(point.ts_ns, [point]);
  }
  // ONE GEOMETRY for the lanes and the crosshair, so the rule lands on the
  // poll it names rather than near it. The axis is time, so the polls are
  // wherever the recorder ran and the crosshair takes their positions.
  const geometry = (width: number) => {
    const plotWidth = width - MARGIN.left - MARGIN.right;
    const x = (ts: number) => MARGIN.left + ((ts - first) / span) * plotWidth;
    return { plotWidth, x };
  };

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={`${measured.length} measured readings across ${lanes.length} series, peaking at ${fromCenticents(peak)}`}
      reading={
        // NOT the scale again: the section lede owns "zero is prices that admit
        // a probability exactly", and a reader on this figure has just read it.
        // What the drawing cannot say is which norm it is drawn in, and why one
        // axis is legitimate for two lanes.
        `${lanes.length} series on one axis, peak ${fromCenticents(peak)}. A lane sitting higher is the`
        + " reading: both are ‖p − q‖₁ in dollars, so the scale is shared and the lanes are comparable —"
        + " which is the whole point of splitting them."
      }
      notes={[
        "A poll that could not be measured is drawn as a gap, never as a zero and never dropped: a line"
        + " closed over one would claim continuity nobody observed.",
        engines.length > 1
          ? `${engines.length} estimators in this record — ${engines.join(", ")} — chosen per book shape`
            + " and not split into their own lines: they alternate every poll or two, so a line per"
            + " estimator would be hundreds of fragments. A segment here can join two of them, and the"
            + " step between is a change of method as much as a change of price."
          : `One estimator throughout: ${engines[0] ?? "none recorded"}.`,
        `${families} distinct families inside these ${lanes.length} lanes, so movement within a lane is`
        + " partly which family was polled on that tick. By family carries the per-family reading.",
      ]}
    >
      <Plot
        height={height}
        sharedX={(width) => {
          const { x } = geometry(width);
          return {
            count: stamps.length,
            x0: MARGIN.left,
            x1: width - MARGIN.right,
            positions: stamps.map((ts) => x(ts)),
            read: (index) => readAt(index, stamps, lanes, byStamp),
            width: 300,
            arriveAt: "last",
            link: "index-polls",
          };
        }}
      >
        {(width) => {
          const { x } = geometry(width);
          return (
            <>
              {lanes.map((lane, i) => (
                <LaneRow
                  key={lane.series}
                  lane={lane}
                  top={MARGIN.top + i * (LANE_H + LANE_GAP)}
                  peak={peak}
                  x={x}
                  width={width}
                />
              ))}
              <text x={MARGIN.left} y={height - 6} className="coh-ladder__tick">
                {clock(first / NS_PER_MS)} UTC
              </text>
              <text x={width - MARGIN.right} y={height - 6} textAnchor="end" className="coh-ladder__tick">
                {clock(last / NS_PER_MS)} UTC
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}

const CAPTION = "L1 distance from the nearest coherent price vector, one lane per series";

function LaneRow({ lane, top, peak, x, width }: {
  lane: Lane;
  top: number;
  peak: number;
  x: (ts: number) => number;
  width: number;
}) {
  const base = top + LANE_H;
  const y = (cc: number) => base - (cc / peak) * (LANE_H - 8);
  const { kept, bucket } = thin(lane.points);
  const measured = lane.points.filter((p) => p.cc != null);
  const unmeasurable = lane.points.length - measured.length;
  const lanePeak = measured.length ? Math.max(...measured.map((p) => p.cc as number)) : null;
  const engines = tally(lane.raw.filter((p) => toCenticents(p.ci) != null), (p) => p.engine);

  // Broken at gaps, never bridged — the rule the single-line chart already
  // kept, applied inside each lane.
  const segments: Array<{ d: string; from: number; to: number; count: number; peak: number }> = [];
  let current: { d: string; from: number; to: number; count: number; peak: number } | null = null;
  for (const point of kept) {
    if (point.cc == null) { if (current) segments.push(current); current = null; continue; }
    if (current) {
      current.d += `L${x(point.ts).toFixed(2)},${y(point.cc).toFixed(2)}`;
      current.to = point.ts;
      current.count += 1;
      current.peak = Math.max(current.peak, point.cc);
    } else {
      current = { d: `M${x(point.ts).toFixed(2)},${y(point.cc).toFixed(2)}`, from: point.ts, to: point.ts, count: 1, peak: point.cc };
    }
  }
  if (current) segments.push(current);

  return (
    <g className="coh-indexlane">
      <text x={MARGIN.left} y={top - 6} className="coh-indexlane__name">
        {lane.series}
      </text>
      <text x={width - MARGIN.right} y={top - 6} textAnchor="end" className="coh-indexlane__meta">
        {lanePeak === null
          ? `${lane.points.length} readings, none measurable`
          : `peak ${fromCenticents(lanePeak)}${unmeasurable ? `, ${unmeasurable} unmeasurable` : ""}`
            + `${engines.length > 1 ? `, ${engines.length} estimators` : ""}`}
      </text>
      <line x1={MARGIN.left} x2={width - MARGIN.right} y1={base} y2={base} className="coh-ladder__axis" />
      {/* NO TITLE ON A SEGMENT since 2026-08-26: the crosshair reads every
          lane at a poll, which is the reader's question, and a segment's own
          facts (its unbroken count, its span) are what the coverage strip
          under this chart draws run by run. The estimator is still not named
          per segment: a segment is built from THINNED points, which carry a
          timestamp and a distance and not the engine that produced them, so
          the estimator at a poll is read from the raw points in the readout
          and the mix belongs to the lane's notes. */}
      {segments.map((segment) => (
        <path key={`${segment.from}`} d={segment.d} fill="none" pathLength={1}
              className="coh-index__line chart-draw" />
      ))}
      {kept.length < lane.points.length ? (
        <text x={MARGIN.left} y={base + 14} className="coh-svg-note">
          {`${lane.points.length} readings thinned to ${kept.length}, keeping each ${bucket}-reading bucket’s extremes`}
        </text>
      ) : null}
    </g>
  );
}
