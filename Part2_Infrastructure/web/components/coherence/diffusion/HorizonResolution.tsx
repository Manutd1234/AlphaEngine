"use client";

/**
 * What each horizon actually resolved, and out of how many bars.
 *
 * NOT THE RUN x HORIZON MATRIX this started as, and the arithmetic is why. On
 * the live ledger 1,984 cells is exactly 248 x 8, and 1,488 measured is exactly
 * 248 x 6 — every run carries the identical row,
 * `[unavailable, unavailable, ok, ok, ok, ok, ok, ok]`. There is no per-run
 * variation in `cell.state` at all. A matrix would have been 1,984 marks saying
 * one sentence, 248 rows tall, in two solid blocks. The content was right and
 * the geometry was wrong.
 *
 * Eight rows instead, one per horizon, with the two that resolve for nobody
 * kept IN rather than dropped — an absent horizon is the tab's own house rule
 * about gaps, one level up.
 *
 * THE SECOND TRACK IS THE NEW FACT. `cell.bars` is on the wire, read by
 * nothing, and it is exactly `[1, 2, 5, 10, 15, 30]` — the horizon in minutes,
 * because the grid's minimum bar count is one throughout. So **the 1m point of
 * all 248 paths is a single close**, and nobody reading this tab has ever been
 * told that. It is the resolution the whole absorption curve is built on.
 *
 * ~20 marks over 1,984 cells, and that is deliberate rather than a shortfall:
 * the cells collapse without loss to eight horizons x five states, of which ten
 * pairs are populated. Every distinct fact in the field is a mark. Drawing
 * 1,984 would be 1,974 duplicates of ten sentences and the worst keyboard walk
 * on the desk.
 */

import { memo } from "react";

import Figure, { FigureEmpty, Plot } from "../Figure";
import type { AbsorptionRead } from "./types";

const ROW = 30;
const MARGIN = { top: 36, right: 16, bottom: 26, left: 56 };
const BAR = 11;
/** Where the state bar ends and the resolution ticks begin, as width fractions. */
const SPLIT = { stateTo: 0.56, ticksFrom: 0.63 };

const STATE_WORD: Record<string, string> = {
  ok: "measured",
  pending: "not reached yet",
  uncaptured: "no bar captured",
  insufficient: "too few bars",
  unavailable: "no source",
};

interface Row {
  horizon: string;
  counts: Map<string, number>;
  total: number;
  bars: number | null;
  reason: string | null;
}

function rowsOf(read: AbsorptionRead): Row[] {
  const byHorizon = new Map<string, Row>();
  for (const horizon of read.horizons) {
    byHorizon.set(horizon, { horizon, counts: new Map(), total: 0, bars: null, reason: null });
  }
  for (const run of read.runs) {
    for (const cell of run.cells) {
      const row = byHorizon.get(cell.horizon);
      if (!row) continue;
      row.counts.set(cell.state, (row.counts.get(cell.state) ?? 0) + 1);
      row.total += 1;
      // NOT averaged. Every measured cell at a horizon carries the same bar
      // count, so a mean would invent a decimal for a quantity that is a count
      // of closes; a disagreement is reported instead of smoothed.
      if (cell.bars != null && row.bars == null) row.bars = cell.bars;
      if (cell.reason && !row.reason) row.reason = cell.reason;
    }
  }
  return read.horizons.map((horizon) => byHorizon.get(horizon) as Row);
}

function HorizonResolution({ read }: { read: AbsorptionRead }) {
  const rows = rowsOf(read);
  const cells = rows.reduce((total, row) => total + row.total, 0);
  const unresolved = rows.filter((row) => row.bars == null);
  const measured = rows.reduce((total, row) => total + (row.counts.get("ok") ?? 0), 0);
  const height = MARGIN.top + rows.length * ROW + MARGIN.bottom;
  const ladder = rows.filter((row) => row.bars != null).map((row) => row.bars as number);
  const widestBars = Math.max(1, ...ladder);

  return (
    <Figure
      caption="What each horizon resolved, and how many closes it was read from"
      ariaLabel={`${rows.length} horizons over ${cells} cells: `
        + rows.map((row) => `${row.horizon} ${row.bars == null ? "never measured" : `${row.bars} bars`}`).join(", ")}
      reading={ladder.length
        ? `Every measured cell at a horizon is read from the same number of closes, and the ladder is `
          + `${ladder.join(", ")} — so the ${rows.find((row) => row.bars === 1)?.horizon ?? "shortest"} `
          + "point of every path is a single close."
        : "No horizon has resolved a bar count yet."}
      missing={unresolved.length && unresolved[0].reason
        ? `${unresolved.map((row) => row.horizon).join(" and ")} resolve for no run at all, and are kept `
          + `in the grid rather than dropped: ${unresolved[0].reason.replace(/\.?$/, ".")}`
        : null}
    >
      {cells ? (
        <Plot height={height} minWidth={460}>
          {(width) => {
            const span = Math.max(120, width - MARGIN.left - MARGIN.right);
            const stateW = span * SPLIT.stateTo;
            const tickX = MARGIN.left + span * SPLIT.ticksFrom;
            const tickW = MARGIN.left + span - tickX;
            return (
              <>
                <text className="coh-svg-label" x={0} y={MARGIN.top - 14}>horizon</text>
                <text className="coh-svg-note" x={MARGIN.left} y={MARGIN.top - 14}>
                  {measured} of {cells} cells measured
                </text>
                <text className="coh-svg-note" x={MARGIN.left + span} y={MARGIN.top - 14} textAnchor="end">
                  closes behind each
                </text>

                {rows.map((row, index) => {
                  const top = MARGIN.top + index * ROW;
                  const mid = top + ROW / 2;
                  let cursor = MARGIN.left;
                  return (
                    <g key={row.horizon}>
                      {/* Right-anchored at the track's own edge, so `1s 30s 1m 2m 5m 10m 15m 30m`
                          form a column. Start-anchored at x=0 their right edges spread
                          13px and the ladder read as ragged. */}
                      <text className="diff-res__label" x={MARGIN.left - 8} y={mid + 4} textAnchor="end">{row.horizon}</text>

                      {[...row.counts.entries()].map(([state, count]) => {
                        const w = row.total ? (count / row.total) * stateW : 0;
                        const x = cursor;
                        cursor += w;
                        return (
                          <rect
                            key={state}
                            className={`diff-res__seg diff-res__seg--${state}`}
                            x={x}
                            y={mid - BAR / 2}
                            width={Math.max(0, w)}
                            height={BAR}
                          >
                            <title>
                              {`${row.horizon}: ${count} of ${row.total} cells ${STATE_WORD[state] ?? state}`}
                            </title>
                          </rect>
                        );
                      })}

                      {row.bars != null ? (
                        <g>
                          {/* One stroke per close. A count this small is better
                              shown than written: six ticks and thirty ticks are
                              the same sentence at different resolutions. */}
                          {Array.from({ length: Math.min(row.bars, 30) }, (unused, tick) => (
                            <line
                              key={tick}
                              className="diff-res__tick"
                              x1={tickX + (tick / Math.max(1, widestBars - 1)) * Math.max(1, tickW - 2)}
                              x2={tickX + (tick / Math.max(1, widestBars - 1)) * Math.max(1, tickW - 2)}
                              y1={mid - BAR / 2}
                              y2={mid + BAR / 2}
                            />
                          ))}
                          <rect
                            className="diff-res__hit"
                            x={tickX}
                            y={mid - BAR / 2}
                            width={Math.max(1, tickW)}
                            height={BAR}
                          >
                            <title>
                              {`${row.horizon}: read from ${row.bars} close${row.bars === 1 ? "" : "s"}`
                                + (row.bars === 1 ? " — a single bar" : "")}
                            </title>
                          </rect>
                        </g>
                      ) : (
                        <text className="diff-res__absent" x={tickX} y={mid + 4}>
                          ◌ never measured
                        </text>
                      )}
                    </g>
                  );
                })}
              </>
            );
          }}
        </Plot>
      ) : (
        <FigureEmpty reason="No horizon has been read yet." />
      )}
    </Figure>
  );
}

export default memo(HorizonResolution);
