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
import MarketWatchlist from "@/components/execution/MarketWatchlist";
import RoutingProbe from "@/components/execution/RoutingProbe";
import { LiveMidContext } from "@/components/execution/live-mid-context";
import { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { useLiveBook } from "@/lib/livebook";
import { classify } from "@/lib/providers/symbols";
import { type ExecutionSection } from "@/lib/sections";
import { SYMBOLS, type Side, type Ticker } from "@/lib/venues";
import { fmt, priceDp, signedPct } from "@/lib/format";
import { type SweepResponse } from "@/lib/types";
import { usePolling } from "@/lib/use-polling";

interface QuotePreview {
  price: number;
  changePct: number | null;
  asOf: string;
  source: string;
  delayed: boolean;
}

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
  const liveSupported = (SYMBOLS as readonly string[]).includes(symbol);
  const paperEquity = classify(symbol) === "equity";
  const snap = useLiveBook(symbol, liveSupported);
  const dp = snap?.consolidatedMid ? priceDp(snap.consolidatedMid) : 2;
  const [tickerBySymbol, setTickerBySymbol] = useState<Record<string, Ticker>>({});
  const [quotePreview, setQuotePreview] = useState<QuotePreview | null>(null);
  const [quotePreviewPending, setQuotePreviewPending] = useState(false);
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

  useEffect(() => {
    if (!paperEquity) {
      setQuotePreview(null);
      setQuotePreviewPending(false);
      return;
    }

    const controller = new AbortController();
    setQuotePreview(null);
    setQuotePreviewPending(true);
    void fetch(`/api/quote?symbols=${encodeURIComponent(symbol)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body: unknown) => {
        if (!body || controller.signal.aborted) return;
        const row = (body as {
          quotes?: Array<{
            data?: { price?: unknown; changePct?: unknown; asOf?: unknown; delayed?: unknown };
            provenance?: { label?: unknown; provider?: unknown; delayed?: unknown };
          }>;
        }).quotes?.[0];
        const price = Number(row?.data?.price);
        const asOf = typeof row?.data?.asOf === "string" ? row.data.asOf : "";
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(Date.parse(asOf))) return;
        const changePct = Number(row?.data?.changePct);
        const label = typeof row?.provenance?.label === "string"
          ? row.provenance.label
          : typeof row?.provenance?.provider === "string" ? row.provenance.provider : "Provider";
        setQuotePreview({
          price,
          changePct: Number.isFinite(changePct) ? changePct : null,
          asOf,
          source: label,
          delayed: row?.data?.delayed === true || row?.provenance?.delayed === true,
        });
      })
      .catch(() => {
        // The order route performs its own authoritative lookup. A preview
        // failure leaves the ticket available and never supplies a price.
      })
      .finally(() => {
        if (!controller.signal.aborted) setQuotePreviewPending(false);
      });

    return () => controller.abort();
  }, [paperEquity, symbol]);

  const instrumentPanel = (
    <MarketWatchlist
      symbol={symbol}
      onSymbolChange={onSymbolChange}
      liveSupported={liveSupported}
      snap={snap}
      tickerBySymbol={tickerBySymbol}
      tickDirection={tickDirection}
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
                {quotePreview ? <small className="muted">{quotePreview.delayed ? "delayed" : "provider quote"}</small> : null}
              </dd>
            </div>
            <div>
              <dt>Execution</dt>
              <dd>Paper MARKET<small className="muted">no L2 routing</small></dd>
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
      <span className={`execution-market-strip__status${liveVenues > 0 || quotePreview ? " is-live" : ""}`}>
        <i aria-hidden />
        {paperEquity
          ? quotePreview
            ? `Covered US ticker, as of ${new Date(quotePreview.asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : quotePreviewPending ? "Checking equity coverage" : "Equity quote unavailable"
          : !liveSupported ? "Quote only" : snap ? `${liveVenues} venues live` : "Connecting"}
      </span>
    </section>
  );

  const marketContext = section === "liquidity" || section === "routing"
    ? instrumentPanel
    : section === "trade"
      ? compactMarketContext
      : null;

  if (!liveSupported) {
    return (
      <>
        {marketContext}
        {wrappedChildren}
        {(["liquidity", "routing"] as const).map((tabId) => (
          <WorkspaceSubtabPanel key={tabId} workspaceId="execution" tabId={tabId} activeId={section}>
            <div className="capability-empty">
              <span className="role-monogram" aria-hidden>L2</span>
              <div>
                <span className="page-kicker">Capability boundary</span>
                <h2>Live venue routing is not available for {symbol}.</h2>
                <p>
                  Quote and news coverage stay available in Data &amp; systems. Select a supported
                  crypto pair above for direct Binance and Bybit books.
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
        ))}
      </>
    );
  }

  return (
    <>
      {marketContext}
      {wrappedChildren}

      <WorkspaceSubtabPanel workspaceId="execution" tabId="liquidity" activeId={section}>
        <LiquidityBook symbol={symbol} snap={snap} dp={dp} onPriceSelect={onPriceSelect} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="execution" tabId="routing" activeId={section}>
        <RoutingProbe
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
