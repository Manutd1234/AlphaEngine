"use client";

/**
 * Where each ranked stage sat against matched windows with no news.
 *
 * WHAT THIS REPLACED, and why the shape had to change. `FloorDistribution`
 * bucketed `control_percentile` into ten bins across [0, 1]. On the live
 * ledger the field takes exactly two values — `0.0` on 13 runs and `1.0` on 6
 * — so eight of the ten bins were height-zero rects that still carried a
 * title and a keyboard stop each, and the `is-middle` highlight marked an
 * empty bar. A histogram of nineteen points at two positions is not a
 * distribution; it is two counts wearing a histogram's clothes.
 *
 * A DOT STRIP IS THE HONEST DRAWING. Each ranked run is one mark at its
 * percentile, stacked where they coincide, so "nine at zero and two at one"
 * is what a reader sees rather than what a reader has to infer from bar
 * heights. The 0.5 rule — "indistinguishable from an ordinary half hour" —
 * stays, because that is the reading the axis exists for.
 *
 * THE UNRANKED STAY OFF THE AXIS. 70 of 89 measured runs have no percentile:
 * no matched window cleared the floor, so there was no population to rank
 * against. A missing rank is not a rank of zero, and zero on this axis means
 * "faster than every no-news window" — the opposite of what an absent rank
 * means. They are counted in their own column with the reason, never bucketed.
 *
 * `percentileWord` is imported from `FloorDistance`, where it moved with the
 * attrition figure, so the two axes on this view keep one vocabulary.
 *
 * SIDE BY SIDE, NOT STACKED, since 2026-08-27, the same move `FloorDistance`
 * made one commit over: two full-width rows become two half-width panels at
 * one row's height. `ROW` is unchanged — it was set by the worst-case stack
 * (nine statement runs sharing a rank of 0.0) and that stack is exactly as
 * tall sideways as it was stacked; only the axis carrying the stage split
 * moved.
 */

import { memo, useState } from "react";

import Figure, { FigureEmpty, Plot } from "../Figure";
import { STAGE_WORD } from "./AbsorptionGate";
import { percentileWord } from "./FloorDistance";
import type { StageRun } from "./types";

const ROW = 156;
const MARGIN = { top: 36, right: 18, bottom: 8, left: 44 };
const STRIP_H = 30;
const DOT_R = 4.5;
const UNRANKED_W = 26;
/** Between the two panels — the `ReturnFan.tsx` `ALLEY` idiom, same value. */
const PANEL_GAP = 40;
const STAGE_MARK: Record<string, string> = { release: "●", call: "▲" };

interface RankedRow {
  readonly stage: "release" | "call";
  readonly ranked: StageRun[];
  readonly unranked: number;
}

export type ControlRankStage = "both" | "release" | "call";

function rowsOf(runs: readonly StageRun[]): RankedRow[] {
  return (["release", "call"] as const)
    .map((stage) => {
      const measured = runs.filter((run) => run.stage === stage && run.signal_state === "ok");
      return {
        stage,
        ranked: measured.filter((run) => run.control_percentile != null),
        unranked: measured.filter((run) => run.control_percentile == null).length,
      };
    })
    .filter((row) => row.ranked.length || row.unranked);
}

function ControlRank({ runs }: { runs: readonly StageRun[] }) {
  const [stageMode, setStageMode] = useState<ControlRankStage>("both");
  const rows = rowsOf(runs);
  const ranked = rows.reduce((total, row) => total + row.ranked.length, 0);
  const unranked = rows.reduce((total, row) => total + row.unranked, 0);
  const height = MARGIN.top + ROW + MARGIN.bottom;
  const distinct = new Set(rows.flatMap((row) => row.ranked.map((run) => run.control_percentile))).size;
  const focused = rows
    .filter((row) => stageMode === "both" || row.stage === stageMode)
    .reduce((total, row) => total + row.ranked.length, 0);

  return (
    <Figure
      caption="Where each ranked stage sat against matched windows with no news"
      ariaLabel={`${ranked} ranked runs over ${rows.length} stages, each a mark at its control percentile, `
        + `with ${unranked} unranked runs counted off the axis`}
      reading={ranked
        ? `Left is faster than an ordinary half hour; the middle is no faster than the market moves anyway. `
          + `The ${ranked} ranks take ${distinct} distinct value${distinct === 1 ? "" : "s"}, so they are marks, not bars.`
        : "No measured stage has a rank yet."}
      missing={unranked
        ? `Only ${ranked} of ${ranked + unranked} measured stages are ranked: the rest had no matched window `
          + "clear the floor, so they sit in the column off the axis rather than at zero — a missing rank is not a rank of nought."
        : null}
    >
      <div className="diff-lens diff-lens--inside" role="group" aria-label="Control percentile stages">
        {(["both", "release", "call"] as const).map((option) => (
          <button key={option} type="button" aria-pressed={stageMode === option}
                  onClick={() => setStageMode(option)}>
            {option === "both" ? "Both stages" : option === "release" ? "Statement" : "Conference"}
          </button>
        ))}
        <span className="diff-lens__readout" aria-live="polite">{focused} ranked</span>
      </div>
      {ranked || unranked ? (
        <Plot height={height} minWidth={560} scrollLabel="Control percentile diagram">
          {(width) => {
            const span = Math.max(120, width - MARGIN.left - MARGIN.right);
            const panelWidth = rows.length > 1 ? (span - PANEL_GAP) / rows.length : span;
            return (
              <>
                {rows.map((row, index) => {
                  const active = stageMode === "both" || stageMode === row.stage;
                  const left = MARGIN.left + index * (panelWidth + PANEL_GAP);
                  const rowUnrankedGap = row.unranked ? UNRANKED_W + 14 : 0;
                  const rowSpan = Math.max(60, panelWidth - rowUnrankedGap);
                  const x = (p: number) => left + p * rowSpan;
                  const top = MARGIN.top;
                  // The axis sits high in the row; coincident ranks stack DOWNWARD from it
                  // into the room below, and the tick labels sit UNDER that room — room
                  // for nine, because nine statement runs share a rank of 0.0 here.
                  const mid = top + 22 + STRIP_H / 2;
                  const word = STAGE_WORD[row.stage] ?? row.stage;
                  // Coincident ranks stack downward so each stays a mark of its own.
                  const seen = new Map<number, number>();
                  if (!active) return <g key={row.stage} />;
                  return (
                    <g key={row.stage} className="diff-rank__panel">
                      <text className="diff-floor__head" x={left} y={top + 12}>
                        <tspan aria-hidden="true">{STAGE_MARK[row.stage]}</tspan> {word}
                      </text>
                      <text className="diff-floor__count" x={left + panelWidth} y={top + 12} textAnchor="end">
                        {row.ranked.length} of {row.ranked.length + row.unranked} ranked
                      </text>

                      <line className="diff-floor__axis" x1={left} x2={left + rowSpan} y1={mid} y2={mid} />
                      <line className="diff-rank__half" x1={x(0.5)} x2={x(0.5)} y1={mid - STRIP_H / 2} y2={mid + STRIP_H / 2}>
                        <title>{`0.5 — ${percentileWord(0.5)}`}</title>
                      </line>

                      {row.ranked.map((run) => {
                        const p = run.control_percentile as number;
                        const key = Math.round(p * 100);
                        const stack = seen.get(key) ?? 0;
                        seen.set(key, stack + 1);
                        return (
                          <circle
                            key={run.run_id}
                            className={`diff-rank__dot diff-rank__dot--${row.stage}`}
                            cx={x(p)}
                            cy={mid + DOT_R + 2 + stack * (DOT_R * 2 + 1)}
                            r={DOT_R}
                          >
                            <title>{`${run.source_ref} ${run.symbol}: ${p.toFixed(2)}, ${percentileWord(p)}`}</title>
                          </circle>
                        );
                      })}

                      {row.unranked ? (
                        <rect className="diff-rank__unranked" x={left + rowSpan + 14} y={mid - STRIP_H / 2}
                              width={UNRANKED_W} height={STRIP_H}>
                          <title>{`${row.unranked} ${word} run${row.unranked === 1 ? "" : "s"} with no percentile: ${percentileWord(null)}`}</title>
                        </rect>
                      ) : null}

                      <text className="coh-ladder__tick" x={x(0)} y={mid + DOT_R + 2 + 9 * (DOT_R * 2 + 1) + 12}>0.0 faster</text>
                      <text className="coh-ladder__tick" x={x(0.5)} y={mid + DOT_R + 2 + 9 * (DOT_R * 2 + 1) + 12} textAnchor="middle">
                        0.5 indistinguishable
                      </text>
                      <text className="coh-ladder__tick" x={x(1)} y={mid + DOT_R + 2 + 9 * (DOT_R * 2 + 1) + 12} textAnchor="end">1.0 slower</text>
                    </g>
                  );
                })}
              </>
            );
          }}
        </Plot>
      ) : (
        <FigureEmpty reason="No stage has been ranked against a control window yet." />
      )}
    </Figure>
  );
}

export default memo(ControlRank);
