"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import AllocationDonut from "@/components/portfolio/AllocationDonut";
import EquityCurve from "@/components/portfolio/EquityCurve";
import ExecutionHandoff, { type HandoffIntent } from "@/components/portfolio/ExecutionHandoff";
import HeadroomBar from "@/components/portfolio/HeadroomBar";
import RiskEngine from "@/components/portfolio/RiskEngine";
import StressTest from "@/components/portfolio/StressTest";
import { compact, fmt, pct, signedPct, usd } from "@/lib/format";
import {
  type EquityPoint,
  type PortfolioPayload,
  bookStatus,
  sandboxBook,
  sandboxEquityPath,
} from "@/lib/portfolio";
import {
  type CovarianceModel,
  type PortfolioRisk,
  type ReturnsBySymbol,
  beta,
  buildCovariance,
  portfolioRisk,
} from "@/lib/portfolio-risk";

export type PortfolioFocusDestination = "research" | "live" | "data";

export interface PortfolioWorkspaceProps {
  workspaceSymbol: string;
  onFocusSymbol: (symbol: string, destination: PortfolioFocusDestination) => void;
}

interface PortfolioError {
  code?: string;
  error: string;
  hint?: string;
}

const REFRESH_MS = 15_000;

type PortfolioConnectionState = "live" | "stale" | "unconfigured" | "error";

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

export default function PortfolioWorkspace({ workspaceSymbol, onFocusSymbol }: PortfolioWorkspaceProps) {
  const [portfolio, setPortfolio] = useState<PortfolioPayload | null>(null);
  const [error, setError] = useState<PortfolioError | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sandbox, setSandbox] = useState(false);
  const [returns, setReturns] = useState<ReturnsBySymbol>({});
  const [riskLoading, setRiskLoading] = useState(false);
  const [handoff, setHandoff] = useState<HandoffIntent | null>(null);
  // The gateway has no session-history endpoint, so the only honest live series
  // is what this tab has actually seen. Appended on each successful poll.
  const [observed, setObserved] = useState<EquityPoint[]>([]);
  const sequence = useRef(0);
  const selectedSymbol = workspaceSymbol.trim().toUpperCase();

  // The sandbox replaces the payload entirely rather than patching gaps in it.
  // A book that is half real and half generated is the one thing worse than
  // either, because no banner can say which half you are reading.
  const book: PortfolioPayload | null = sandbox ? sandboxBook() : portfolio;

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
        return;
      }
      const payload = body as PortfolioPayload;
      setPortfolio(payload);
      setObserved((current) => {
        const equity = payload.equity.current;
        const at = Date.parse(payload.as_of) || Date.now();
        // Same snapshot polled twice is one observation, not two — otherwise an
        // idle tab draws a flat line that looks like measured stability.
        if (current.length && current[current.length - 1].t === at) return current;
        const hwm = Math.max(current[current.length - 1]?.highWaterMark ?? equity, equity);
        return [...current, { t: at, equity, highWaterMark: hwm }].slice(-240);
      });
      setLastSuccessAt(new Date());
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

  // Daily closes for whatever the book holds. The gateway knows the positions
  // and nothing about how they co-move, so the covariance has to be measured
  // here — from the same `/api/ohlcv` route the research tab uses, not from
  // assumed factor loadings.
  const heldSymbols = (book?.exposure.positions ?? [])
    .filter((position) => position.notional > 0)
    .map((position) => position.symbol)
    .join(",");

  useEffect(() => {
    const symbols = heldSymbols ? heldSymbols.split(",") : [];
    if (!symbols.length) {
      setReturns({});
      return;
    }
    let cancelled = false;
    setRiskLoading(true);
    Promise.all(
      symbols.map(async (symbol) => {
        try {
          const response = await fetch(
            `/api/ohlcv?symbol=${encodeURIComponent(symbol)}&interval=1d&bars=180`,
            { cache: "no-store" },
          );
          if (!response.ok) return [symbol, [] as number[]] as const;
          const body = await response.json();
          const bars: { c: number }[] = body.bars ?? [];
          // Synthetic bars would silently become a covariance estimate. A book's
          // risk must not be measured against invented prices, so that source is
          // dropped rather than used.
          if (body.source !== "binance" || bars.length < 21) return [symbol, [] as number[]] as const;
          const series: number[] = [];
          for (let i = 1; i < bars.length; i++) {
            if (bars[i - 1].c > 0) series.push(bars[i].c / bars[i - 1].c - 1);
          }
          return [symbol, series] as const;
        } catch {
          return [symbol, [] as number[]] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setReturns(Object.fromEntries(entries.filter(([, r]) => r.length > 0)));
      setRiskLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [heldSymbols]);

  if (loading && !book) {
    return (
      <div className="portfolio-loading" aria-label="Loading portfolio">
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    );
  }

  const connectionState: PortfolioConnectionState = book
    ? (error ? "stale" : "live")
    : (error?.code === "gateway_not_configured" ? "unconfigured" : "error");

  if (!book) {
    if (connectionState === "unconfigured") {
      return (
        <div className="card portfolio-setup-card" role="status" aria-labelledby="portfolio-setup-title">
          <div className="portfolio-card-heading">
            <div>
              <span className="page-kicker">Portfolio gateway setup</span>
              <h2 id="portfolio-setup-title">Connect the portfolio book</h2>
            </div>
          </div>
          <p className="sub">
            Add <code>ALPHAENGINE_GATEWAY_URL</code> to the Vercel environment and redeploy to load
            authoritative positions, exposure and risk limits. Research remains available now.
          </p>
          <div className="page-actions">
            <button className="primary-action" onClick={() => setSandbox(true)}>
              Explore the sandbox book
            </button>
            <button onClick={() => onFocusSymbol(selectedSymbol, "research")}>Open Research</button>
          </div>
          <p className="research-note">
            The sandbox is a generated book, labelled as such on every panel. It exists so this
            surface can be evaluated without standing up a gateway — not to stand in for one.
          </p>
        </div>
      );
    }

    return (
      <div className="card portfolio-setup-card" role="alert" aria-labelledby="portfolio-error-title">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Gateway unavailable</span>
            <h2 id="portfolio-error-title">Portfolio state is temporarily unavailable</h2>
          </div>
        </div>
        <p className="sub">{error?.error ?? "The portfolio gateway did not return a usable response."}</p>
        {error?.hint && <p className="muted">{error.hint}</p>}
        <div className="page-actions">
          <button className="primary-action" onClick={() => refresh()} disabled={loading}>
            {loading ? "Connecting…" : "Retry connection"}
          </button>
          <button onClick={() => setSandbox(true)}>Explore the sandbox book</button>
          <button onClick={() => onFocusSymbol(selectedSymbol, "research")}>Open Research</button>
        </div>
        <p className="research-note">
          The gateway is a long-lived process and may simply be asleep. The sandbox is a generated
          book, labelled on every panel, so this surface can still be evaluated.
        </p>
      </div>
    );
  }

  const isStale = !sandbox && connectionState === "stale";
  const binding = book.risk_budget.binding_constraint;
  const positions = book.exposure.positions;
  const strategies = book.attribution.by_strategy ?? [];
  const lastRefreshLabel = (lastSuccessAt ?? new Date(book.as_of)).toLocaleTimeString();
  const gatewayEnvironment = book.gateway?.environment?.trim().toLowerCase();
  const gatewayLabel = gatewayEnvironment && gatewayEnvironment !== "production"
    ? `${gatewayEnvironment[0].toUpperCase()}${gatewayEnvironment.slice(1)} risk gateway live`
    : "Authoritative risk gateway live";

  // Signed notionals: a short must reduce the book's variance, and it only can
  // if the sign survives into the covariance maths.
  const riskPositions = positions
    .filter((position) => position.notional > 0)
    .map((position) => ({
      symbol: position.symbol,
      signedNotional: position.side === "SHORT" ? -position.notional : position.notional,
    }));
  const covarianceModel: CovarianceModel | null = riskPositions.length
    ? buildCovariance(riskPositions.map((r) => r.symbol), returns)
    : null;
  const risk: PortfolioRisk | null = covarianceModel
    ? portfolioRisk(riskPositions, book.equity.current, covarianceModel, 365, returns)
    : null;
  const measured = new Set(covarianceModel?.symbols ?? []);
  const missingHistory = riskPositions.map((r) => r.symbol).filter((sym) => !measured.has(sym));
  const referenceSymbol = riskPositions[0]?.symbol ?? "BTCUSDT";
  // Beta against the largest position, and each position's share of book
  // volatility. Both belong on the positions row: a PM reading exposure should
  // not have to scroll to a second table to learn that the third-largest line
  // carries the most risk.
  const riskShare = new Map(risk?.contributions.map((c) => [c.symbol, c.contributionShare]) ?? []);
  const betaBySymbol = new Map(
    riskPositions.map((r) => [r.symbol, r.symbol === referenceSymbol ? 1 : beta(r.symbol, referenceSymbol, returns)]),
  );
  const equityTrack: EquityPoint[] = book.sandbox ? sandboxEquityPath(book) : observed;

  const status = bookStatus(book);
  const statusTone = {
    glyph: status.glyph,
    label: status.label,
    detail: status.detail,
    color:
      status.level === "halted" || status.level === "critical"
        ? "var(--critical-text)"
        : status.level === "elevated"
          ? "var(--warning-text)"
          : "var(--success-text)",
  };

  return (
    <>
      {book.trading_halted && (
        <div className="banner error" role="alert">
          <span aria-hidden>■</span>
          <div>
            <strong>{isStale ? "Trading was halted at the last successful refresh." : "Trading is halted."}</strong>{" "}
            {book.halted_symbols.length ? `Halted instruments: ${book.halted_symbols.join(", ")}.` : "The global kill switch is active."}
          </div>
        </div>
      )}

      {isStale && (
        <div className="banner warn" role="status" aria-live="polite">
          <span aria-hidden>!</span>
          <div>
            <strong>Portfolio data is stale.</strong>{" "}
            Last successful refresh was {lastRefreshLabel}. {error?.error} Execution handoffs are
            disabled until the gateway reconnects.
          </div>
        </div>
      )}

      {sandbox && (
        /* Rendered above everything, on every refresh, for as long as the mode is
           on. A one-time notice is how a generated book gets mistaken for a real
           one after ten minutes of reading. */
        <div className="banner warn sandbox-banner" role="status">
          <span aria-hidden>◆</span>
          <div>
            <strong>Sandbox book — these positions do not exist.</strong> Equity, P&amp;L, exposure and
            every risk figure below are generated from a fixed seed. The workflow is real; the book is
            not. Execution handoffs are disabled.
          </div>
        </div>
      )}

      <div className="portfolio-statusbar">
        <div>
          <span className={`system-health${isStale || sandbox ? " is-warn" : ""}`}>
            <i aria-hidden /> {sandbox ? "Sandbox book (generated)" : isStale ? "Stale portfolio snapshot" : gatewayLabel}
          </span>
          <span className="num">
            {sandbox ? "Deterministic — the same book every time" : `Last successful refresh ${lastRefreshLabel}`}
          </span>
        </div>
        <div className="portfolio-statusbar__actions">
          <div className="seg research-seg" role="group" aria-label="Book source">
            <button
              type="button"
              aria-pressed={!sandbox}
              onClick={() => setSandbox(false)}
              disabled={!portfolio && !error}
            >
              Live gateway
            </button>
            <button type="button" aria-pressed={sandbox} onClick={() => setSandbox(true)}>
              Sandbox
            </button>
          </div>
          <button onClick={() => refresh(true)} disabled={refreshing || sandbox}>
            {refreshing ? (isStale ? "Reconnecting…" : "Refreshing…") : (isStale ? "Reconnect" : "Refresh book")}
          </button>
        </div>
      </div>

      <HeadroomBar
        grossUsed={book.risk_budget.gross_exposure.used}
        grossLimit={book.risk_budget.gross_exposure.limit}
        net={book.exposure.net}
        equity={book.equity.current}
        drawdownUsedPct={book.risk_budget.daily_drawdown.used_pct}
        drawdownLimitPct={book.risk_budget.daily_drawdown.limit_pct}
        cushionUsd={book.risk_budget.daily_drawdown.cushion_usd}
        bindingConstraint={binding[0]}
        bindingUtilisation={binding[1]}
        largestPosition={
          positions[0]
            ? {
                symbol: positions[0].symbol,
                utilisation: positions[0].symbol_limit.utilisation,
                remaining: positions[0].symbol_limit.remaining,
              }
            : null
        }
      />

      <section className="portfolio-metrics" aria-label="Portfolio summary">
        <div>
          <span>Equity</span>
          <strong className="num">{usd(book.equity.current, 0)}</strong>
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
            net {usd(book.exposure.net, 0)} · {fmt(book.exposure.leverage, 2)}× · {positions.length} position{positions.length === 1 ? "" : "s"}
          </small>
        </div>
        <div>
          <span>Binding constraint</span>
          <strong>{binding[0].replace("_", " ")}</strong>
          <small className="num">{fmt(binding[1] * 100, 1)}% utilized</small>
        </div>
        <div>
          <span>VaR 95 · 1 day</span>
          <strong className="num">{risk ? usd(risk.var95, 0) : "—"}</strong>
          <small>
            {risk
              ? `${pct(risk.var95 / Math.max(1, book.equity.current), 2)} of equity`
              : "needs price history"}
          </small>
        </div>
        <div>
          <span>Status</span>
          {/* Derived from the tightest constraint, never asserted. A green light
              that is not computed from the limits is worse than no light. */}
          <strong style={{ color: statusTone.color }}>
            <span aria-hidden>{statusTone.glyph}</span> {statusTone.label}
          </strong>
          <small>{statusTone.detail}</small>
        </div>
      </section>

      <div className="portfolio-main-grid">
        <div className="card portfolio-positions-card">
          <div className="portfolio-card-heading">
            <div>
              <span className="page-kicker">{isStale ? "Last known book" : "Live book"}</span>
              <h2>Positions</h2>
            </div>
            <span>{usd(book.exposure.gross, 0)} gross</span>
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
                      <td>{fmt(position.share_of_gross * 100, 1)}%</td>
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
                        <div className="portfolio-row-actions">
                          <button
                            onClick={() => onFocusSymbol(position.symbol, "live")}
                            disabled={isStale}
                            title={isStale ? "Reconnect the portfolio gateway before opening execution." : undefined}
                          >
                            Trade
                          </button>
                          <button onClick={() => onFocusSymbol(position.symbol, "research")}>Research</button>
                          <button
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
              <p>
                {isStale
                  ? "The last successful snapshot was flat. Reconnect before relying on current exposure."
                  : "The risk gateway is connected and the book is flat. Research candidates remain available for review."}
              </p>
              <button onClick={() => onFocusSymbol(selectedSymbol, "research")}>Open research workspace</button>
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
            used={book.risk_budget.gross_exposure.utilisation}
            detail={`${usd(book.risk_budget.gross_exposure.remaining, 0)} headroom of ${usd(book.risk_budget.gross_exposure.limit, 0)}`}
          />
          <BudgetRow
            label="Daily drawdown"
            used={book.risk_budget.daily_drawdown.utilisation}
            detail={`${usd(book.risk_budget.daily_drawdown.cushion_usd, 0)} equity cushion to halt`}
          />
          <BudgetRow
            label="Largest position"
            used={positions[0]?.symbol_limit.utilisation ?? 0}
            detail={positions[0] ? `${positions[0].symbol} · ${usd(positions[0].symbol_limit.remaining, 0)} symbol headroom` : "No symbol exposure"}
          />
          <div className="portfolio-concentration">
            <div><span>Largest share</span><strong className="num">{fmt(book.concentration.largest_share * 100, 1)}%</strong></div>
            <div><span>Effective positions</span><strong className="num">{fmt(book.concentration.effective_positions, 1)}</strong></div>
          </div>
        </div>
      </div>

      <div className="portfolio-main-grid">
        <EquityCurve
          points={equityTrack}
          startOfDay={book.equity.start_of_day}
          haltLevel={book.risk_budget.daily_drawdown.equity_at_halt}
          generated={Boolean(book.sandbox)}
        />
        <AllocationDonut
          positions={positions}
          gross={book.exposure.gross}
          effectivePositions={book.concentration.effective_positions}
          largestShare={book.concentration.largest_share}
          hhi={book.concentration.hhi}
        />
      </div>

      <div className="portfolio-main-grid">
        <RiskEngine
          risk={risk}
          model={covarianceModel}
          equity={book.equity.current}
          loading={riskLoading && !risk}
          missing={missingHistory}
        />
        {riskPositions.length > 0 ? (
          <StressTest
            positions={riskPositions}
            equity={book.equity.current}
            returns={returns}
            referenceSymbol={referenceSymbol}
            drawdownLimitPct={book.risk_budget.daily_drawdown.limit_pct}
            startOfDayEquity={book.equity.start_of_day}
          />
        ) : (
          <div className="card">
            <div className="portfolio-card-heading">
              <div>
                <span className="page-kicker">Scenario analysis</span>
                <h2>Stress test</h2>
              </div>
            </div>
            <p className="sub">
              A flat book cannot be stressed — there is no exposure for a shock to move. Load the
              sandbox to see the engine against a populated book.
            </p>
          </div>
        )}
      </div>

      <div className="card portfolio-controls-card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Risk controls</span>
            <h2>Emergency actions</h2>
          </div>
          <span>handoff only</span>
        </div>
        <p className="sub">
          This workspace holds no gateway credential and cannot move risk. These produce the exact
          authenticated request to run against your gateway, where it is gated and audited.
        </p>
        <div className="page-actions">
          <button onClick={() => setHandoff({ kind: "flatten_all" })} disabled={!positions.length}>
            Flatten the book
          </button>
          <button onClick={() => setHandoff({ kind: "halt" })}>Halt trading</button>
        </div>
        <ExecutionHandoff intent={handoff} onClose={() => setHandoff(null)} sandbox={Boolean(book.sandbox)} />
      </div>

      <div className="card portfolio-attribution-card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Execution attribution</span>
            <h2>Strategy flow</h2>
          </div>
          <span>{isStale ? "Last known audit-backed activity" : "Audit-backed order activity"}</span>
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
