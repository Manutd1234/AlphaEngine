"use client";

/**
 * Portfolio manager's tab: what the book owns, and whether the shape of it is
 * the shape that was intended.
 *
 * The limits themselves live on the Risk tab. What stays here is the subset a PM
 * acts on — how much of each cap is spent, and which one binds first — because
 * "should I add to this sleeve" is an allocation question answered by a limit,
 * and sending someone to another tab to learn they have no room would make this
 * page lie by omission.
 *
 * The five sections answer five different questions and were one scroll until
 * they were split: what is the book worth (overview), how did it get there
 * (equity), what exactly is in it (positions), what should be in it
 * (allocation), and which sleeve earned it (performance). Four of those have
 * since split again, in-panel — Overview into Standing/Book, Positions into
 * Holdings/Shape/Exit, Allocation into Mix/Targets/Composition and Performance
 * into its two time bases — because a section that answers one question with
 * eight cards is a scroll wearing a subtab's name.
 * Real-time monitoring and static target allocation are not the
 * same activity, and a page that interleaves them asks the reader to hold both
 * at once.
 */

import { useState, type CSSProperties } from "react";

import NumberTicker from "@/components/common/NumberTicker";
import Sparkline from "@/components/overview/Sparkline";
import RowMenu from "@/components/common/RowMenu";
import StatTile from "@/components/StatTile";
import AllocationDonut from "@/components/portfolio/AllocationDonut";
import AllocationPanel from "@/components/portfolio/AllocationPanel";
import AllocationMixes from "@/components/portfolio/AllocationMixes";
import ExposureHeatmap from "@/components/portfolio/ExposureHeatmap";
import RiskAdjustedTrend from "@/components/portfolio/RiskAdjustedTrend";
import UnrealisedSpread from "@/components/portfolio/UnrealisedSpread";
import { BookChrome, BookFallback, BookSourceControl, CrossLinkTile } from "@/components/portfolio/BookChrome";
import EquityCurve from "@/components/portfolio/EquityCurve";
import ExecutionHandoff, { type HandoffIntent } from "@/components/portfolio/ExecutionHandoff";
import PnlWaterfall from "@/components/portfolio/PnlWaterfall";
import LiquidityPanel from "@/components/portfolio/LiquidityPanel";
import WorkingOrders from "@/components/portfolio/WorkingOrders";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { compact, fmt, formatDuration, pct, signedPct, usd } from "@/lib/format";
import { buildPnlWaterfall } from "@/lib/pnl-attribution";
import { proposeAllocation } from "@/lib/portfolio-risk";
import { bookStatus } from "@/lib/portfolio";
import { maxDrawdown } from "@/lib/portfolio-analytics";
import { PORTFOLIO_SECTIONS, type PortfolioSection, type RiskSection } from "@/lib/sections";
import type { BookView } from "@/lib/use-book";

export type PortfolioFocusDestination = "research" | "live" | "data";

export interface PortfolioWorkspaceProps {
  view: BookView;
  workspaceSymbol: string;
  onFocusSymbol: (symbol: string, destination: PortfolioFocusDestination) => void;
  /**
   * The section is optional so a caller that can only switch tabs stays valid.
   * The cross-link tile names the panel that explains its figures; a handler
   * that ignores the argument lands wherever the reader last was, which is the
   * behaviour this argument exists to end.
   */
  onOpenRisk: (section?: RiskSection) => void;
  /** Operator credential shared with the Reliability tab and the header. */
  operatorToken?: string;
  section: PortfolioSection;
  onSectionChange: (section: PortfolioSection) => void;
  /** False while this workspace is mounted but hidden behind another tab. */
  active?: boolean;
}

export { PORTFOLIO_SECTION_IDS, type PortfolioSection } from "@/lib/sections";

/** Positions shown in the overview summary before it defers to the full table. */
const SUMMARY_ROWS = 5;

/**
 * The utilisations at which Overview starts saying something, in one place.
 *
 * They were three literals inside the alert loop and two more on the risk tile.
 * The Standing summary now quotes them back to the reader — "no position has
 * spent 75% of its symbol cap" — and prose repeating a number that lives in a
 * condition is prose that goes wrong the first time the condition is retuned.
 * None of these is a limit: the gateway owns and enforces those. These are the
 * points at which a published limit is close enough to be worth a sentence.
 */
const ALERT_BANDS = {
  /** A symbol worth naming. */
  symbolNear: 0.75,
  /** …and the one to make room in first. */
  symbolAtCap: 0.9,
  gross: 0.9,
  /** The gateway's own figure: reduce-only engages here. */
  drawdown: 0.8,
} as const;

/**
 * The drift at which Overview offers the allocation panel.
 *
 * Unlike the bands above this one really is this page's own, so the Standing
 * summary attributes it to the page rather than to the risk desk.
 */
const DRIFT_PROMPT = 0.05;

/**
 * The four sections that outgrew a scroll, each with one in-panel split.
 *
 * Positions was eight cards and Allocation four, which is where this pattern
 * started; Overview was six and Performance five. Two or three panes, never
 * four: `.seg button` is `flex: 1`, so a fourth forces abbreviated labels, and
 * it is also the point at which a picker stops being a split and becomes a
 * second navigation the reader has to learn.
 *
 * Deliberately NOT a nested `<WorkspaceSubtabs>`: that publishes `--rail-h`
 * from a ResizeObserver and asserts exactly one rail is mounted, so a second
 * would fight the first over every sticky offset in the app. `.seg role="group"`
 * is the house in-panel pattern, as `ReliabilityOverview` uses it.
 *
 * And conditional renders rather than `hidden`, for the same reason it gives:
 * a switched-away pane's ResizeObserver — every chart here has one — should not
 * keep running behind the pane on screen.
 */
type OverviewPane = "standing" | "book";
type PositionsPane = "holdings" | "shape" | "exit";
type AllocationPane = "mix" | "targets" | "composition";
type PerformancePane = "flow" | "trend";

/**
 * Overview answers two questions that a reader arrives with one of, never both:
 * is anything wrong right now, and what is the book actually holding. The first
 * is a glance before doing something else; the second is the thing itself.
 *
 * The summary strip stays ABOVE this switcher and never moves, which is the
 * arrangement `DataTrustOverview` settled on for the same reason: equity, day
 * P&L and the binding constraint are the frame both questions are asked inside,
 * so putting them in one pane would make switching to the other read as though
 * the book had changed.
 */
const OVERVIEW_PANES: Array<{ id: OverviewPane; label: string; hint: string }> = [
  { id: "standing", label: "Standing", hint: "Whether anything is asking for attention right now: soft limits inside their warning bands, and how far the book has drifted from a risk-model target" },
  { id: "book", label: "Book", hint: "What the book is holding — the session's shape, the largest positions in it, and how much room the risk desk's limits leave" },
];

const POSITIONS_PANES: Array<{ id: PositionsPane; label: string; hint: string }> = [
  { id: "holdings", label: "Holdings", hint: "Every open position, what it is worth, and the actions on it" },
  { id: "shape", label: "Shape", hint: "Where the weight sits against each symbol's own cap, and how the unrealised P&L is spread across the book" },
  { id: "exit", label: "Exit", hint: "What getting out would cost at a chosen participation rate, and the orders already working" },
];

/**
 * The cleanest one-source-per-pane split in the app. Mix and Composition read
 * the positions payload alone; only Targets needs a covariance. So on a book
 * with too little shared history to build one — a new symbol, a short session —
 * a single pane goes quiet and says why, instead of a dead grey slab wedged
 * between two charts that are working perfectly well.
 */
const ALLOCATION_PANES: Array<{ id: AllocationPane; label: string; hint: string }> = [
  { id: "mix", label: "Mix", hint: "What the book is concentrated in right now, measured from notional alone" },
  { id: "targets", label: "Targets", hint: "What the book should be under a risk model, and the trades that would close the gap — needs a covariance" },
  { id: "composition", label: "Composition", hint: "Asset class, settlement currency and sleeve: three cuts of the same book making three different claims" },
];

/**
 * The one split in this file drawn along a time base rather than a subject.
 *
 * Performance held two kinds of number that must never be read as one series.
 * The flow tables and the execution-quality tiles are all lifetime: the gateway
 * builds them from `execution_stats()`, which is `FROM orders` with no session
 * filter, so they cover every order since the audit log was opened. The
 * drawdown and rolling-Sharpe plots are measured from the equity track this tab
 * has collected, which starts empty on every load. The card below already warns
 * in prose that mixing the two subtracts a lifetime fee bill from one day's
 * P&L; the switcher makes that boundary something the reader crosses instead of
 * a paragraph under a table.
 *
 * So the labels carry the time base rather than only the subject. Naming the
 * panes "Flow" and "Quality" would have split them by what they measure and
 * left the boundary the prose is warning about inside one of the halves.
 */
const PERFORMANCE_PANES: Array<{ id: PerformancePane; label: string; hint: string }> = [
  { id: "flow", label: "Flow, lifetime", hint: "Every audited order since the log was opened — attributed by sleeve, by instrument, and totalled desk-wide" },
  { id: "trend", label: "Trend, this session", hint: "How far under water this session went and whether its return was worth its own variance, measured from the equity track this tab has collected" },
];

/**
 * `attribution.by_symbol` and `execution_quality` are typed as loose records
 * because the gateway's own shape has widened twice. A field that is absent, or
 * present as something other than a finite number, reads as "not measured"
 * rather than as zero.
 */
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export default function PortfolioWorkspace({
  view,
  workspaceSymbol,
  onFocusSymbol,
  onOpenRisk,
  operatorToken,
  section,
  onSectionChange,
  active = true,
}: PortfolioWorkspaceProps) {
  const [handoff, setHandoff] = useState<HandoffIntent | null>(null);
  // Above the `!book` bail-out, with every other hook: a pane selector declared
  // after an early return is the "rendered more hooks than during the previous
  // render" crash on the first snapshot that arrives.
  const [overviewPane, setOverviewPane] = useState<OverviewPane>("standing");
  const [positionsPane, setPositionsPane] = useState<PositionsPane>("holdings");
  const [allocationPane, setAllocationPane] = useState<AllocationPane>("mix");
  const [performancePane, setPerformancePane] = useState<PerformancePane>("flow");
  const selectedSymbol = workspaceSymbol.trim().toUpperCase();

  const {
    book,
    isStale,
    risk,
    riskPositions,
    covarianceModel,
    allocationLimits,
    riskShare,
    betaBySymbol,
    equityTrack,
    periods,
    historyBackfilled,
    referenceSymbol,
    referenceSessionReturn,
    refresh,
  } = view;

  const fallback = <BookFallback view={view} onOpenResearch={() => onFocusSymbol(selectedSymbol, "research")} />;
  if (!book) return fallback;

  const binding = book.risk_budget.binding_constraint;
  const positions = book.exposure.positions;
  const strategies = book.attribution.by_strategy ?? [];
  const status = bookStatus(book);
  const statusColor =
    status.level === "halted" || status.level === "critical"
      ? "var(--critical-text)"
      : status.level === "elevated"
        ? "var(--warning-text)"
        : "var(--success-text)";

  // Moving focus with the section is what makes the jump usable from a keyboard:
  // the rail is a tablist, so landing on the tab itself puts the arrow keys back
  // in reach instead of stranding the caret wherever the link was.
  const openSection = (next: PortfolioSection) => {
    onSectionChange(next);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => document.getElementById(`portfolio-subtab-${next}`)?.focus());
    }
  };

  const waterfall = buildPnlWaterfall({
    book,
    positions: riskPositions,
    betaBySymbol,
    referenceSymbol,
    referenceReturn: referenceSessionReturn,
  });

  // `by_symbol` and `execution_quality` have been in the payload since the
  // gateway learned to build it and were rendered nowhere. Both are typed as
  // loose records, so every field is read defensively and a missing one stays
  // "—" rather than becoming a zero nobody measured.
  const symbolFlow = (book.attribution.by_symbol ?? [])
    .map((row) => ({
      symbol: typeof row.symbol === "string" ? row.symbol : null,
      orders: numberOrNull(row.orders),
      filled: numberOrNull(row.filled),
      rejected: numberOrNull(row.rejected),
      fees: numberOrNull(row.fees),
      avgLatencyMs: numberOrNull(row.avg_latency_ms),
    }))
    .filter((row): row is typeof row & { symbol: string } => row.symbol !== null);

  const quality = book.execution_quality ?? {};
  const executionTiles = [
    {
      label: "Fill rate",
      value: numberOrNull(quality.total) && numberOrNull(quality.accepted) != null
        ? pct((numberOrNull(quality.accepted) ?? 0) / (numberOrNull(quality.total) || 1), 1)
        : null,
      note: `${numberOrNull(quality.accepted) ?? "—"} of ${numberOrNull(quality.total) ?? "—"} orders`,
    },
    {
      label: "Avg slippage",
      value: numberOrNull(quality.avg_slippage_bps) == null
        ? null
        : `${fmt(numberOrNull(quality.avg_slippage_bps)!, 2)} bps`,
      note: "unweighted mean across fills",
    },
    {
      label: "p99 latency",
      // The ticker wraps only the measured branch; null stays null and the
      // consumer keeps rendering its dash.
      value: numberOrNull(quality.p99_latency_ms) == null
        ? null
        : <NumberTicker value={numberOrNull(quality.p99_latency_ms)!} format={(v) => formatDuration(v, "ms")} />,
      note: `p50 ${formatDuration(numberOrNull(quality.p50_latency_ms), "ms")}`,
    },
    {
      label: "Fees paid",
      value: numberOrNull(quality.total_fees) == null ? null : usd(numberOrNull(quality.total_fees)!, 2),
      note: "lifetime, across every session",
    },
  ].filter((tile): tile is typeof tile & { value: string } => tile.value !== null);

  // Book-level drift against the panel's default target. Half the sum of the
  // absolute drifts, because every dollar that has to move is counted once on
  // the way out and once on the way in.
  const defaultProposal = covarianceModel
    ? proposeAllocation(riskPositions, covarianceModel, "inverse_vol", allocationLimits)
    : null;
  const bookDrift = defaultProposal
    ? defaultProposal.targets.reduce((acc, t) => acc + Math.abs(t.drift), 0) / 2
    : null;

  // Derived strictly from limits the gateway already publishes. No threshold is
  // invented here: a warning this page made up would be a warning the risk desk
  // never agreed to.
  const alerts: Array<{ tone: "warn" | "critical"; glyph: string; word: string; detail: string }> = [];
  for (const position of positions) {
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

  const largest = [...positions].sort((a, b) => b.notional - a.notional).slice(0, SUMMARY_ROWS);
  const bookLabel = book.sandbox ? "Sandbox book (generated)" : isStale ? "Last known book" : "Live book";

  return (
    <>
      <BookChrome view={view} />

      <WorkspaceSubtabs
        workspaceId="portfolio"
        label="Portfolio manager sections"
        tabs={PORTFOLIO_SECTIONS}
        activeId={section}
        onChange={onSectionChange}
        actions={<BookSourceControl view={view} />}
        active={active}
      />

      <WorkspaceSubtabPanel workspaceId="portfolio" tabId="overview" activeId={section}>
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
            <strong>{binding[0].replace("_", " ")}</strong>
            <small className="num">{fmt(binding[1] * 100, 1)}% utilized</small>
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
                <p className="research-note">
                  Every line here is read off a limit the gateway publishes — nothing on this page
                  invents a threshold the risk desk did not set.
                </p>
              </div>
            )}

            {bookDrift != null && bookDrift >= DRIFT_PROMPT && (
              <div className="banner context-change" role="status">
                <div>
                  <strong>Book drift is {pct(bookDrift, 1)}</strong> against an inverse-volatility
                  target — enough that rebalancing is likely to cost less than the drift does.
                </div>
                <button type="button" onClick={() => openSection("allocation")}>
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
                  ? `${alerts.length} limit${alerts.length === 1 ? " is" : "s are"} inside a warning band; `
                    + "each line above quotes the published limit it was read from."
                  : `No position has spent ${fmt(ALERT_BANDS.symbolNear * 100, 0)}% of its symbol cap, `
                    + `gross exposure is under ${fmt(ALERT_BANDS.gross * 100, 0)}% of its limit, and less `
                    + `than ${fmt(ALERT_BANDS.drawdown * 100, 0)}% of the daily drawdown budget is spent. `
                    + "Those three points are where this page starts talking; the limits they are "
                    + "fractions of belong to the gateway, which is also what enforces them."}
              </p>
              <p className="research-note">
                {bookDrift == null
                  ? "Drift against a risk-model target is not measured on this book: the instruments in "
                    + "it share too little price history to build a covariance, so there is no target to "
                    + "measure against — which is not the same as being on target."
                  : bookDrift >= DRIFT_PROMPT
                    ? `Book drift is ${pct(bookDrift, 1)} against an inverse-volatility target, which is `
                      + "what the prompt above is about."
                    : `Book drift is ${pct(bookDrift, 1)} against an inverse-volatility target — under the `
                      + `${pct(DRIFT_PROMPT, 0)} at which this page raises the rebalancing prompt.`}
              </p>
            </div>
          </>
        )}

        {overviewPane === "book" && (
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
                <button type="button" className="text-action" onClick={() => openSection("equity")}>
                  Equity curve &amp; P&amp;L attribution →
                </button>
              </div>
              {view.equityTrack.length >= 2 ? (
                <>
                  <Sparkline
                    points={view.equityTrack.map((p) => p.equity)}
                    width={520}
                    height={54}
                    variant="area"
                    tone={
                      view.equityTrack[view.equityTrack.length - 1].equity >= view.equityTrack[0].equity
                        ? "good"
                        : "critical"
                    }
                    ariaLabel="Session equity path"
                  />
                  <p className="muted">
                    {view.equityTrack.length} observations
                    {maxDrawdown(view.equityTrack)
                      ? <>, deepest drawdown {pct(maxDrawdown(view.equityTrack)!.drawdown, 2)} from the
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
                <button type="button" className="text-action" onClick={() => openSection("positions")}>
                  All {positions.length} position{positions.length === 1 ? "" : "s"} →
                </button>
              </div>

              {largest.length ? (
                <div className="table-wrap table-wrap--clamped">
                  <table>
                    <caption className="sr-only">
                      The {largest.length} largest positions by notional. The full book is in the Positions section.
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
                  value: binding[0].replace("_", " "),
                  note: `${fmt(binding[1] * 100, 1)}% utilized`,
                },
              ]}
            />
          </>
        )}
      </WorkspaceSubtabPanel>

      {/* One session read two ways — the path and its decomposition. They left
          the overview because that section had grown to seven panels covering
          alerts, headroom, charts, a positions preview and a risk cross-link;
          the charts are the half a reader comes back to. */}
      <WorkspaceSubtabPanel workspaceId="portfolio" tabId="equity" activeId={section}>
        <div className="compact-grid-2col portfolio-chart-pair">
          <EquityCurve
            periods={periods}
            backfilled={historyBackfilled}
            points={equityTrack}
            startOfDay={book.equity.start_of_day}
            haltLevel={book.risk_budget.daily_drawdown.equity_at_halt}
            generated={Boolean(book.sandbox)}
          />

          <PnlWaterfall waterfall={waterfall} generated={Boolean(book.sandbox)} />
        </div>
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="portfolio" tabId="positions" activeId={section}>
        <div className="seg" role="group" aria-label="Positions view">
          {POSITIONS_PANES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={positionsPane === option.id}
              title={option.hint}
              onClick={() => setPositionsPane(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {positionsPane === "holdings" && (
          <div className="card portfolio-positions-card">
            <div className="portfolio-card-heading">
              <div>
                {/* Sandbox first: `isStale` is forced false in sandbox, so keying on
                    it alone would caption generated positions as a "Live book". */}
                <span className="page-kicker">{bookLabel}</span>
                <h2>Positions</h2>
              </div>
              <span>{usd(book.exposure.gross, 0)} gross</span>
            </div>

            {positions.length ? (
              <div className="table-wrap table-wrap--clamped">
                <table>
                  <caption className="sr-only">Current portfolio positions and their measured risk contributions</caption>
                  <thead>
                    <tr>
                      <th>Instrument</th>
                      <th>Side</th>
                      <th>Notional</th>
                      <th>Share</th>
                      <th>Mark</th>
                      <th>Total P&amp;L</th>
                      <th>β</th>
                      <th>Vol contrib</th>
                      <th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((position) => (
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
                        <td>{fmt(position.mark_price, position.mark_price < 10 ? 4 : 2)}</td>
                        <td className={position.total_pnl >= 0 ? "pos" : "neg"}>{usd(position.total_pnl, 0)}</td>
                        <td>
                          {betaBySymbol.get(position.symbol) == null ? (
                            <span className="muted" title="Not enough aligned price history to measure">—</span>
                          ) : (
                            fmt(betaBySymbol.get(position.symbol)!, 2)
                          )}
                        </td>
                        <td className={(riskShare.get(position.symbol) ?? 0) < 0 ? "pos" : undefined}>
                          {riskShare.has(position.symbol) ? (
                            <>
                              {pct(riskShare.get(position.symbol)!, 1)}
                              {/* A hedge takes risk out; naming it stops a negative
                                  percentage reading as an error. */}
                              {(riskShare.get(position.symbol) ?? 0) < 0 && <span className="muted"> hedge</span>}
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          {/* One disclosure rather than three buttons per row.
                              `RowMenu` renders in the top layer so the last rows
                              of this scroller are not clipped — see its header. */}
                          <RowMenu label={`Actions for ${position.symbol}`}>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => onFocusSymbol(position.symbol, "live")}
                              disabled={isStale}
                              title={isStale ? "Reconnect the portfolio gateway before opening execution." : undefined}
                            >
                              Trade
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => onFocusSymbol(position.symbol, "research")}
                            >
                              Research
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => setHandoff({
                                kind: "flatten_symbol",
                                symbol: position.symbol,
                                side: position.side === "SHORT" ? "SHORT" : "LONG",
                                notional: position.notional,
                              })}
                              title="Show the authenticated request that closes this position"
                            >
                              Close
                            </button>
                          </RowMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="portfolio-empty-book">
                <strong>No open positions</strong>
                <p>
                  {isStale
                    ? "The last successful snapshot was flat. Reconnect before relying on current exposure."
                    : "The risk gateway is connected and the book is flat. Research candidates remain available for review."}
                </p>
                <button onClick={() => onFocusSymbol(selectedSymbol, "research")}>Open research workspace</button>
              </div>
            )}
          </div>
        )}

        {/* Two questions the nine-column table cannot answer by summing: where
            the weight sits against each position's own limit, and whether a
            small total P&L is a quiet book or two large offsetting bets. */}
        {positionsPane === "shape" && (
          <>
            <ExposureHeatmap positions={positions} generated={Boolean(book.sandbox)} />
            <UnrealisedSpread positions={positions} generated={Boolean(book.sandbox)} />
          </>
        )}

        {/* The exit, and the capital already committed to making one. A weight
            is only as real as the way out of it, and `useBook` has been
            computing `advBySymbol` from the same bars as the risk figures on
            every poll since those shipped — with nothing reading it until now. */}
        {positionsPane === "exit" && (
          <>
            <LiquidityPanel positions={positions} advMap={view.advBySymbol} />

            {/* `active` now requires the Exit pane as well as the section. The
                panel is mounted only here, but the section panel above it stays
                mounted when the reader moves to Allocation — so without the pane
                in the condition an order poll would keep hitting the gateway
                behind a tab nobody is looking at, which is what it did while
                every Positions card shared one scroll. */}
            <WorkingOrders
              source={book.sandbox ? "sandbox" : isStale ? "unavailable" : "live"}
              focusSymbol={selectedSymbol}
              isStale={isStale}
              active={active && section === "positions" && positionsPane === "exit"}
              operatorToken={operatorToken}
              onChanged={() => void refresh(true)}
              onFocusSymbol={(symbol) => onFocusSymbol(symbol, "research")}
            />
          </>
        )}
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="portfolio" tabId="allocation" activeId={section}>
        <div className="seg" role="group" aria-label="Allocation view">
          {ALLOCATION_PANES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={allocationPane === option.id}
              title={option.hint}
              onClick={() => setAllocationPane(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* What the book IS. Notional only — no covariance, so this pane draws
            on any book with an open position. */}
        {allocationPane === "mix" && (
          <AllocationDonut
            positions={positions}
            gross={book.exposure.gross}
            effectivePositions={book.concentration.effective_positions}
            largestShare={book.concentration.largest_share}
            hhi={book.concentration.hhi}
          />
        )}

        {/* What it SHOULD be. The only pane that needs a covariance, and the
            only one that goes quiet when there is not enough history for one. */}
        {allocationPane === "targets" && (
          <AllocationPanel
            positions={riskPositions}
            model={covarianceModel}
            limits={allocationLimits}
          />
        )}

        {/* Three cuts of the same book, and three DIFFERENT claims — measured,
            inferred and flow. Each says which it is rather than presenting them
            as equivalent. */}
        {allocationPane === "composition" && (
          <AllocationMixes positions={positions} attribution={strategies} generated={Boolean(book.sandbox)} />
        )}
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="portfolio" tabId="performance" activeId={section}>
        <div className="seg" role="group" aria-label="Performance view">
          {PERFORMANCE_PANES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={performancePane === option.id}
              title={option.hint}
              onClick={() => setPerformancePane(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {performancePane === "flow" && (
          <>
            <div className="card portfolio-attribution-card">
              <div className="portfolio-card-heading">
                <div>
                  <span className="page-kicker">Execution attribution</span>
                  <h2>Strategy flow</h2>
                </div>
                <span>
                  {book.sandbox
                    ? "Generated activity — no audit log behind these rows"
                    : isStale ? "Last known audit-backed activity" : "Audit-backed order activity"}
                </span>
              </div>
              {strategies.length ? (
                <div className="table-wrap table-wrap--clamped">
                  <table>
                    <caption className="sr-only">Order activity and performance attributed by strategy</caption>
                    <thead>
                      <tr>
                        <th>Strategy</th>
                        <th>Orders</th>
                        <th>Accepted</th>
                        <th>Notional</th>
                        <th>Realised P&amp;L</th>
                        <th>Win rate</th>
                        <th>Closed</th>
                        <th>Fees</th>
                        <th>Avg slippage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {strategies.map((strategy, index) => (
                        <tr key={`${strategy.strategy ?? "unattributed"}-${index}`}>
                          <th scope="row">{strategy.strategy || "Unattributed"}</th>
                          <td>{strategy.orders}</td>
                          <td>{strategy.filled}</td>
                          <td>${compact(strategy.notional ?? 0)}</td>
                          <td className={
                            strategy.realized_pnl == null ? undefined : strategy.realized_pnl >= 0 ? "pos" : "neg"
                          }>
                            {strategy.realized_pnl == null ? "—" : usd(strategy.realized_pnl, 0)}
                            {/* Realised P&L excludes open inventory, so a sleeve still
                                holding risk is only partly scored. Without this the
                                number reads as a final verdict on the sleeve. */}
                            {strategy.has_open_inventory && (
                              <small className="muted" title="This sleeve still holds inventory, so its realised P&L is only part of the story">
                                {", "}open
                              </small>
                            )}
                          </td>
                          <td className="num">
                            {strategy.win_rate == null ? <span className="muted">—</span> : pct(strategy.win_rate, 0)}
                          </td>
                          <td className="num">
                            {strategy.closed_trades == null ? <span className="muted">—</span> : strategy.closed_trades}
                          </td>
                          <td>{usd(strategy.fees ?? 0, 2)}</td>
                          <td>{strategy.avg_slippage_bps == null ? "—" : `${fmt(strategy.avg_slippage_bps, 2)} bps`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="portfolio-attribution-empty">No audited order flow has been recorded for this session.</p>
              )}
              <p className="research-note">
                These totals are lifetime, not session — they cover every order since the audit log was
                opened. The session-scoped costs are the ones the P&amp;L waterfall on Overview uses, and
                mixing the two would subtract a lifetime fee bill from one day&apos;s P&amp;L.
              </p>
            </div>

            {symbolFlow.length > 0 && (
              <div className="card">
                <div className="portfolio-card-heading">
                  <div>
                    <span className="page-kicker">Execution attribution</span>
                    <h2>Flow by instrument</h2>
                  </div>
                  <span>{symbolFlow.length} instrument{symbolFlow.length === 1 ? "" : "s"} touched</span>
                </div>
                <div className="table-wrap" tabIndex={0}>
                  <table>
                    <caption className="sr-only">Order flow attributed by instrument</caption>
                    <thead>
                      <tr>
                        <th scope="col">Instrument</th>
                        <th scope="col">Orders</th>
                        <th scope="col">Filled</th>
                        <th scope="col">Rejected</th>
                        <th scope="col">Fees</th>
                        <th scope="col">Avg latency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {symbolFlow.map((row) => (
                        <tr key={row.symbol}>
                          <th scope="row">{row.symbol}</th>
                          <td className="num">{row.orders ?? "—"}</td>
                          <td className="num">{row.filled ?? "—"}</td>
                          <td className={`num ${(row.rejected ?? 0) > 0 ? "neg" : "muted"}`}>{row.rejected ?? "—"}</td>
                          <td className="num">{row.fees == null ? "—" : usd(row.fees, 2)}</td>
                          <td className="num">
                            {row.avgLatencyMs == null
                              ? <span className="muted">—</span>
                              : formatDuration(row.avgLatencyMs, "ms")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="research-note">
                  The rejected column is the interesting one: it is where the pre-trade limits actually
                  bound, and an instrument that never rejects is either well-sized or never tested.
                </p>
              </div>
            )}

            {/* The totals row of the two tables above, which is why it sits with
                them rather than with the session chart. `execution_stats()` on the
                gateway is `FROM orders` with no session filter, so every tile here
                is measured over the same lifetime window the flow tables are — the
                fee tile says so outright, and the kicker now says it for all four.

                It is also the one card on this pane that can be absent: the sandbox
                book ships `execution_quality: {}`, so on a generated book there are
                no tiles to draw. The two tables above carry the pane on their own,
                and both state their own emptiness, so no fallback is owed here. */}
            {executionTiles.length > 0 && (
              <div className="card">
                <div className="portfolio-card-heading">
                  <div>
                    <span className="page-kicker">Desk-wide and lifetime, computed by the gateway</span>
                    <h2>Execution quality</h2>
                  </div>
                </div>
                {/* Shared StatTile — one tile dialect per workspace. */}
                <div className="tiles stability-tiles">
                  {executionTiles.map((tile) => (
                    <StatTile key={tile.label} label={tile.label} value={tile.value} note={tile.note} />
                  ))}
                </div>
                <p className="research-note">
                  Latency percentiles rather than an average alone: a mean decision time hides the one
                  order in a hundred that took long enough to miss its price, which is the number an
                  execution review argues about.
                </p>
              </div>
            )}
          </>
        )}

        {/* The two things a flow table cannot show: how far under water the
            session went, and whether the return was worth its own variance.
            Both are measured from the equity track, which starts empty on every
            load — so this is the whole of the session-scoped half, and the
            switcher above is the boundary the attribution card warns about. */}
        {performancePane === "trend" && (
          <RiskAdjustedTrend points={equityTrack} generated={Boolean(book.sandbox)} />
        )}
      </WorkspaceSubtabPanel>

      {/* Outside every panel on purpose: an in-flight handoff must not vanish
          because the reader changed section while the request was open. */}
      <ExecutionHandoff
        intent={handoff}
        onClose={() => setHandoff(null)}
        sandbox={Boolean(book.sandbox)}
        onExecuted={() => void refresh(true)}
        operatorToken={operatorToken}
      />
    </>
  );
}
