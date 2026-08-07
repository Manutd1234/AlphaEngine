"use client";

/**
 * Liquidity & Time-to-Liquidate (TTL) Panel.
 *
 * Displays TTL metrics per position, bottleneck identification, and manual TCA exit quotes.
 */

import { useState } from "react";
import { timeToLiquidate, liquidityConcentration, DEFAULT_PARTICIPATION, type LiquidityInput } from "@/lib/liquidity";
import { useExitQuotes } from "@/lib/use-exit-quotes";
import { fmt } from "@/lib/format";

interface LiquidityPanelProps {
  positions: { symbol: string; notional: number; quantity: number }[];
  advMap: Record<string, { adv: number; observations: number }>;
}

export default function LiquidityPanel({ positions, advMap }: LiquidityPanelProps) {
  const [participation, setParticipation] = useState(DEFAULT_PARTICIPATION);
  const { quotes, loading, fetchExitQuote } = useExitQuotes();

  const inputs: LiquidityInput[] = positions.map((p) => ({
    symbol: p.symbol,
    notional: p.notional,
    quantity: p.quantity,
    adv: advMap[p.symbol]?.adv ?? null,
    observations: advMap[p.symbol]?.observations ?? 0,
  }));

  const report = timeToLiquidate(inputs, participation);
  const conc = liquidityConcentration(report);

  return (
    <div className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Liquidity Risk</span>
          <h2>Time to Liquidate (TTL)</h2>
        </div>
        <span>
          {positions.length} positions · Participation: {(participation * 100).toFixed(0)}% ADV
        </span>
      </div>

      <p className="sub">
        Estimates the sessions required to exit positions at a given participation rate without market disruption.
      </p>

      <div className="compact-grid-3col" style={{ margin: "14px 0" }}>
        <div className="card" style={{ padding: "10px" }}>
          <span className="section-note">Slowest Leg</span>
          <strong>{report.slowestLeg ?? "—"}</strong>
          <small>{report.bookDaysToLiquidate ? `${report.bookDaysToLiquidate.toFixed(1)} sessions` : "Unmeasurable"}</small>
        </div>
        <div className="card" style={{ padding: "10px" }}>
          <span className="section-note">Clearable 1-Session</span>
          <strong>{(report.shareClearableInOneSession * 100).toFixed(0)}%</strong>
          <small>Positions exitable in ≤1 session</small>
        </div>
        <div className="card" style={{ padding: "10px" }}>
          <span className="section-note">TTL Bottleneck HHI</span>
          <strong>{conc?.hhi ? conc.hhi.toFixed(2) : "—"}</strong>
          <small>Concentration of unwind horizon</small>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Notional</th>
              <th>ADV (20d)</th>
              <th>Position / ADV</th>
              <th>Days to Exit</th>
              <th>Band</th>
              <th>Exit Probe</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => {
              const quoteKey = `${r.symbol}-${r.notional > 0 ? "SELL" : "BUY"}`;
              const quote = quotes[quoteKey];
              const isLoading = loading[quoteKey];

              return (
                <tr key={r.symbol}>
                  <td><strong>{r.symbol}</strong></td>
                  <td>${fmt(Math.abs(r.notional))}</td>
                  <td>{r.adv ? `$${fmt(r.adv)}` : "—"}</td>
                  <td>{r.adv && r.adv > 0 ? `${(Math.abs(r.notional) / r.adv * 100).toFixed(1)}%` : "—"}</td>
                  <td>{r.daysToLiquidate ? `${r.daysToLiquidate.toFixed(1)}d (${r.sessionsToExit}s)` : "—"}</td>
                  <td>
                    <span className={`pill is-${r.band === "illiquid" ? "critical" : r.band === "moderate" ? "warning" : "good"}`}>
                      {r.band}
                    </span>
                  </td>
                  <td>
                    {quote ? (
                      <small>
                        Slippage: {quote.expectedSlippageBps ? `${quote.expectedSlippageBps.toFixed(1)} bps` : "—"} ({quote.fetchedAt})
                      </small>
                    ) : (
                      <button
                        type="button"
                        className="small"
                        disabled={isLoading}
                        onClick={() => fetchExitQuote(r.symbol, r.notional, r.notional > 0)}
                      >
                        {isLoading ? "Probing..." : "Price Exit"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="research-note" style={{ marginTop: "12px" }}>
        Time to liquidate assumes volume is available every day at the stated participation rate ({participation * 100}% ADV).
        Treat these estimates as a floor for market impact during stressed unwinds.
      </p>
    </div>
  );
}
