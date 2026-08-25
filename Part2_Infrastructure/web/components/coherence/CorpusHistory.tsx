"use client";

/**
 * The settled record as a panel of measures, not as one line.
 *
 * `/calibration/history` ships SEVEN figures per run — Brier, skill, base rate,
 * uncertainty, favourite–longshot slope, median horizon and the market count —
 * timestamped, oldest first. `CalibrationTrend` plots `skill` and drops the
 * rest: `markets` is mapped into its point shape at line 68 and then never
 * read, and the other five are never mapped at all. This is the same move
 * `diffusion/FloorDistribution` documents — a second reading of fields that
 * were already on the wire and shown only in aggregate — and it needs no new
 * gateway route, because the payload was always this wide.
 *
 * ONE READING ACROSS ALL OF THEM, which is the reason it is one figure rather
 * than six. The question at a given run is not "what was Brier" but "what was
 * everything, then" — a Brier that fell while uncertainty fell with it says
 * the questions got easier, not that the prices got better, and that is a
 * comparison no per-mark readout can make. `Plot`'s `sharedX` exists for this:
 * the crosshair reads a run, and the card says every measure at it.
 *
 * EACH ROW IS SCALED TO ITS OWN RANGE, so heights compare WITHIN a row and
 * never between rows. Uncertainty sits near 0.16 and Brier near 0.0001 —
 * three orders apart — and one shared axis would draw Brier as a flat line on
 * the floor, which is the reading `MurphyBars` already has an inset to avoid.
 * `ClockAgreement` made the same call for the same reason. The row label
 * carries the range so the flatness of a row is readable as a fact.
 *
 * X IS THE RUN, NOT THE CLOCK. Runs are drawn evenly spaced because this is a
 * record OF RUNS and the recorder's cadence is not the subject; the ends carry
 * their dates so the span is visible. Spacing them by timestamp would put the
 * crosshair between two runs and read a value at a moment nobody measured.
 */

import type { ReactNode } from "react";

import { extent, linePath, linearScale } from "@/components/chart-kit";
import Figure, { FigureEmpty, Plot } from "./Figure";
import { decimalLabel } from "./ReliabilityDiagram";
import { DIAGRAM_LABEL_PX, gutterFor } from "@/lib/coherence/label-metrics";
import type { CoherenceCalibrationHistory, CoherenceCalibrationPoint } from "@/lib/coherence/types-lab";
import type { SharedXRow } from "@/lib/coherence/use-shared-x-readout";
import { shortDate } from "@/lib/format";

const ROW_H = 30;
const ROW_GAP = 8;
const TOP = 12;
const BOTTOM = 26;
const RIGHT = 8;

interface Measure {
  key: string;
  label: string;
  /** null where the run did not record it. Never 0 — that is the whole rule. */
  at: (point: CoherenceCalibrationPoint) => number | null;
  show: (value: number) => string;
}

const num = (raw: string | null): number | null => {
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const MEASURES: readonly Measure[] = [
  { key: "skill", label: "Skill", at: (p) => num(p.skill), show: (v) => decimalLabel(String(v), 6) },
  { key: "brier", label: "Brier", at: (p) => num(p.brier), show: (v) => decimalLabel(String(v), 6) },
  { key: "base_rate", label: "Base rate", at: (p) => num(p.base_rate), show: (v) => decimalLabel(String(v), 4) },
  { key: "uncertainty", label: "Uncertainty", at: (p) => num(p.uncertainty), show: (v) => decimalLabel(String(v), 6) },
  { key: "bias_slope", label: "Bias slope", at: (p) => num(p.bias_slope), show: (v) => decimalLabel(String(v), 4) },
  {
    key: "median_horizon_s",
    label: "Median horizon",
    at: (p) => p.median_horizon_s,
    show: (v) => (v >= 3600 ? `${Math.round(v / 360) / 10}h` : v >= 60 ? `${Math.round(v / 60)}m` : `${Math.round(v)}s`),
  },
  { key: "markets", label: "Markets scored", at: (p) => p.markets, show: (v) => String(Math.round(v)) },
];

export default function CorpusHistory({ data, skillDrawnAbove }: {
  data: CoherenceCalibrationHistory;
  /**
   * Whether the skill line is drawn above this panel.
   *
   * It usually is — `CalibrationTrend` is the headline of this view. But when
   * every recorded run declined to score, that component draws a coverage strip
   * and no curve at all, and on this deployment that is the live case: 38 runs,
   * skill null on all 38. Told `false`, the panel stops claiming skill is next
   * door and lets it fall to the silent list like any other unwritten measure.
   */
  skillDrawnAbove: boolean;
}) {
  const points = data.points;
  if (!points.length) {
    return (
      <Figure caption={CAPTION} ariaLabel={CAPTION}>
        <FigureEmpty reason="No run has been recorded yet, so there is no record to draw." />
      </Figure>
    );
  }

  // SKILL IS READ HERE AND DRAWN NEXT DOOR. `CalibrationTrend` is the headline
  // figure of this view and owns the skill line, with the zero rule and the
  // reading that says what zero means. Drawing it again would be the same claim
  // twice; leaving it out of the CARD would break the one comparison this panel
  // exists for — a Brier that fell while uncertainty fell with it means the
  // questions got easier, and that is unreadable without skill beside them.
  // So: six lanes, seven rows in the readout.
  const lanes = skillDrawnAbove ? MEASURES.filter((m) => m.key !== "skill") : MEASURES;

  // A measure with no value on ANY run is not drawn as an empty lane. It is
  // named in the notes instead, because an empty lane reads as a measure that
  // came back zero rather than one the recorder never wrote.
  const drawn = lanes.filter((m) => points.some((p) => m.at(p) !== null));
  const silent = lanes.filter((m) => !drawn.includes(m));
  const height = TOP + drawn.length * (ROW_H + ROW_GAP) + BOTTOM;

  const read = (index: number) => {
    const point = points[index];
    const rows: SharedXRow[] = MEASURES.filter((m) => (skillDrawnAbove && m.key === "skill") || drawn.includes(m)).map((m) => {
      const value = m.at(point);
      return { label: m.label, value: value === null ? "—" : m.show(value) };
    });
    rows.push({ label: "Engine", value: point.engine });
    if (point.thin) rows.push({ label: "Sample", value: "thin" });
    return { title: `Run ${index + 1} of ${points.length}, ${shortDate(point.ts_ns / 1e6)}`, rows };
  };

  const scored = points.filter((p) => num(p.skill) !== null).length;
  const engines = [...new Set(points.map((p) => p.engine))];

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={CAPTION}
      reading={
        `${points.length} recorded runs, ${scored} of them scored.`
        + " Each row is scaled to its own range, so a shape reads within a row and never across"
        + " two — uncertainty and Brier are three orders of magnitude apart, and one axis would"
        + " draw the smaller as a flat line on the floor."
        + (skillDrawnAbove
          ? " Skill is the figure above; it is in this panel's readout so the measures can be read"
            + " against it, and out of its lanes so the claim is not made twice."
          : "")
      }
      notes={notesFor(points.length - scored, silent, engines)}
    >
      <Plot
        height={height}
        // The SAME geometry the lanes are drawn with, so the crosshair lands on
        // the run it names rather than near it.
        sharedX={(width) => {
          const { gutter, trackW } = geometry(width, drawn.map((m) => m.label));
          return { count: points.length, x0: gutter, x1: gutter + trackW, read, width: 232 };
        }}
      >
        {(width) => <Panel width={width} points={points} drawn={drawn} />}
      </Plot>
    </Figure>
  );
}

const CAPTION = "Everything else the recorder wrote, run by run, each on its own scale";

function notesFor(refused: number, silent: readonly Measure[], engines: readonly string[]): string[] {
  const notes: string[] = [];
  notes.push(
    "Runs are drawn evenly spaced, so this is a record of RUNS rather than a time axis: the gap"
    + " between two marks is one run, never a duration. Spacing them by timestamp would put the"
    + " crosshair between two runs and read a value at a moment nobody measured.",
  );
  notes.push(
    refused > 0
      ? `${refused} of the runs could not be scored and are drawn as gaps, never as zeroes — a line`
        + " closed over one would claim a score nobody took."
      : "Every recorded run carries a score, so no row on this panel has a gap in it.",
  );
  if (silent.length) {
    notes.push(
      `${silent.map((m) => m.label).join(", ")} ${silent.length === 1 ? "is" : "are"} on the wire and`
      + " null on every run recorded so far, so no lane is drawn for"
      + ` ${silent.length === 1 ? "it" : "them"} — an empty lane reads as a measure that came back`
      + " zero rather than one nothing was ever written to.",
    );
  }
  if (engines.length > 1) {
    notes.push(
      `Two engines in one record (${engines.join(", ")}): a forecast test and a convergence test are`
      + " not one measurement, so the run-to-run step between them is not a trend.",
    );
  }
  notes.push(
    "The series accrues forward only; nothing back-fills it, so the first run is where the recorder"
    + " started rather than where the venue did.",
  );
  return notes;
}

/**
 * Where the labels stop and the track starts.
 *
 * ONE function, called by the lanes AND by the crosshair, because they must
 * agree to the pixel: a readout built from its own idea of the axis reads a
 * value at a position the drawing never used, and nothing about the picture
 * shows that it is doing so.
 *
 * Reserved from the MEASURED advance of the labels, never from a constant. A
 * gutter multiplied out of one ratio is what ran `ComboBandStrips`' tickers
 * 21px past their column, where paint order hid the overrun as a clip.
 */
function geometry(width: number, labels: readonly string[]) {
  const gutter = gutterFor(labels, width, DIAGRAM_LABEL_PX, { min: 96, max: 168 });
  return { gutter, trackW: Math.max(40, width - gutter - RIGHT) };
}

function Panel({ width, points, drawn }: {
  width: number;
  points: readonly CoherenceCalibrationPoint[];
  drawn: readonly Measure[];
}) {
  const { gutter, trackW } = geometry(width, drawn.map((m) => m.label));
  const x = linearScale(0, Math.max(1, points.length - 1), gutter, gutter + trackW);
  const nodes: ReactNode[] = [];

  drawn.forEach((measure, row) => {
    const top = TOP + row * (ROW_H + ROW_GAP);
    const values = points.map((p) => measure.at(p));
    const [lo, hi] = extent(values);
    const y = linearScale(lo, hi, top + ROW_H - 3, top + 3);
    const seen = values.filter((v): v is number => v !== null);
    const last = [...values].reverse().find((v) => v !== null) ?? null;
    const flat = hi - lo === 0;

    nodes.push(
      <g key={measure.key} className="coh-corpushist__row">
        <text x={0} y={top + ROW_H / 2 + 4} className="coh-corpushist__label">{measure.label}</text>
        {/* The lane, so a row with one gap still reads as a row. */}
        <line x1={gutter} x2={gutter + trackW} y1={top + ROW_H + 2} y2={top + ROW_H + 2}
              className="coh-corpushist__base" />
        {/* DRAWN IN ORDER, because the order is the claim: this record accrues
            forward only and nothing back-fills it, so a lane arriving
            left-to-right is that fact rather than decoration. `chart-draw` is
            the engine's existing idiom — `pathLength={1}` normalises every path
            so one CSS rule fits any geometry, and the rule reads `--dur-draw`
            rather than a literal, so the reduced-motion block collapses it to
            1ms with the rest.

            NOT on the bars, strips or ladders elsewhere on this tab: a reader
            scans those, and animating a thing that is scanned only delays it. */}
        <path d={linePath(values.map((v, i) => ({ x: x(i), y: v === null ? null : y(v) })))}
              pathLength={1} className="coh-corpushist__line chart-draw" fill="none" />
        {/* Every run that HAS a value gets a mark, so a single-run measure is
            visible at all — a path of one point draws nothing. */}
        {values.map((v, i) => v === null ? null : (
          <circle key={i} cx={x(i)} cy={y(v)} r={1.6} className="coh-corpushist__dot" />
        ))}
        <text x={gutter + trackW} y={top + ROW_H / 2 + 4} textAnchor="end"
              className="coh-corpushist__last">
          {last === null ? "—" : measure.show(last)}
        </text>
        {/* A flat row is a measurement, and it must not read as a broken one. */}
        {flat && seen.length > 1 ? (
          <text x={gutter} y={top + 2} className="coh-corpushist__flat">
            {`unchanged at ${measure.show(lo)}`}
          </text>
        ) : null}
      </g>,
    );
  });

  const first = points[0];
  const last = points[points.length - 1];
  nodes.push(
    <g key="axis">
      <text x={gutter} y={TOP + drawn.length * (ROW_H + ROW_GAP) + 14} className="coh-corpushist__tick">
        {shortDate(first.ts_ns / 1e6)}
      </text>
      <text x={gutter + trackW} y={TOP + drawn.length * (ROW_H + ROW_GAP) + 14} textAnchor="end"
            className="coh-corpushist__tick">
        {shortDate(last.ts_ns / 1e6)}
      </text>
    </g>,
  );
  return <>{nodes}</>;
}
