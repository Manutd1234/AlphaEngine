"use client";

/**
 * Three ways of cutting the same book, and three different claims.
 *
 * They are deliberately not presented as equivalent, because they are not:
 *
 *  - ASSET CLASS is measured. It comes from `classify`, the routing module's own
 *    classifier, reused rather than copied so it cannot drift from the judgement
 *    that decides where quotes are actually fetched.
 *  - CURRENCY is INFERRED, from the ticker's quote suffix, because no currency
 *    field exists anywhere in the payload. A ticker with no quote asset lands in
 *    `unknown` rather than being assumed into USD.
 *  - SLEEVE is FLOW, not holdings. `by_strategy` is a lifetime tally of what
 *    each sleeve has traded, and the positions payload carries no strategy tag
 *    to build current exposure from — so this is traded notional and the caption
 *    says so. Calling it "sleeve concentration" without that word would describe
 *    a chart this data cannot draw.
 */

import { compact } from "@/lib/format";
import { assetClassMix, currencyMix, sleeveMix } from "@/lib/portfolio-analytics";
import type { PortfolioPosition, StrategyAttribution } from "@/lib/portfolio";

const COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "color-mix(in srgb, var(--series-1) 55%, var(--surface-3))",
  "color-mix(in srgb, var(--series-2) 55%, var(--surface-3))",
  "color-mix(in srgb, var(--series-3) 55%, var(--surface-3))",
];

export interface CompositionStackRow {
  label: string;
  scope: string;
  provenance: "measured" | "inferred" | "flow";
  entries: ReturnType<typeof assetClassMix>;
}

export function compositionStackRows(
  positions: PortfolioPosition[],
  attribution: StrategyAttribution[],
): CompositionStackRow[] {
  return [
    { label: "Asset class", scope: "current gross exposure", provenance: "measured", entries: assetClassMix(positions) },
    { label: "Settlement", scope: "current gross exposure", provenance: "inferred", entries: currencyMix(positions) },
    { label: "Sleeve", scope: "lifetime traded notional", provenance: "flow", entries: sleeveMix(attribution) },
  ];
}

function CompositionStack({ row }: { row: CompositionStackRow }) {
  if (!row.entries.length) return <p className="muted">No {row.scope} to attribute.</p>;
  const spoken = row.entries.map((entry) => `${entry.label} ${Math.round(entry.share * 100)} percent`).join(", ");
  return (
    <div className="allocation-stack">
      <div className="allocation-stack__head">
        <strong>{row.label}</strong>
        <span>{row.scope}, {row.provenance}</span>
      </div>
      <div className="allocation-stack__track" role="img" aria-label={`${row.label}, ${row.scope}: ${spoken}`}>
        {row.entries.map((entry, index) => (
          <span key={entry.label} aria-hidden style={{
            width: `${entry.share * 100}%`, background: COLORS[index % COLORS.length],
          }} />
        ))}
      </div>
      <ul className="allocation-stack__legend">
        {row.entries.map((entry, index) => (
          <li key={entry.label} title={`${entry.value}`}>
            <i aria-hidden style={{ background: COLORS[index % COLORS.length] }} />
            <span>{entry.label}</span>
            <strong className="num">{Math.round(entry.share * 100)}%</strong>
            <small className="num">{compact(entry.value)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AllocationMixes({
  positions,
  attribution,
  generated,
}: {
  positions: PortfolioPosition[];
  attribution: StrategyAttribution[];
  generated: boolean;
}) {
  const rows = compositionStackRows(positions, attribution);

  return (
    <section className="card">
      <div className="portfolio-card-heading">
        <div>
          {/* The only card heading on this tab that carried no kicker: the
              wrapper was already here, sized for one. Thirty-five siblings
              name their subject above the title, so a reader scanning the
              left edge of the column hit one blank line here. */}
          <span className="page-kicker">Composition</span>
          <h2>Asset class, settlement and sleeve</h2>
        </div>
        {generated && <span className="section-note">generated book</span>}
      </div>

      <div className="allocation-stacks" role="group" aria-label="Portfolio composition as separate allocation scopes">
        {rows.map((row) => <CompositionStack key={row.label} row={row} />)}
      </div>

      {/* One disclosure, not three. The summary names all three provenances,
          so the claims behind each stack stay on screen while the derivation
          stays available without crowding the comparison. */}
      <details className="disclosure">
        <summary>
          What each cut measures: classified by the router, inferred from the ticker, traded flow
        </summary>
        <p className="research-note">
          <strong>Asset class</strong> is gross exposure classified by the module that routes each
          symbol&rsquo;s quotes.
        </p>
        <p className="research-note">
          <strong>Settlement currency is derived from the ticker.</strong> Positions record no
          currency, so a ticker with no quote suffix counts as unknown, not as dollars.
        </p>
        <p className="research-note">
          <strong>Sleeve is traded notional, not holdings.</strong> Positions carry no sleeve tag,
          so current exposure by sleeve cannot be derived or crossed with asset class.
        </p>
      </details>
    </section>
  );
}
