"use client";

/**
 * How a settlement index is made, drawn rather than described.
 *
 * The Formation view answered four questions in a four-row table of prose, and
 * a table is the wrong shape for this one: what it is really describing is a
 * PIPELINE — station readings become a quality-controlled set, the set becomes
 * one published minute, and sixty of those minutes become the number a contract
 * settles against. Each stage can fail, and where it fails decides what the
 * failure means. A reader who cannot see the chain cannot see that the window
 * average at the end is four transformations away from a thermometer.
 *
 * So the diagram IS the argument, and the figures ride on the stages they
 * belong to: how many stations reported, how many minutes this read reproduced
 * from the rule, how many the venue never published, and how long the window
 * is. Where a stage cannot be measured it says so on the stage rather than in a
 * footnote — a chain with an unmeasured link is a different claim from a chain
 * with a broken one.
 *
 * Nothing here carries meaning in colour alone. A stage that holds is marked ●
 * and one that does not is ▲, the same vocabulary the chips use, so the diagram
 * survives forced-colors and a reader who cannot separate the two hues.
 */

import Figure, { Plot } from "./Figure";

export interface FormationStage {
  /** The short noun on the box — two words at most; it has ~130px. */
  title: string;
  /** The measurement this stage carries, or null when this read has none. */
  value: string | null;
  /** One clause under the figure. Not a sentence: the caption is the sentence. */
  note: string;
  /** False when this read found the stage broken, null when it could not ask. */
  holds: boolean | null;
}

const BOX_H = 68;
const GAP = 34;
const TOP = 8;
/** Below this a box cannot hold two words of --fs-tick and is not worth drawing. */
const MIN_BOX_W = 96;
const PAD = 8;

/**
 * SVG text neither wraps nor clips: a string longer than its box runs straight
 * out of it and over the arrow beside it. Observed, not derived — the live
 * feed's QC version is `miami-temperature-v1.0-cal-20260824` and its station
 * list is five nine-character names, and both crossed into the next stage.
 *
 * `--fs-tick` is a fixed 10px (it is chart furniture and deliberately off the
 * type scale), and the widest ordinary glyph in this font at that size is under
 * 5.6px. Estimating rather than measuring means erring towards a shorter
 * string, which is the safe direction: the full value is on the `<title>`, so
 * nothing is lost, and a box that fits is worth more than a character.
 */
function fit(text: string, boxWidth: number, perChar: number): string {
  const budget = Math.max(4, Math.floor((boxWidth - PAD * 2) / perChar));
  return text.length <= budget ? text : `${text.slice(0, budget - 1)}…`;
}

function mark(holds: boolean | null): string {
  if (holds === null) return "◌";
  return holds ? "●" : "▲";
}

export default function FormationDiagram({
  stages,
  caption,
  reading,
  missing,
}: {
  stages: FormationStage[];
  caption: string;
  reading?: string | null;
  missing?: string | null;
}) {
  const height = TOP + BOX_H + 34;
  const ariaLabel = stages
    .map((stage) => `${stage.title}: ${stage.value ?? "not measured in this read"}, ${stage.note}`)
    .join(". Then ");

  return (
    <Figure caption={caption} reading={reading} missing={missing} ariaLabel={ariaLabel}>
      <Plot height={height}>
        {(width) => {
          // The boxes FILL the measured width rather than sitting at a fixed
          // one. Centring a 630px chain inside a 1400px card left half the
          // figure empty and every string truncated anyway, which is the worst
          // of both: room going spare beside text that did not fit.
          const count = stages.length;
          const gap = GAP;
          const boxW = Math.max(MIN_BOX_W, (width - (count - 1) * gap) / count);
          const startX = Math.max(0, (width - (count * boxW + (count - 1) * gap)) / 2);
          return (
            <>
              {stages.map((stage, index) => {
                const x = startX + index * (boxW + gap);
                const midY = TOP + BOX_H / 2;
                return (
                  <g key={stage.title}>
                    <rect
                      x={x} y={TOP} width={boxW} height={BOX_H} rx={6}
                      className={stage.holds === false ? "coh-form__box is-broken" : "coh-form__box"}
                    />
                    <text x={x + PAD} y={TOP + 17} className="coh-form__title">
                      <tspan aria-hidden="true">{mark(stage.holds)}</tspan>{" "}
                      {fit(stage.title, boxW - 14, 5.6)}
                    </text>
                    {/* --fs-sm, so a wider glyph: the value is the figure a
                        reader takes from the stage and it earns the larger
                        rung, but it also runs out of the box soonest. */}
                    <text x={x + PAD} y={TOP + 39} className="coh-form__value">
                      {fit(stage.value ?? "—", boxW, 7.2)}
                      <title>{stage.value ?? "not measured in this read"}</title>
                    </text>
                    <text x={x + PAD} y={TOP + 57} className="coh-form__note">
                      {fit(stage.note, boxW, 5.2)}
                      <title>{stage.note}</title>
                    </text>
                    {index < count - 1 ? (
                      <g className="coh-form__arrow">
                        <line
                          x1={x + boxW + 4} x2={x + boxW + gap - 8}
                          y1={midY} y2={midY} strokeWidth="1.5"
                        />
                        <polygon
                          points={`${x + boxW + gap - 8},${midY} ${x + boxW + gap - 15},${midY - 4} ${x + boxW + gap - 15},${midY + 4}`}
                        />
                      </g>
                    ) : null}
                  </g>
                );
              })}
              <text x={startX} y={height - 8} className="coh-axis__label">
                Each box is a transformation, not a reading; the contract settles on the last one.
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
