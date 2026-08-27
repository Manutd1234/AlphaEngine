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

import Figure, { FigureEmpty, Plot } from "../Figure";
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

interface Ranked {
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
  const ofStage = runs.filter((run) => run.stage === stage && run.signal_state === "ok");
  const usable = ofStage.filter((run) => run.half_life_s != null && run.half_life_vol != null);
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

const STAGE_WORD = { release: "statement", call: "press conference" } as const;

export default function ClockAgreement({ runs }: { runs: StageRun[] }) {
  const panels = (["release", "call"] as const).map((stage) => ({ stage, ...rankByClock(runs, stage) }));
  const drawable = panels.filter((panel) => panel.rows.length >= 2);
  const movedIn = (rows: Ranked[]) =>
    rows.filter((row) => Math.abs(row.wallRank - row.volRank) > rows.length * MOVED).length;
  const totalMoved = drawable.reduce((sum, panel) => sum + movedIn(panel.rows), 0);
  const totalRows = drawable.reduce((sum, panel) => sum + panel.rows.length, 0);
  const dropped = panels.reduce((sum, panel) => sum + panel.dropped, 0);

  return (
    <Figure
      caption="Each stage ranked by the wall clock and by the volatility clock, within its own stage"
      ariaLabel={
        totalRows
          ? `Two rank slopegraphs, one per stage, over ${totalRows} measured stages; `
            + `${totalMoved} move more than a tenth of their own field between the clocks`
          : "No stage carries both clocks yet"
      }
      reading={
        totalRows
          ? `${totalMoved} of ${totalRows} stages move more than a tenth of their own field between the clocks — `
            + "the ones where a path stopped because volatility ran out, not because absorption finished."
          : null
      }
      missing={[
        "Ranked WITHIN each stage, not across both: the statement and the press conference have different "
        + "characteristic speeds, so a pooled ranking would report that difference as a disagreement between clocks.",
        "A rank plot says WHICH stages disagree and never by how much — the two clocks are in different units, "
        + "seconds against accumulated control variance, and no drawing can honestly put them on one axis.",
        dropped
          ? `${dropped} measured ${dropped === 1 ? "stage carries" : "stages carry"} one clock and not the other, and ${dropped === 1 ? "is" : "are"} not drawn.`
          : null,
      ].filter(Boolean).join(" ")}
    >
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
                      {panel.rows.map((row) => {
                        const shifted = Math.abs(row.wallRank - row.volRank) > panel.rows.length * MOVED;
                        return (
                          <line
                            key={row.key}
                            className={`diff-clock__link${shifted ? " is-moved" : ""} diff-clock__link--${row.stage}`}
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
        <FigureEmpty reason="Fewer than two stages in either arm carry both clocks, which is not a ranking." />
      )}
    </Figure>
  );
}
