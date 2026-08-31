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
 * A ROW OF IDENTICAL CELLS IS NOT A CALM VENUE. `paper_equity_slippage_bps`
 * reached every PAPER_EQUITY fill as the same 8.0, so that venue's row printed
 * 8.0 in every hour it traded and read as the steadiest venue on the grid. The
 * ramp cannot say that; a row header can. Each venue therefore carries the mark
 * `venueProvenance` already computes for the cost card beside it — one source
 * for the verdict, so the two panes cannot disagree on screen about whether a
 * venue was measured.
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

import { MIN_PRICED_FILLS, venueQuality, type BlotterRow, type ProvenanceMark } from "@/lib/blotter";
import { SHARPE_RAMP_DARK, SHARPE_RAMP_LIGHT, divergingScale, readableRampInk } from "@/lib/colormap";
import { fmt } from "@/lib/format";

/* The floor lives in lib/blotter.ts now: three panels on this subtab report
   against it, and a local copy is how one of them ends up disagreeing with the
   other two about whether there is enough evidence to draw. */
const MIN_FILLS = MIN_PRICED_FILLS;

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

    // Same computation the cost pane draws its Basis column from, not a second
    // opinion. `venueQuality` groups on status === "FILLED" where this grid
    // groups on `accepted`, so a venue can carry a mark and no cell; indexing
    // by name rather than by position keeps that harmless.
    const marks = new Map<string, ProvenanceMark>(
      venueQuality(rows).venues.map((v) => [v.venue, v.provenance.mark]),
    );

    const hourList = [...hours].sort((a, b) => a - b);
    const absMax = Math.max(
      0.1,
      ...[...grid.values()].map((cell) => Math.abs(cell.mean)),
    );
    return { venues, hourList, grid, absMax, marks, fillCount: fills.length };
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
                ? "no priced fills to grid; the audit feed has no source while Live gateway is selected"
                : `collecting priced fills, n=${view.fillCount} of ${MIN_FILLS}, across at least 2 UTC hours`}
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
                <th scope="row">
                  {venue}{" "}
                  {(() => {
                    const mark = view.marks.get(venue);
                    if (!mark) return null;
                    return (
                      <span className={`pill pill--${mark.tone === "warn" ? "warn" : "info"}`}>
                        <span aria-hidden>{mark.glyph}</span> {mark.word}
                      </span>
                    );
                  })()}
                </th>
                {view.hourList.map((hour) => {
                  const cell = view.grid.get(`${venue}:${hour}`);
                  if (!cell) {
                    // An empty cell is "no fills this hour", not zero slippage.
                    return <td key={hour} className="is-empty" aria-label={`${venue}, ${hour}:00 UTC: no fills`} />;
                  }
                  const fill = colour(cell.mean);
                  return (
                    <td
                      key={hour}
                      className="num"
                      style={{ background: fill, color: readableRampInk(fill) }}
                      title={`${venue} at ${String(hour).padStart(2, "0")}:00 UTC: ${fmt(cell.mean, 2)} bps over ${cell.count} fill${cell.count === 1 ? "" : "s"}`}
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
      {/* Methodology and a chart-reading rule, folded where SpreadDecomposition
          and VenueMixDonut beside it fold theirs: what the cells measure, over
          which sample, bucketed how, and which way the ramp runs.

          Nothing measured leaves the screen with it. Every cell prints its own
          signed number and carries venue, hour, mean and fill count on its
          title, so the colour was never the only reading — and the sample floor
          has its own at-rest sentence in the branch above, which is the one a
          reader would be wrong not to have seen. */}
      <details className="disclosure">
        <summary>How to read this grid</summary>
        <p className="research-note">
          Mean realised slippage (bps) across {view.fillCount}
          {source === "sandbox" ? " generated" : ""} priced fills by UTC hour;
          red pays up, blue beats the reference.
        </p>
        {/* The rule the ramp cannot express, folded beside the one it can. */}
        <p className="research-note">
          A venue marked ASSUMED prints the same figure in every hour because the gateway assigned it
          one, not because the venue was steady. The mark comes from the cost pane&apos;s own
          dispersion test, and a venue marked UNSTATED is one whose fills never said whether they
          were simulated — that is an unanswered question, not a clean bill.
        </p>
      </details>
    </section>
  );
}
