"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { compact, fmt, signedPct, usd } from "@/lib/format";

export type PortfolioFocusDestination = "research" | "live" | "data";

export interface PortfolioWorkspaceProps {
  onFocusSymbol: (symbol: string, destination: PortfolioFocusDestination) => void;
}

interface Headroom {
  used: number;
  limit: number;
  remaining: number;
  utilisation: number;
}

interface PortfolioPosition {
  symbol: string;
  side: "LONG" | "SHORT" | "FLAT";
  quantity: number;
  avg_price: number;
  mark_price: number;
  notional: number;
  share_of_gross: number;
  unrealized_pnl: number;
  realized_pnl: number;
  total_pnl: number;
  symbol_limit: Headroom;
}

interface StrategyAttribution {
  strategy: string | null;
  orders: number;
  filled: number;
  notional: number;
  fees: number;
  avg_slippage_bps: number | null;
}

interface PortfolioPayload {
  as_of: string;
  session_date: string;
  trading_halted: boolean;
  halted_symbols: string[];
  equity: {
    current: number;
    start_of_day: number;
    daily_pnl: number;
    daily_return: number;
    realized_pnl: number;
    unrealized_pnl: number;
  };
  exposure: {
    gross: number;
    net: number;
    leverage: number;
    positions: PortfolioPosition[];
  };
  concentration: {
    positions: number;
    largest_symbol: string | null;
    largest_share: number;
    top_two_share: number;
    hhi: number;
    effective_positions: number;
  };
  risk_budget: {
    gross_exposure: Headroom;
    daily_drawdown: {
      used_pct: number;
      limit_pct: number;
      utilisation: number;
      equity_at_halt: number;
      cushion_usd: number;
    };
    binding_constraint: [string, number];
  };
  attribution: {
    by_strategy: StrategyAttribution[];
    by_symbol: Array<Record<string, unknown>>;
  };
  execution_quality: Record<string, unknown>;
}

interface PortfolioError {
  code?: string;
  error: string;
  hint?: string;
}

const REFRESH_MS = 15_000;

function BudgetRow({ label, used, detail }: { label: string; used: number; detail: string }) {
  const bounded = Math.max(0, Math.min(1, used || 0));
  const tone = bounded >= 0.9 ? "critical" : bounded >= 0.7 ? "warning" : "good";
  return (
    <div className="portfolio-budget-row">
      <div>
        <strong>{label}</strong>
        <span className="num">{fmt(bounded * 100, 1)}%</span>
      </div>
      <div className="portfolio-budget-track" aria-label={`${label}: ${fmt(bounded * 100, 1)} percent used`}>
        <i className={`is-${tone}`} style={{ width: `${bounded * 100}%` }} />
      </div>
      <small>{detail}</small>
    </div>
  );
}

export default function PortfolioWorkspace({ onFocusSymbol }: PortfolioWorkspaceProps) {
  const [portfolio, setPortfolio] = useState<PortfolioPayload | null>(null);
  const [error, setError] = useState<PortfolioError | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const sequence = useRef(0);

  const refresh = useCallback(async (quiet = false) => {
    const current = ++sequence.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);

    try {
      const response = await fetch("/api/gateway/portfolio", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (current !== sequence.current) return;
      if (!response.ok) {
        setError({
          code: body.code,
          error: body.error ?? `Portfolio request failed with HTTP ${response.status}.`,
          hint: body.hint,
        });
        if (!quiet) setPortfolio(null);
        return;
      }
      setPortfolio(body as PortfolioPayload);
      setError(null);
    } catch {
      if (current === sequence.current) {
        setError({ error: "The portfolio view could not reach its same-origin gateway route." });
      }
    } finally {
      if (current === sequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh(true);
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
      sequence.current += 1;
    };
  }, [refresh]);

  if (loading && !portfolio) {
    return (
      <div className="portfolio-loading" aria-label="Loading portfolio">
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    );
  }

  if (!portfolio) {
    const isUnconfigured = error?.code === "gateway_not_configured";
    return (
      <div className="portfolio-connection-card">
        <span className="role-monogram" aria-hidden>PM</span>
        <div>
          <span className="page-kicker">{isUnconfigured ? "Optional gateway connection" : "Gateway unavailable"}</span>
          <h2>{isUnconfigured ? "Connect the authoritative portfolio book." : "Portfolio state is temporarily unavailable."}</h2>
          <p>{error?.error}</p>
          {error?.hint && <small>{error.hint}</small>}
          <div>
            <button className="primary-action" onClick={() => refresh()} disabled={loading}>Try again</button>
            <button onClick={() => onFocusSymbol("BTCUSDT", "research")}>Continue with research</button>
          </div>
        </div>
      </div>
    );
  }

  const binding = portfolio.risk_budget.binding_constraint;
  const positions = portfolio.exposure.positions;
  const strategies = portfolio.attribution.by_strategy ?? [];

  return (
    <>
      {portfolio.trading_halted && (
        <div className="banner error" role="alert">
          <span aria-hidden>■</span>
          <div>
            <strong>Trading is halted.</strong>{" "}
            {portfolio.halted_symbols.length ? `Halted instruments: ${portfolio.halted_symbols.join(", ")}.` : "The global kill switch is active."}
          </div>
        </div>
      )}

      <div className="portfolio-statusbar">
        <div>
          <span className="system-health"><i aria-hidden /> Authoritative risk gateway</span>
          <span className="num">As of {new Date(portfolio.as_of).toLocaleTimeString()}</span>
        </div>
        <button onClick={() => refresh(true)} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh book"}</button>
      </div>

      <section className="portfolio-metrics" aria-label="Portfolio summary">
        <div>
          <span>Equity</span>
          <strong className="num">{usd(portfolio.equity.current, 0)}</strong>
          <small>start {usd(portfolio.equity.start_of_day, 0)}</small>
        </div>
        <div>
          <span>Day P&amp;L</span>
          <strong className={`num ${portfolio.equity.daily_pnl >= 0 ? "pos" : "neg"}`}>{usd(portfolio.equity.daily_pnl, 0)}</strong>
          <small>{signedPct(portfolio.equity.daily_return)}</small>
        </div>
        <div>
          <span>Gross exposure</span>
          <strong className="num">{usd(portfolio.exposure.gross, 0)}</strong>
          <small>{fmt(portfolio.exposure.leverage, 2)}× leverage</small>
        </div>
        <div>
          <span>Net exposure</span>
          <strong className={`num ${portfolio.exposure.net < 0 ? "neg" : ""}`}>{usd(portfolio.exposure.net, 0)}</strong>
          <small>{positions.length} open position{positions.length === 1 ? "" : "s"}</small>
        </div>
        <div>
          <span>Binding constraint</span>
          <strong>{binding[0].replace("_", " ")}</strong>
          <small className="num">{fmt(binding[1] * 100, 1)}% utilized</small>
        </div>
      </section>

      <div className="portfolio-main-grid">
        <div className="card portfolio-positions-card">
          <div className="portfolio-card-heading">
            <div>
              <span className="page-kicker">Live book</span>
              <h2>Positions</h2>
            </div>
            <span>{usd(portfolio.exposure.gross, 0)} gross</span>
          </div>

          {positions.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th>Side</th>
                    <th>Notional</th>
                    <th>Share</th>
                    <th>Mark</th>
                    <th>Total P&amp;L</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((position) => (
                    <tr key={position.symbol}>
                      <th scope="row">{position.symbol}</th>
                      <td className={position.side === "SHORT" ? "neg" : "pos"}>{position.side}</td>
                      <td>{usd(position.notional, 0)}</td>
                      <td>{fmt(position.share_of_gross * 100, 1)}%</td>
                      <td>{fmt(position.mark_price, position.mark_price < 10 ? 4 : 2)}</td>
                      <td className={position.total_pnl >= 0 ? "pos" : "neg"}>{usd(position.total_pnl, 0)}</td>
                      <td>
                        <div className="portfolio-row-actions">
                          <button onClick={() => onFocusSymbol(position.symbol, "live")}>Trade</button>
                          <button onClick={() => onFocusSymbol(position.symbol, "research")}>Research</button>
                          <button onClick={() => onFocusSymbol(position.symbol, "data")}>Data</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="portfolio-empty-book">
              <strong>No open positions</strong>
              <p>The risk gateway is connected and the book is flat. Research candidates remain available for review.</p>
              <button onClick={() => onFocusSymbol("BTCUSDT", "research")}>Open research workspace</button>
            </div>
          )}
        </div>

        <div className="card portfolio-risk-card">
          <div className="portfolio-card-heading">
            <div>
              <span className="page-kicker">Pre-trade guardrails</span>
              <h2>Risk budget</h2>
            </div>
          </div>
          <BudgetRow
            label="Gross exposure"
            used={portfolio.risk_budget.gross_exposure.utilisation}
            detail={`${usd(portfolio.risk_budget.gross_exposure.remaining, 0)} headroom of ${usd(portfolio.risk_budget.gross_exposure.limit, 0)}`}
          />
          <BudgetRow
            label="Daily drawdown"
            used={portfolio.risk_budget.daily_drawdown.utilisation}
            detail={`${usd(portfolio.risk_budget.daily_drawdown.cushion_usd, 0)} equity cushion to halt`}
          />
          <BudgetRow
            label="Largest position"
            used={positions[0]?.symbol_limit.utilisation ?? 0}
            detail={positions[0] ? `${positions[0].symbol} · ${usd(positions[0].symbol_limit.remaining, 0)} symbol headroom` : "No symbol exposure"}
          />
          <div className="portfolio-concentration">
            <div><span>Largest share</span><strong className="num">{fmt(portfolio.concentration.largest_share * 100, 1)}%</strong></div>
            <div><span>Effective positions</span><strong className="num">{fmt(portfolio.concentration.effective_positions, 1)}</strong></div>
          </div>
        </div>
      </div>

      <div className="card portfolio-attribution-card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Execution attribution</span>
            <h2>Strategy flow</h2>
          </div>
          <span>Audit-backed order activity</span>
        </div>
        {strategies.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Orders</th>
                  <th>Accepted</th>
                  <th>Notional</th>
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
      </div>
    </>
  );
}
