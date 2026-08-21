"use client";

/**
 * Where the open P&L actually sits.
 *
 * The positions table sums this into one number, which cannot answer the
 * question a reader has when that number is small: is this a flat book, or two
 * large positions cancelling each other out? Those are opposite risk positions
 * that report the same total, and only one of them is quiet.
 *
 * A diverging bar per position rather than a gauge. A gauge shows one number
 * against a range and this data has no range — no target, no limit, nothing the
 * open P&L is supposed to be. What it has is a distribution across positions,
 * and a bar chart around a zero rule is the honest shape for that.
 */

import { usd } from "@/lib/format";
import { unrealisedSpread } from "@/lib/portfolio-analytics";
import type { PortfolioPosition } from "@/lib/portfolio";

export default function UnrealisedSpread({
  positions,
  generated,
}: {
  positions: PortfolioPosition[];
  generated: boolean;
}) {
  const spread = unrealisedSpread(positions);

  if (!spread.n) {
    return (
      <section className="card portfolio-shape-card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Open P&amp;L</span>
            <h2>Unrealised by position</h2>
          </div>
        </div>
        <p className="muted">
          No open position carries an unrealised figure: nothing to distribute. A flat book, not
          an unmeasured one.
        </p>
      </section>
    );
  }

  const rows = [...positions]
    .filter((p) => Number.isFinite(p.unrealized_pnl))
    .sort((a, b) => b.unrealized_pnl - a.unrealized_pnl);

  return (
    <section className="card portfolio-shape-card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Open P&amp;L</span>
          <h2>Unrealised by position</h2>
        </div>
        <span>
          {spread.winners} up, {spread.losers} down{spread.flat ? `, ${spread.flat} flat` : ""}
        </span>
      </div>

      <div className="unrealised-spread">
        {rows.map((row) => {
          const share = spread.scale > 0 ? Math.abs(row.unrealized_pnl) / spread.scale : 0;
          const up = row.unrealized_pnl > 0;
          return (
            <div key={row.symbol} className="unrealised-spread__row">
              <span className="unrealised-spread__label">{row.symbol}</span>
              {/* Two half-tracks around a shared centre, so a reader compares
                  magnitudes across the zero rule rather than reading two
                  separately-scaled charts. */}
              <span className="unrealised-spread__track">
                <i
                  className={up ? "is-up" : "is-down"}
                  style={{ width: `${share * 50}%`, [up ? "left" : "right"]: "50%" }}
                />
              </span>
              <span className={`num unrealised-spread__value ${up ? "pos" : row.unrealized_pnl < 0 ? "neg" : ""}`}>
                {usd(row.unrealized_pnl, 0)}
              </span>
            </div>
          );
        })}
      </div>

      {/* The figures stay visible; only the generalisation collapses. */}
      <p className="research-note">
        Total open P&amp;L is <strong className="num">{usd(spread.total, 0)}</strong>
        {spread.best && spread.worst && spread.best.symbol !== spread.worst.symbol ? (
          <>
            , between <strong>{spread.best.symbol}</strong> at {usd(spread.best.pnl, 0)} and{" "}
            <strong>{spread.worst.symbol}</strong> at {usd(spread.worst.pnl, 0)}.
          </>
        ) : "."}
        {generated && " Generated book."}
      </p>

      <details className="disclosure">
        <summary>What a small total can hide</summary>
        <p className="research-note">
          A flat book and two large positions cancelling report the same total; only one is quiet.
        </p>
      </details>
    </section>
  );
}
