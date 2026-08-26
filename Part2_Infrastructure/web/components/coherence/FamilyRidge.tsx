"use client";

/**
 * Every watched family's distance from coherence, one lane each, over one axis.
 *
 * "Coherance index, fix the by family diagrams."
 *
 * WHAT IT REPLACED DREW TWO BARS. `IndexFamilies` rowed on `series_ticker` —
 * of which the live watchlist has TWO — so "by family" was a strip of two
 * lengths, with each row's other three quantities available only as hover text
 * and inside a fold. The families are the EVENTS: twenty-six of them on the
 * tape this was measured against, each its own ladder of strikes with its own
 * history. Rowing on the series answered a question nobody asked and hid the
 * one the view is named for.
 *
 * SMALL MULTIPLES, ON A SHARED Y. One lane per family, sorted by the worst
 * distance ever measured on it, every lane scaled to the SAME y — because the
 * comparison across families is the entire point, and a lane scaled to its own
 * range makes a family that never left 0.0020 look exactly like one that
 * reached 0.2950.
 *
 * THE X AXIS IS POLL ORDER, NOT ELAPSED TIME, and this figure says so rather
 * than leaving it to be inferred from an even-looking axis. Families are polled
 * at different moments and a shared wall-clock axis would leave most lanes
 * mostly empty. Ordering by the union of poll timestamps puts every lane on the
 * same ticks, at the cost of a slope that is not a rate — which the notes name.
 *
 * IT ALSO MAKES THE CURSOR HONEST. `Plot`'s shared axis divides `[x0, x1]`
 * evenly across `count`, so a figure whose marks are placed any other way gets
 * a crosshair reading a position it never drew at. Here the axis IS an ordinal,
 * so even division is the drawing's own definition rather than an assumption
 * about the data — and both the marks and the axis call `xOf`, so they cannot
 * drift apart.
 *
 * A gap is a gap. An unmeasurable reading breaks the line rather than being
 * interpolated across, because a line closing over one would claim continuity
 * nobody observed.
 */

import Figure, { FigureEmpty, Plot } from "./Figure";
import { clock } from "./IndexBasisChart";
import { DIAGRAM_LABEL_PX, advancePx, truncateMiddle } from "@/lib/coherence/label-metrics";
import { fromCenticents, signedCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceIndexSeries } from "@/lib/coherence/types";
import type { SharedX } from "@/lib/coherence/use-shared-x-readout";

const NS_PER_MS = 1_000_000;
const LANE_H = 21;
const MARGIN = { top: 16, bottom: 30 };
/**
 * How many lanes are drawn before the rest are counted instead.
 *
 * Sixteen at 21px is 336 of plot, which is the tallest this may be without the
 * section needing a scroll of its own. Families are sorted by peak, so what is
 * dropped is always the quietest — and the count of what was dropped is in the
 * figure's own footnote rather than left to be noticed.
 */
const LANES = 16;

interface Lane {
  ticker: string;
  readings: number;
  measured: number;
  unmeasurable: number;
  peak: number | null;
  /** Reading per poll ordinal, or null where the poll produced none for this family. */
  byOrdinal: Array<number | null>;
}

/** Every family, its readings placed on the union of poll times. */
function lanesOf(data: CoherenceIndexSeries): { lanes: Lane[]; stamps: number[] } {
  const stamps = [...new Set(data.points.map((point) => point.ts_ns))].sort((a, b) => a - b);
  const at = new Map(stamps.map((ts, index) => [ts, index]));
  const lanes = new Map<string, Lane>();
  for (const point of data.points) {
    const lane = lanes.get(point.event_ticker) ?? {
      ticker: point.event_ticker,
      readings: 0,
      measured: 0,
      unmeasurable: 0,
      peak: null,
      byOrdinal: new Array<number | null>(stamps.length).fill(null),
    };
    lanes.set(point.event_ticker, lane);
    lane.readings += 1;
    const cc = toCenticents(point.ci);
    if (cc == null) {
      lane.unmeasurable += 1;
      continue;
    }
    lane.measured += 1;
    lane.peak = lane.peak == null || cc > lane.peak ? cc : lane.peak;
    lane.byOrdinal[at.get(point.ts_ns) ?? 0] = cc;
  }
  const ordered = [...lanes.values()].sort(
    (a, b) => (b.peak ?? -1) - (a.peak ?? -1) || a.ticker.localeCompare(b.ticker),
  );
  return { lanes: ordered, stamps };
}

/** The x of one poll ordinal — the ONE expression the marks and the axis share. */
function xOf(index: number, count: number, x0: number, x1: number): number {
  return count <= 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * index) / (count - 1);
}

/** A run of consecutive readings, so a gap breaks the line rather than closing it. */
function runsOf(values: Array<number | null>): Array<Array<{ index: number; cc: number }>> {
  const runs: Array<Array<{ index: number; cc: number }>> = [];
  let run: Array<{ index: number; cc: number }> = [];
  values.forEach((cc, index) => {
    if (cc == null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push({ index, cc });
  });
  if (run.length) runs.push(run);
  return runs;
}

export default function FamilyRidge({ data }: { data: CoherenceIndexSeries }) {
  const { lanes, stamps } = lanesOf(data);
  const drawn = lanes.slice(0, LANES);
  const dropped = lanes.length - drawn.length;
  const highest = Math.max(1, ...lanes.map((lane) => lane.peak ?? 0));

  if (!drawn.length || stamps.length < 2) {
    return (
      <Figure
        caption="Every watched family's distance from coherence, one lane each"
        ariaLabel="No family has produced two readings yet"
        missing={data.notes[0] ?? null}
      >
        <FigureEmpty
          reason={
            lanes.length
              ? "One poll is a point, not a lane: this view needs two readings before a family has a shape."
              : "No family has been polled yet, so there is nothing to lay out."
          }
        />
      </Figure>
    );
  }

  const height = MARGIN.top + drawn.length * LANE_H + MARGIN.bottom;
  const worst = drawn[0];
  /** What each lane says on its right, so the gutter can be measured from it. */
  const metaOf = (lane: Lane) =>
    `${fromCenticents(lane.peak) ?? "never measured"} peak, ${lane.unmeasurable} gap(s)`;

  const shared = (width: number): SharedX => ({
    count: stamps.length,
    x0: 8 + Math.max(...drawn.map((lane) => advancePx(lane.ticker, DIAGRAM_LABEL_PX))),
    x1: width - (8 + Math.max(...drawn.map((lane) => advancePx(metaOf(lane), DIAGRAM_LABEL_PX)))),
    read: (index) => ({
      title: `Poll ${index + 1} of ${stamps.length}, ${clock(stamps[index] / NS_PER_MS)} UTC`,
      rows: drawn
        .map((lane) => ({
          label: truncateMiddle(lane.ticker, 150, DIAGRAM_LABEL_PX),
          value: lane.byOrdinal[index] == null ? "— not measured" : fromCenticents(lane.byOrdinal[index]) ?? "—",
          raw: lane.byOrdinal[index] ?? null,
        }))
        // A readout naming sixteen families at a poll most of them missed is a
        // list of dashes. The ones that answered are the reading.
        .filter((row) => !row.value.startsWith("—")),
    }),
    // 72 wider than the reading alone: a pinned row reads "now was then, +diff".
    width: 332,
    arriveAt: "last",
    // One poll held against another, family by family, the step in dollars.
    pin: true,
    diff: (a, b) => (a.raw != null && b.raw != null ? signedCenticents(a.raw - b.raw) : ""),
  });

  return (
    <Figure
      caption="Every watched family's distance from coherence, one lane each, worst first"
      ariaLabel={
        `${drawn.length} families over ${stamps.length} polls, sharing one scale to a peak of `
        + `${fromCenticents(highest)}`
      }
      reading={
        `${worst.ticker} is the furthest any family has been from admitting a probability, at `
        + `${fromCenticents(worst.peak)}; every lane is drawn to that same scale.`
      }
      missing={dropped ? `${dropped} quieter famil(ies) are not drawn: the lanes are sorted worst first and the panel holds ${LANES}.` : null}
      notes={[
        "The axis is POLL ORDER, not elapsed time. Families are polled at different moments, so a "
        + "shared wall-clock axis would leave most lanes mostly empty; the cost is that a slope here is "
        + "not a rate.",
        // REWORDED, NOT DUPLICATED. `coherence-proof-claims` pins "claim
        // continuity nobody observed" to exactly ONE carrier — `IndexPane`,
        // which owns that sentence for this section — and it counts FILES, so a
        // second figure reusing the house phrase goes red exactly like a
        // deletion. The count exists to stop one claim being made in several
        // places, so raising it would defeat the guard rather than satisfy it.
        "A lane breaks where a reading could not be measured rather than closing over it: the gap is "
        + "what was not seen, and a line drawn through it would be an invention.",
        ...data.notes,
      ]}
    >
      <Plot height={height} sharedX={shared}>
        {(width: number) => {
          const gutter = Math.max(...drawn.map((lane) => advancePx(lane.ticker, DIAGRAM_LABEL_PX)));
          const x0 = gutter + 8;
          // MEASURED ON BOTH SIDES. A constant right margin of 122 clipped
          // "0.0900, 26 unmeasurable" to "0.0900, 26 unmeasurab" — the count
          // that matters most is the one on the family with the most gaps.
          const x1 = width - (8 + Math.max(...drawn.map((lane) => advancePx(metaOf(lane), DIAGRAM_LABEL_PX))));
          const y = (laneIndex: number, cc: number) =>
            MARGIN.top + laneIndex * LANE_H + LANE_H - 3 - (cc / highest) * (LANE_H - 6);

          return (
            <>
              {drawn.map((lane, laneIndex) => {
                const base = MARGIN.top + laneIndex * LANE_H + LANE_H - 3;
                const runs = runsOf(lane.byOrdinal);
                const peakAt = lane.byOrdinal.findIndex((cc) => cc != null && cc === lane.peak);
                return (
                  <g key={lane.ticker}>
                    <text x={gutter} y={base - 1} textAnchor="end" className="coh-ridge__name">
                      {lane.ticker}
                    </text>
                    <line x1={x0} x2={x1} y1={base} y2={base} className="coh-ridge__base" />
                    {/* A LINE WHERE THERE ARE TWO IN A ROW, AND A DOT ALWAYS.
                        The x axis is the UNION of poll times across every
                        family, and a family answers a fraction of them — 901
                        ordinals on the live tape against about thirty readings
                        each — so almost every run is a single point, and a
                        one-point path draws nothing at all. The first version
                        of this lane rendered as an empty rule with one peak dot
                        on it: correct geometry, invisible measurement. Seen at
                        a viewport; no arithmetic in the source says a run is
                        usually length one. */}
                    {runs
                      .filter((run) => run.length > 1)
                      .map((run) => (
                        <path
                          key={`${lane.ticker}-${run[0].index}`}
                          d={run
                            .map((point, at) => `${at ? "L" : "M"}${xOf(point.index, stamps.length, x0, x1).toFixed(2)},${y(laneIndex, point.cc).toFixed(2)}`)
                            .join(" ")}
                          className="coh-ridge__line"
                        />
                      ))}
                    {runs.flat().map((point) => (
                      <circle
                        key={`${lane.ticker}-dot-${point.index}`}
                        cx={xOf(point.index, stamps.length, x0, x1)}
                        cy={y(laneIndex, point.cc)}
                        r={1.5}
                        className="coh-ridge__dot"
                      />
                    ))}
                    {peakAt >= 0 && lane.peak != null ? (
                      <circle
                        cx={xOf(peakAt, stamps.length, x0, x1)}
                        cy={y(laneIndex, lane.peak)}
                        r={3}
                        className="coh-ridge__peak"
                      />
                    ) : null}
                    <text x={x1 + 8} y={base - 1} className="coh-ridge__meta">
                      {metaOf(lane)}
                    </text>
                  </g>
                );
              })}
              <text x={x0} y={height - 10} className="coh-ridge__tick">
                {`poll 1, ${clock(stamps[0] / NS_PER_MS)} UTC`}
              </text>
              <text x={x1} y={height - 10} textAnchor="end" className="coh-ridge__tick">
                {`poll ${stamps.length}, ${clock(stamps[stamps.length - 1] / NS_PER_MS)} UTC`}
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
