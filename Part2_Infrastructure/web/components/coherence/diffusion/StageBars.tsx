"use client";

/**
 * Two bars per stage: what was measured, and where it sat against no news.
 *
 * The attrition bar is not a footnote. Most rate decisions move neither stage
 * two pre-event sigmas, so a summary that showed only the stages that cleared
 * the floor would describe a quarter of the sample as though it were all of
 * it. Measured and refused are drawn on the same bar, at the same scale.
 *
 * SVG INSIDE `<Plot>` SINCE 2026-08-25, and the reason is a measurement rather
 * than a preference. This was HTML with `title` ATTRIBUTES, and
 * `useMarkReadout` collects SVG `<title>` CHILDREN — so the twenty-six facts on
 * the Control view were reachable by mouse and by nothing else. Measured: that
 * view had 26 hoverable titles and 0 keyboard stops, one of three views on the
 * tab in that state. Through `<Plot>` the figure gets the tab stop, the arrow
 * walk, the positioned readout and the announcement every other figure here
 * already had.
 *
 * The geometry is what it was: one track per stage at one scale, measured and
 * refused on the same bar. What changes is the medium and what a keyboard can
 * reach.
 *
 * The percentile bar answers the question the half-life cannot: a stage can be
 * slow because the news was complicated or because the whole hour was quiet.
 * Each stage is placed against matched windows on prior days at the same clock
 * time — 0.0 means faster than every one of them, 0.5 means indistinguishable
 * from an ordinary half hour.
 */

import { Plot } from "../Figure";
import type { StageSummary } from "./types";

const WORD: Record<string, string> = { release: "Statement", call: "Press conference" };
const MARK: Record<string, string> = { release: "●", call: "▲" };

/** The vocabulary for the control-percentile axis, owned here and shared.
 *  `FloorDistribution` draws the same axis as a distribution and imports this
 *  rather than writing a second set of words — two figures describing one
 *  number differently is how an axis stops meaning one thing. */
export function percentileWord(value: number | null): string {
  if (value == null) return "no matched window cleared the floor";
  if (value <= 0.1) return "faster than nearly every no-news window";
  if (value <= 0.35) return "faster than most no-news windows";
  if (value < 0.65) return "indistinguishable from a no-news window";
  return "slower than most no-news windows";
}

const ROW = 74;
const PAD = { top: 6, bottom: 4, left: 0, right: 0 };
const TRACK = 11;

export default function StageBars({ stages }: { stages: StageSummary[] }) {
  const widest = Math.max(1, ...stages.map((stage) => stage.measured + stage.no_signal + stage.other));
  const height = PAD.top + stages.length * ROW + PAD.bottom;

  return (
    <Plot height={height} minWidth={420}>
      {(width) => (
        <>
          {stages.map((stage, index) => {
            const total = stage.measured + stage.no_signal + stage.other;
            const top = PAD.top + index * ROW;
            const trackY = top + 24;
            const span = Math.max(60, width - PAD.left - PAD.right);
            const w = (count: number) => (count / widest) * span;
            const word = WORD[stage.stage] ?? stage.stage;
            return (
              <g key={stage.stage}>
                <text className="diff-bars__svghead" x={PAD.left} y={top + 13}>
                  {MARK[stage.stage]} {word}
                </text>
                <text className="diff-bars__svgcount" x={PAD.left + span} y={top + 13} textAnchor="end">
                  {stage.measured} of {total} stages cleared the noise floor
                </text>

                {/* The empty track behind both fills, so a stage that measured
                    nothing still draws a bar rather than nothing at all. */}
                <rect className="diff-bars__svgtrack" x={PAD.left} y={trackY} width={span} height={TRACK} />
                <rect className="diff-bars__svgfill diff-bars__svgfill--measured"
                      x={PAD.left} y={trackY} width={w(stage.measured)} height={TRACK}>
                  <title>{`${word}: ${stage.measured} of ${total} cleared the noise floor`}</title>
                </rect>
                <rect className="diff-bars__svgfill diff-bars__svgfill--refused"
                      x={PAD.left + w(stage.measured)} y={trackY}
                      width={w(stage.no_signal + stage.other)} height={TRACK}>
                  <title>
                    {`${word}: ${stage.no_signal} moved too little to measure`
                      + (stage.other ? `, ${stage.other} refused otherwise` : "")
                      + " — counted, not dropped"}
                  </title>
                </rect>

                <text className="diff-bars__svgfoot" x={PAD.left} y={trackY + TRACK + 18}>
                  {stage.median_half_life_s != null
                    ? `half absorbed in ${Math.round(stage.median_half_life_s)}s`
                    : (stage.reason ?? "no half-life was resolved")}
                </text>
                <text className="diff-bars__svgfoot" x={PAD.left + span} y={trackY + TRACK + 18} textAnchor="end">
                  {stage.median_control_percentile != null
                    ? `${stage.median_control_percentile.toFixed(2)} ${percentileWord(stage.median_control_percentile)}`
                    : percentileWord(null)}
                </text>
              </g>
            );
          })}
        </>
      )}
    </Plot>
  );
}
