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
          <span className="page-kicker">Composition</span>
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
          <small className="muted">
            Gross exposure, classified by the same module that routes each symbol&rsquo;s quotes.
          </small>
        </div>

        <div>
          <span className="field">Settlement currency</span>
          <DonutChart
            slices={toSlices(byCurrency)}
            emptyNote="No open position to attribute."
            ariaLabel="Gross exposure by settlement currency"
          />
          <small className="muted">
            <strong>Derived from the ticker.</strong> No currency is recorded on a position, so this
            reads the quote suffix; a symbol without one is counted as unknown rather than assumed
            into dollars.
          </small>
        </div>

        <div>
          <span className="field">Sleeve</span>
          <DonutChart
            slices={toSlices(bySleeve)}
            emptyNote="No sleeve has traded yet."
            ariaLabel="Traded notional by strategy sleeve"
          />
          <small className="muted">
            <strong>Traded notional, not holdings.</strong> The attribution table is a lifetime
            tally per sleeve and positions carry no sleeve tag, so current exposure by sleeve is not
            derivable here.
          </small>
        </div>
      </div>
    </section>
  );
}
