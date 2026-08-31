"use client";

/**
 * The two stages of one announcement, drawn against each other.
 *
 * This is the picture the module exists to produce. A rate decision arrives
 * twice — the statement at 14:00, the press conference at 14:30 — and the
 * question is whether the price finishes absorbing the two at the same speed.
 * Two curves, one grid, one terminal, so the comparison is a comparison rather
 * than an artefact of measuring them over different windows.
 *
 * MEASURED IN PIXELS, NOT IN A STRETCHED UNIT BOX. The first version of this
 * used `viewBox="0 0 100 H"` with `preserveAspectRatio="none"`, which is fine
 * for a drawing made only of lines and ruins one with labels on it: the box is
 * scaled about nineteen times horizontally and once vertically, so every
 * glyph comes out that much wider than it is tall. `useMeasuredWidth` gives
 * the real width and one user unit is one CSS pixel, which is the convention
 * `components/chart-kit.tsx` already uses for exactly this reason.
 *
 * The x axis is ORDINAL over the horizon grid. The grid is geometric (1m, 2m,
 * 5m, 10m, 15m, 30m); a linear time axis would give the last cell half the
 * width and squash the part where everything happens.
 */

import { Grid, XAxis, bandPath, linearScale, ticks } from "@/components/chart-kit";
import { Plot } from "../Figure";
import { absorptionBand } from "@/lib/coherence/absorption-band";
import { pct } from "@/lib/format";
import { useState } from "react";

import type { StageRun, StageSummary } from "./types";

const HEIGHT = 216;
// 40, not 34: the legend sits in the top margin as ONE row now (below), and at
// 34 a 14px key's own ink box started 1px ABOVE the svg's own top edge — it
// survived only because `.coh-figure__plot svg` sets `overflow: visible`
// (`10a-coherence-plane.css`) — with a 5px gap to the caption above and an
// 8.4px vertical overlap with the "100%" gridline label. Both figures move by
// the same +6, so the plot area itself is unchanged.
const MARGIN = { top: 40, right: 18, bottom: 30, left: 44 };

export interface AbsorptionCurveProps {
  horizons: string[];
  release: (number | null)[];
  call: (number | null)[];
  stages: StageSummary[];
  /** Retained on the public prop contract for the evidence table beside this plot. */
  runs?: StageRun[];
}

export type AbsorptionSeries = "both" | "release" | "call";

/** Broken at gaps rather than bridged: an unmeasured horizon is a hole in the
 *  record, and a line drawn across it asserts a fraction nobody read. */
function brokenPath(
  values: (number | null)[],
  x: (index: number) => number,
  y: (value: number) => number,
): string {
  let drawn = "";
  let open = false;
  values.forEach((value, index) => {
    if (value == null) {
      open = false;
      return;
    }
    drawn += `${open ? "L" : "M"}${x(index).toFixed(2)},${y(value).toFixed(2)}`;
    open = true;
  });
  return drawn;
}

export default function AbsorptionCurve({ horizons, release, call, stages, runs }: AbsorptionCurveProps) {
  const [series, setSeries] = useState<AbsorptionSeries>("both");
  return (
    <div className="diff-instrument">
      <div className="diff-lens" role="group" aria-label="Absorption lines">
        {(["both", "release", "call"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={series === option}
            onClick={() => setSeries(option)}
          >
            {option === "both" ? "Both lines" : option === "release" ? "Statement" : "Conference"}
          </button>
        ))}
      </div>
      <Plot
        height={HEIGHT}
        minWidth={300}
        scrollLabel="Absorption lines diagram"
        sharedX={(width) => {
          const x0 = MARGIN.left;
          const x1 = Math.max(x0 + 60, width - MARGIN.right);
          return {
            count: horizons.length,
            x0,
            x1,
            arriveAt: "first" as const,
            width: 310,
            read: (index: number) => ({
              title: `Horizon ${horizons[index]}`,
              rows: [
                ...(series !== "call"
                  ? [{ label: "Statement", value: pct(release[index]), raw: release[index] }]
                  : []),
                ...(series !== "release"
                  ? [{ label: "Press conference", value: pct(call[index]), raw: call[index] }]
                  : []),
                ...(release[index] == null && call[index] == null
                  ? [{ label: "Resolution", value: "not measured inside one minute" }]
                  : []),
              ],
            }),
          };
        }}
      >
        {(width) => (
          <Curve
            width={width}
            horizons={horizons}
            release={release}
            call={call}
            stages={stages}
            runs={runs}
            series={series}
          />
        )}
      </Plot>
    </div>
  );
}

function Curve({ width, horizons, release, call, stages, runs, series }:
  AbsorptionCurveProps & { width: number; series: AbsorptionSeries }) {
  const x0 = MARGIN.left;
  const x1 = Math.max(x0 + 60, width - MARGIN.right);
  const y0 = HEIGHT - MARGIN.bottom;
  const y1 = MARGIN.top;

  const highest = Math.max(1, ...[...release, ...call].filter((value): value is number => value != null));
  const xScale = linearScale(0, Math.max(horizons.length - 1, 1), x0, x1);
  const yScale = linearScale(0, highest, y0, y1);
  const yTicks = ticks(0, highest, 4);

  // XAxis takes the DOMAIN values and scales them itself; handing it pixels
  // would place every label at the far right of the plot.
  const points = horizons.map((_, index) => index);
  const summaryOf = (stage: "release" | "call") => stages.find((row) => row.stage === stage);
  const half = yScale(0.5);

  // The translucent shadows are the middle half of the exact floor-cleared
  // runs behind each mean. They follow the line selector and are drawn first,
  // so the uncertainty never covers a mark or an axis.
  const bands = runs?.length
    ? {
        release: absorptionBand(runs, "release", horizons),
        call: absorptionBand(runs, "call", horizons),
      }
    : null;
  const bandFor = (rows: ReturnType<typeof absorptionBand>) =>
    bandPath(
      rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.p25 != null && row.p75 != null)
        .map(({ row, index }) => ({
          x: xScale(index),
          y0: yScale(row.p25 as number),
          y1: yScale(row.p75 as number),
        })),
    );

  return (
    <>
        <Grid yTicks={yTicks} yScale={yScale} x0={x0} x1={x1} format={(value) => pct(value, 0)} />

        {bands && series !== "call" ? (
          <path
            d={bandFor(bands.release)}
            className="diff-curve__band diff-curve__band--release"
            aria-hidden="true"
          />
        ) : null}
        {bands && series !== "release" ? (
          <path
            d={bandFor(bands.call)}
            className="diff-curve__band diff-curve__band--call"
            aria-hidden="true"
          />
        ) : null}

        {/* Drawn only when a path overshot its own terminal and came back, which
            is a real thing a price does. Clipping the axis at one would report
            the overshoot as full absorption and shorten the half-life. */}
        {highest > 1 ? (
          <line x1={x0} x2={x1} y1={yScale(1)} y2={yScale(1)} className="diff-curve__full" />
        ) : null}
        <line x1={x0} x2={x1} y1={half} y2={half} className="diff-curve__half" />
        {/* Reference-line words and the two keys are sized in 14r on the
            diagram ladder (note and legend at 13, gap marks at 12); only the
            chart-kit axis numerals stay on the 10px tick floor. */}
        <text x={x1} y={half - 4} textAnchor="end" className="diff-curve__note">
          half the move
        </text>

        {series !== "call" ? (
          <path d={brokenPath(release, xScale, yScale)} className="diff-curve__release" fill="none" />
        ) : null}
        {series !== "release" ? (
          <path d={brokenPath(call, xScale, yScale)} className="diff-curve__call" fill="none" />
        ) : null}

        {/* A hover line on every dot and every gap mark (fourth review of
            2026-08-24). The two curves cross and the horizon axis is ordinal,
            so reading a point off the grid takes two guesses — which stage,
            and which horizon — and both are in the dot itself now. A gap mark
            says WHY there is no point rather than leaving the reader to infer
            zero absorption, which is the misreading this figure is built to
            refuse. */}
        {horizons.map((horizon, index) => {
          const releaseValue = release[index];
          const callValue = call[index];
          return (
            <g key={horizon}>
              {series !== "call" && releaseValue != null ? (
                <circle cx={xScale(index)} cy={yScale(releaseValue)} r={3}
                        className="diff-curve__dot diff-curve__dot--release" />
              ) : null}
              {series !== "release" && callValue != null ? (
                <circle cx={xScale(index)} cy={yScale(callValue)} r={3}
                        className="diff-curve__dot diff-curve__dot--call" />
              ) : null}
              {releaseValue == null && callValue == null ? (
                <text x={xScale(index)} y={y0 - 6} textAnchor="middle"
                      className="diff-curve__gap" aria-hidden="true">◌</text>
              ) : null}
            </g>
          );
        })}

        <XAxis points={points} y={y0} x0={x0} x1={x1}
               format={(value) => horizons[Math.round(value)] ?? ""} minGap={34} />

        {/* ONE ROW, not two, since 2026-08-27: the two keys measure 179px and
            237px at 14px in a plot over 1500px wide — stacking them was never
            necessary, and it was the stack that left no room for the caption
            gap. Left-anchored at the axis origin, right-anchored at the axis
            end, the `EpisodeTape.tsx` two-key idiom. */}
        {series !== "call" ? <text x={x0} y={MARGIN.top - 12} className="diff-curve__key diff-curve__key--release">
          <tspan aria-hidden="true">●</tspan> statement
          {summaryOf("release")?.median_half_life_s
            ? ` — half in ${Math.round(summaryOf("release")!.median_half_life_s!)}s`
            : ""}
        </text> : null}
        {series !== "release" ? <text x={x1} y={MARGIN.top - 12} textAnchor="end" className="diff-curve__key diff-curve__key--call">
          <tspan aria-hidden="true">▲</tspan> press conference
          {summaryOf("call")?.median_half_life_s
            ? ` — half in ${Math.round(summaryOf("call")!.median_half_life_s!)}s`
            : ""}
        </text> : null}
    </>
  );
}
