"use client";

/**
 * Overview's Standing pane: is anything asking for attention right now.
 *
 * The half of Overview a reader arrives at with a glance rather than a
 * question. Both cards it was originally given are conditional — no alert
 * fires until a symbol has spent its warning band, and the drift banner needs
 * both a covariance and enough drift to be worth a trade — so on the quiet book
 * that is the normal case this pane would have rendered as a blank plane. A
 * blank plane is indistinguishable from a section that failed to mount, so the
 * summary card below the two conditionals always renders and states the answer
 * instead of leaving it to be inferred from an absence.
 *
 * Every threshold it tests and every threshold it quotes comes from
 * `alert-bands`; nothing on this page invents a limit the risk desk did not
 * set. This component calls no hooks and takes no early return.
 */

import { ALERT_BANDS, DRIFT_PROMPT } from "@/components/portfolio/alert-bands";
import { fmt, pct, usd } from "@/lib/format";
import type { PortfolioPayload } from "@/lib/portfolio";
import {
  proposeAllocation,
  type AllocationLimits,
  type CovarianceModel,
  type RiskPosition,
} from "@/lib/portfolio-risk";
import type { PortfolioSection } from "@/lib/sections";

export interface OverviewStandingProps {
  book: PortfolioPayload;
  /** "Live book", "Last known book" or the sandbox caption — one wording, decided once. */
  bookLabel: string;
  /** The same book in the shape the risk model consumes — not `book.exposure.positions`. */
  riskPositions: RiskPosition[];
  /** Null when the instruments share too little history to build one. */
  covarianceModel: CovarianceModel | null;
  limits: AllocationLimits;
  /** Focus-moving section jump, so the drift prompt lands on the rail's tab. */
  onOpenSection: (section: PortfolioSection) => void;
}

export default function OverviewStanding({
  book,
  bookLabel,
  riskPositions,
  covarianceModel,
  limits,
  onOpenSection,
}: OverviewStandingProps) {
  // Book-level drift against the panel's default target. Half the sum of the
  // absolute drifts, because every dollar that has to move is counted once on
  // the way out and once on the way in.
  const defaultProposal = covarianceModel
    ? proposeAllocation(riskPositions, covarianceModel, "inverse_vol", limits)
    : null;
  const bookDrift = defaultProposal
    ? defaultProposal.targets.reduce((acc, t) => acc + Math.abs(t.drift), 0) / 2
    : null;

  // Derived strictly from limits the gateway already publishes. No threshold is
  // invented here: a warning this page made up would be a warning the risk desk
  // never agreed to.
  const alerts: Array<{ tone: "warn" | "critical"; glyph: string; word: string; detail: string }> = [];
  for (const position of book.exposure.positions) {
    const used = position.symbol_limit.utilisation;
    if (used >= ALERT_BANDS.symbolAtCap) {
      alerts.push({
        tone: "critical", glyph: "▲", word: "At cap",
        detail: `${position.symbol} is at ${fmt(used * 100, 1)}% of its symbol limit — ${usd(position.symbol_limit.remaining, 0)} of room left.`,
      });
    } else if (used >= ALERT_BANDS.symbolNear) {
      alerts.push({
        tone: "warn", glyph: "◆", word: "Near cap",
        detail: `${position.symbol} has spent ${fmt(used * 100, 1)}% of its symbol limit.`,
      });
    }
  }
  if (book.risk_budget.gross_exposure.utilisation >= ALERT_BANDS.gross) {
    alerts.push({
      tone: "critical", glyph: "▲", word: "Gross",
      detail: `Gross exposure is at ${fmt(book.risk_budget.gross_exposure.utilisation * 100, 1)}% of the cap — adding to any sleeve needs room made elsewhere.`,
    });
  }
  if (book.risk_budget.daily_drawdown.utilisation >= ALERT_BANDS.drawdown) {
    alerts.push({
      tone: "critical", glyph: "▲", word: "Drawdown",
      detail: `${fmt(book.risk_budget.daily_drawdown.utilisation * 100, 0)}% of the daily drawdown budget is spent; reduce-only engages at ${fmt(ALERT_BANDS.drawdown * 100, 0)}%.`,
    });
  }

  return (
    <>
      {alerts.length > 0 && (
        <div className="card portfolio-alerts">
          <div className="portfolio-card-heading">
            <div>
              <span className="page-kicker">Soft limits</span>
              <h2>Wants attention</h2>
            </div>
            <span>enforced at the gate</span>
          </div>
          <ul>
            {alerts.map((alert) => (
              <li key={alert.detail} className={`is-${alert.tone}`}>
                {/* Icon, word and colour together. Colour alone would leave the
                    severity unreadable to anyone who cannot separate the two
                    hues, and these are the rows that matter most. */}
                <span aria-hidden>{alert.glyph}</span>
                <strong>{alert.word}</strong>
                <span>{alert.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {bookDrift != null && bookDrift >= DRIFT_PROMPT && (
        <div className="banner context-change" role="status">
          <div>
            <strong>Book drift is {pct(bookDrift, 1)}</strong> against an inverse-volatility
            target — past the point where rebalancing costs less than the drift.
          </div>
          <button type="button" onClick={() => onOpenSection("allocation")}>
            Open allocation
          </button>
        </div>
      )}

      {/* Both cards above are conditional, and on a quiet book neither
          renders — which would leave this pane a blank plane, and a blank
          plane is indistinguishable from a section that failed to mount.
          So the answer to "is anything wrong" is stated rather than left
          to be inferred from an absence.

          It also prints the drift, which otherwise appears only when it
          is large enough to prompt: a drift under that mark was measured
          and then shown to nobody, and a drift that could not be measured
          at all is a third state again — the covariance needs shared price
          history these instruments may not have. Rendering that one as
          "0%" would turn "we cannot tell" into "nothing to do". */}
      <div className="card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Standing</span>
            <h2>{alerts.length ? "Something is asking for attention" : "Nothing is asking for attention"}</h2>
          </div>
          <span>{bookLabel}</span>
        </div>
        <p className="sub">
          {alerts.length
            ? `${alerts.length} limit${alerts.length === 1 ? " is" : "s are"} inside a warning band, `
              + "each quoting the published limit it was read from."
            : `No position has spent ${fmt(ALERT_BANDS.symbolNear * 100, 0)}% of its symbol cap, `
              + `gross exposure is under ${fmt(ALERT_BANDS.gross * 100, 0)}% of its limit, and less `
              + `than ${fmt(ALERT_BANDS.drawdown * 100, 0)}% of the daily drawdown budget is spent.`}
        </p>
        {/* Nothing when the prompt is up. That branch read "Book drift
            is 20.3% against an inverse-volatility target, which is what
            the prompt above is about" — a sentence whose whole content is
            a pointer at a banner four lines higher that already carries
            the same figure and says what to do with it. The other two
            branches say something the banner does not. */}
        {(bookDrift == null || bookDrift < DRIFT_PROMPT) && (
          <p className="research-note">
            {bookDrift == null
              ? "Drift is not measured: these instruments share too little price history for a "
                + "covariance, so there is no target to measure against"
                + " — which is not the same as being on target."
              : `Book drift is ${pct(bookDrift, 1)} against an inverse-volatility target — under the `
                + `${pct(DRIFT_PROMPT, 0)} at which this page raises the rebalancing prompt.`}
          </p>
        )}
      </div>
    </>
  );
}
