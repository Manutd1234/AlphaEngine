"use client";

/**
 * Seven relationships against two stages, the signed t in every cell.
 *
 * WHAT THIS REPLACED. The table view opened on a `ValueStrip` of `Finding.n`:
 * fourteen bars carrying three distinct values — 61, 26 and 29 — under a
 * caption about how many meetings sat behind each verdict. That is one number
 * per row wearing a chart, and the table folded beneath it already printed the
 * same column.
 *
 * THE PAIRING IS THE SHAPE. Every relationship was measured twice, once on the
 * statement and once on the press conference, and the question a reader brings
 * to the table is whether the two agree. Laid out as a grid — a row per
 * relationship, a column per stage — the answer is one glance: the control
 * clears the band in both columns and every null sits inside it in both. A
 * relationship that held in one stage only would show as a row with one bar
 * out and one in, which no list of fourteen rows makes visible.
 *
 * Each cell is one signed bar from the column's own zero, the ±2 band behind
 * it, the verdict as a mark and the count in words beside the bar. A cell with
 * no measurement is hatched and says so; it is never a bar of length nought.
 */

import { memo } from "react";

import { DIAGRAM_LABEL_PX, advancePx, gutterFor, truncateMiddle } from "@/lib/coherence/label-metrics";
import { fmt } from "@/lib/format";
import Figure, { FigureEmpty, Plot } from "../Figure";
import { STAGE_WORD } from "./AbsorptionGate";
import type { Finding } from "./types";

const MARGIN = { top: 34, right: 18, bottom: 30 };
// 22, the pitch `ValueStrip` uses for a 13px label, not 30: fourteen rows at
// 30 spent 112px on air the labels did not need. `BAR_H` stays 12, so a bar
// still clears its row by 5px either side.
const ROW = 22;
const BAR_H = 12;
const COL_GAP = 28;
/** Beyond this a column stops growing; a larger t is drawn at the edge with its value in the title. */
const AXIS_MAX = 5;
const BAND_T = 2;
const STAGES = ["release", "call"] as const;
const STAGE_MARK: Record<string, string> = { release: "●", call: "▲" };
const VERDICT_MARK: Record<Finding["verdict"], string> = { holds: "✓", absent: "✗", not_assessable: "◌" };
const VERDICT_WORD: Record<Finding["verdict"], string> = {
  holds: "holds",
  absent: "absent",
  not_assessable: "not assessable",
};

interface MatrixRow {
  readonly name: string;
  readonly question: string;
  readonly cells: { release: Finding | null; call: Finding | null };
}

function rowsOf(findings: readonly Finding[]): MatrixRow[] {
  const byName = new Map<string, MatrixRow>();
  for (const row of findings) {
    const entry = byName.get(row.name)
      ?? { name: row.name, question: row.question, cells: { release: null, call: null } };
    // `both` is a stage the wire may send; it fills both columns.
    for (const stage of STAGES) if (row.stage === stage || row.stage === "both") entry.cells[stage] = row;
    byName.set(row.name, entry);
  }
  return [...byName.values()];
}

function EvidenceMatrix({ findings }: { findings: readonly Finding[] }) {
  const rows = rowsOf(findings);
  const cells = rows.flatMap((row) => STAGES.map((stage) => row.cells[stage]));
  const drawn = cells.filter((cell) => cell && cell.t_statistic != null).length;
  const blank = cells.length - drawn;
  const paired = rows.filter((row) => row.cells.release && row.cells.call);
  const agree = paired.filter((row) => row.cells.release?.verdict === row.cells.call?.verdict);
  const split = paired.filter((row) => row.cells.release?.verdict !== row.cells.call?.verdict);
  const height = MARGIN.top + rows.length * ROW + MARGIN.bottom;

  return (
    <Figure
      caption="Every relationship in both stages, its signed t against the band a shuffled pairing would reach"
      ariaLabel={`${rows.length} relationships by ${STAGES.length} stages, ${drawn} cells drawn as signed t bars`
        + (blank ? `, ${blank} hatched as unmeasured` : "")}
      reading={rows.length
        ? `${agree.length} of ${paired.length} paired relationships read the same in both stages`
          + (split.length
            ? `; ${split.length} read differently: ${split.map((row) => row.name).join(", ")}.`
            : ", so no null here is a statement-only or a conference-only result.")
        : null}
      missing={blank
        ? `${blank} of ${cells.length} cells have no measurement and are hatched rather than drawn at nought.`
        : null}
    >
      {rows.length ? (
        <Plot height={height} minWidth={560}>
          {(width) => {
            const gutter = gutterFor(rows.map((row) => row.name), width, DIAGRAM_LABEL_PX, {
              // 320, not 280: the widest live name is 38 characters and needs
              // about 290px at the label rung; capped at 280 it elided to
              // "resolution centro… absorption speed" at every desk width.
              min: 120, max: 320, maxFraction: 0.34, clearance: 16,
            });
            const span = Math.max(240, width - gutter - MARGIN.right);
            const colW = (span - COL_GAP) / STAGES.length;
            const colLeft = (col: number) => gutter + col * (colW + COL_GAP);
            const x = (col: number, t: number) =>
              colLeft(col) + ((Math.max(-AXIS_MAX, Math.min(AXIS_MAX, t)) + AXIS_MAX) / (2 * AXIS_MAX)) * colW;
            const base = MARGIN.top + rows.length * ROW;
            // The count sits past the bar's end when there is room for it in
            // the column and its gap, and on the other side of zero when there
            // is not — the control's bar takes nine tenths of a half column,
            // and past it at desk widths under 700px the words left the plot.
            const countAt = (col: number, t: number, text: string) => {
              const w = advancePx(text, DIAGRAM_LABEL_PX);
              const x0 = x(col, 0);
              const xt = x(col, t);
              if (t >= 0) {
                return xt + 6 + w <= colLeft(col) + colW + COL_GAP - 4
                  ? { x: xt + 6, anchor: "start" as const }
                  : { x: x0 - 6, anchor: "end" as const };
              }
              return xt - 6 - w >= colLeft(col) + 2
                ? { x: xt - 6, anchor: "end" as const }
                : { x: x0 + 6, anchor: "start" as const };
            };

            return (
              <>
                {STAGES.map((stage, col) => (
                  <g key={stage}>
                    <text className="diff-matrix__head" x={colLeft(col)} y={MARGIN.top - 10}>
                      <tspan aria-hidden="true">{STAGE_MARK[stage]}</tspan> {STAGE_WORD[stage] ?? stage}
                    </text>
                    <rect className="diff-band" x={x(col, -BAND_T)} y={MARGIN.top}
                          width={x(col, BAND_T) - x(col, -BAND_T)} height={rows.length * ROW}>
                      <title>{`${STAGE_WORD[stage] ?? stage}: inside this band a shuffled pairing reaches the same t about as often`}</title>
                    </rect>
                    <line className="diff-matrix__zero" x1={x(col, 0)} x2={x(col, 0)} y1={MARGIN.top} y2={base} />
                    <line className="diff-matrix__axis" x1={colLeft(col)} x2={colLeft(col) + colW} y1={base} y2={base} />
                    {[-4, -2, 0, 2, 4].map((t) => (
                      <text key={t} className="coh-ladder__tick" x={x(col, t)} y={base + 14} textAnchor="middle">
                        {t > 0 ? `+${t}` : t}
                      </text>
                    ))}
                  </g>
                ))}

                {rows.map((row, index) => {
                  const mid = MARGIN.top + index * ROW + ROW / 2;
                  return (
                    <g key={row.name}>
                      <text className="diff-matrix__row" x={gutter - 12} y={mid + 4} textAnchor="end">
                        <title>{`${row.name} — ${row.question}`}</title>
                        {/* The label ends at `gutter - 12`, so that is its room, less two.
                            It was `gutter - 18` against a clearance of 16, and the widest
                            name was two pixels over its own budget at every width. */}
                        {truncateMiddle(row.name, gutter - 14, DIAGRAM_LABEL_PX)}
                      </text>
                      {STAGES.map((stage, col) => {
                        const cell = row.cells[stage];
                        const word = STAGE_WORD[stage] ?? stage;
                        if (!cell || cell.t_statistic == null) {
                          return (
                            <rect key={stage} className="diff-matrix__unmeasured" x={colLeft(col) + 1}
                                  y={mid - BAR_H / 2} width={colW - 2} height={BAR_H}>
                              <title>
                                {`${row.name}, ${word}: ${cell
                                  ? `${VERDICT_WORD[cell.verdict]} on ${cell.n} meetings, no t reported`
                                  : "not measured"}`}
                              </title>
                            </rect>
                          );
                        }
                        const t = cell.t_statistic;
                        const x0 = x(col, 0);
                        const xt = x(col, t);
                        const filled = cell.verdict === "holds";
                        const count = `${VERDICT_MARK[cell.verdict]} n ${cell.n}`;
                        const at = countAt(col, t, count);
                        const title = `${row.name}, ${word}: t ${t > 0 ? "+" : ""}${fmt(t, 2)}, n ${cell.n}`
                          + (cell.shuffled_p != null
                            ? `, p ${cell.shuffled_p === 0 ? "under 0.001" : fmt(cell.shuffled_p, 3)}`
                            : "")
                          + ` — ${VERDICT_WORD[cell.verdict]}`;
                        return (
                          <g key={stage}>
                            <rect className={`diff-matrix__bar diff-matrix__bar--${stage}${filled ? "" : " is-absent"}`}
                                  x={Math.min(x0, xt)} y={mid - BAR_H / 2}
                                  width={Math.max(1.5, Math.abs(xt - x0))} height={BAR_H}>
                              <title>{title}</title>
                            </rect>
                            <text className="diff-matrix__n" x={at.x} y={mid + 4} textAnchor={at.anchor}>
                              <tspan aria-hidden="true">{VERDICT_MARK[cell.verdict]}</tspan> n {cell.n}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  );
                })}
              </>
            );
          }}
        </Plot>
      ) : (
        <FigureEmpty reason="Nothing has been measured yet." />
      )}
    </Figure>
  );
}

export default memo(EvidenceMatrix);
