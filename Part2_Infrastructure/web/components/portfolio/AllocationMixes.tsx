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

import DonutChart, { type DonutSlice } from "@/components/common/DonutChart";
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

const toSlices = (mix: ReturnType<typeof assetClassMix>): DonutSlice[] =>
  mix.map((entry, index) => ({
    label: entry.label,
    value: entry.value,
    colour: COLORS[index % COLORS.length],
  }));

export default function AllocationMixes({
  positions,
  attribution,
  generated,
}: {
  positions: PortfolioPosition[];
  attribution: StrategyAttribution[];
  generated: boolean;
}) {
  const byClass = assetClassMix(positions);
  const byCurrency = currencyMix(positions);
  const bySleeve = sleeveMix(attribution);

  return (
    <section className="card">
      <div className="portfolio-card-heading">
        <div>
          <h2>Asset class, settlement and sleeve</h2>
        </div>
        {generated && <span className="section-note">generated book</span>}
      </div>

      <div className="allocation-mixes">
        <div>
          <span className="field">Asset class</span>
          <DonutChart
            slices={toSlices(byClass)}
            emptyNote="No open position to classify."
            ariaLabel="Gross exposure by asset class"
          />
        </div>

        <div>
          <span className="field">Settlement currency</span>
          <DonutChart
            slices={toSlices(byCurrency)}
            emptyNote="No open position to attribute."
            ariaLabel="Gross exposure by settlement currency"
          />
        </div>

        <div>
          <span className="field">Sleeve</span>
          <DonutChart
            slices={toSlices(bySleeve)}
            emptyNote="No sleeve has traded yet."
            ariaLabel="Traded notional by strategy sleeve"
          />
        </div>
      </div>

      {/* One disclosure, not three. The summary names all three provenances,
          so the claims that each ring means something different — and that two
          of them are not measurements — stay on screen while the ~450
          characters explaining them do not. */}
      <details className="disclosure">
        <summary>
          What each cut measures: classified by the router, inferred from the ticker, and traded flow
        </summary>
        <p className="research-note">
          <strong>Asset class</strong> is gross exposure classified by the module that routes each
          symbol&rsquo;s quotes.
        </p>
        <p className="research-note">
          <strong>Settlement currency is derived from the ticker.</strong> No currency is recorded
          on a position, so a symbol with no quote suffix counts as unknown, not as dollars.
        </p>
        <p className="research-note">
          <strong>Sleeve is traded notional, not holdings.</strong> Positions carry no sleeve tag,
          so current exposure by sleeve cannot be derived.
        </p>
      </details>
    </section>
  );
}
