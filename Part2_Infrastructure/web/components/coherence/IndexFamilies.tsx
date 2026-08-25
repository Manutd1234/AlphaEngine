"use client";

/**
 * The index broken down by the family each reading was measured on.
 *
 * Split out of `IndexPane` on 2026-08-25, when that file crossed the house's
 * 400-line ceiling. The rule there is to SPLIT rather than shave prose to buy a
 * line, and the seam is the one the switcher already draws: `Chart` is the
 * recorded line over time and this is the same points grouped by family, so a
 * reader can tell "the index is quiet" from "one family is unreadable and the
 * rest are flat". Neither holds state; both are pure over the payload the pane
 * has already read.
 *
 * A FAMILY THAT HAS PRODUCED NOTHING STILL GETS A ROW. The table is seeded from
 * the watched list before any point is counted, because absent from the table
 * reads as "not watched" — which is a different fact from "watched and never
 * measurable", and the second is the one worth knowing.
 */

import { fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceIndexSeries } from "@/lib/coherence/types";
import ValueStrip from "./ValueStrip";

interface FamilyRow {
  ticker: string;
  readings: number;
  measured: number;
  unmeasurable: number;
  /** The largest distance measured on this family, or null if none ever was. */
  peak: number | null;
}

function familyRows(data: CoherenceIndexSeries): FamilyRow[] {
  const rows = new Map<string, FamilyRow>();
  const rowFor = (ticker: string) => {
    const found = rows.get(ticker) ?? { ticker, readings: 0, measured: 0, unmeasurable: 0, peak: null };
    rows.set(ticker, found);
    return found;
  };
  // Seeded from the watched list first, so a family that has produced nothing
  // still gets a row: absent from the table reads as "not watched".
  for (const ticker of data.series) rowFor(ticker);
  for (const point of data.points) {
    const row = rowFor(point.series_ticker);
    row.readings += 1;
    const cc = toCenticents(point.ci);
    if (cc == null) {
      row.unmeasurable += 1;
      continue;
    }
    row.measured += 1;
    row.peak = row.peak == null || cc > row.peak ? cc : row.peak;
  }
  return [...rows.values()].sort(
    (a, b) => (b.peak ?? -1) - (a.peak ?? -1) || a.ticker.localeCompare(b.ticker),
  );
}

export default function FamilyTable({ data }: { data: CoherenceIndexSeries }) {
  const rows = familyRows(data);

  if (!rows.length) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span> No family has been polled yet.
      </p>
    );
  }

  return (
    <>
    {/* The table's decisive column drawn (third review, 2026-08-24): which
        family drives the index. A family with no measured reading declines
        its bar — a peak nobody measured is not a peak of zero. */}
    <ValueStrip
      caption="The worst distance ever measured, family by family"
      ariaLabel={`Peak distance per family for ${rows.length} watched families`}
      rows={rows.map((row) => ({
        label: row.ticker,
        value: row.peak,
        text: row.peak == null ? "—" : fromCenticents(row.peak) ?? "—",
        title: `${row.ticker}: ${row.readings} readings, ${row.measured} measured, ${row.unmeasurable} unmeasurable`,
        noBar: row.peak == null ? (row.readings ? "never measured" : "never polled") : undefined,
      }))}
      notes={[
        "A reading is the L1 distance from the family's MID prices to the nearest vector summing to a dollar — "
        + "mid, because consistency is a property of the prices and tradability of the book.",
      ]}
    />
    {/* The strip answers the view's question — which family drives the index —
        so the four counts behind each bar go behind a summary (fourth review
        of 2026-08-24). They are per-row detail: how many polls a family has
        had, how many of them could be measured, and how many could not. A
        reader auditing a family's coverage opens one disclosure; a reader
        asking which family is worst never has to. */}
    <details className="disclosure">
      <summary>{`Readings, measured and unmeasurable for each watched family, ${rows.length} rows`}</summary>
    <div className="table-wrap">
      <table className="coh-table">
        <caption className="coh-table__caption">
          One row per watched family, worst peak first. An unmeasurable poll is counted in its own column, never
          folded into the measured ones.
        </caption>
        <thead>
          <tr>
            <th scope="col">Family</th>
            <th scope="col" className="num">Readings</th>
            <th scope="col" className="num">Measured</th>
            <th scope="col" className="num">Unmeasurable</th>
            <th scope="col" className="num">Peak distance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ticker}>
              <th scope="row">{row.ticker}</th>
              <td className="num">{row.readings}</td>
              <td className="num">{row.measured}</td>
              <td className="num">{row.unmeasurable}</td>
              <td className="num">
                {row.peak == null ? <span className="muted">—</span> : fromCenticents(row.peak)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </details>
    </>
  );
}
