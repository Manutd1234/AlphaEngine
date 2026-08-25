"use client";

/**
 * Every measured relationship on one axis, so the nulls are as visible as the hit.
 *
 * A results table can be read row by row without ever noticing that four of the
 * six rows found nothing. Put all six on a shared t axis with the |t| = 2 band
 * drawn behind them, and the shape of the study is legible in one glance: two
 * dots outside the band, four inside it, and the two outside are the control.
 *
 * The band is the honest part. It is not a threshold the study chose after
 * looking — it is drawn at the same place for every row, and a dot inside it is
 * a dot that a shuffled pairing would have produced about as often.
 *
 * Identity never rests on colour: the stage is a hue AND the verdict is a
 * filled or hollow mark, which is what keeps this readable in High Contrast.
 */

import { Plot } from "../Figure";
import { DIAGRAM_LABEL_PX, gutterFor, truncateMiddle } from "@/lib/coherence/label-metrics";
import type { Finding } from "./types";

const ROW = 26;
const PAD = { top: 22, bottom: 26, right: 46 };
/** Row labels are the widest thing here, so the gutter is measured, not guessed.
 *  13 is the diagram ladder's series/row-label rung (2026-08-24: it came off
 *  the 10px tick floor the desk review called too small, then the whole ladder
 *  lifted 12 → 13 in the same review's third pass); CHAR_PX and the gutter
 *  derive from it, so the label column widened with the type rather than
 *  truncating. The 14r token `--fs-diagram-label` holds the same 13 for the
 *  classes that read CSS; this one is inline because the arithmetic below
 *  needs the number.
 *
 *  THE GUTTER IS NO LONGER DERIVED FROM A CONSTANT RATIO. It used to be
 *  `LABEL_SIZE * 0.56`, which is the MIXED-CASE prose advance measured in
 *  Chrome — while a `Finding.name` is wire data and can arrive uppercase, where
 *  Inter sets nearer 0.69em. So the column under-measured exactly the labels
 *  most likely to overrun it, and the overrun printed into the axis rather than
 *  clipping. `label-metrics.ts` exists for this and owns the numbers now. */
const LABEL_SIZE = DIAGRAM_LABEL_PX;
const GUTTER_MIN = 140;
const GUTTER_MAX = 300;
/** Beyond this the axis stops growing; a larger t is drawn at the edge with its value. */
const AXIS_MAX = 5;
/** Where "distinguishable from a shuffled pairing" starts, in t. */
const THRESHOLD = 2;

export default function EffectPlot({ findings }: { findings: Finding[] }) {
  const rows = findings.filter((row) => row.t_statistic != null);
  const height = PAD.top + rows.length * ROW + PAD.bottom;

  return (
    <Plot height={height}>
      {(width) => {
        // The gutter takes what the labels need and no more, but never so much
        // that the axis is squeezed out: past the cap a name is elided with its
        // full text kept in a tooltip, because a clipped label is worse than a
        // shortened one — it looks like the word is simply missing.
        const label = (row: Finding) => `${row.name} (${row.stage})`;
        const gutter = gutterFor(rows.map(label), width, LABEL_SIZE, {
          min: GUTTER_MIN, max: GUTTER_MAX, maxFraction: 0.34, clearance: 18,
        });
        const span = Math.max(width - gutter - PAD.right, 120);
        const x = (t: number) =>
          gutter + ((Math.max(-AXIS_MAX, Math.min(AXIS_MAX, t)) + AXIS_MAX) / (2 * AXIS_MAX)) * span;
        const base = PAD.top + rows.length * ROW;

        return (
          <>
            <rect
              className="diff-effect__band"
              x={x(-THRESHOLD)}
              y={PAD.top - 8}
              width={x(THRESHOLD) - x(-THRESHOLD)}
              height={rows.length * ROW + 8}
            />
            {/* Sized in 14r at the 13px legend rung — the band's words are the
                figure's whole caveat, not an axis tick. */}
            <text className="diff-effect__bandlabel" x={x(0)} y={PAD.top - 12} textAnchor="middle">
              chance could do this
            </text>
            <line className="diff-effect__zero" x1={x(0)} x2={x(0)} y1={PAD.top - 8} y2={base} />
            <line className="diff-effect__axis" x1={gutter} x2={gutter + span} y1={base} y2={base} />
            {[-4, -2, 0, 2, 4].map((tick) => (
              <text
                key={tick}
                className="diff-effect__tick"
                x={x(tick)}
                y={base + 14}
                textAnchor="middle"
                fontSize={10}
              >
                {tick > 0 ? `+${tick}` : tick}
              </text>
            ))}
            {/* The axis's TITLE, not one of its numerals: 12px label rung via
                coh-svg-label (14r); the -4…+4 ticks above stay at the floor. */}
            <text
              className="coh-svg-label"
              x={gutter + span}
              y={base + 24}
              textAnchor="end"
            >
              t statistic
            </text>

            {rows.map((row, index) => {
              const t = row.t_statistic as number;
              const cy = PAD.top + index * ROW + ROW / 2 - 4;
              const holds = row.verdict === "holds";
              const stage = row.stage === "call" ? "call" : "release";
              return (
                <g key={`${row.name}-${row.stage}`}>
                  <text className="diff-effect__row" x={gutter - 12} y={cy + 3.5}
                        textAnchor="end" fontSize={LABEL_SIZE}>
                    <title>{`${label(row)} — ${row.question}`}</title>
                    {/* Middle-elided, not tail-truncated: a relationship name
                        is distinguished by its tail — the stage in brackets —
                        as often as by its head. */}
                    {truncateMiddle(label(row), gutter - 18, LABEL_SIZE)}
                  </text>
                  <line
                    className="diff-effect__stem"
                    x1={x(0)}
                    x2={x(t)}
                    y1={cy}
                    y2={cy}
                  />
                  <circle
                    className={`diff-effect__dot diff-effect__dot--${stage}${holds ? "" : " diff-effect__dot--absent"}`}
                    cx={x(t)}
                    cy={cy}
                    r={5}
                  />
                  <text
                    className="diff-effect__value"
                    x={x(t) + (t < 0 ? -12 : 12)}
                    y={cy + 4}
                    textAnchor={t < 0 ? "end" : "start"}
                  >
                    {t > 0 ? "+" : ""}
                    {t.toFixed(2)}
                  </text>
                </g>
              );
            })}
          </>
        );
      }}
    </Plot>
  );
}
