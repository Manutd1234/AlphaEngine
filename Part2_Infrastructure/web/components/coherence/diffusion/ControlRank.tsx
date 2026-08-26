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
 */

import { memo } from "react";

import Figure, { FigureEmpty, Plot } from "../Figure";
import { STAGE_WORD } from "./AbsorptionGate";
import { percentileWord } from "./FloorDistance";
import type { StageRun } from "./types";

const ROW = 156;
const MARGIN = { top: 36, right: 18, bottom: 8, left: 44 };
const STRIP_H = 30;
const DOT_R = 4.5;
const UNRANKED_W = 26;
const STAGE_MARK: Record<string, string> = { release: "●", call: "▲" };

interface RankedRow {
  readonly stage: "release" | "call";
  readonly ranked: StageRun[];
  readonly unranked: number;
}

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
  const rows = rowsOf(runs);
  const ranked = rows.reduce((total, row) => total + row.ranked.length, 0);
  const unranked = rows.reduce((total, row) => total + row.unranked, 0);
  const height = MARGIN.top + rows.length * ROW + MARGIN.bottom;
  const distinct = new Set(rows.flatMap((row) => row.ranked.map((run) => run.control_percentile))).size;

  return (
    <Figure
      caption="Where each ranked stage sat against matched windows with no news"
      ariaLabel={`${ranked} ranked runs over ${rows.length} stages, each a mark at its control percentile, `
        + `with ${unranked} unranked runs counted off the axis`}
      reading={ranked
        ? `Mass at the left is absorption faster than an ordinary half hour; mass at the middle is a stage that `
          + `finished no faster than the market finishes anything. On this ledger the ${ranked} ranks take `
          + `${distinct} distinct value${distinct === 1 ? "" : "s"}, which is why they are drawn as marks and not as bars.`
        : "No measured stage has a rank yet."}
      missing={unranked
        ? `Only ${ranked} of ${ranked + unranked} measured stages are ranked: the rest had no matched window `
          + "clear the floor, so they sit in the column off the axis rather than at zero — a missing rank is not a rank of nought."
        : null}
    >
      {ranked || unranked ? (
        <Plot height={height} minWidth={480}>
          {(width) => {
            const span = Math.max(120, width - MARGIN.left - MARGIN.right - (unranked ? UNRANKED_W + 14 : 0));
            const x = (p: number) => MARGIN.left + p * span;
            return (
              <>
                {rows.map((row, index) => {
                  const top = MARGIN.top + index * ROW;
                  // The axis sits high in the row; coincident ranks stack DOWNWARD from it
                  // into the room below, and the tick labels sit UNDER that room — room
                  // for nine, because nine statement runs share a rank of 0.0 here. Stacked upward they overprinted the head text on
                  // the live ledger, where nine statement runs share a rank of 0.0.
                  const mid = top + 22 + STRIP_H / 2;
                  const word = STAGE_WORD[row.stage] ?? row.stage;
                  // Coincident ranks stack downward so each stays a mark of its own.
                  const seen = new Map<number, number>();
                  return (
                    <g key={row.stage}>
                      <text className="diff-floor__head" x={MARGIN.left} y={top + 12}>
                        <tspan aria-hidden="true">{STAGE_MARK[row.stage]}</tspan> {word}
                      </text>
                      <text className="diff-floor__count" x={MARGIN.left + span} y={top + 12} textAnchor="end">
                        {row.ranked.length} of {row.ranked.length + row.unranked} ranked
                      </text>

                      <line className="diff-floor__axis" x1={MARGIN.left} x2={MARGIN.left + span} y1={mid} y2={mid} />
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
                        <rect className="diff-rank__unranked" x={MARGIN.left + span + 14} y={mid - STRIP_H / 2}
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
