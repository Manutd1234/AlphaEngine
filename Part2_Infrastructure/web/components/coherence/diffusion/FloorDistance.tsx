"use client";

/**
 * How close every refused run came to clearing the noise floor.
 *
 * WHAT THIS REPLACED. `StageBars` drew each stage as one track split in two —
 * measured against refused — with the refused half a single grey block. Live
 * that block was 82 statement runs and 77 conference runs, and the figure could
 * say nothing about any of them but that there were 82 and 77.
 *
 * WHAT THE REFUSALS CARRY. Every refused run arrives with `signal_reason` set
 * to one sentence — "the terminal move is 0.71 pre-event sigmas, below the
 * floor of 2" — and on the live ledger 159 of 159 parse. That sigma is the
 * whole of what the floor decided on, and drawn as a histogram it answers the
 * question the block could not: is the floor a cliff or a gradient?
 *
 *     statement   refused |σ|: n=82  median 0.72  p90 1.61  max 1.98
 *     conference  refused |σ|: n=77  median 0.63  p90 1.51  max 1.92
 *
 * Bucketed at 0.2σ the distribution is close to uniform on [0, 2): a real
 * fraction of the refused set sits just under the gate. That is a fact about
 * the floor a reader should see, and the attrition block hid it.
 *
 * THE ACCEPTED RUNS ARE NOT ON THIS AXIS, and the figure says so rather than
 * drawing them at the floor. Their sigma is `sigma_pre_per_bar` — persisted in
 * the run dataclass, not yet on the wire — so the 89 that cleared are counted
 * above the floor in the header and placed nowhere. The gateway change that
 * closes this is one field; until it lands, "cleared" is the only honest
 * position for them.
 *
 * Every pin from `diffusion-figures.test.ts` is kept: `controls_used` is not
 * read (it is the windows FOUND, not the rank's population), this is a sigma
 * histogram and not the half-life histogram the Meetings strip already draws,
 * and the wire carries no placebo to strip.
 */

import { memo } from "react";

import { refusalSigma, sigmaBuckets } from "@/lib/coherence/signal-sigma";
import Figure, { FigureEmpty, Plot } from "../Figure";
import { STAGE_WORD } from "./AbsorptionGate";
import type { StageRun, StageSummary } from "./types";

/** The vocabulary for the control-percentile axis, owned here and shared.
 *  `ControlRank` draws that axis and imports this rather than writing a second
 *  set of words — two figures describing one number differently is how an axis
 *  stops meaning one thing. Moved here from `StageBars` with the figure. */
export function percentileWord(value: number | null): string {
  if (value == null) return "no matched window cleared the floor";
  if (value <= 0.1) return "faster than nearly every no-news window";
  if (value <= 0.35) return "faster than most no-news windows";
  if (value < 0.65) return "indistinguishable from a no-news window";
  return "slower than most no-news windows";
}

const ROW = 118;
const MARGIN = { top: 40, right: 18, bottom: 8, left: 44 };
const HIST_H = 60;
const BUCKET_SIGMA = 0.2;
const STAGE_MARK: Record<string, string> = { release: "●", call: "▲" };

interface StageSigmas {
  readonly stage: "release" | "call";
  readonly sigmas: number[];
  readonly floor: number;
  readonly unparsed: number;
  readonly accepted: number;
}

function sigmasOf(runs: readonly StageRun[]): StageSigmas[] {
  return (["release", "call"] as const).map((stage) => {
    const mine = runs.filter((run) => run.stage === stage);
    const sigmas: number[] = [];
    let floor = 2;
    let unparsed = 0;
    for (const run of mine) {
      if (run.signal_state === "ok") continue;
      const parsed = refusalSigma(run.signal_reason);
      if (parsed) { sigmas.push(parsed.sigma); floor = parsed.floor; }
      else unparsed += 1;
    }
    return { stage, sigmas, floor, unparsed, accepted: mine.filter((run) => run.signal_state === "ok").length };
  });
}

function FloorDistance({ runs, stages }: { runs: readonly StageRun[]; stages: readonly StageSummary[] }) {
  const rows = sigmasOf(runs).filter((row) => row.sigmas.length || row.accepted);
  const refused = rows.reduce((total, row) => total + row.sigmas.length, 0);
  const accepted = rows.reduce((total, row) => total + row.accepted, 0);
  const unparsed = rows.reduce((total, row) => total + row.unparsed, 0);
  const floor = rows[0]?.floor ?? 2;
  const near = rows.map((row) => ({
    stage: row.stage,
    count: row.sigmas.filter((sigma) => sigma >= floor - 2 * BUCKET_SIGMA).length,
  }));
  const height = MARGIN.top + rows.length * ROW + MARGIN.bottom;
  const medianOf = (stage: string) => stages.find((s) => s.stage === stage)?.median_half_life_s ?? null;

  return (
    <Figure
      caption="How close every refused stage came to the noise floor, in pre-event sigmas"
      ariaLabel={`${refused} refused runs over ${rows.length} stages, each placed by the sigma its terminal move `
        + `represented against a floor of ${floor}; ${accepted} accepted runs counted above the floor`}
      reading={refused
        ? `The floor is a gradient, not a cliff: refusals spread across the whole span below ${floor}σ, and `
          + near.map((n) => `${n.count} ${STAGE_WORD[n.stage] ?? n.stage}`).join(" and ")
          + ` runs sat within ${(2 * BUCKET_SIGMA).toFixed(1)}σ of clearing.`
        : "No stage was refused, so there is no distance to draw."}
      missing={[
        accepted
          ? `The ${accepted} runs that cleared are counted above the floor and placed nowhere: their sigma is `
            + "not on the wire, and drawing them at the line would invent a position."
          : null,
        unparsed ? `${unparsed} refusals carried no sigma the figure could read, and are counted off the axis.` : null,
      ].filter(Boolean).join(" ") || null}
    >
      {refused ? (
        <Plot height={height} minWidth={480}>
          {(width) => {
            const span = Math.max(120, width - MARGIN.left - MARGIN.right);
            const x = (sigma: number) => MARGIN.left + (Math.min(sigma, floor) / floor) * span;
            return (
              <>
                {rows.map((row, index) => {
                  const top = MARGIN.top + index * ROW;
                  const base = top + 22 + HIST_H;
                  const counts = sigmaBuckets(row.sigmas, row.floor, BUCKET_SIGMA);
                  const tallest = Math.max(1, ...counts);
                  const word = STAGE_WORD[row.stage] ?? row.stage;
                  const median = medianOf(row.stage);
                  return (
                    <g key={row.stage}>
                      <text className="diff-floor__head" x={MARGIN.left} y={top + 12}>
                        <tspan aria-hidden="true">{STAGE_MARK[row.stage]}</tspan> {word}
                      </text>
                      <text className="diff-floor__count" x={MARGIN.left + span} y={top + 12} textAnchor="end">
                        {row.sigmas.length} refused, {row.accepted} cleared
                        {median != null ? ` — half absorbed in ${Math.round(median)}s` : ""}
                      </text>

                      {counts.map((count, bucket) => {
                        const lo = bucket * BUCKET_SIGMA;
                        const hi = Math.min(row.floor, lo + BUCKET_SIGMA);
                        const h = (count / tallest) * HIST_H;
                        const nearFloor = hi >= row.floor - 2 * BUCKET_SIGMA;
                        return (
                          <rect
                            key={bucket}
                            className={`diff-floor__bucket${nearFloor ? " is-near" : ""}`}
                            x={x(lo) + 1}
                            y={base - h}
                            width={Math.max(1, x(hi) - x(lo) - 2)}
                            height={h}
                          >
                            <title>
                              {`${word}: ${count} run${count === 1 ? "" : "s"} at ${lo.toFixed(1)}–${hi.toFixed(1)}σ`
                                + (nearFloor ? " — within reach of the floor" : "")}
                            </title>
                          </rect>
                        );
                      })}

                      <line className="diff-floor__axis" x1={MARGIN.left} x2={MARGIN.left + span} y1={base} y2={base} />
                      <line className="diff-floor__floor" x1={x(row.floor)} x2={x(row.floor)} y1={top + 18} y2={base + 4}>
                        <title>{`The floor: a terminal move of ${row.floor} pre-event sigmas. ${row.accepted} ${word} runs cleared it.`}</title>
                      </line>
                      <text className="coh-ladder__tick" x={MARGIN.left} y={base + 14}>0σ</text>
                      <text className="coh-ladder__tick" x={x(row.floor / 2)} y={base + 14} textAnchor="middle">
                        {(row.floor / 2).toFixed(0)}σ
                      </text>
                      <text className="coh-ladder__tick" x={x(row.floor)} y={base + 14} textAnchor="end">
                        {row.floor}σ floor
                      </text>
                    </g>
                  );
                })}
              </>
            );
          }}
        </Plot>
      ) : (
        <FigureEmpty reason="No stage has been refused yet, so there is no distance to the floor to draw." />
      )}
    </Figure>
  );
}

export default memo(FloorDistance);
