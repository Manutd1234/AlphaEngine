"use client";

/**
 * The same stages ranked by two clocks, and the meetings where the choice
 * changes the answer.
 *
 * `half_life_vol` has been on the wire since the arm shipped and was drawn
 * NOWHERE. It is the identification check the `clock` formula card argues in
 * prose only: a path that stops moving may have finished absorbing, or may have
 * run out of volatility, and the two are told apart by measuring the same stage
 * on a clock built from OTHER windows.
 *
 * IT IS NOT A HALF-LIFE IN SECONDS, and that is why this is a rank plot rather
 * than the obvious scatter. `tools/diffusion_phase0.py` reads it off
 * `clock.axis()`, which is cumulative control VARIANCE — measured on the live
 * ledger it runs 1.2e-07 to 1.2e-04 while the wall clock runs 60s to 1,402s.
 * Putting the two on one length axis would be dishonest by three orders of
 * magnitude. Ranks are unitless, so nothing incomparable is placed on one
 * scale, and the crossings are the finding.
 *
 * WHAT A RANK PLOT CANNOT SAY is by HOW MUCH, and the footnote says so. It also
 * counts the runs that carry one clock and not the other, because those are
 * dropped from the drawing and their absence is the interesting part.
 */

import { useState } from "react";

import Figure, { Plot } from "../Figure";
import DiffusionSparseState from "./DiffusionSparseState";
import type { StageRun } from "./types";

/**
 * Tall enough to aim at one line, and no taller than that needs.
 *
 * 240 put 89 ranks into 176px of plot — two pixels a rank, so the lines were a
 * hatch rather than 89 things a reader could tell apart, and hitting the one
 * you wanted with a pointer was luck. This is a SLOPEGRAPH split per stage —
 * the y scale each panel draws is its OWN row count, not 89 — and the taller
 * panel on the live ledger is the 47-row press-conference one; the 42-row
 * statement panel is more forgiving. 400 gives that taller panel
 * `(400 − 40 − 24) / 46` ≈ 7.3px between adjacent ranks, comfortably above
 * the 5px this file used to call enough for the full 89. The figure is still
 * taller than a screenful of the card, and that is still the right trade:
 * this view exists to be read line by line, and a reader who wants the
 * headline has it in the sentence underneath.
 */
const HEIGHT = 400;
const MARGIN = { top: 40, right: 12, bottom: 24, left: 12 };
/** Room outside the left axis for "fastest" and "slowest", both right-anchored. */
const LABEL_GUTTER = 58;
/** The right axis labels itself on centre, so it needs almost no tail. */
const PANEL_TAIL = 16;

export interface Ranked {
  key: string;
  label: string;
  stage: "release" | "call";
  wall: number;
  vol: number;
  wallRank: number;
  volRank: number;
}

/**
 * Both clocks, ranked WITHIN each stage, for the stages that carry both.
 *
 * Within, not pooled, and this is the correctness point of the figure. The two
 * stages have different characteristic speeds — 165s against 728s on the live
 * ledger — so a single ranking over both is dominated by WHICH STAGE a run is,
 * and a line that moved would be reporting that difference rather than a
 * disagreement between the clocks. Ranking inside each stage asks the question
 * the card actually poses: holding the stage fixed, does the clock change the
 * order?
 */
export function rankByClock(runs: readonly StageRun[], stage: "release" | "call"): {
  rows: Ranked[];
  dropped: number;
} {
  const ofStage = runs.filter((run) => run.stage === stage);
  const usable = ofStage.filter((run) =>
    run.signal_state === "ok" && run.half_life_s != null && run.half_life_vol != null,
  );
  const byWall = [...usable].sort((a, b) => (a.half_life_s as number) - (b.half_life_s as number));
  const byVol = [...usable].sort((a, b) => (a.half_life_vol as number) - (b.half_life_vol as number));
  const wallRank = new Map(byWall.map((run, index) => [run.run_id, index]));
  const volRank = new Map(byVol.map((run, index) => [run.run_id, index]));
  return {
    rows: usable.map((run) => ({
      key: run.run_id,
      label: `${run.source_ref.replace("fed:", "")} ${run.symbol}`,
      stage,
      wall: run.half_life_s as number,
      vol: run.half_life_vol as number,
      wallRank: wallRank.get(run.run_id) ?? 0,
      volRank: volRank.get(run.run_id) ?? 0,
    })),
    dropped: ofStage.length - usable.length,
  };
}

/** How far a rank has to move to be worth drawing as a move: a tenth of its own field. */
const MOVED = 0.1;

export type ClockPathMode = "dotted" | "solid" | "all";

export function clockPathIsMaterial(row: Ranked, rowCount: number): boolean {
  return Math.abs(row.wallRank - row.volRank) > rowCount * MOVED;
}

/** Background paths are dotted; the material crossings are solid, regardless of stage colour. */
export function clockPathIsDotted(row: Ranked, rowCount: number): boolean {
  return !clockPathIsMaterial(row, rowCount);
}

/** Filtering changes only visibility. Ranking and the main/background decision remain fixed. */
export function clockRowsForMode(rows: readonly Ranked[], mode: ClockPathMode): Ranked[] {
  const rowCount = rows.length;
  const visible = mode === "all"
    ? [...rows]
    : rows.filter((row) => clockPathIsDotted(row, rowCount) === (mode === "dotted"));
  // Keep the grey dotted context behind the coloured solid paths in the SVG
  // paint order, even when the wire arrives in a different order.
  return visible.sort((a, b) =>
    Number(clockPathIsMaterial(a, rowCount)) - Number(clockPathIsMaterial(b, rowCount)),
  );
}

const STAGE_WORD = { release: "statement", call: "press conference" } as const;

export default function ClockAgreement({ runs }: { runs: StageRun[] }) {
  const [pathMode, setPathMode] = useState<ClockPathMode>("all");
  const panels = (["release", "call"] as const).map((stage) => ({ stage, ...rankByClock(runs, stage) }));
  const drawable = panels.filter((panel) => panel.rows.length >= 2);
  const movedIn = (rows: Ranked[]) =>
    rows.filter((row) => clockPathIsMaterial(row, rows.length)).length;
  const totalMoved = drawable.reduce((sum, panel) => sum + movedIn(panel.rows), 0);
  const totalRows = drawable.reduce((sum, panel) => sum + panel.rows.length, 0);
  const clockReadable = panels.reduce((sum, panel) => sum + panel.rows.length, 0);
  const totalRecords = runs.length;
  const totalSolid = totalMoved;
  const totalDotted = totalRows - totalSolid;
  const dropped = panels.reduce((sum, panel) => sum + panel.dropped, 0);
  const visibleRows = drawable.reduce(
    (sum, panel) => sum + clockRowsForMode(panel.rows, pathMode).length,
    0,
  );
  const sparseReason = totalRecords === 0
    ? "No stage path has been recorded. The connected boxes show how two clock readings become a rank movement, not a result."
    : clockReadable === 0
      ? `${totalRecords} recorded path${totalRecords === 1 ? " carries" : "s carry"} no complete, accepted pair of clock readings. `
        + "The dependency path is shown, but no rank is invented."
      : `${clockReadable} of ${totalRecords} recorded paths carry both clocks, but neither stage has the two paths required for a ranking.`;

  return (
    <Figure
      caption="Wall-clock rank versus volatility-clock rank"
      ariaLabel={
        totalRows
          ? `Two rank slopegraphs, one per stage, over ${totalRows} clock-ranked paths from ${totalRecords} total paths; `
            + `${totalMoved} move more than a tenth of their own field between the clocks`
          : clockReadable
            ? `${clockReadable} path${clockReadable === 1 ? " carries" : "s carry"} both clocks, but no stage has the two paths required for a ranking`
            : totalRecords
              ? `${totalRecords} recorded path${totalRecords === 1 ? " carries" : "s carry"} no complete, accepted pair of clock readings`
              : "No stage path has been recorded"
      }
      reading={
        totalRows
          ? `${totalMoved} of ${totalRows} paths change rank materially between the two clocks.`
          : null
      }
      missing="Ranks are within each stage; statement and press-conference speeds are not compared directly."
      notes={[
        "Rank changes show which paths move, not the size of the clock difference; the clocks use different units.",
        dropped
          ? `${dropped} of ${totalRecords} paths lack both clock readings and stay off the rank axes.`
          : null,
      ].filter((note): note is string => Boolean(note))}
    >
      <div className="diff-lens diff-lens--inside" role="group" aria-label="Clock paths">
        <button type="button" aria-pressed={pathMode === "dotted"}
                onClick={() => setPathMode("dotted")}>Dotted backdrop — {totalDotted}</button>
        <button type="button" aria-pressed={pathMode === "solid"}
                onClick={() => setPathMode("solid")}>Solid main paths — {totalSolid}</button>
        <button type="button" aria-pressed={pathMode === "all"}
                onClick={() => setPathMode("all")}>All clock-ranked — {totalRows}</button>
        <span className="diff-lens__readout" aria-live="polite">
          {pathMode === "all" ? `${totalRecords} total paths; ${totalRows} ranked` : `${visibleRows} ranked; ${totalRecords} total`}
        </span>
      </div>
      {drawable.length ? (
        <Plot height={HEIGHT}>
          {(width) => {
            // Each stage gets its own pair of axes inside its own half. A
            // slopegraph reads by the ANGLE of its lines, so the axes are kept
            // close together — stretched across a desk-width pane every line is
            // nearly horizontal and a rank change looks like no change at all.
            const panelWidth = (width - MARGIN.left - MARGIN.right) / drawable.length;
            return (
              <>
                {drawable.map((panel, index) => {
                  const origin = MARGIN.left + index * panelWidth;
                  // NOT CENTRED, and that is the whole of this fix. Centring
                  // gave each panel equal flanks, but the two sides need very
                  // different room: "fastest" and "slowest" are right-anchored
                  // OUTSIDE the left axis and want about fifty pixels, while
                  // the right axis carries its label centred on itself and
                  // needs almost none. Equal flanks therefore reserved the left
                  // gutter twice and left 264px of the figure unused — 72 on
                  // each outer flank and 120 between the pair.
                  //
                  // Placed against the gutter each side actually needs, the two
                  // panels fill their halves. Still bounded by the panel rather
                  // than unbounded: a slopegraph reads by ANGLE, and at this
                  // height the result is roughly square, which is the shape
                  // that keeps a rank change visible as a slope.
                  const left = origin + LABEL_GUTTER;
                  const right = origin + panelWidth - PANEL_TAIL;
                  const y = (rank: number) =>
                    MARGIN.top + (rank / Math.max(1, panel.rows.length - 1)) * (HEIGHT - MARGIN.top - MARGIN.bottom);
                  return (
                    <g key={panel.stage}>
                      <text className="coh-svg-note" x={(left + right) / 2} y={MARGIN.top - 20} textAnchor="middle">
                        {STAGE_WORD[panel.stage]}
                      </text>
                      <text className="coh-ladder__tick" x={left} y={MARGIN.top - 9} textAnchor="middle">wall</text>
                      <text className="coh-ladder__tick" x={right} y={MARGIN.top - 9} textAnchor="middle">vol</text>
                      <line className="coh-ladder__axis" x1={left} x2={left} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} />
                      <line className="coh-ladder__axis" x1={right} x2={right} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} />
                      <text className="coh-ladder__tick" x={left - 6} y={MARGIN.top + 4} textAnchor="end">fastest</text>
                      <text className="coh-ladder__tick" x={left - 6} y={HEIGHT - MARGIN.bottom} textAnchor="end">slowest</text>
                      {clockRowsForMode(panel.rows, pathMode).map((row) => {
                        const shifted = clockPathIsMaterial(row, panel.rows.length);
                        const dotted = clockPathIsDotted(row, panel.rows.length);
                        return (
                          <line
                            key={row.key}
                            className={`diff-clock__link${shifted ? " is-moved" : ""}${dotted ? " is-dotted" : " is-solid"} diff-clock__link--${row.stage}`}
                            x1={left} x2={right} y1={y(row.wallRank)} y2={y(row.volRank)}
                          >
                            <title>
                              {`${row.label} ${STAGE_WORD[row.stage]}: ${Math.round(row.wall)}s on the wall clock, `
                                + `rank ${row.wallRank + 1} of ${panel.rows.length}; `
                                + `rank ${row.volRank + 1} on the volatility clock`
                                + `${shifted ? " — the clock changes the reading" : ""}`}
                            </title>
                          </line>
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
        <DiffusionSparseState kind="clocks" sampleCount={clockReadable} reason={sparseReason} />
      )}
    </Figure>
  );
}
