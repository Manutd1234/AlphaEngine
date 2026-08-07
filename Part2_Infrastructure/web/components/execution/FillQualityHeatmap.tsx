"use client";

/**
 * Realised slippage by hour of day and venue, over the rows on screen.
 *
 * The quality panel above this reports one average; a desk arguing about
 * execution wants to know *when* and *where* it is paying up — a venue that is
 * fine at noon and expensive at the open produces the same mean as one that is
 * mediocre all day. Signed slippage on a diverging ramp: red cells cost, blue
 * cells beat the reference price.
 *
 * Cells are drawn only where fills exist, and the panel refuses to render at
 * all below a minimum sample — an hour×venue grid interpolated from four fills
 * would be a picture of noise wearing the authority of a heatmap. Same
 * honesty rule as everything else on this desk: absence is shown as absence.
 */

import { useMemo } from "react";

import type { BlotterRow } from "@/lib/blotter";
import { SHARPE_RAMP_LIGHT, divergingScale } from "@/lib/colormap";
import { fmt } from "@/lib/format";

/** Below this many priced fills the grid is noise, not evidence. */
const MIN_FILLS = 8;

interface Cell {
  mean: number;
  count: number;
}

export default function FillQualityHeatmap({
  rows,
  source = "live",
}: {
  rows: BlotterRow[];
  source?: "live" | "sandbox" | "unavailable";
}) {
  const view = useMemo(() => {
    const fills = rows.filter(
      (row) => row.accepted && row.slippageBps != null && row.venue,
    );
    if (fills.length < MIN_FILLS) return null;

    const venues = [...new Set(fills.map((row) => row.venue as string))].sort();
    const grid = new Map<string, Cell>();
    const hours = new Set<number>();

    for (const row of fills) {
      const hour = new Date(row.ts).getUTCHours();
      if (Number.isNaN(hour)) continue;
      hours.add(hour);
      const key = `${row.venue}:${hour}`;
      const cell = grid.get(key);
      if (cell) {
        cell.mean += ((row.slippageBps as number) - cell.mean) / (cell.count + 1);
        cell.count += 1;
      } else {
        grid.set(key, { mean: row.slippageBps as number, count: 1 });
      }
    }
    if (hours.size < 2 || venues.length === 0) return null;

    const hourList = [...hours].sort((a, b) => a - b);
    const absMax = Math.max(
      0.1,
      ...[...grid.values()].map((cell) => Math.abs(cell.mean)),
    );
    return { venues, hourList, grid, absMax, fillCount: fills.length };
  }, [rows]);

  if (!view) return null;

  const colour = divergingScale(view.absMax, SHARPE_RAMP_LIGHT);

  return (
    <section className="card fill-quality-heatmap">
      <header className="section-heading compact">
        <div>
          <h3>Fill quality by hour and venue</h3>
          <p className="muted">
            Mean realised slippage (bps) across {view.fillCount}
            {source === "sandbox" ? " generated" : ""} priced fills · UTC hours ·
            red pays up, blue beats the reference.
          </p>
        </div>
      </header>
      <div className="table-wrap">
        <table className="fill-quality-heatmap__grid">
          <thead>
            <tr>
              <th scope="col">Venue</th>
              {view.hourList.map((hour) => (
                <th scope="col" key={hour} className="num">
                  {String(hour).padStart(2, "0")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.venues.map((venue) => (
              <tr key={venue}>
                <th scope="row">{venue}</th>
                {view.hourList.map((hour) => {
                  const cell = view.grid.get(`${venue}:${hour}`);
                  if (!cell) {
                    // An empty cell is "no fills this hour", not zero slippage.
                    return <td key={hour} className="is-empty" aria-label={`${venue}, ${hour}:00 UTC: no fills`} />;
                  }
                  return (
                    <td
                      key={hour}
                      className="num"
                      style={{ background: colour(cell.mean) }}
                      title={`${venue} · ${String(hour).padStart(2, "0")}:00 UTC · ${fmt(cell.mean, 2)} bps over ${cell.count} fill${cell.count === 1 ? "" : "s"}`}
                    >
                      {fmt(cell.mean, 1)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
