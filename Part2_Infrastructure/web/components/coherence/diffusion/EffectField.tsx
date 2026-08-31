"use client";

/**
 * Every measured relationship placed by two numbers, so the sample behind each
 * null is the shape of the figure and not a footnote.
 *
 * WHAT THIS REPLACED. `EffectPlot` drew each row's `t` on one shared axis with
 * the ±2 band behind it — fourteen dots on fourteen rows, `shuffled_p` in the
 * hover and `n` on a different button. A reader could see that twelve rows sat
 * inside the band, and not that every one of them rested on 26 or 29 meetings
 * while the two outside it rested on 61. That is the section's most important
 * caveat, and no figure carried it.
 *
 * TWO AXES AND AN AREA. `t` across, with the same ±2 band; `shuffled_p` up,
 * with the 0.05 rule; and each mark's AREA from `n`, so the controls are the
 * two large marks alone above the rule and the nulls are twelve smaller ones
 * in a cloud under it. Stage is the mark's SHAPE — a circle for the statement,
 * a triangle for the press conference, the pair the Control view already uses
 * — and the verdict is filled against hollow, so nothing here rests on hue.
 *
 * WHY THE p AXIS IS LINEAR. A log axis is the convention for p, and on this
 * payload it is the wrong drawing: the twelve nulls span p 0.26 to 0.95, which
 * a log scale down to 0.001 folds into the bottom fifth of the plot, where they
 * overprint each other. Linear, they take seventy per cent of the height, and
 * the one p of exactly zero — no shuffle reached the control's t — sits on the
 * top edge with no clamp inventing a floor for it.
 *
 * THE NOTES ARE COUNTED, NOT SCATTERED. Ten of the fourteen rows carry a
 * `Finding.note`, and there are two distinct sentences among them. Ten marks
 * beside ten points in a cloud would be clutter; two lines under the axis,
 * each counting the rows it applies to and carrying its full sentence, is the
 * same information read once.
 */

import { memo, useState } from "react";

import { DIAGRAM_LABEL_PX, truncateMiddle } from "@/lib/coherence/label-metrics";
import { fmt } from "@/lib/format";
import Figure, { FigureEmpty, Plot } from "../Figure";
import { STAGE_WORD } from "./AbsorptionGate";
import type { Finding } from "./types";

const MARGIN = { top: 40, right: 24, bottom: 108, left: 52 };
const PLOT_H = 220;
/** Beyond this the t axis stops growing; a larger t is drawn at the edge with its value in the title. */
const AXIS_MAX = 5;
/** Where "distinguishable from a shuffled pairing" starts, in t. */
const BAND_T = 2;
/** The one rule on the p axis. */
const P_RULE = 0.05;
/** Mark AREA scales with n: r = sqrt(n) × this. Sixty-one meetings draw at r 9, twenty-six at r 5.9. */
const R_PER_SQRT_N = 1.15;

export type EvidenceStage = "all" | "release" | "call";

export function qualifyingEvidence(
  findings: readonly Finding[],
  stage: EvidenceStage,
  minAbsT: number,
  maxP: number,
): Finding[] {
  return findings.filter((row) =>
    (stage === "all" || row.stage === "both" || row.stage === stage)
    && row.t_statistic != null
    && row.shuffled_p != null
    && Math.abs(row.t_statistic) >= minAbsT
    && row.shuffled_p <= maxP,
  );
}

const VERDICT_WORD: Record<Finding["verdict"], string> = {
  holds: "holds",
  absent: "absent",
  not_assessable: "not assessable",
};

interface Placed {
  readonly row: Finding;
  readonly t: number;
  readonly p: number;
}

function placed(findings: readonly Finding[]): Placed[] {
  const out: Placed[] = [];
  for (const row of findings) {
    if (row.t_statistic == null || row.shuffled_p == null) continue;
    out.push({ row, t: row.t_statistic, p: row.shuffled_p });
  }
  return out;
}

/** p is reported to three places; a p of exactly zero is "no shuffle reached it", not 0.000. */
function pWord(p: number): string {
  return p === 0 ? "under 0.001" : fmt(p, 3);
}

/** A triangle of the same area as a circle of radius r, apex up, centred on (cx, cy). */
function triangle(cx: number, cy: number, r: number): string {
  const side = r * Math.sqrt((4 * Math.PI) / Math.sqrt(3));
  const height = (side * Math.sqrt(3)) / 2;
  return `M${cx},${cy - (2 * height) / 3} L${cx + side / 2},${cy + height / 3} L${cx - side / 2},${cy + height / 3} Z`;
}

/** The distinct note sentences on the wire, each with the number of rows that carry it. */
function noteGroups(findings: readonly Finding[]): { note: string; rows: number }[] {
  const seen = new Map<string, number>();
  for (const row of findings) if (row.note) seen.set(row.note, (seen.get(row.note) ?? 0) + 1);
  return [...seen].map(([note, rows]) => ({ note, rows }));
}

function EffectField({ findings }: { findings: readonly Finding[] }) {
  const [stage, setStage] = useState<EvidenceStage>("all");
  const [minAbsT, setMinAbsT] = useState(BAND_T);
  const [maxP, setMaxP] = useState(P_RULE);
  const allPoints = placed(findings);
  const tSliderMax = Math.max(
    AXIS_MAX,
    Math.ceil(Math.max(0, ...allPoints.map((point) => Math.abs(point.t))) * 4) / 4,
  );
  const points = allPoints.filter((point) =>
    stage === "all" || point.row.stage === "both" || point.row.stage === stage,
  );
  const undrawn = findings.length - allPoints.length;
  const holds = points.filter((pt) => pt.row.verdict === "holds");
  const nulls = points.filter((pt) => pt.row.verdict !== "holds");
  const qualifying = qualifyingEvidence(findings, stage, minAbsT, maxP);
  const qualifyingKeys = new Set(qualifying.map((row) => `${row.name}-${row.stage}`));
  const holdN = [...new Set(holds.map((pt) => pt.row.n))].sort((a, b) => a - b);
  const nullN = [...new Set(nulls.map((pt) => pt.row.n))].sort((a, b) => a - b);
  const notes = noteGroups(findings);
  const height = MARGIN.top + PLOT_H + MARGIN.bottom;
  const list = (ns: number[]) => ns.join(" or ");
  // Derived, never asserted: the sample clause changes with the ledger.
  const share = holdN.length && nullN.length ? Math.max(...nullN) / Math.min(...holdN) : null;
  const sizeClause = share == null
    ? ""
    : share < 0.5
      ? " — under half the sample that found the control"
      : share < 1
        ? " — a smaller sample than the one that found the control"
        : "";

  return (
    <Figure
      caption="Every relationship by its t statistic and its shuffled p, each mark sized by the meetings behind it"
      ariaLabel={`${points.length} relationships placed by t across and shuffled p up; ${holds.length} hold, `
        + `${nulls.length} sit inside the band a shuffled pairing reaches`}
      reading={points.length
        ? holds.length
          ? `The ${holds.length} that clear the band rest on ${list(holdN)} meetings; every null rests on `
            + `${list(nullN)}${sizeClause}. The mark sizes say so before the numbers do.`
          : "Nothing clears the band, the control included — so no row can be read as absence rather than broken measurement."
        : null}
      missing={undrawn
        ? `${undrawn} relationship${undrawn === 1 ? "" : "s"} carried no t or no p and ${undrawn === 1 ? "is" : "are"} `
          + `not placed; the table counts ${undrawn === 1 ? "it" : "them"}.`
        : null}
    >
      <div className="diff-evidence-controls">
        <div className="diff-lens diff-lens--inside" role="group" aria-label="Evidence stages">
          {(["all", "release", "call"] as const).map((option) => (
            <button key={option} type="button" aria-pressed={stage === option}
                    onClick={() => setStage(option)}>
              {option === "all" ? "All stages" : option === "release" ? "Statement" : "Conference"}
            </button>
          ))}
          <span className="diff-lens__readout" aria-live="polite">{qualifying.length} clear rules</span>
        </div>
        <label>
          <span>Minimum |t|</span><strong className="num">{minAbsT.toFixed(1)}</strong>
          <input type="range" aria-label="Minimum absolute t" min={0} max={tSliderMax} step={0.25}
                 value={minAbsT} onChange={(event) => setMinAbsT(Number(event.currentTarget.value))} />
        </label>
        <label>
          <span>Maximum shuffled p</span><strong className="num">{maxP.toFixed(2)}</strong>
          <input type="range" aria-label="Maximum shuffled p" min={0} max={1} step={0.01}
                 value={maxP} onChange={(event) => setMaxP(Number(event.currentTarget.value))} />
        </label>
      </div>
      {points.length ? (
        <Plot height={height}>
          {(width) => {
            const span = Math.max(160, width - MARGIN.left - MARGIN.right);
            const x = (t: number) =>
              MARGIN.left + ((Math.max(-AXIS_MAX, Math.min(AXIS_MAX, t)) + AXIS_MAX) / (2 * AXIS_MAX)) * span;
            const y = (p: number) => MARGIN.top + Math.min(1, Math.max(0, p)) * PLOT_H;
            const base = MARGIN.top + PLOT_H;
            const rOf = (n: number) => Math.max(3, Math.sqrt(Math.max(0, n)) * R_PER_SQRT_N);
            const label = (pt: Placed) => `${pt.row.name}, ${STAGE_WORD[pt.row.stage] ?? pt.row.stage}`;
            // The rows that hold are named beside their marks; the nulls are a
            // cloud and are named by the matrix and the table instead. Two
            // holds on one p share a baseline, so a label under another is
            // stepped down rather than printed through it — 17px, because a
            // 13px label's box is 16px tall and 15 printed the two together.
            let lastLabelY = -Infinity;

            return (
              <>
                <text className="coh-svg-label" x={MARGIN.left} y={MARGIN.top - 22}>shuffled p</text>
                <text className="coh-svg-note" x={x(0)} y={MARGIN.top - 8} textAnchor="middle">chance could do this</text>
                <rect className="diff-band" x={x(-minAbsT)} y={MARGIN.top} width={x(minAbsT) - x(-minAbsT)} height={PLOT_H}>
                  <title>Inside this band a shuffled pairing reaches the same t about as often</title>
                </rect>
                <line className="diff-field__zero" x1={x(0)} x2={x(0)} y1={MARGIN.top} y2={base} />
                <line className="diff-field__rule" x1={MARGIN.left} x2={MARGIN.left + span} y1={y(maxP)} y2={y(maxP)}>
                  <title>{`p ${maxP.toFixed(2)}: adjustable shuffled-p evidence rule`}</title>
                </line>
                <text className="coh-ladder__tick" x={MARGIN.left + 4} y={y(maxP) - 4}>{`p ${maxP.toFixed(2)}`}</text>
                <line className="diff-field__axis" x1={MARGIN.left} x2={MARGIN.left + span} y1={base} y2={base} />
                <line className="diff-field__axis" x1={MARGIN.left} x2={MARGIN.left} y1={MARGIN.top} y2={base} />
                {[0, 0.25, 0.5, 0.75, 1].map((p) => (
                  <text key={p} className="coh-ladder__tick" x={MARGIN.left - 6} y={y(p) + 4} textAnchor="end">{p}</text>
                ))}
                {[-4, -2, 0, 2, 4].map((t) => (
                  <text key={t} className="coh-ladder__tick" x={x(t)} y={base + 14} textAnchor="middle">
                    {t > 0 ? `+${t}` : t}
                  </text>
                ))}
                <text className="coh-svg-label" x={MARGIN.left + span} y={base + 28} textAnchor="end">t statistic</text>
                <text className="coh-figure__key" x={MARGIN.left} y={base + 46}>
                  <tspan aria-hidden="true">●</tspan> statement <tspan aria-hidden="true">▲</tspan> press conference — filled holds, hollow absent
                </text>
                <text className="coh-figure__key" x={MARGIN.left} y={base + 64}>mark area is the meetings behind it</text>
                {notes.map((group, index) => (
                  <text key={group.note} className="diff-field__note" x={MARGIN.left} y={base + 82 + index * 18}>
                    <title>{`${group.rows} row${group.rows === 1 ? "" : "s"}: ${group.note}`}</title>
                    <tspan aria-hidden="true">○</tspan>{" "}
                    {truncateMiddle(`${group.rows} rows — ${group.note}`, span - 14, DIAGRAM_LABEL_PX)}
                  </text>
                ))}

                {points.map((pt) => {
                  const cx = x(pt.t);
                  const cy = y(pt.p);
                  const r = rOf(pt.row.n);
                  const stage = pt.row.stage === "call" ? "call" : "release";
                  const filled = pt.row.verdict === "holds";
                  const key = `${pt.row.name}-${pt.row.stage}`;
                  const cls = `diff-field__mark diff-field__mark--${stage}${filled ? "" : " is-absent"}`
                    + `${qualifyingKeys.has(key) ? " is-qualified" : ""}`;
                  const title = `${label(pt)}: t ${pt.t > 0 ? "+" : ""}${fmt(pt.t, 2)}, p ${pWord(pt.p)}, n ${pt.row.n}`
                    + ` — ${VERDICT_WORD[pt.row.verdict]}`;
                  return stage === "call" ? (
                    <path key={key} className={cls} d={triangle(cx, cy, r)}>
                      <title>{title}</title>
                    </path>
                  ) : (
                    <circle key={key} className={cls} cx={cx} cy={cy} r={r}>
                      <title>{title}</title>
                    </circle>
                  );
                })}

                {holds.map((pt) => {
                  const r = rOf(pt.row.n);
                  const wanted = y(pt.p) + r + 17;
                  const at = wanted < lastLabelY + 17 ? lastLabelY + 17 : wanted;
                  lastLabelY = at;
                  return (
                    <text key={`${pt.row.name}-${pt.row.stage}-label`} className="diff-field__label"
                          x={x(pt.t) - r - 6} y={at} textAnchor="end" aria-hidden="true">
                      {label(pt)}
                    </text>
                  );
                })}
              </>
            );
          }}
        </Plot>
      ) : (
        <FigureEmpty reason="No relationship has enough meetings behind it yet." />
      )}
    </Figure>
  );
}

export default memo(EffectField);
