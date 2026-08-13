"use client";

/**
 * Where the book's weight sits, and where it is pressed against a limit.
 *
 * TWO MEASURES, NOT ONE, because they disagree usefully. A position can be a
 * small share of gross and still be at 96% of its own symbol limit, and that is
 * precisely the row a reader is hunting for — collapsing to a single number
 * hides it behind the large positions.
 *
 * A table with two bar columns rather than a drawn grid: the reader is
 * comparing along one axis at a time, the labels are symbols rather than
 * coordinates, and this survives wrapping, forced-colours and a screen reader
 * without a second implementation. The colour is a reinforcement — every cell
 * prints its own number.
 */

import { pct, usd } from "@/lib/format";
import { exposureCells } from "@/lib/portfolio-analytics";
import type { PortfolioPosition } from "@/lib/portfolio";

/** Above this share of its own limit a position is worth looking at. */
const TIGHT = 0.75;

export default function ExposureHeatmap({
  positions,
  generated,
}: {
  positions: PortfolioPosition[];
  generated: boolean;
}) {
  const cells = exposureCells(positions);

  if (!cells.length) {
    return (
      <section className="card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Concentration</span>
            <h2>Exposure and limit pressure</h2>
          </div>
        </div>
        <p className="muted">
          No open positions, so there is no exposure to rank. This is a flat book rather than a
          missing measurement.
        </p>
      </section>
    );
  }

  const tight = cells.filter((cell) => cell.utilisation != null && cell.utilisation >= TIGHT);

  return (
    <section className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Concentration</span>
          <h2>Exposure and limit pressure</h2>
        </div>
        <span className="section-note">{cells.length} positions</span>
      </div>

      <p className="sub">
        Share of gross beside each position&rsquo;s own symbol-limit utilisation. They are separate
        questions: a small position can still be the one closest to a hard stop.
      </p>

      <div className="table-wrap" tabIndex={0}>
        <table className="exposure-heatmap">
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">Side</th>
              <th scope="col" className="num">Notional</th>
              <th scope="col">Share of gross</th>
              <th scope="col">Symbol limit used</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((cell) => (
              <tr key={cell.symbol}>
                <td><strong>{cell.symbol}</strong></td>
                <td className={cell.side === "SHORT" ? "neg" : "pos"}>{cell.side}</td>
                <td className="num">{usd(cell.notional, 0)}</td>
                <td>
                  <span className="exposure-heatmap__bar">
                    <i style={{ width: `${Math.min(100, cell.share * 100)}%` }} />
                    <span className="num">{pct(cell.share, 1)}</span>
                  </span>
                </td>
                <td>
                  {cell.utilisation == null ? (
                    // No limit published is not an unused limit.
                    <span className="muted">no limit published</span>
                  ) : (
                    <span
                      className={`exposure-heatmap__bar${cell.utilisation >= TIGHT ? " is-tight" : ""}`}
                    >
                      <i style={{ width: `${Math.min(100, cell.utilisation * 100)}%` }} />
                      <span className="num">{pct(cell.utilisation, 0)}</span>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="research-note">
        {tight.length
          ? <>
              {tight.length} position{tight.length === 1 ? " is" : "s are"} at or above{" "}
              {pct(TIGHT, 0)} of {tight.length === 1 ? "its" : "their"} symbol limit:{" "}
              <strong>{tight.map((cell) => cell.symbol).join(", ")}</strong>. Limit pressure binds
              before concentration does.
            </>
          : <>No position is above {pct(TIGHT, 0)} of its symbol limit. The binding constraint, if
              there is one, is elsewhere.</>}
        {generated && " Generated book."}
      </p>
    </section>
  );
}
