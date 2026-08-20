"use client";

/**
 * The Performance section: the one split in this workspace drawn along a time
 * base rather than a subject.
 *
 * Performance held two kinds of number that must never be read as one series.
 * The flow tables and the execution-quality tiles are all lifetime: the gateway
 * builds them from `execution_stats()`, which is `FROM orders` with no session
 * filter, so they cover every order since the audit log was opened. The
 * drawdown and rolling-Sharpe plots are measured from the equity track the
 * workspace has collected, which starts empty on every load. The card below
 * already warns in prose that mixing the two subtracts a lifetime fee bill from
 * one day's P&L; the switcher makes that boundary something the reader crosses
 * instead of a paragraph under a table.
 *
 * So the labels carry the time base rather than only the subject. Naming the
 * panes "Flow" and "Quality" would have split them by what they measure and
 * left the boundary the prose is warning about inside one of the halves.
 *
 * The pane state is the first thing this component does and nothing returns
 * before it: a selector declared after an early return is the "rendered more
 * hooks than during the previous render" crash on the first snapshot that
 * arrives.
 */

import { useState } from "react";

import NumberTicker from "@/components/common/NumberTicker";
import RiskAdjustedTrend from "@/components/portfolio/RiskAdjustedTrend";
import StatTile from "@/components/StatTile";
import { compact, fmt, formatDuration, pct, usd } from "@/lib/format";
import type { EquityPoint, PortfolioPayload } from "@/lib/portfolio";

type PerformancePane = "flow" | "trend";

/**
 * Two panes, never four: `.seg button` is `flex: 1`, so a fourth forces
 * abbreviated labels, and it is also the point at which a picker stops being a
 * split and becomes a second navigation the reader has to learn.
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

export interface PerformanceSectionProps {
  book: PortfolioPayload;
  /** A book is on screen but the most recent refresh failed. */
  isStale: boolean;
  /** Session-scoped, and empty on every fresh load — the Trend pane's whole subject. */
  equityTrack: EquityPoint[];
}

export default function PerformanceSection({ book, isStale, equityTrack }: PerformanceSectionProps) {
  const [performancePane, setPerformancePane] = useState<PerformancePane>("flow");
  const strategies = book.attribution.by_strategy ?? [];

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

  return (
    <>
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
    </>
  );
}
