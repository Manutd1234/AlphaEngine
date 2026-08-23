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
import type { Finding } from "./types";

const ROW = 26;
const PAD = { top: 22, bottom: 26, right: 46 };
/** Row labels are the widest thing here, so the gutter is measured, not guessed. */
const LABEL_SIZE = 10;
/** Average advance of the UI face at LABEL_SIZE, in pixels per character. */
const CHAR_PX = LABEL_SIZE * 0.56;
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
        const longest = rows.reduce((most, row) => Math.max(most, label(row).length), 0);
        const gutter = Math.min(GUTTER_MAX, Math.max(GUTTER_MIN,
          Math.min(longest * CHAR_PX + 18, width * 0.34)));
        const fits = Math.max(8, Math.floor((gutter - 18) / CHAR_PX));
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
            <text className="diff-effect__bandlabel" x={x(0)} y={PAD.top - 12} textAnchor="middle" fontSize={10}>
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
            <text
              className="diff-effect__tick"
              x={gutter + span}
              y={base + 24}
              textAnchor="end"
              fontSize={10}
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
                    {label(row).length > fits ? `${label(row).slice(0, fits - 1)}…` : label(row)}
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
                    fontSize={10}
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
