"use client";

/**
 * Which venue filled the desk, and how much of it is not attributable.
 *
 * DELIBERATELY NOT "venue fill ratio". A fill ratio per venue would need, for
 * each venue, the orders it was offered and the orders it filled — and this
 * data cannot supply the denominator: `venue` is non-null only on fills,
 * because an order that never filled never reached a venue. What is computable
 * is the venue MIX of fills, which is what this draws and what the heading
 * says.
 *
 * `unattributed` is printed rather than absorbed. Dropping untagged fills would
 * make this chart's total disagree with the fill count in the KPI row directly
 * above it, and a reader who notices that has no way to tell which is wrong.
 */

import DonutChart, { type DonutSlice } from "@/components/common/DonutChart";
import { fmt } from "@/lib/format";
import { venueQuality, type BlotterRow } from "@/lib/blotter";

/** Fixed order, never cycled — the same rule the categorical tokens follow. */
const SLICE_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "color-mix(in srgb, var(--series-1) 55%, var(--surface-3))",
  "color-mix(in srgb, var(--series-2) 55%, var(--surface-3))",
  "color-mix(in srgb, var(--series-3) 55%, var(--surface-3))",
];

export default function VenueMixDonut({
  rows,
  source = "live",
}: {
  rows: BlotterRow[];
  source?: "live" | "sandbox" | "unavailable";
}) {
  const mix = venueQuality(rows);

  if (source === "unavailable") {
    return (
      <section className="card">
        <header className="section-heading compact">
          <div>
            <h3>Share of fills by venue</h3>
          </div>
        </header>
        <p className="muted">
          No audit log is reachable here, so there are no fills to attribute to a venue.
        </p>
      </section>
    );
  }

  const slices: DonutSlice[] = mix.venues.map((venue, index) => ({
    label: venue.venue,
    value: venue.fills,
    colour: SLICE_COLORS[index % SLICE_COLORS.length],
  }));

  const top = mix.venues[0] ?? null;

  return (
    <section className="card">
      {/* section-heading compact + h3, matching its Where-pane peer — see the
          note in SpreadDecomposition for why the portfolio grammar left. The
          early return above kept it after this branch lost it, so an empty
          pane showed both grammars and an "Execution venues" kicker no reader
          of a populated panel ever meets; the h3 already says which venues and
          what is counted. */}
      <header className="section-heading compact">
        <div>
          <h3>Share of fills by venue</h3>
        </div>
        <span className="section-note">{mix.totalFills} fills</span>
      </header>

      <DonutChart
        slices={slices}
        centreValue={top ? `${Math.round((top.fills / Math.max(1, mix.totalFills)) * 100)}%` : undefined}
        centreLabel={top?.venue}
        emptyNote="No priced fill has been attributed to a venue in this window."
        ariaLabel="Share of fills by venue"
      />

      {mix.venues.length > 0 && (
        <div className="table-wrap" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Venue</th>
                <th className="num">Fills</th>
                <th className="num">Notional</th>
                <th className="num">Effective spread</th>
                <th className="num">Mean slippage</th>
              </tr>
            </thead>
            <tbody>
              {mix.venues.map((venue) => (
                <tr key={venue.venue}>
                  <td><strong>{venue.venue}</strong></td>
                  <td className="num">{venue.fills}</td>
                  <td className="num">${fmt(venue.notional)}</td>
                  <td className="num">
                    {venue.effectiveSpreadBps != null ? `${venue.effectiveSpreadBps.toFixed(1)} bps` : "—"}
                  </td>
                  <td className="num">
                    {venue.meanSlippageBps != null ? `${venue.meanSlippageBps.toFixed(1)} bps` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Both of these stay on screen. The unattributed count is a figure a
          reader acts on — it is the only thing reconciling this ring with the
          fill count in the KPI row above, per this file's opening note — and
          "Generated desk." is a generated-data statement. Only the reason a MIX
          is the measurable thing folds, below. */}
      {(mix.unattributed > 0 || source === "sandbox") && (
        <p className="research-note">
          {mix.unattributed > 0
            && `${mix.unattributed} fill${mix.unattributed === 1 ? "" : "s"} carr${mix.unattributed === 1 ? "ies" : "y"} no venue tag and ${mix.unattributed === 1 ? "is" : "are"} excluded from the ring.`}
          {source === "sandbox" && " Generated desk."}
        </p>
      )}

      {/* A scope caveat, not a measurement. The heading and the fill count in
          the section note already state what IS being counted, so folding the
          reason the other measure is impossible costs the reader nothing at
          rest and the summary still names the question. */}
      <details className="disclosure">
        <summary>What is missing from the denominator?</summary>
        <p className="research-note">
          Share of <em>fills</em>, not a fill ratio: an order that never filled never reached a venue,
          so the audit log holds no denominator for one.
        </p>
      </details>
    </section>
  );
}
