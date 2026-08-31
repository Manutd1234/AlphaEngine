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
 * EVERY STAGE IS ON THIS AXIS since 2026-08-26. The wire carries
 * `terminal_sigmas` — the judged ratio, computed on the gateway from the one
 * formula `_judge` uses — for the 89 that cleared as well as the 159 refused,
 * so the histogram runs past the floor and the accepted stages sit where the
 * floor actually saw them: from just over 2σ to the far end. The refusal
 * sentence is read only as a fallback against a gateway that predates the
 * field, and a stage with neither is counted off the axis, never drawn at
 * nought.
 *
 * Every pin from `diffusion-figures.test.ts` is kept: `controls_used` is not
 * read (it is the windows FOUND, not the rank's population), this is a sigma
 * histogram and not the half-life histogram the Meetings strip already draws,
 * and the wire carries no placebo to strip.
 *
 * SIDE BY SIDE, NOT STACKED, since 2026-08-27. The two stages used to be two
 * full-width rows, `ROW` tall each; they are two half-width panels at one
 * row's height now — the `ReturnFan` two-panel idiom, applied to a figure
 * that already had its own two stages and only needed them placed across
 * instead of down. Every constant below the panel split — bucket width, the
 * floor line, the tick labels — is unchanged; only which axis carries the
 * stage split moved.
 */

import { memo } from "react";

import { refusalSigma, sigmaBuckets } from "@/lib/coherence/signal-sigma";
import { fmt } from "@/lib/format";
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
/** The axis ends here; a stage past it lands in the last bucket, which says so. */
const AXIS_MAX_SIGMA = 8;
/** Between the two panels — the `ReturnFan.tsx` `ALLEY` idiom, same value. */
const PANEL_GAP = 40;
const STAGE_MARK: Record<string, string> = { release: "●", call: "▲" };

interface StageSigmas {
  readonly stage: "release" | "call";
  /** Every placed stage's sigma, refused and cleared alike. */
  readonly sigmas: number[];
  readonly floor: number;
  /** Stages with neither the wire number nor a readable sentence. */
  readonly unplaced: number;
  readonly accepted: number;
  readonly refused: number;
}

/** The wire's judged ratio first; the sentence only where the wire has none. */
function sigmaOf(run: StageRun): number | null {
  if (run.terminal_sigmas != null && Number.isFinite(run.terminal_sigmas)) return run.terminal_sigmas;
  return refusalSigma(run.signal_reason)?.sigma ?? null;
}

function sigmasOf(runs: readonly StageRun[]): StageSigmas[] {
  return (["release", "call"] as const).map((stage) => {
    const mine = runs.filter((run) => run.stage === stage);
    const sigmas: number[] = [];
    let floor = 2;
    let unplaced = 0;
    for (const run of mine) {
      const parsed = refusalSigma(run.signal_reason);
      if (parsed) floor = parsed.floor;
      const sigma = sigmaOf(run);
      if (sigma == null) unplaced += 1;
      else sigmas.push(sigma);
    }
    return {
      stage, sigmas, floor, unplaced,
      accepted: mine.filter((run) => run.signal_state === "ok").length,
      refused: mine.filter((run) => run.signal_state !== "ok").length,
    };
  });
}

function FloorDistance({ runs, stages }: { runs: readonly StageRun[]; stages: readonly StageSummary[] }) {
  const rows = sigmasOf(runs).filter((row) => row.sigmas.length || row.accepted || row.refused);
  const refused = rows.reduce((total, row) => total + row.refused, 0);
  const accepted = rows.reduce((total, row) => total + row.accepted, 0);
  const placed = rows.reduce((total, row) => total + row.sigmas.length, 0);
  const unplaced = rows.reduce((total, row) => total + row.unplaced, 0);
  const floor = rows[0]?.floor ?? 2;
  const near = rows.map((row) => ({
    stage: row.stage,
    count: row.sigmas.filter((sigma) => sigma < floor && sigma >= floor - 2 * BUCKET_SIGMA).length,
  }));
  const cleared = rows.flatMap((row) => row.sigmas.filter((sigma) => sigma >= floor)).sort((a, b) => a - b);
  const clearedMedian = cleared.length ? cleared[Math.floor(cleared.length / 2)] : null;
  const clearedMax = cleared.length ? cleared[cleared.length - 1] : null;
  const height = MARGIN.top + ROW + MARGIN.bottom;
  const medianOf = (stage: string) => stages.find((s) => s.stage === stage)?.median_half_life_s ?? null;

  return (
    <Figure
      caption="Every stage by the sigma its terminal move represented, against the noise floor it was judged on"
      ariaLabel={`${placed} stages over ${rows.length} rows, each placed by its terminal move in pre-event sigmas `
        + `against a floor of ${floor}; ${refused} refused below it, ${accepted} cleared above it`}
      reading={placed
        ? `The floor is a gradient, not a cliff: `
          + near.map((n) => `${n.count} ${STAGE_WORD[n.stage] ?? n.stage}`).join(" and ")
          + ` runs sat within ${(2 * BUCKET_SIGMA).toFixed(1)}σ of clearing`
          + (clearedMedian != null && clearedMax != null
            ? `, and the ${cleared.length} that cleared reach ${fmt(clearedMax, 1)}σ, half past ${fmt(clearedMedian, 1)}σ.`
            : ".")
        : "No stage has a sigma this figure can place."}
      missing={unplaced
        ? `${unplaced} stage${unplaced === 1 ? "" : "s"} carried neither the wire's sigma nor a readable refusal, `
          + "and are counted off the axis rather than drawn at nought."
        : null}
    >
      {placed ? (
        <Plot height={height} minWidth={560} scrollLabel="Noise-floor distance diagram">
          {(width) => {
            const span = Math.max(120, width - MARGIN.left - MARGIN.right);
            const panelWidth = rows.length > 1 ? (span - PANEL_GAP) / rows.length : span;
            return (
              <>
                {rows.map((row, index) => {
                  const left = MARGIN.left + index * (panelWidth + PANEL_GAP);
                  const x = (sigma: number) => left + (Math.min(sigma, AXIS_MAX_SIGMA) / AXIS_MAX_SIGMA) * panelWidth;
                  const top = MARGIN.top;
                  const base = top + 22 + HIST_H;
                  const counts = sigmaBuckets(row.sigmas, AXIS_MAX_SIGMA, BUCKET_SIGMA);
                  const tallest = Math.max(1, ...counts);
                  const word = STAGE_WORD[row.stage] ?? row.stage;
                  const median = medianOf(row.stage);
                  return (
                    <g key={row.stage}>
                      <text className="diff-floor__head" x={left} y={top + 12}>
                        <tspan aria-hidden="true">{STAGE_MARK[row.stage]}</tspan> {word}
                      </text>
                      <text className="diff-floor__count" x={left + panelWidth} y={top + 12} textAnchor="end">
                        {row.refused} refused, {row.accepted} cleared
                        {median != null ? ` — half absorbed in ${Math.round(median)}s` : ""}
                      </text>

                      {counts.map((count, bucket) => {
                        const lo = bucket * BUCKET_SIGMA;
                        const hi = lo + BUCKET_SIGMA;
                        const last = bucket === counts.length - 1;
                        const h = (count / tallest) * HIST_H;
                        const past = lo >= row.floor;
                        const nearFloor = !past && hi >= row.floor - 2 * BUCKET_SIGMA;
                        return (
                          <rect
                            key={bucket}
                            className={`diff-floor__bucket${nearFloor ? " is-near" : ""}${past ? " is-cleared" : ""}`}
                            x={x(lo) + 1}
                            y={base - h}
                            width={Math.max(1, x(hi) - x(lo) - 2)}
                            height={h}
                          >
                            <title>
                              {`${word}: ${count} run${count === 1 ? "" : "s"} at ${last ? `${lo.toFixed(1)}σ and past` : `${lo.toFixed(1)}–${hi.toFixed(1)}σ`}`
                                + (nearFloor ? " — within reach of the floor" : past ? " — cleared" : "")}
                            </title>
                          </rect>
                        );
                      })}

                      <line className="diff-floor__axis" x1={left} x2={left + panelWidth} y1={base} y2={base} />
                      <line className="diff-floor__floor" x1={x(row.floor)} x2={x(row.floor)} y1={top + 18} y2={base + 4}>
                        <title>{`The floor: a terminal move of ${row.floor} pre-event sigmas. ${row.accepted} ${word} runs cleared it.`}</title>
                      </line>
                      <text className="coh-ladder__tick" x={left} y={base + 14}>0σ</text>
                      <text className="coh-ladder__tick" x={x(row.floor)} y={base + 14} textAnchor="middle">
                        {row.floor}σ floor
                      </text>
                      <text className="coh-ladder__tick" x={x(AXIS_MAX_SIGMA / 2)} y={base + 14} textAnchor="middle">
                        {AXIS_MAX_SIGMA / 2}σ
                      </text>
                      <text className="coh-ladder__tick" x={x(AXIS_MAX_SIGMA)} y={base + 14} textAnchor="end">
                        {AXIS_MAX_SIGMA}σ and past
                      </text>
                    </g>
                  );
                })}
              </>
            );
          }}
        </Plot>
      ) : (
        <FigureEmpty reason="No stage carries a sigma yet, so there is no distance to the floor to draw." />
      )}
    </Figure>
  );
}

export default memo(FloorDistance);
