"use client";

/**
 * Every maker panel across twelve columns — the proof under the ranking.
 *
 * `DispersionStrips` ranks the panels and this is what a reader checks a number
 * against. Split out of `RfqPane` on 2026-08-25 when the section's KPI row took
 * that file past the 400-line ceiling: the house rule is to split rather than
 * shave prose, and the seam was already drawn in the pane's own comments —
 * everything here is the PANEL's evidence, and what is left there is the
 * CHANNEL's vocabulary and the four ways it can answer.
 *
 * FOLDED, AND THE SUMMARY COUNTS. It is the longest table on the tab and every
 * column is per-row detail, so it opens when a reader wants to check a figure
 * and costs nothing when they want the ranking. The summary states both the
 * shape and the size, so nobody opens it to find out how big it is.
 *
 * A DASH IS A QUANTITY THE PANEL COULD NOT PRODUCE, never a zero — the band and
 * the share are blank without a combo reading, and an unmeasured ratio is not a
 * ratio of zero.
 */

import type { CoherenceDispersion } from "@/lib/coherence/types-lab";

/** Below this many independent makers a spread is an anecdote, not a distribution. */
export const THIN_PANEL = 3;

function Row({ row }: { row: CoherenceDispersion }) {
  const band = row.lowest == null || row.highest == null ? "—" : `${row.lowest} to ${row.highest}`;
  return (
    <tr>
      <th scope="row">{row.market_ticker}</th>
      <td className="num">{row.quotes}</td>
      <td className="num">{row.usable}</td>
      <td className="num">{row.median ?? "—"}</td>
      <td className="num">{band}</td>
      <td className="num">{row.spread ?? "—"}</td>
      <td className="num">{row.median_width ?? "—"}</td>
      <td className="num">{row.crossed}</td>
      <td className="num">{row.band_width ?? "—"}</td>
      <td className="num">{row.band_fraction ?? "—"}</td>
      <td>
        {row.thin ? (
          <span>
            <span aria-hidden="true">▲</span> thin, fewer than {THIN_PANEL} makers
          </span>
        ) : (
          <span>
            <span aria-hidden="true">●</span> {THIN_PANEL} makers or more
          </span>
        )}
      </td>
      <td>
        {row.detail ? (
          <details className="disclosure">
            <summary>How this row reached its usable count</summary>
            <p>{row.detail}</p>
          </details>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

export default function DispersionTable({ rows }: { rows: CoherenceDispersion[] }) {
  return (
    <details className="disclosure">
      <summary>
        Every maker panel across twelve columns, {rows.length}{" "}
        {rows.length === 1 ? "market" : "markets"}
      </summary>
    <div className="table-wrap">
      <table className="coh-table">
        <caption className="coh-table__caption">
          Spread is the disagreement between makers, median width is one maker&rsquo;s own bid-offer — opposite
          situations. Band and share are blank without a combo reading: an unmeasured ratio is
          not a ratio of zero.
        </caption>
        <thead>
          <tr>
            <th scope="col">Market</th>
            <th scope="col" className="num">Quotes</th>
            <th scope="col" className="num">Usable</th>
            <th scope="col" className="num">Median</th>
            <th scope="col" className="num">Lowest to highest</th>
            <th scope="col" className="num">Spread between makers</th>
            <th scope="col" className="num">Median maker width</th>
            <th scope="col" className="num">Crossed</th>
            <th scope="col" className="num">Band the legs leave</th>
            <th scope="col" className="num">Share of it used</th>
            <th scope="col">Panel</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.market_ticker} row={row} />
          ))}
        </tbody>
      </table>
    </div>
    <p className="coh-rfq__note">
      Crossed quotes are counted and excluded, never averaged in: their two sides were priced at different
      moments. A dash is a quantity the panel could not produce, never a zero.
    </p>
    </details>
  );
}
