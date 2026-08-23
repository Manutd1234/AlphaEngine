"use client";

/**
 * Two bars per stage: what was measured, and where it sat against no news.
 *
 * The attrition bar is not a footnote. Most rate decisions move neither stage
 * two pre-event sigmas, so a summary that showed only the stages that cleared
 * the floor would describe a quarter of the sample as though it were all of
 * it. Measured and refused are drawn on the same bar, at the same scale.
 *
 * The percentile bar answers the question the half-life cannot: a stage can be
 * slow because the news was complicated or because the whole hour was quiet.
 * Each stage is placed against matched windows on prior days at the same clock
 * time — 0.0 means faster than every one of them, 0.5 means indistinguishable
 * from an ordinary half hour.
 */

import type { StageSummary } from "./types";

const WORD: Record<string, string> = { release: "Statement", call: "Press conference" };
const MARK: Record<string, string> = { release: "●", call: "▲" };

function percentileWord(value: number | null): string {
  if (value == null) return "no matched window cleared the floor";
  if (value <= 0.1) return "faster than nearly every window with no news in it";
  if (value <= 0.35) return "faster than most windows with no news in it";
  if (value < 0.65) return "indistinguishable from a window with no news in it";
  return "slower than most windows with no news in it";
}

export default function StageBars({ stages }: { stages: StageSummary[] }) {
  const widest = Math.max(1, ...stages.map((stage) => stage.measured + stage.no_signal + stage.other));
  return (
    <div className="diff-bars">
      {stages.map((stage) => {
        const total = stage.measured + stage.no_signal + stage.other;
        const share = (count: number) => `${((count / widest) * 100).toFixed(1)}%`;
        return (
          <div className="diff-bars__row" key={stage.stage}>
            <div className="diff-bars__head">
              <span aria-hidden="true">{MARK[stage.stage]}</span> {WORD[stage.stage]}
              <span className="diff-bars__count">
                {stage.measured} of {total} stages cleared the noise floor
              </span>
            </div>
            <div className="diff-bars__track" role="img"
                 aria-label={`${WORD[stage.stage]}: ${stage.measured} measured, ${stage.no_signal} below the floor`}>
              <span className="diff-bars__fill diff-bars__fill--measured" style={{ width: share(stage.measured) }} />
              <span className="diff-bars__fill diff-bars__fill--refused" style={{ width: share(stage.no_signal + stage.other) }} />
            </div>
            <div className="diff-bars__foot">
              {stage.median_half_life_s != null ? (
                <span className="num">half absorbed in {Math.round(stage.median_half_life_s)}s</span>
              ) : (
                <span className="muted">{stage.reason ?? "no half-life was resolved"}</span>
              )}
              <span className="diff-bars__percentile">
                {stage.median_control_percentile != null ? (
                  <>
                    <span className="num">{stage.median_control_percentile.toFixed(2)}</span>{" "}
                    {percentileWord(stage.median_control_percentile)}
                  </>
                ) : (
                  <span className="muted">{percentileWord(null)}</span>
                )}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
