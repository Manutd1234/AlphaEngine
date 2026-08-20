"use client";

/**
 * Feeds & Contracts, freshness half: the gateway's observed venue feeds.
 *
 * The two halves of that rail section degrade separately — freshness comes from
 * the gateway's venue feeds, contract evidence from this function instance —
 * and one can be absent while the other is fully populated, which is why they
 * are two panes rather than one scroll. Split out of `DataTrustOverview` at the
 * pane boundary; the pane state stays in the parent.
 *
 * Nothing here substitutes for a missing figure. A venue the desk does not
 * cover reads "not covered", an unreported age reads "—", and an empty feed
 * list says the registry may still answer requests while being unable to prove
 * freshness.
 */

import type { HealthSourceFreshness, SystemHealth } from "@/components/systems/types";

import { absoluteTime } from "./trust-time";

interface FeedsFreshnessPaneProps {
  health: SystemHealth | null;
  symbol: string;
  gatewaySource: HealthSourceFreshness | null;
}

export default function FeedsFreshnessPane({ health, symbol, gatewaySource }: FeedsFreshnessPaneProps) {
  const feeds = health?.platform?.market_data.feeds ?? [];

  return (
    <section className="card data-trust-monitor" aria-labelledby="feed-monitor-heading">
      {/* portfolio-card-heading, like the four sibling cards in this file
          and every card on this surface: the two monitor cards alone
          borrowed the non-card section grammar, so equal-rank titles
          rendered at two sizes as the reader switched panes. */}
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Freshness</span>
          <h2 id="feed-monitor-heading">Observed market feeds</h2>
        </div>
        <span className="section-note">
          gateway {gatewaySource?.state?.replace("_", " ") ?? "not observed"}
        </span>
      </div>

      {feeds.length ? (
        <div className="table-wrap" tabIndex={0}>
          <table>
            <caption className="sr-only">Gateway market-feed freshness and update evidence.</caption>
            <thead>
              <tr>
                <th scope="col">Venue</th>
                <th scope="col">State</th>
                <th scope="col">{symbol} age</th>
                <th scope="col">Updates</th>
                <th scope="col">Reconnects</th>
                <th scope="col">Mode</th>
              </tr>
            </thead>
            <tbody>
              {feeds.map((feed) => {
                const instrument = feed.symbols.find((row) => row.symbol === symbol);
                return (
                  <tr key={feed.venue}>
                    <td><strong>{feed.venue}</strong></td>
                    <td>
                      <span className={`data-trust-inline-state is-${feed.status === "up" ? "good" : feed.status === "down" ? "bad" : "warn"}`}>
                        <span aria-hidden>{feed.status === "up" ? "●" : feed.status === "down" ? "✕" : "▲"}</span>
                        {feed.status}
                      </span>
                    </td>
                    <td className="num">
                      {!instrument ? "not covered" : instrument.age_seconds == null ? "—" : `${instrument.age_seconds.toFixed(2)}s`}
                    </td>
                    <td className="num">{instrument?.updates_total?.toLocaleString() ?? "—"}</td>
                    <td className="num">{feed.reconnects}</td>
                    <td>{feed.synthetic ? "synthetic" : "upstream"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="data-trust-empty">
          <strong>No gateway feed evidence.</strong>
          <p>
            The registry may still answer requests, but it cannot prove feed freshness. Gateway
            source: {gatewaySource?.state?.replace("_", " ") ?? "not exposed"}.
          </p>
        </div>
      )}

      <p className="console-footnote">
        Gateway observed at {absoluteTime(gatewaySource?.observedAt)}. Ages belong to each
        venue and symbol; fetching does not make an old feed fresh.
      </p>
    </section>
  );
}
