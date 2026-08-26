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
import { absorptionBand, bandCoverage } from "@/lib/coherence/absorption-band";
import { pct } from "@/lib/format";

import type { StageRun, StageSummary } from "./types";

const HEIGHT = 210;
const MARGIN = { top: 34, right: 18, bottom: 30, left: 44 };

export interface AbsorptionCurveProps {
  horizons: string[];
  release: (number | null)[];
  call: (number | null)[];
  stages: StageSummary[];
  /**
   * The runs the two curves are the MEAN of, for the spread behind them.
   * Optional: the curves are complete without it, and a caller that has not
   * got the runs draws the means alone rather than an empty band.
   */
  runs?: StageRun[];
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

export default function AbsorptionCurve({ horizons, release, call, stages, runs }: AbsorptionCurveProps) {
  return (
    <Plot height={HEIGHT} minWidth={320}>
      {(width) => <Curve width={width} horizons={horizons} release={release} call={call} stages={stages} runs={runs} />}
    </Plot>
  );
}

function Curve({ width, horizons, release, call, stages, runs }: AbsorptionCurveProps & { width: number }) {
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

  // The spread the two means are means OF, drawn behind them. Same population
  // as the mean by construction — the filter lives in `absorption-band.ts`.
  const bands = runs?.length
    ? ({
        release: absorptionBand(runs, "release", horizons),
        call: absorptionBand(runs, "call", horizons),
      })
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

        {/* The middle half of the runs at each horizon, behind the mean each is
            a mean of. Drawn FIRST so the two lines stay the thing being read. */}
        {bands ? (
          <>
            <path d={bandFor(bands.release)} className="diff-curve__band diff-curve__band--release">
              <title>
                {`The middle half of the statement stages at each horizon — the mean is a mean of paths this far apart`}
              </title>
            </path>
            <path d={bandFor(bands.call)} className="diff-curve__band diff-curve__band--call">
              <title>
                {`The middle half of the press-conference stages at each horizon`}
              </title>
            </path>
          </>
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

        <path d={brokenPath(release, xScale, yScale)} className="diff-curve__release" fill="none" />
        <path d={brokenPath(call, xScale, yScale)} className="diff-curve__call" fill="none" />

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
              {releaseValue != null ? (
                <circle cx={xScale(index)} cy={yScale(releaseValue)} r={3}
                        className="diff-curve__dot diff-curve__dot--release">
                  <title>{`Statement, ${horizon}: ${pct(releaseValue)} of the move arrived`}</title>
                </circle>
              ) : null}
              {callValue != null ? (
                <circle cx={xScale(index)} cy={yScale(callValue)} r={3}
                        className="diff-curve__dot diff-curve__dot--call">
                  <title>{`Press conference, ${horizon}: ${pct(callValue)} of the move arrived`}</title>
                </circle>
              ) : null}
              {releaseValue == null && callValue == null ? (
                <text x={xScale(index)} y={y0 - 6} textAnchor="middle"
                      className="diff-curve__gap" aria-hidden="true">◌
                  <title>{`${horizon}: not measured on either stage — no free bar source resolves it`}</title>
                </text>
              ) : null}
            </g>
          );
        })}

        <XAxis points={points} y={y0} x0={x0} x1={x1}
               format={(value) => horizons[Math.round(value)] ?? ""} minGap={34} />

        <text x={x0} y={13} className="diff-curve__key diff-curve__key--release">
          <tspan aria-hidden="true">●</tspan> statement
          {summaryOf("release")?.median_half_life_s
            ? ` — half in ${Math.round(summaryOf("release")!.median_half_life_s!)}s`
            : ""}
        </text>
        <text x={x0} y={30} className="diff-curve__key diff-curve__key--call">
          <tspan aria-hidden="true">▲</tspan> press conference
          {summaryOf("call")?.median_half_life_s
            ? ` — half in ${Math.round(summaryOf("call")!.median_half_life_s!)}s`
            : ""}
        </text>
    </>
  );
}
