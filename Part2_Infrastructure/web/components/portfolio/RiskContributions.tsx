"use client";

/**
 * Who is causing the book's volatility.
 *
 * The gateway reports notional, and notional is not risk. A $1.15M short in BNB
 * and a $1.45M long in SOL are similar numbers that do opposite things to the
 * variance of the book, and no exposure table can show that. The Euler
 * decomposition splits total volatility into per-position contributions that
 * **sum to the total**, which is what makes "cut this to lose the most risk per
 * dollar" answerable.
 *
 * Its own card rather than a section of the risk engine: the engine answers how
 * much can be lost, this answers who is causing it, and a reader should be able
 * to land on one without scrolling past the other.
 */

import { pct, usd } from "@/lib/format";
import type { PortfolioRisk } from "@/lib/portfolio-risk";

interface RiskContributionsProps {
  contributions: PortfolioRisk["contributions"];
}

export default function RiskContributions({ contributions }: RiskContributionsProps) {
  // Once, not once per row. This was recomputed inside the map, which made the
  // table O(n squared) in a component that re-renders on every 15s book poll.
  const totalGross = contributions.reduce((acc, c) => acc + Math.abs(c.signedNotional), 0);

  return (
    <div className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Where the risk lives</span>
          <h2>Risk contribution</h2>
        </div>
        <span>{contributions.length} positions</span>
      </div>

      <p className="sub">
        Sums to the book&apos;s total volatility, so it answers what to cut — not what is largest.
      </p>

      <div className="table-wrap" tabIndex={0}>
        <table>
          <caption className="sr-only">
            Per-position share of notional against share of portfolio volatility, with standalone
            volatility.
          </caption>
          <thead>
            <tr>
              <th scope="col">Instrument</th>
              <th scope="col">Notional</th>
              <th scope="col">Share of book</th>
              <th scope="col">Standalone vol</th>
              <th scope="col">Risk share</th>
              <th scope="col">Contribution</th>
            </tr>
          </thead>
          <tbody>
            {contributions.map((c) => {
              const notionalShare = Math.abs(c.signedNotional) / Math.max(1, totalGross);
              const diverges = Math.abs(c.contributionShare - notionalShare) > 0.1;
              return (
                <tr key={c.symbol}>
                  <td>{c.symbol}</td>
                  <td className={c.signedNotional >= 0 ? "pos" : "neg"}>{usd(c.signedNotional, 0)}</td>
                  <td>{pct(notionalShare, 1)}</td>
                  <td>{pct(c.standaloneVol, 1)}</td>
                  <td className={c.contributionShare < 0 ? "pos" : undefined}>
                    {pct(c.contributionShare, 1)}
                    {/* A hedge takes risk OUT. Worth naming, since a negative
                        percentage is easy to read as an error. */}
                    {c.contributionShare < 0 && <span className="muted">, hedge</span>}
                    {/* "its size" named the Share of book column, which is two
                        cells to the left and on screen. One word instead, and a
                        comma to match the ", hedge" sibling above. */}
                    {diverges && c.contributionShare >= 0 && (
                      <span className="muted">
                        , {c.contributionShare > notionalShare ? "over" : "under"}-risked
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className="risk-bar"
                      role="img"
                      aria-label={`${pct(c.contributionShare, 1)} of book volatility`}
                    >
                      <i
                        style={{
                          width: `${Math.min(100, Math.abs(c.contributionShare) * 100)}%`,
                          background: c.contributionShare < 0 ? "var(--series-3)" : "var(--series-1)",
                        }}
                        aria-hidden
                      />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
