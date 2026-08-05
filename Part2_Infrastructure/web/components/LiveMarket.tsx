"use client";

/**
 * Live market view — streaming L2 books and execution cost, in the browser.
 *
 * The books arrive over WebSockets opened straight to Binance and Bybit; nothing
 * here goes through the API. The same numbers are available as REST snapshots at
 * `/api/depth` and `/api/tca` for non-browser callers.
 */

import { useEffect, useState, type ReactNode } from "react";

import DepthChart from "@/components/DepthChart";
import DislocationStrip from "@/components/DislocationStrip";
import StatTile from "@/components/StatTile";
import { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { liveTca, useLiveBook } from "@/lib/livebook";
import { SYMBOLS, type Side, type Ticker } from "@/lib/venues";
import { compact, fmt, priceDp, signedPct, usd } from "@/lib/format";
import { STRATEGY_LABELS, type SweepResponse } from "@/lib/types";

const PROBE_SIZES = [10_000, 50_000, 100_000, 250_000, 1_000_000];

const STATUS_STYLE = {
  live: { icon: "●", label: "live" },
  connecting: { icon: "◌", label: "connecting" },
  stale: { icon: "▲", label: "stale" },
  error: { icon: "✕", label: "down" },
} as const;

export type ExecutionSection = "trade" | "liquidity" | "routing" | "activity";

interface LiveMarketProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  side: Side;
  onSideChange: (side: Side) => void;
  notional: number;
  onNotionalChange: (notional: number) => void;
  research: SweepResponse | null;
  onOpenResearch: () => void;
  onOpenData: () => void;
  section: ExecutionSection;
  children?: ReactNode;
}

export default function LiveMarket({
  symbol,
  onSymbolChange,
  side,
  onSideChange,
  notional,
  onNotionalChange,
  research,
  onOpenResearch,
  onOpenData,
  section,
  children,
}: LiveMarketProps) {
  const liveSupported = (SYMBOLS as readonly string[]).includes(symbol);
  const snap = useLiveBook(symbol, liveSupported);
  const tca = liveTca(snap, side, notional);
  const dp = snap?.consolidatedMid ? priceDp(snap.consolidatedMid) : 2;
  const [tickerBySymbol, setTickerBySymbol] = useState<Record<string, Ticker>>({});

  useEffect(() => {
    const controller = new AbortController();

    const refreshWatchlist = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch(`/api/ticker?symbols=${SYMBOLS.join(",")}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body = await response.json() as { tickers?: Ticker[] };
        setTickerBySymbol(Object.fromEntries((body.tickers ?? []).map((ticker) => [ticker.symbol, ticker])));
      } catch (watchlistError) {
        if ((watchlistError as Error).name !== "AbortError") {
          // The L2 stream remains authoritative for the active symbol. A failed
          // 24h summary should leave em dashes, not take the trading surface down.
        }
      }
    };

    void refreshWatchlist();
    const timer = window.setInterval(() => void refreshWatchlist(), 30_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  const ladder = (rows: [number, number][], kind: "bid" | "ask") => {
    const top = rows.slice(0, 12);
    let cum = 0;
    const withCum = top.map(([p, q]) => {
      cum += p * q;
      return { p, q, cum };
    });
    const max = withCum.at(-1)?.cum ?? 1;
    const colour = kind === "bid" ? "var(--diverging-pos)" : "var(--diverging-neg)";
    const rowsOut = kind === "ask" ? [...withCum].reverse() : withCum;

    return rowsOut.map(({ p, q, cum: c }) => (
      <div
        key={`${kind}-${p}`}
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          padding: "3px 6px",
          fontFamily: "var(--mono)",
          fontSize: 11.5,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            right: 0,
            width: `${(c / max) * 100}%`,
            background: colour,
            opacity: 0.14,
            borderRadius: 3,
          }}
        />
        <span style={{ position: "relative", color: colour }}>{fmt(p, dp)}</span>
        <span style={{ position: "relative", textAlign: "right", color: "var(--text-secondary)" }}>
          {fmt(q, 4)}
        </span>
        <span style={{ position: "relative", textAlign: "right", color: "var(--text-muted)" }}>
          {compact(c)}
        </span>
      </div>
    ));
  };

  const instrumentPanel = (
    <section className="card instrument-panel market-context-card" aria-labelledby="market-watchlist-title">
      <div className="market-context-card__heading">
        <div>
          <span className="page-kicker">Live market context</span>
          <h2 id="market-watchlist-title">Watchlist</h2>
        </div>
        <span className={`market-context-card__mode${liveSupported ? " is-live" : ""}`}>
          <i aria-hidden /> {liveSupported ? "Direct L2 streaming" : "Quote coverage only"}
        </span>
      </div>

      <div className="market-watchlist" role="group" aria-label="Tradable instruments">
        {SYMBOLS.map((watchSymbol) => {
          const ticker = tickerBySymbol[watchSymbol];
          const change = ticker?.changePct24h ?? null;
          const active = watchSymbol === symbol;
          return (
            <button
              type="button"
              className="market-watchlist__item"
              key={watchSymbol}
              onClick={() => onSymbolChange(watchSymbol)}
              aria-pressed={active}
              aria-label={`${watchSymbol}, ${ticker?.last == null ? "price pending" : `last ${fmt(ticker.last, priceDp(ticker.last))}`}, ${change == null ? "24 hour change pending" : `${signedPct(change)} over 24 hours`}`}
            >
              <span className="market-watchlist__symbol">{watchSymbol}</span>
              <strong className="num">
                {ticker?.last == null ? "—" : fmt(ticker.last, priceDp(ticker.last))}
              </strong>
              <small className={`num${change == null ? "" : change >= 0 ? " pos" : " neg"}`}>
                {change == null ? "24h —" : `24h ${signedPct(change)}`}
              </small>
            </button>
          );
        })}
      </div>

      <div className="venue-status-strip" aria-label={`${symbol} venue status`}>
        {(snap?.venues ?? []).map((venue) => {
          const status = STATUS_STYLE[venue.status];
          return (
            <div className={`venue-status is-${venue.status}`} key={venue.venue}>
              <span className="venue-status__name">
                <i aria-hidden />
                <strong>{venue.venue}</strong>
                <small>{status.label}</small>
              </span>
              <span className="venue-status__metrics num">
                {venue.status === "live" ? `${venue.updates.toLocaleString()} updates` : status.icon}
                {venue.book.latencyMs ? ` · ${fmt(venue.book.latencyMs, 0)}ms` : ""}
                {venue.reconnects > 0 ? ` · ${venue.reconnects} reconnects` : ""}
              </span>
            </div>
          );
        })}
        {liveSupported && !snap ? (
          <div className="venue-status is-connecting">
            <span className="venue-status__name"><i aria-hidden /><strong>VENUES</strong><small>connecting</small></span>
            <span className="venue-status__metrics">Opening public sockets…</span>
          </div>
        ) : null}
      </div>
    </section>
  );

  if (!liveSupported) {
    return (
      <>
        {instrumentPanel}
        {children}
        {(["liquidity", "routing"] as const).map((tabId) => (
          <WorkspaceSubtabPanel key={tabId} workspaceId="execution" tabId={tabId} activeId={section}>
            <div className="capability-empty">
              <span className="role-monogram" aria-hidden>L2</span>
              <div>
                <span className="page-kicker">Capability boundary</span>
                <h2>Live venue routing is not available for {symbol}.</h2>
                <p>
                  Quote and news coverage can still be inspected in Data &amp; systems. Select a supported
                  crypto pair above to open direct Binance and Bybit order books.
                </p>
                <div>
                  <button className="primary-action" onClick={onOpenData}>Open data workspace</button>
                  <button onClick={onOpenResearch}>Review research context</button>
                </div>
              </div>
            </div>
          </WorkspaceSubtabPanel>
        ))}
      </>
    );
  }

  const costVsModel = tca?.slippageBps == null || !research
    ? null
    : tca.slippageBps - research.request.slippageBps;

  return (
    <>
      {instrumentPanel}
      {children}

      <WorkspaceSubtabPanel workspaceId="execution" tabId="liquidity" activeId={section}>

      <div className="tiles" style={{ marginBottom: 16, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        <StatTile label="Consolidated mid" value={fmt(snap?.consolidatedMid, dp)} note={`${snap?.venues.filter((v) => v.status === "live").length ?? 0} venues live`} />
        <StatTile
          label="Spread"
          value={snap?.spreadBps == null ? "—" : `${fmt(snap.spreadBps, 2)} bps`}
          note={snap?.spreadBps != null && snap.spreadBps < 0 ? "crossed across venues" : "consolidated"}
          tone={snap?.spreadBps != null && snap.spreadBps < 0 ? "pos" : undefined}
        />
        <StatTile label="Bid depth" value={`$${compact(snap?.depthUsdBid ?? 0)}`} note="within ±10 bps of mid" />
        <StatTile label="Ask depth" value={`$${compact(snap?.depthUsdAsk ?? 0)}`} note="within ±10 bps of mid" />
        <StatTile
          label="Imbalance"
          value={snap?.imbalance == null ? "—" : `${(snap.imbalance * 100).toFixed(1)}%`}
          note={snap?.imbalance == null ? "" : snap.imbalance > 0 ? "bid heavy" : "ask heavy"}
          tone={snap?.imbalance == null ? undefined : snap.imbalance > 0 ? "pos" : "neg"}
        />
      </div>

      <div className="card">
        <h2>Cumulative depth</h2>
        <p className="sub">
          How much size sits between the mid and any price. A near-vertical step is a wall; a
          shallow ramp is a thin book that will cost you to cross.
        </p>
        <DepthChart
          bids={snap?.merged.bids ?? []}
          asks={snap?.merged.asks ?? []}
          mid={snap?.consolidatedMid ?? null}
        />
      </div>

      <div className="card">
        <h2>Consolidated ladder</h2>
        <p className="sub">Every venue&apos;s levels merged and sorted by price — the book a smart router actually walks.</p>
        <div style={{ fontFamily: "var(--mono)" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--text-muted)",
              padding: "0 6px 6px",
            }}
          >
            <span>Price</span>
            <span style={{ textAlign: "right" }}>Size</span>
            <span style={{ textAlign: "right" }}>Cum $</span>
          </div>
          {snap ? ladder(snap.merged.asks, "ask") : null}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "8px 6px",
              margin: "4px 0",
              borderTop: "1px solid var(--grid)",
              borderBottom: "1px solid var(--grid)",
            }}
          >
            <span className="num" style={{ fontSize: 17, fontWeight: 650 }}>
              {fmt(snap?.consolidatedMid, dp)}
            </span>
            <span className="num muted" style={{ fontSize: 11.5 }}>
              spread {fmt(snap?.spreadBps, 2)} bps
            </span>
          </div>
          {snap ? ladder(snap.merged.bids, "bid") : <div className="muted" style={{ padding: 16, textAlign: "center" }}>waiting for book…</div>}
        </div>
      </div>

      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="execution" tabId="routing" activeId={section}>
        {research?.request.symbol === symbol && (
          <div className="workflow-handoff execution-handoff">
            <div>
              <span className="page-kicker">Research context attached</span>
              <strong>{STRATEGY_LABELS[research.request.strategy]} {research.best.fast}/{research.best.slow} · {research.verdict.level.toUpperCase()}</strong>
              <small>
                Model budget {research.request.slippageBps} bps
                {costVsModel == null
                  ? " · live impact pending"
                  : ` · live impact is ${Math.abs(costVsModel).toFixed(2)} bps ${costVsModel <= 0 ? "inside" : "above"} budget`}
              </small>
            </div>
            <div>
              <button onClick={onOpenResearch}>Review evidence</button>
              <button onClick={onOpenData}>Verify feed</button>
            </div>
          </div>
        )}

      <div className="card">
        <h2>Execution cost probe</h2>
        <p className="sub">
          Walk the live ladder for a target order and see what it would actually cost, plus the
          cross-venue split that minimises it.
        </p>

        <div className="row" style={{ marginBottom: 12, alignItems: "flex-end" }}>
          <div style={{ flex: 1.4 }}>
            <label className="field" htmlFor="probe">Target notional (USD)</label>
            <input
              id="probe"
              type="number"
              min={100}
              step={10000}
              value={notional}
              onChange={(e) => onNotionalChange(Math.max(100, Number(e.target.value) || 0))}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label className="field">Side</label>
            <div className="seg">
              {(["BUY", "SELL"] as Side[]).map((s) => (
                <button key={s} aria-pressed={s === side} onClick={() => onSideChange(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {PROBE_SIZES.map((n) => (
            <button key={n} className="icon" onClick={() => onNotionalChange(n)} style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>
              ${compact(n)}
            </button>
          ))}
        </div>

        {tca ? (
          <>
            <div className="table-wrap" style={{ marginBottom: 14 }}>
              <table>
                <caption className="sr-only">Execution estimate per venue</caption>
                <thead>
                  <tr>
                    <th scope="col">Venue</th>
                    <th scope="col">VWAP</th>
                    <th scope="col">Slippage</th>
                    <th scope="col">Levels</th>
                    <th scope="col">Fillable</th>
                  </tr>
                </thead>
                <tbody>
                  {tca.perVenue.map((e) => (
                    <tr key={e.venue}>
                      <th scope="row" style={{ textAlign: "left", padding: "7px 10px", borderBottom: "1px solid var(--grid)" }}>
                        {e.venue}
                      </th>
                      <td>{fmt(e.vwap, dp)}</td>
                      <td className={(e.slippageBps ?? 0) > 10 ? "neg" : ""}>{fmt(e.slippageBps, 2)} bps</td>
                      <td className="muted">{e.levelsConsumed}</td>
                      <td className={e.fillable ? "pos" : "neg"}>
                        {e.fillable ? "yes" : `only $${compact(e.filledNotional)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", height: 26, borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)", marginBottom: 12 }}>
              {tca.legs.length ? (
                tca.legs.map((l, i) => (
                  <div
                    key={l.venue}
                    style={{
                      width: `${l.sharePct}%`,
                      background: i === 0 ? "var(--series-1)" : "var(--series-2)",
                      color: "#fff",
                      display: "grid",
                      placeItems: "center",
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      fontWeight: 700,
                      /* 2px surface gap rather than a drawn border between fills */
                      boxShadow: i > 0 ? "inset 2px 0 0 var(--surface-1)" : undefined,
                    }}
                  >
                    {l.venue} {l.sharePct.toFixed(0)}%
                  </div>
                ))
              ) : (
                <div style={{ width: "100%", background: "var(--surface-2)", display: "grid", placeItems: "center", fontSize: 11, color: "var(--text-muted)" }}>
                  no routable liquidity
                </div>
              )}
            </div>

            <div className="tiles" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
              <StatTile label="Blended VWAP" value={fmt(tca.vwap, dp)} note="smart route" />
              <StatTile
                label="Slippage"
                value={tca.slippageBps == null ? "—" : `${fmt(tca.slippageBps, 2)} bps`}
                note="vs consolidated mid"
                tone={(tca.slippageBps ?? 0) > 10 ? "neg" : undefined}
              />
              <StatTile
                label="Saved vs worst venue"
                value={tca.savingUsd == null ? "—" : usd(tca.savingUsd, 2)}
                note="on this order"
                tone={tca.savingUsd && tca.savingUsd > 0 ? "pos" : undefined}
              />
            </div>

            <DislocationStrip
              dislocation={tca.dislocation}
              venuesOnline={tca.perVenue.map((e) => e.venue)}
            />
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>Waiting for a live book on both venues…</p>
        )}
      </div>

        <details className="card execution-methodology">
          <summary>How the live routing feed works</summary>
          <p className="sub">
            The ladders stream over WebSockets opened directly from your browser to Binance and
            Bybit. The same numbers are available as REST snapshots at <code>/api/depth</code> and
            <code>/api/tca</code> for non-browser callers, computed with identical maths. Pre-trade
            risk checks and the execution kill-switch remain on the always-on gateway.
          </p>
        </details>
      </WorkspaceSubtabPanel>
    </>
  );
}
