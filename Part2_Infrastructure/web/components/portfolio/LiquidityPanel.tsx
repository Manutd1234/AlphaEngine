"use client";

/**
 * How long would it take to get out of this book, and what would the exit cost?
 *
 * Sits beside the positions table because it answers the question that table
 * raises and cannot: a position is only as real as the exit, and a 3% weight in
 * something that trades $200k a day is a different risk from the same weight in
 * something that trades $200m.
 *
 * WHAT IT REFUSES TO SAY. `timeToLiquidate` bands a position `unmeasurable`
 * rather than guessing when ADV is missing or thinner than
 * MIN_ADV_OBSERVATIONS, and those rows print "—" rather than a horizon. The
 * exit probe is manual for the same reason it is manual on the routing tab: it
 * walks two live order books, and the answer is only true at the moment it is
 * asked, so polling it would age the number on screen into fiction.
 *
 * The ADV it reads has been computed on every book poll since the risk numbers
 * shipped — `useBook` exposes `advBySymbol` from the same bars the risk figures
 * use, precisely "so a position can never have a liquidity figure but no risk
 * figure" — and until this panel mounted, nothing consumed it.
 */

import { useState } from "react";

import StatTile from "@/components/StatTile";
import { fmt } from "@/lib/format";
import {
  DEFAULT_PARTICIPATION,
  MIN_ADV_OBSERVATIONS,
  liquidityConcentration,
  timeToLiquidate,
  type LiquidityInput,
} from "@/lib/liquidity";
import { useExitQuotes } from "@/lib/use-exit-quotes";

/**
 * The rates a desk actually argues about. The panel used to hold this in state
 * with no setter and print "Participation: 10% ADV" as a fixed label beside
 * copy describing it as adjustable — so the control the prose promised did not
 * exist.
 */
const PARTICIPATION_STEPS = [0.05, DEFAULT_PARTICIPATION, 0.2, 0.3] as const;

const BAND_TONE: Record<string, string> = {
  liquid: "good",
  moderate: "warning",
  illiquid: "critical",
  unmeasurable: "neutral",
};

export default function LiquidityPanel({
  positions,
  advMap,
}: {
  positions: { symbol: string; notional: number; quantity: number }[];
  advMap: Record<string, { adv: number; observations: number }>;
}) {
  const [participation, setParticipation] = useState<number>(DEFAULT_PARTICIPATION);
  const { quotes, loading, errors, fetchExitQuote } = useExitQuotes();

  const inputs: LiquidityInput[] = positions.map((position) => ({
    symbol: position.symbol,
    notional: position.notional,
    quantity: position.quantity,
    adv: advMap[position.symbol]?.adv ?? null,
    observations: advMap[position.symbol]?.observations ?? 0,
  }));

  const report = timeToLiquidate(inputs, participation);
  const concentration = liquidityConcentration(report);
  const unmeasurable = report.rows.filter((row) => row.band === "unmeasurable").length;

  return (
    <div className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Liquidity risk</span>
          <h2>Time to liquidate</h2>
        </div>
        <div className="seg research-seg" role="group" aria-label="Participation rate">
          {PARTICIPATION_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              aria-pressed={participation === step}
              onClick={() => setParticipation(step)}
            >
              {Math.round(step * 100)}%
            </button>
          ))}
        </div>
      </div>

      <p className="sub">
        Sessions to exit each position at {Math.round(participation * 100)}% of its average
        daily volume. {positions.length} position{positions.length === 1 ? "" : "s"}
        {unmeasurable > 0 && `, ${unmeasurable} without enough volume history to measure`}.
      </p>

      {/* Shared stat tiles, not cards nested inside the card: every sibling
          metric strip on Portfolio and Risk is a stat-tile row, and this was
          the surface's third tile dialect with its own padding and type
          overrides. */}
      <div className="tiles stability-tiles liquidity-facts">
        <StatTile
          label="Slowest leg"
          value={report.slowestLeg ?? "—"}
          note={report.bookDaysToLiquidate != null
            ? `${report.bookDaysToLiquidate.toFixed(1)} sessions`
            : "No position has measurable volume"}
        />
        <StatTile
          label="Clearable in one session"
          value={`${(report.shareClearableInOneSession * 100).toFixed(0)}%`}
          note="Of measured positions"
        />
        <StatTile
          label="Unwind concentration"
          value={concentration?.hhi != null ? concentration.hhi.toFixed(2) : "—"}
          note="HHI across exit horizons"
        />
      </div>

      <div className="table-wrap" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="num">Notional</th>
              <th className="num">ADV (20d)</th>
              <th className="num">Position / ADV</th>
              <th className="num">Days to exit</th>
              <th>Band</th>
              <th>Exit probe</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => {
              const key = `${row.symbol}-${row.notional > 0 ? "SELL" : "BUY"}`;
              const quote = quotes[key];
              const error = errors[key];

              return (
                <tr key={row.symbol}>
                  <td><strong>{row.symbol}</strong></td>
                  <td className="num">${fmt(Math.abs(row.notional))}</td>
                  <td className="num">{row.adv ? `$${fmt(row.adv)}` : "—"}</td>
                  <td className="num">
                    {row.adv && row.adv > 0
                      ? `${((Math.abs(row.notional) / row.adv) * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="num">
                    {row.daysToLiquidate != null
                      ? `${row.daysToLiquidate.toFixed(1)}d (${row.sessionsToExit}s)`
                      : "—"}
                  </td>
                  <td>
                    <span className={`pill is-${BAND_TONE[row.band] ?? "neutral"}`}>{row.band}</span>
                  </td>
                  <td>
                    {/* Three outcomes, and the failure is one of them. The probe
                        used to swallow every error, so a 503 for a symbol with
                        no live book looked exactly like a button nobody had
                        pressed. */}
                    {error ? (
                      <small className="liquidity-probe__error">{error}</small>
                    ) : quote ? (
                      <small>
                        {quote.expectedSlippageBps != null
                          ? `${quote.expectedSlippageBps.toFixed(1)} bps`
                          : "not priced"}
                        {!quote.fillable && `; book covers $${fmt(quote.routedNotional)} of it`}
                        {"; "}
                        {quote.fetchedAt}
                      </small>
                    ) : (
                      // No size class: "small" matched no selector anywhere —
                      // a no-op that implied a compact variant existed.
                      <button
                        type="button"
                        disabled={Boolean(loading[key])}
                        onClick={() => void fetchExitQuote(row.symbol, row.notional, row.notional > 0)}
                      >
                        {loading[key] ? "Probing…" : "Price exit"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details className="disclosure">
        <summary>Why a liquidation horizon is a floor, not a forecast</summary>
        <p className="research-note">
          A horizon assumes the stated share of average daily volume is available every session,
          which a stressed tape does not offer. Positions with fewer than{" "}
          {MIN_ADV_OBSERVATIONS} volume observations are banded{" "}
          <strong>unmeasurable</strong>, not estimated.
        </p>
      </details>
    </div>
  );
}
