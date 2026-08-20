"use client";

/**
 * The Overview section: one summary strip, and two panes under it.
 *
 * Overview answers two questions that a reader arrives with one of, never both:
 * is anything wrong right now, and what is the book actually holding. The first
 * is a glance before doing something else; the second is the thing itself.
 *
 * The summary strip stays ABOVE the switcher and never moves, which is the
 * arrangement `DataTrustOverview` settled on for the same reason: equity, day
 * P&L and the binding constraint are the frame both questions are asked inside,
 * so putting them in one pane would make switching to the other read as though
 * the book had changed.
 *
 * Deliberately NOT a nested `<WorkspaceSubtabs>`: that publishes `--rail-h`
 * from a ResizeObserver, so a second rail would fight the first over every
 * sticky offset in the app. `.seg role="group"` is the house in-panel pattern,
 * as `ReliabilityOverview` uses it. And conditional renders rather than
 * `hidden`, for the same reason it gives: a switched-away pane's ResizeObserver
 * — every chart here has one — should not keep running behind the pane on
 * screen.
 *
 * The pane state is the first thing this component does and nothing returns
 * before it, which is the rule the whole file tree keeps: a selector declared
 * after an early return is the "rendered more hooks than during the previous
 * render" crash on the first snapshot that arrives.
 */

import { useState } from "react";

import NumberTicker from "@/components/common/NumberTicker";
import OverviewBook from "@/components/portfolio/OverviewBook";
import OverviewStanding from "@/components/portfolio/OverviewStanding";
import { constraintLabel, fmt, signedPct, usd } from "@/lib/format";
import { bookStatus, type EquityPoint, type PortfolioPayload } from "@/lib/portfolio";
import type { AllocationLimits, CovarianceModel, PortfolioRisk, RiskPosition } from "@/lib/portfolio-risk";
import type { PortfolioSection, RiskSection } from "@/lib/sections";

type OverviewPane = "standing" | "book";

/**
 * Two panes, never four: `.seg button` is `flex: 1`, so a fourth forces
 * abbreviated labels, and it is also the point at which a picker stops being a
 * split and becomes a second navigation the reader has to learn.
 */
const OVERVIEW_PANES: Array<{ id: OverviewPane; label: string; hint: string }> = [
  { id: "standing", label: "Standing", hint: "Soft limits inside their warning bands, and drift from a risk-model target" },
  { id: "book", label: "Book", hint: "The session's shape, the largest positions, and the room the limits leave" },
];

export interface OverviewSectionProps {
  book: PortfolioPayload;
  /** "Live book", "Last known book" or the sandbox caption — one wording, decided once. */
  bookLabel: string;
  risk: PortfolioRisk | null;
  riskPositions: RiskPosition[];
  covarianceModel: CovarianceModel | null;
  allocationLimits: AllocationLimits;
  equityTrack: EquityPoint[];
  /** Focus-moving section jump, so every deferral lands on the rail's tab. */
  onOpenSection: (section: PortfolioSection) => void;
  onOpenRisk: (section?: RiskSection) => void;
}

export default function OverviewSection({
  book,
  bookLabel,
  risk,
  riskPositions,
  covarianceModel,
  allocationLimits,
  equityTrack,
  onOpenSection,
  onOpenRisk,
}: OverviewSectionProps) {
  const [overviewPane, setOverviewPane] = useState<OverviewPane>("standing");

  const binding = book.risk_budget.binding_constraint;
  const positions = book.exposure.positions;
  const status = bookStatus(book);
  const statusColor =
    status.level === "halted" || status.level === "critical"
      ? "var(--critical-text)"
      : status.level === "elevated"
        ? "var(--warning-text)"
        : "var(--success-text)";

  return (
    <>
      {/* The strip is the frame, not a pane. It stays above the switcher and
          does not move when the switcher does, so crossing between Standing
          and Book never looks like the book itself changed underneath. */}
      <section className="portfolio-metrics" aria-label="Portfolio summary">
        <div>
          <span>Equity</span>
          <strong className="num"><NumberTicker value={book.equity.current} format={(v) => usd(v, 0)} /></strong>
          <small>start {usd(book.equity.start_of_day, 0)}</small>
        </div>
        <div>
          <span>Day P&amp;L</span>
          <strong className={`num ${book.equity.daily_pnl >= 0 ? "pos" : "neg"}`}>{usd(book.equity.daily_pnl, 0)}</strong>
          <small>{signedPct(book.equity.daily_return)}</small>
        </div>
        <div>
          <span>Exposure</span>
          <strong className="num">{usd(book.exposure.gross, 0)}</strong>
          <small>
            net {usd(book.exposure.net, 0)}, {fmt(book.exposure.leverage, 2)}×, {positions.length} position{positions.length === 1 ? "" : "s"}
          </small>
        </div>
        <div>
          <span>Binding constraint</span>
          <strong>{constraintLabel(binding[0])}</strong>
          <small className="num">{fmt(binding[1] * 100, 1)}% utilised</small>
        </div>
        <div>
          <span>Concentration</span>
          <strong className="num">{fmt(book.concentration.effective_positions, 1)}</strong>
          <small>
            effective positions; largest {fmt(book.concentration.largest_share * 100, 1)}%, top two{" "}
            {fmt(book.concentration.top_two_share * 100, 1)}%
          </small>
        </div>
        <div>
          <span>Status</span>
          {/* Derived from the tightest constraint, never asserted. A green light
              that is not computed from the limits is worse than no light. */}
          <strong style={{ color: statusColor }}>
            <span aria-hidden>{status.glyph}</span> {status.label}
          </strong>
          <small>{status.detail}</small>
        </div>
      </section>

      <div className="seg" role="group" aria-label="Overview view">
        {OVERVIEW_PANES.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={overviewPane === option.id}
            title={option.hint}
            onClick={() => setOverviewPane(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {overviewPane === "standing" && (
        <OverviewStanding
          book={book}
          bookLabel={bookLabel}
          riskPositions={riskPositions}
          covarianceModel={covarianceModel}
          limits={allocationLimits}
          onOpenSection={onOpenSection}
        />
      )}

      {overviewPane === "book" && (
        <OverviewBook
          book={book}
          bookLabel={bookLabel}
          risk={risk}
          equityTrack={equityTrack}
          onOpenSection={onOpenSection}
          onOpenRisk={onOpenRisk}
        />
      )}
    </>
  );
}
