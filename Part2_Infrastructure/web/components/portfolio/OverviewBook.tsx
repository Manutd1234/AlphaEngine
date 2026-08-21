"use client";

/**
 * Overview's Book pane: what the book is actually holding.
 *
 * The other half of the question a reader arrives with. Standing answers "is
 * anything wrong"; this answers "what is in it" — the session's shape, the
 * positions that carry most of it, and how much room the risk desk's limits
 * leave before any of it can grow.
 *
 * Every card here is a glance with a way through to the thing itself rather
 * than a second copy of it. The full equity curve and the P&L attribution
 * waterfall live on Equity & P&L, the nine-column positions table lives on
 * Positions, and the limits live on the Risk tab. All three read the same
 * snapshot this pane does, so they cannot disagree — but only one of each pair
 * is the place to act.
 *
 * This component calls no hooks and takes no early return.
 */

import type { CSSProperties } from "react";

import { ALERT_BANDS } from "@/components/portfolio/alert-bands";
import { CrossLinkTile } from "@/components/portfolio/BookChrome";
import Sparkline from "@/components/overview/Sparkline";
import { constraintLabel, fmt, pct, usd } from "@/lib/format";
import type { EquityPoint, PortfolioPayload } from "@/lib/portfolio";
import { maxDrawdown } from "@/lib/portfolio-analytics";
import type { PortfolioRisk } from "@/lib/portfolio-risk";
import type { PortfolioSection, RiskSection } from "@/lib/sections";

/** Positions shown in the overview summary before it defers to the full table. */
const SUMMARY_ROWS = 5;

export interface OverviewBookProps {
  book: PortfolioPayload;
  /** "Live book", "Last known book" or the sandbox caption — one wording, decided once. */
  bookLabel: string;
  /** Null until enough aligned history exists to estimate a covariance. */
  risk: PortfolioRisk | null;
  equityTrack: EquityPoint[];
  /** Focus-moving section jump, so a deferral lands on the rail's tab. */
  onOpenSection: (section: PortfolioSection) => void;
  onOpenRisk: (section?: RiskSection) => void;
}

export default function OverviewBook({
  book,
  bookLabel,
  risk,
  equityTrack,
  onOpenSection,
  onOpenRisk,
}: OverviewBookProps) {
  const binding = book.risk_budget.binding_constraint;
  const positions = book.exposure.positions;
  const largest = [...positions].sort((a, b) => b.notional - a.notional).slice(0, SUMMARY_ROWS);

  return (
    <>
      {/* A glance, not a second copy. The full curve and the attribution
          waterfall live on Equity & P&L and were moved off this section
          deliberately when it grew to seven panels; this is the shape of the
          session with a way through to them, which is what Overview is for. */}
      <div className="card portfolio-glance">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">{bookLabel}</span>
            <h2>Session shape</h2>
          </div>
          <button type="button" className="text-action" onClick={() => onOpenSection("equity")}>
            Equity curve &amp; P&amp;L attribution →
          </button>
        </div>
        {equityTrack.length >= 2 ? (
          <>
            <Sparkline
              points={equityTrack.map((p) => p.equity)}
              width={520}
              height={54}
              variant="area"
              tone={
                equityTrack[equityTrack.length - 1].equity >= equityTrack[0].equity
                  ? "good"
                  : "critical"
              }
              ariaLabel="Session equity path"
            />
            <p className="muted">
              {equityTrack.length} observations
              {maxDrawdown(equityTrack)
                ? <>, deepest drawdown {pct(maxDrawdown(equityTrack)!.drawdown, 2)} from the
                    running high-water mark</>
                : ", never below its high-water mark"}
              .
            </p>
          </>
        ) : (
          <p className="muted">
            The equity track holds fewer than two observations, so there is no path to draw yet.
          </p>
        )}
      </div>

      {/* A summary, not a second copy: four columns against the full table's
          nine, and it defers rather than repeating the row actions. Both read
          the same snapshot, so they cannot disagree — but only one of them is
          the place to act on a position. */}
      <div className="card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">{bookLabel}</span>
            <h2>Largest exposures</h2>
          </div>
          <button type="button" className="text-action" onClick={() => onOpenSection("positions")}>
            All {positions.length} position{positions.length === 1 ? "" : "s"} →
          </button>
        </div>

        {largest.length ? (
          <div className="table-wrap table-wrap--clamped">
            <table>
              <caption className="sr-only">
                The {largest.length} largest positions by notional.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Instrument</th>
                  <th scope="col">Side</th>
                  <th scope="col">Notional</th>
                  <th scope="col">Share</th>
                  <th scope="col">Total P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {largest.map((position) => (
                  <tr key={position.symbol}>
                    <th scope="row">{position.symbol}</th>
                    <td className={position.side === "SHORT" ? "neg" : "pos"}>{position.side}</td>
                    <td>{usd(position.notional, 0)}</td>
                    <td>
                      {fmt(position.share_of_gross * 100, 1)}%
                      {/* Ranks four positions at a glance; the number stays first
                          and stays exact. Share of gross, so the fill is the
                          share itself with no rescaling. */}
                      <span
                        className="cell-meter"
                        aria-hidden
                        style={{ "--fill": `${position.share_of_gross * 100}%` } as CSSProperties}
                      />
                    </td>
                    <td className={position.total_pnl >= 0 ? "pos" : "neg"}>{usd(position.total_pnl, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="research-note">The book is flat — there is no exposure to rank.</p>
        )}
      </div>

      {/* Risk lives on its own tab now. What a PM needs before adding to a
          sleeve is how much room is left, so the headline numbers come along and
          the full engine is one click away.

          The click names `limits`, because that is where three of these
          four figures are computed and shown at full width — gross
          headroom, the drawdown cushion and the binding constraint are
          all rows of the limit table there. VaR 95 is the fourth and lives
          one section along on `model`; sending the reader to the panel
          that explains three of four beats sending them to whichever
          section they happened to open last, which is what a bare
          `onNavigate` could do. The label says where it lands. */}
      <CrossLinkTile<RiskSection>
        kicker="Owned by the risk desk"
        title="Limits and tail risk"
        actionLabel="Open Risk limits"
        onNavigate={onOpenRisk}
        targetSection="limits"
        metrics={[
          {
            label: "VaR 95, 1 day",
            value: risk ? usd(risk.var95, 0) : "—",
            note: risk
              ? `${pct(risk.var95 / Math.max(1, book.equity.current), 2)} of equity`
              : "needs price history",
          },
          {
            label: "Gross headroom",
            value: usd(book.risk_budget.gross_exposure.remaining, 0),
            note: `${fmt(book.risk_budget.gross_exposure.utilisation * 100, 1)}% of the cap in use`,
            tone: book.risk_budget.gross_exposure.utilisation >= ALERT_BANDS.gross ? "warn" : undefined,
          },
          {
            label: "Drawdown cushion",
            value: usd(book.risk_budget.daily_drawdown.cushion_usd, 0),
            note: `${fmt(book.risk_budget.daily_drawdown.used_pct * 100, 2)}% of ${fmt(book.risk_budget.daily_drawdown.limit_pct * 100, 2)}% used`,
            tone: book.risk_budget.daily_drawdown.utilisation >= ALERT_BANDS.drawdown ? "warn" : undefined,
          },
          {
            label: "Binding constraint",
            value: constraintLabel(binding[0]),
            note: `${fmt(binding[1] * 100, 1)}% utilised`,
          },
        ]}
      />
    </>
  );
}
