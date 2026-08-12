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
 * Cells are drawn only where fills exist, and the grid refuses to render below
 * a minimum sample — an hour×venue grid interpolated from four fills would be
 * a picture of noise wearing the authority of a heatmap. Below the floor the
 * panel says how far along the collection is rather than vanishing: a surface
 * that silently disappears reads as broken, not as honest. It stays silent
 * only when the audit log is unreachable, where a "collecting" line would be
 * a promise nothing is working to keep.
 */

import { useEffect, useMemo, useState } from "react";

import type { BlotterRow } from "@/lib/blotter";
import { SHARPE_RAMP_DARK, SHARPE_RAMP_LIGHT, divergingScale } from "@/lib/colormap";
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
    if (fills.length < MIN_FILLS) return { fillCount: fills.length, grid: null };

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
    if (hours.size < 2 || venues.length === 0) {
      return { fillCount: fills.length, grid: null };
    }

    const hourList = [...hours].sort((a, b) => a - b);
    const absMax = Math.max(
      0.1,
      ...[...grid.values()].map((cell) => Math.abs(cell.mean)),
    );
    return { venues, hourList, grid, absMax, fillCount: fills.length };
  }, [rows]);

  // Same theme resolution as components/Heatmap.tsx: the toggle stamps
  // data-theme, the OS preference fills in when it hasn't.
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const resolveTheme = () => {
      const resolved = document.documentElement.dataset.theme ?? (media.matches ? "dark" : "light");
      setIsDark(resolved === "dark");
    };
    const observer = new MutationObserver(resolveTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    media.addEventListener("change", resolveTheme);
    resolveTheme();
    return () => {
      observer.disconnect();
      media.removeEventListener("change", resolveTheme);
    };
  }, []);

  if (!view.grid) {
    /**
     * This was `if (source === "unavailable") return null` — the only surface on
     * the desk that answered a missing feed by rendering nothing at all. On the
     * Fill quality subtab that produced a blank plane below the heading: no
     * card, no explanation, nothing to distinguish it from a section that had
     * failed to mount.
     *
     * The state itself stays. It is reachable only by pressing "Live gateway" on
     * a deployment that has none, which is an explicit request for real data —
     * and answering an explicit request with generated data would override the
     * one thing the desk never overrides. So the honest answer is a card that
     * says which feed is missing and what would fill it, in the same shape the
     * populated panel uses.
     */
    return (
      <section className="card fill-quality-heatmap">
        <header className="section-heading compact">
          <div>
            <h3>Fill quality by hour and venue</h3>
            <p className="muted" role="status">
              {source === "unavailable"
                ? "no priced fills to grid · the audit feed has no source while Live gateway is selected"
                : `collecting priced fills · n=${view.fillCount} of ${MIN_FILLS}, across at least 2 UTC hours`}
            </p>
          </div>
        </header>
      </section>
    );
  }

  const colour = divergingScale(view.absMax, isDark ? SHARPE_RAMP_DARK : SHARPE_RAMP_LIGHT);

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
      <div className="table-wrap" tabIndex={0}>
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
