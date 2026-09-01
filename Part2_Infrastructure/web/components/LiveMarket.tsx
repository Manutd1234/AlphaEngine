"use client";

/**
 * Live market view — streaming L2 books and execution cost, in the browser.
 *
 * The books arrive over WebSockets opened straight to Binance and Bybit; nothing
 * here goes through the API. The same numbers are available as REST snapshots at
 * `/api/depth` and `/api/tca` for non-browser callers.
 *
 * What is left in this file is the tab's spine: the ONE `useLiveBook`
 * subscription, the watchlist poll behind it, and the decision about which
 * market context a section gets. The three panels it composes each took their
 * own dependencies with them:
 *
 *   MarketWatchlist  the instrument list and venue-status strip
 *   LiquidityBook    the depth curve and the click-to-trade ladder
 *   RoutingProbe     the cost probe, its what-if constraints and RouteEstimate
 *
 * They render no book of their own, deliberately. A second subscription would
 * be a second moment of the same market, and a ladder disagreeing with the
 * cost probe above it is worse than either being late.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import SymbolCombobox from "@/components/SymbolCombobox";
import LiquidityBook from "@/components/execution/LiquidityBook";
import MarketWatchlist, {
  EquityMarketPath,
} from "@/components/execution/MarketWatchlist";
import {
  equityQuoteHealthLabel,
  useEquityQuotePreview,
} from "@/components/execution/use-equity-quote";
import RoutingProbe from "@/components/execution/RoutingProbe";
import { LiveMidContext } from "@/components/execution/live-mid-context";
import { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { useLiveBook } from "@/lib/livebook";
import { type ExecutionSection } from "@/lib/sections";
import { SYMBOLS, marketCapabilitiesFor, type Side, type Ticker } from "@/lib/venues";
import { fmt, priceDp, signedPct } from "@/lib/format";
import { type SweepResponse } from "@/lib/types";
import { usePolling } from "@/lib/use-polling";

export { type ExecutionSection } from "@/lib/sections";

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
  /** Ladder click-to-trade: stage a limit at the clicked level in the ticket. */
  onPriceSelect?: (pick: { side: Side; price: number }) => void;
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
  onPriceSelect,
  children,
}: LiveMarketProps) {
  const capabilities = marketCapabilitiesFor(symbol);
  const paperEquity = capabilities.paperMarketOrder;
  const snap = useLiveBook(symbol, capabilities.directL2);
  const dp = snap?.consolidatedMid ? priceDp(snap.consolidatedMid) : 2;
  const [tickerBySymbol, setTickerBySymbol] = useState<Record<string, Ticker>>({});
  const { quote: quotePreview, pending: quotePreviewPending, health: quoteHealth } =
    useEquityQuotePreview(symbol, paperEquity);
  // Direction of each symbol's last real price change, for the tick flash.
  // Redundant emphasis only: the signed 24h% with its sign glyph sits beside
  // the price, which is what the no-colour-only rule requires.
  const [tickDirection, setTickDirection] = useState<Record<string, "up" | "down">>({});
  const prevTickers = useRef<Record<string, Ticker>>({});
  /* The watchlist fetch closes over an AbortController owned by the effect
     below, so the loop calls through a ref rather than owning the callback —
     an aborted controller must not be polled against. */
  const refreshWatchlistRef = useRef<(() => Promise<void>) | null>(null);
  const activeTicker = tickerBySymbol[symbol];
  const activeChange = paperEquity ? quotePreview?.changePct ?? null : activeTicker?.changePct24h ?? null;
  const activeLast = paperEquity ? quotePreview?.price ?? null : activeTicker?.last ?? snap?.consolidatedMid ?? null;
  const liveVenues = snap?.venues.filter((venue) => venue.status === "live").length ?? 0;

  // The ticket (rendered as children) reads the mid for its price-band hint.
  const wrappedChildren = (
    <LiveMidContext.Provider value={snap?.consolidatedMid ?? null}>
      {children}
    </LiveMidContext.Provider>
  );

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
        const next = Object.fromEntries((body.tickers ?? []).map((ticker) => [ticker.symbol, ticker]));
        // Flash on change only. The price element is keyed by its value, so
        // an unchanged poll remounts nothing and replays nothing.
        const moved: Record<string, "up" | "down"> = {};
        for (const [tickerSymbol, ticker] of Object.entries(next)) {
          const was = prevTickers.current[tickerSymbol]?.last;
          if (was != null && ticker.last != null && ticker.last !== was) {
            moved[tickerSymbol] = ticker.last > was ? "up" : "down";
          }
        }
        prevTickers.current = next;
        setTickerBySymbol(next);
        if (Object.keys(moved).length) setTickDirection((prev) => ({ ...prev, ...moved }));
      } catch (watchlistError) {
        if ((watchlistError as Error).name !== "AbortError") {
          // The L2 stream remains authoritative for the active symbol. A failed
          // 24h summary should leave em dashes, not take the trading surface down.
        }
      }
    };

    void refreshWatchlist();
    refreshWatchlistRef.current = refreshWatchlist;
    return () => {
      controller.abort();
      refreshWatchlistRef.current = null;
    };
  }, []);

  /* The old timer fired every 30s and the callback returned immediately when
     `document.hidden` — so a backgrounded tab woke the main thread twice a
     minute to decide to do nothing, and the loop had no backoff when the
     ticker route was refusing. The controller does not wake at all. */
  usePolling({
    tick: () => refreshWatchlistRef.current?.(),
    intervalMs: 30_000,
    maxBackoffMs: 300_000,
  });

  const instrumentPanel = (
    <MarketWatchlist
      symbol={symbol}
      onSymbolChange={onSymbolChange}
      liveSupported={capabilities.directL2}
      snap={snap}
      tickerBySymbol={tickerBySymbol}
      tickDirection={tickDirection}
      equityHealth={paperEquity ? quoteHealth : null}
    />
  );

  const compactMarketContext = (
    <section className="execution-market-strip" aria-label={`${symbol} market context`}>
      <div style={{ flex: "0 1 220px", minWidth: 180 }}>
        <SymbolCombobox
          id="execution-symbol"
          label="Trade instrument"
          value={symbol}
          onCommit={onSymbolChange}
        />
      </div>
      <dl>
        <div>
          <dt>Last</dt>
          <dd className="num">
            {activeLast == null ? "—" : fmt(activeLast, priceDp(activeLast))}
            <small className={activeChange == null ? "muted" : activeChange >= 0 ? "pos" : "neg"}>
              {activeChange == null ? "24h pending" : `24h ${signedPct(activeChange)}`}
            </small>
          </dd>
        </div>
        {paperEquity ? (
          <>
            <div>
              <dt>Reference</dt>
              <dd>
                {quotePreview?.source ?? (quotePreviewPending ? "Checking…" : "Unavailable")}
                {quotePreview ? (
                  <small className="muted console-wrap">
                    {quotePreview.synthetic ? "display only" : quotePreview.delayed ? "delayed" : "provider quote"};{" "}
                    {equityQuoteHealthLabel(quoteHealth)}
                  </small>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Execution</dt>
              <dd>Paper MARKET<small className="muted console-wrap">no L2 routing</small></dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt>L2 mid</dt>
              <dd className="num">{snap?.consolidatedMid == null ? "—" : fmt(snap.consolidatedMid, dp)}</dd>
            </div>
            <div>
              <dt>Spread</dt>
              <dd className="num">{snap?.spreadBps == null ? "—" : `${fmt(snap.spreadBps, 2)} bps`}</dd>
            </div>
          </>
        )}
      </dl>
      <span className={`execution-market-strip__status${liveVenues > 0 || (quotePreview && !quotePreview.synthetic && !quotePreview.delayed && quoteHealth.state === "fresh") ? " is-live" : ""}`}>
        <i aria-hidden />
        {paperEquity
          ? quotePreview
            ? quotePreview.synthetic
              ? `Sandbox preview — not execution evidence; ${equityQuoteHealthLabel(quoteHealth)}`
              : quoteHealth.state !== "fresh"
                ? `${equityQuoteHealthLabel(quoteHealth)}; retained ${quotePreview.delayed ? "delayed/EOD" : "provider"} quote`
                : quotePreview.delayed
                  ? `Delayed/EOD equity quote; ${equityQuoteHealthLabel(quoteHealth)}; market as of ${new Date(quotePreview.asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : `Covered US ticker; ${equityQuoteHealthLabel(quoteHealth)}; market as of ${new Date(quotePreview.asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : equityQuoteHealthLabel(quoteHealth)
          : !capabilities.directL2 ? "Quote only" : snap ? `${liveVenues} venues live` : "Connecting"}
      </span>
    </section>
  );

  const marketContext = section === "liquidity" || section === "routing"
    ? instrumentPanel
    : section === "trade"
      ? compactMarketContext
      : null;

  if (!capabilities.directL2) {
    return (
      <>
        {marketContext}
        {wrappedChildren}
        {(["liquidity", "routing"] as const).map((tabId) => (
          capabilities.paperMarketOrder ? (
            <EquityMarketPath
              key={tabId}
              symbol={symbol}
              tabId={tabId}
              activeId={section}
              quote={quotePreview}
              quotePending={quotePreviewPending}
              quoteHealth={quoteHealth}
              onOpenData={onOpenData}
              onOpenResearch={onOpenResearch}
            />
          ) : (
            <WorkspaceSubtabPanel key={tabId} workspaceId="execution" tabId={tabId} activeId={section}>
              <div className="capability-empty">
                <span className="role-monogram" aria-hidden>L2</span>
                <div>
                  <span className="page-kicker">Capability boundary</span>
                  <h2>Direct L2 routing is not available for {symbol}.</h2>
                  <p>
                    Quote and news coverage stay in Data &amp; systems. Select a supported crypto
                    pair above for direct Binance and Bybit books.
                  </p>
                  <div>
                    {/* Both are navigation, so both look like navigation. The
                        first wore the fill reserved for Send order. */}
                    <button onClick={onOpenData}>Open data workspace</button>
                    <button onClick={onOpenResearch}>Review research context</button>
                  </div>
                </div>
              </div>
            </WorkspaceSubtabPanel>
          )
        ))}
      </>
    );
  }

  return (
    <>
      {marketContext}
      {wrappedChildren}

      {/* `active` on both: the panels persist behind `hidden` once visited,
          and the snapshot arrives every 300ms whichever section is showing.
          Each panel is memoised to skip its render while hidden (see
          `execution/hidden-panel.ts`), so the ladder and the probe cost
          nothing to a reader on the ticket and repaint on the book's cadence
          only while they are the section on screen. */}
      <WorkspaceSubtabPanel workspaceId="execution" tabId="liquidity" activeId={section}>
        <LiquidityBook
          symbol={symbol}
          snap={snap}
          dp={dp}
          onPriceSelect={onPriceSelect}
          active={section === "liquidity"}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="execution" tabId="routing" activeId={section}>
        <RoutingProbe
          active={section === "routing"}
          symbol={symbol}
          snap={snap}
          dp={dp}
          side={side}
          onSideChange={onSideChange}
          notional={notional}
          onNotionalChange={onNotionalChange}
          research={research}
          onOpenResearch={onOpenResearch}
          onOpenData={onOpenData}
        />
      </WorkspaceSubtabPanel>
    </>
  );
}
