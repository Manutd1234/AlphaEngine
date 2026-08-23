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

import { Grid, XAxis, linearScale, ticks, useMeasuredWidth } from "@/components/chart-kit";
import { pct } from "@/lib/format";

import type { StageSummary } from "./types";

const HEIGHT = 210;
const MARGIN = { top: 34, right: 18, bottom: 30, left: 44 };

export interface AbsorptionCurveProps {
  horizons: string[];
  release: (number | null)[];
  call: (number | null)[];
  stages: StageSummary[];
}

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

export default function AbsorptionCurve({ horizons, release, call, stages }: AbsorptionCurveProps) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
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
  const measured = (curve: (number | null)[]) => curve.filter((value) => value != null).length;

  const half = yScale(0.5);

  return (
    <div ref={ref} className="diff-curve__frame">
      <svg viewBox={`0 0 ${Math.max(width, 320)} ${HEIGHT}`} width="100%" height={HEIGHT}
           role="img"
           aria-label={`Absorbed fraction against horizon for both stages of a rate decision. `
             + `The statement curve has ${measured(release)} of ${horizons.length} horizons measured, `
             + `the press conference ${measured(call)}.`}>
        <Grid yTicks={yTicks} yScale={yScale} x0={x0} x1={x1} format={(value) => pct(value, 0)} />

        {/* Drawn only when a path overshot its own terminal and came back, which
            is a real thing a price does. Clipping the axis at one would report
            the overshoot as full absorption and shorten the half-life. */}
        {highest > 1 ? (
          <line x1={x0} x2={x1} y1={yScale(1)} y2={yScale(1)} className="diff-curve__full" />
        ) : null}
        <line x1={x0} x2={x1} y1={half} y2={half} className="diff-curve__half" />
        <text x={x1} y={half - 4} textAnchor="end" fontSize={10} className="diff-curve__note">
          half the move
        </text>

        <path d={brokenPath(release, xScale, yScale)} className="diff-curve__release" fill="none" />
        <path d={brokenPath(call, xScale, yScale)} className="diff-curve__call" fill="none" />

        {horizons.map((horizon, index) => {
          const releaseValue = release[index];
          const callValue = call[index];
          return (
            <g key={horizon}>
              {releaseValue != null ? (
                <circle cx={xScale(index)} cy={yScale(releaseValue)} r={3}
                        className="diff-curve__dot diff-curve__dot--release" />
              ) : null}
              {callValue != null ? (
                <circle cx={xScale(index)} cy={yScale(callValue)} r={3}
                        className="diff-curve__dot diff-curve__dot--call" />
              ) : null}
              {releaseValue == null && callValue == null ? (
                <text x={xScale(index)} y={y0 - 6} textAnchor="middle" fontSize={10}
                      className="diff-curve__gap" aria-hidden="true">◌</text>
              ) : null}
            </g>
          );
        })}

        <XAxis points={points} y={y0} x0={x0} x1={x1}
               format={(value) => horizons[Math.round(value)] ?? ""} minGap={34} />

        <text x={x0} y={16} fontSize={12} className="diff-curve__key diff-curve__key--release">
          <tspan aria-hidden="true">●</tspan> statement
          {summaryOf("release")?.median_half_life_s
            ? ` — half in ${Math.round(summaryOf("release")!.median_half_life_s!)}s`
            : ""}
        </text>
        <text x={x0} y={30} fontSize={12} className="diff-curve__key diff-curve__key--call">
          <tspan aria-hidden="true">▲</tspan> press conference
          {summaryOf("call")?.median_half_life_s
            ? ` — half in ${Math.round(summaryOf("call")!.median_half_life_s!)}s`
            : ""}
        </text>
      </svg>
    </div>
  );
}
