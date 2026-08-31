"use client";

/**
 * Trust Summary's Response pane: feed tick rates, per-source response history
 * and quota headroom.
 *
 * Split out of `DataTrustOverview` at the pane boundary — `view`/`pane` state
 * and the two segmented controls stay in the parent, and each pane is a
 * conditional render, so a switched-away pane stops observing rather than
 * hiding behind an attribute.
 *
 * Everything drawn here comes off the health snapshot's second half, which is
 * built DURING the health request and is therefore populated on every poll —
 * unlike the dispatch-side counters the Composition pane draws.
 */

import GappedSparkline from "@/components/charts/GappedSparkline";
import type { SystemHealth } from "@/components/systems/types";
import { resolveLatencySource } from "@/lib/data-trust";
import { metricRow } from "@/lib/format";

import FeedThroughput from "./FeedThroughput";
import FeedFreshnessGrid from "./FeedFreshnessGrid";
import QuotaHeadroom from "./QuotaHeadroom";

export default function TrustResponsePane({ health }: { health: SystemHealth | null }) {
  const latencyWindow = health?.latencyWindow ?? null;

  return (
    <>
      <FeedThroughput health={health} />
      <FeedFreshnessGrid health={health} />

      {/* Shared row, not a stack: the sparkline rows and the normalised
          quota bars are both narrow content, so at desk width they halve
          the pane's scroll instead of each taking a full-width card. The
          980px media rule stacks them again where half a panel is too
          little. Unlike the feeds monitors that were un-paired in the last
          consolidation, neither side is a wide table. */}
      <div className="data-trust-detail-grid">
      {/* ------------------------------------------------------------------
          Response history per source.

          The samples behind these have existed on the server the whole time
          and only the aggregates ever escaped, so this tab could report a
          p95 and had no way to say whether it had been climbing.

          The BUCKET statistic is p50 and the HEADLINE is the 15-minute p95,
          and they are labelled apart: a 60-second bucket holds single-digit
          calls here, and a "p95" over three of them is the maximum wearing a
          percentile's name.
          ------------------------------------------------------------------ */}
      <section className="card" aria-labelledby="trust-latency-heading">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Freshness</span>
            <h2 id="trust-latency-heading">Per-source response history</h2>
          </div>
          <span className="section-note">
            {latencyWindow ? `${latencyWindow.buckets} × ${Math.round(latencyWindow.bucketMs / 1000)}s` : "no history"}
          </span>
        </div>

        {!latencyWindow?.series.length ? (
          <p className="muted">
            No source has enough calls in the last fifteen minutes to plot; a quiet instance,
            not a broken one.
          </p>
        ) : (
          <ul className="spark-rows">
            {latencyWindow.series.map((row) => {
              /**
               * Resolved rather than pattern-matched. The previous branch
               * tested `venue:*` and then provider ids, so `plane:gateway`
               * — recorded on EVERY health poll by this very route, and
               * therefore the densest line here — matched neither and its
               * stat chip read "—" permanently, beside a fully drawn line.
               */
              const source = resolveLatencySource(health, row.key);
              const windowSamples = row.n.reduce((sum, n) => sum + n, 0);
              const gaps = row.p50.filter((v) => v == null).length;
              return (
                <li key={row.key}>
                  <span className="spark-rows__label" title={row.key}>{source.label}</span>
                  <GappedSparkline
                    points={row.p50}
                    ariaLabel={`${source.label} response time per minute`}
                    emptyNote="too few calls to plot"
                    tone={source.stats && source.stats.errorRate > 0.05 ? "warn" : "accent"}
                  />
                  <span className="spark-rows__stat num" title={source.note ?? undefined}>
                    {/* Withheld, not zeroed: no fifteen-minute aggregate is
                        published for a plane probe, and "p95 0ms" would be
                        the fastest possible lie. */}
                    {metricRow([
                      source.stats?.p95 != null ? `p95 ${Math.round(source.stats.p95)} ms` : "p95 n/a",
                      `n=${source.stats?.n ?? windowSamples}`,
                      gaps ? `${gaps} quiet min` : null,
                    ])}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {/* Methodology folds; measurements do not. Every figure this
            paragraph explains is printed in the rows above, so the
            derivation collapses to a summary that names both statistics —
            a reader who trusts the labels never pays for the argument. */}
        <details className="disclosure">
          <summary>
            The spark is a per-minute median, the chip a fifteen-minute p95
          </summary>
          <p className="research-note">
            A minute with fewer than {latencyWindow?.minSamplesPerBucket ?? 3} calls is drawn as
            a gap, not bridged. A source shown as <strong>p95 n/a</strong> — the gateway probe
            is one — publishes no aggregate, so its sample count comes from the
            window&rsquo;s own buckets.
          </p>
        </details>
      </section>

      <QuotaHeadroom health={health} />
      </div>
    </>
  );
}
