"use client";

/**
 * Live market view — streaming L2 books and execution cost, in the browser.
 *
 * The books arrive over WebSockets opened straight to Binance and Bybit; nothing
 * here goes through the API. The same numbers are available as REST snapshots at
 * `/api/depth` and `/api/tca` for non-browser callers.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import DepthChart from "@/components/DepthChart";
import DislocationStrip from "@/components/DislocationStrip";
import StatTile from "@/components/StatTile";
import SymbolCombobox from "@/components/SymbolCombobox";
import { LiveMidContext } from "@/components/execution/live-mid-context";
import { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { liveTca, useLiveBook } from "@/lib/livebook";
import { classify } from "@/lib/providers/symbols";
import { type ExecutionSection } from "@/lib/sections";
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
  // What-if constraints for the probe only: null include-list means every
  // venue, and an empty cap string means uncapped, so the default call is
  // opts-free and stays on the gateway-parity path.
  const [includedVenues, setIncludedVenues] = useState<string[] | null>(null);
  const [capText, setCapText] = useState("");
  const capBps = Number.isFinite(parseFloat(capText)) ? parseFloat(capText) : undefined;
  const whatIfActive = includedVenues !== null || capBps !== undefined;
  const tca = liveTca(
    snap,
    side,
    notional,
    whatIfActive ? { venues: includedVenues ?? undefined, maxSlippageBps: capBps } : undefined,
  );
  const dp = snap?.consolidatedMid ? priceDp(snap.consolidatedMid) : 2;
  const [tickerBySymbol, setTickerBySymbol] = useState<Record<string, Ticker>>({});
  const [quotePreview, setQuotePreview] = useState<QuotePreview | null>(null);
  const [quotePreviewPending, setQuotePreviewPending] = useState(false);
  // Direction of each symbol's last real price change, for the tick flash.
  // Redundant emphasis only: the signed 24h% with its sign glyph sits beside
  // the price, which is what the no-colour-only rule requires.
  const [tickDirection, setTickDirection] = useState<Record<string, "up" | "down">>({});
  const prevTickers = useRef<Record<string, Ticker>>({});
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
    const timer = window.setInterval(() => void refreshWatchlist(), 30_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

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

    // Lifting an ask is a BUY at that price; hitting a bid is a SELL.
    const clickSide: Side = kind === "ask" ? "BUY" : "SELL";

    return rowsOut.map(({ p, q, cum: c }) => (
      <button
        key={`${kind}-${p}`}
        type="button"
        className="ladder-row"
        title="Stage as a limit order in the ticket"
        aria-label={`${clickSide === "BUY" ? "Buy" : "Sell"} ${symbol} at ${fmt(p, dp)} — stage a limit order in the ticket`}
        onClick={() => onPriceSelect?.({ side: clickSide, price: p })}
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
            /* 0.14 read as ~1.05:1 against the card — a wash nobody saw. */
            opacity: 0.22,
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
      </button>
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

      <div className="market-watchlist-shell">
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
              <strong
                className="num market-watchlist__price"
                key={ticker?.last ?? "pending"}
                data-tick={tickDirection[watchSymbol]}
              >
                {ticker?.last == null ? "—" : fmt(ticker.last, priceDp(ticker.last))}
              </strong>
              <small className={`num${change == null ? "" : change >= 0 ? " pos" : " neg"}`}>
                {change == null ? "24h —" : `24h ${signedPct(change)}`}
              </small>
            </button>
          );
        })}
      </div>
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
                {venue.book.latencyMs ? `, ${fmt(venue.book.latencyMs, 0)} ms` : ""}
                {venue.reconnects > 0 ? `; ${venue.reconnects} reconnects` : ""}
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
                  Quote and news coverage can still be inspected in Data &amp; systems. Select a supported
                  crypto pair above to open direct Binance and Bybit order books.
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

  const costVsModel = tca?.slippageBps == null || !research
    ? null
    : tca.slippageBps - research.request.slippageBps;

  return (
    <>
      {marketContext}
      {wrappedChildren}

      <WorkspaceSubtabPanel workspaceId="execution" tabId="liquidity" activeId={section}>

      <div className="tiles" style={{ marginBottom: 16, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        <StatTile label="Consolidated mid" value={fmt(snap?.consolidatedMid, dp)} note={`${snap?.venues.filter((v) => v.status === "live").length ?? 0} venues live`} />
        <StatTile
          label="Spread"
          value={snap?.spreadBps == null ? "—" : `${fmt(snap.spreadBps, 2)} bps`}
          note={snap?.spreadBps != null && snap.spreadBps < 0 ? "crossed across venues" : "consolidated"}
          tone={snap?.spreadBps != null && snap.spreadBps < 0 ? "pos" : undefined}
        />
        {/* Dashed, not zeroed — matching the Spread tile beside them. An
            absent snapshot rendered "$0 of depth", which reads as an empty
            book rather than as an unread one. */}
        <StatTile
          label="Bid depth"
          value={snap?.depthUsdBid == null ? "—" : `$${compact(snap.depthUsdBid)}`}
          note={snap == null ? "no book snapshot" : "within ±10 bps of mid"}
        />
        <StatTile
          label="Ask depth"
          value={snap?.depthUsdAsk == null ? "—" : `$${compact(snap.depthUsdAsk)}`}
          note={snap == null ? "no book snapshot" : "within ±10 bps of mid"}
        />
        <StatTile
          label="Imbalance"
          value={snap?.imbalance == null ? "—" : `${(snap.imbalance * 100).toFixed(1)}%`}
          note={snap?.imbalance == null ? "" : snap.imbalance > 0 ? "bid heavy" : "ask heavy"}
          tone={snap?.imbalance == null ? undefined : snap.imbalance > 0 ? "pos" : "neg"}
        />
      </div>

      {/* The curve and the ladder are the same book read two ways, so they
          share one baseline: the chart takes the ladder's height instead of
          sitting 210px tall beside 570px of levels. */}
      <div className="compact-grid-2col liquidity-pair">
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
            height={430}
          />
        </div>

        <div className="card">
          <h2>Consolidated ladder</h2>
          <p className="sub">
            Every venue&apos;s levels merged and sorted by price — the book a smart router actually
            walks. Click a level to stage it as a limit order in the ticket.
          </p>
          <div className="liquidity-pair__book">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                fontSize: "var(--fs-2xs)",
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
              <span className="num" style={{ fontSize: "var(--fs-h2)", fontWeight: 650 }}>
                {fmt(snap?.consolidatedMid, dp)}
              </span>
              <span className="num muted" style={{ fontSize: "var(--fs-body)" }}>
                spread {fmt(snap?.spreadBps, 2)} bps
              </span>
            </div>
            {snap ? ladder(snap.merged.bids, "bid") : <div className="muted" style={{ padding: 16, textAlign: "center" }}>waiting for book…</div>}
          </div>
        </div>
      </div>

      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="execution" tabId="routing" activeId={section}>
        {research?.request.symbol === symbol && (
          <div className="workflow-handoff execution-handoff">
            <div>
              <span className="page-kicker">Research context attached</span>
              <strong>{STRATEGY_LABELS[research.request.strategy]} {research.best.fast}/{research.best.slow}, {research.verdict.level.toUpperCase()}</strong>
              <small>
                Model budget {research.request.slippageBps} bps
                {costVsModel == null
                  ? "; live impact pending"
                  : `; live impact is ${Math.abs(costVsModel).toFixed(2)} bps ${costVsModel <= 0 ? "inside" : "above"} budget`}
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
        {/* "see what it would actually cost" was the h2 above it in a longer
            form. What the heading does not say is that the walk is over the
            live ladder rather than a model, and that the split comes with it. */}
        <p className="sub">
          Walks the live ladder for a target order, and the cross-venue split
          that minimises it.
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
            {/* The only `.seg` in the app that carried neither `role="group"`
                nor a name, so a screen reader met two loose buttons rather than
                a two-way choice. Not `seg--side`: this is the cost probe's
                input, not an order ticket — nothing here can be submitted, so
                it takes the same quiet selection as every other filter. */}
            <div className="seg" role="group" aria-label="Probe side">
              {(["BUY", "SELL"] as Side[]).map((s) => (
                <button key={s} type="button" aria-pressed={s === side} onClick={() => onSideChange(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Shortcuts into the notional field above, and now they say so.
            They were five loose buttons in a bare flex div — no group, no name,
            and no `aria-pressed`, so a screen reader met five unrelated actions
            and could not tell which size the probe was actually running.

            Not a `.seg`: five options against that control's two-or-three
            budget, and `.seg button` is `flex: 1`, so a fifth segment buys the
            grouping by abbreviating every label. A named group of toggles keeps
            the full amounts.

            The pressed state is carried by a mark rather than by a fill,
            because `.icon` has no selected treatment and inventing one would
            need a rule in globals.css. `aria-pressed` and the ✓ say the same
            thing, so neither audience is reading state off colour — and when
            the trader types an amount by hand, none is marked, which is honest:
            the input, not this row, holds the value. */}
        <div
          role="group"
          aria-label="Target notional shortcuts"
          style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}
        >
          {PROBE_SIZES.map((n) => (
            <button
              key={n}
              type="button"
              className="icon"
              aria-pressed={notional === n}
              title={`Set the target notional to $${compact(n)}`}
              onClick={() => onNotionalChange(n)}
              style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-body)" }}
            >
              {notional === n ? <span aria-hidden>✓ </span> : null}
              ${compact(n)}
            </button>
          ))}
        </div>

        {/* A div with role="group", not a <fieldset>/<legend>. The legend's UA
            rendering places it IN the border, straddling it — and nothing in
            this sheet overrides that, because app/tailwind.css deliberately
            ships no preflight and a preflight is what normally neutralises it.
            A heading inside the box is what was wanted, and this also drops
            fieldset's `min-width: min-content`, which fights flex children. */}
        <div
          className="whatif-constraints"
          role="group"
          aria-labelledby="whatif-constraints-title"
        >
          <p className="page-kicker" id="whatif-constraints-title">
            What-if constraints — client-side only
          </p>
          {/* Urgency presets. The probe's honest levers are the venue set and
              the slippage cap, so that is all a preset writes — into the same
              visible inputs, never hidden state. Passive accepts only cheap
              liquidity; aggressive takes the book as it comes. */}
          <div className="whatif-constraints__row">
            <div>
              <span className="field">Routing strategy</span>
              <div className="seg" role="group" aria-label="What-if routing urgency preset">
                {([
                  { label: "Passive", cap: "1" },
                  { label: "Balanced", cap: "3" },
                  { label: "Aggressive", cap: "" },
                ] as const).map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    aria-pressed={capText === preset.cap && includedVenues === null}
                    disabled={snap?.consolidatedMid == null && preset.cap !== ""}
                    onClick={() => {
                      setCapText(preset.cap);
                      setIncludedVenues(null);
                    }}
                    title={preset.cap === "" ? "All venues, uncapped" : `All venues, max slippage ${preset.cap} bps`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="whatif-constraints__row">
            <div>
              <span className="field">Route through</span>
              {/* Deliberately NOT a `.seg`, and that is a correction rather
                  than a preference. Venue inclusion is a multi-select —
                  `aria-pressed` is independent per venue, and every venue can be
                  on at once — but it was rendered in the same segmented shell as
                  the twenty-odd exclusive pickers beside it, including the
                  routing preset directly above. A control that looks like a
                  one-of-three teaches that turning Bybit on turns Binance off,
                  which is the opposite of what it does.

                  Same treatment as the notional shortcuts above this fieldset:
                  a named group of independent toggles, each carrying its own
                  state as a mark. ✓ included, ✕ excluded — the two readings
                  are both spelled out, so the row reads as a set of switches at
                  a glance and nothing rests on the raised-surface fill that
                  makes a seg look exclusive. */}
              <div
                role="group"
                aria-label="Venues included in the what-if route"
                style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
              >
                {(snap?.venues ?? []).map((v) => {
                  const on = includedVenues === null || includedVenues.includes(v.venue);
                  return (
                    <button
                      key={v.venue}
                      type="button"
                      className="icon"
                      aria-pressed={on}
                      title={on
                        ? `Exclude ${v.venue} from the what-if route`
                        : `Include ${v.venue} in the what-if route`}
                      style={{ fontSize: "var(--fs-body)" }}
                      onClick={() => {
                        const all = (snap?.venues ?? []).map((x) => x.venue);
                        const current = includedVenues ?? all;
                        const next = on
                          ? current.filter((x) => x !== v.venue)
                          : [...current, v.venue];
                        setIncludedVenues(next.length === all.length ? null : next);
                      }}
                    >
                      <span aria-hidden>{on ? "✓" : "✕"}</span> {v.venue}
                    </button>
                  );
                })}
                {/* The seg rendered as an empty pill box before the first book
                    arrived, which reads as a control with its options missing
                    rather than as a probe with nothing to route yet. */}
                {(snap?.venues ?? []).length === 0 && (
                  <span className="muted" style={{ fontSize: "var(--fs-body)" }}>
                    No venue is streaming yet, so there is nothing to include or exclude.
                  </span>
                )}
              </div>
            </div>
            <div>
              <label className="field" htmlFor="probe-cap">Max slippage (bps)</label>
              <input
                id="probe-cap"
                type="number"
                min={0}
                step={1}
                value={capText}
                placeholder="uncapped"
                disabled={snap?.consolidatedMid == null}
                title={snap?.consolidatedMid == null ? "A cap needs a reference mid" : undefined}
                onChange={(e) => setCapText(e.target.value)}
              />
            </div>
          </div>
          <p className="muted whatif-constraints__note">
            Reruns the same TCA maths under your constraints. Nothing is routed and the
            gateway&apos;s pre-trade gates are unaffected.
          </p>
        </div>

        {tca ? (
          <>
            <div className="table-wrap" tabIndex={0} style={{ marginBottom: 14 }}>
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
                  {tca.perVenue.map((e) => {
                    const excluded = tca.excludedVenues.includes(e.venue);
                    return (
                      <tr key={e.venue}>
                        <th scope="row" style={{ textAlign: "left", padding: "7px 10px", borderBottom: "1px solid var(--grid)" }}>
                          {e.venue}
                          {excluded ? <span className="pill pill--info" style={{ marginLeft: 6 }}>excluded</span> : null}
                        </th>
                        <td>{fmt(e.vwap, dp)}</td>
                        <td className={(e.slippageBps ?? 0) > 10 ? "neg" : ""}>{fmt(e.slippageBps, 2)} bps</td>
                        <td className="muted">{e.levelsConsumed}</td>
                        <td className={e.fillable ? "pos" : "neg"}>
                          {e.fillable ? "yes" : `only $${compact(e.filledNotional)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Labels live in the legend below, not inside the segments: white
                text on the orange series-2 fill was ~3.2:1 — an AA failure the
                bar's size never left room to fix in place. */}
            <div
              role="img"
              aria-label={tca.legs.length
                ? `Route split: ${tca.legs.map((l) => `${l.venue} ${l.sharePct.toFixed(0)}%`).join(", ")}`
                : "No routable liquidity"}
              style={{ display: "flex", height: 18, borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)", marginBottom: 4 }}
            >
              {tca.legs.length ? (
                <>
                  {tca.legs.map((l, i) => (
                    <div
                      key={l.venue}
                      aria-hidden
                      style={{
                        /* Sized against the REQUEST, not the fill, so a capped
                           route visibly falls short of the bar. */
                        width: `${(l.notional / tca.requestedNotional) * 100}%`,
                        background: i === 0 ? "var(--series-1)" : "var(--series-2)",
                        /* 2px surface gap rather than a drawn border between fills */
                        boxShadow: i > 0 ? "inset 2px 0 0 var(--surface-1)" : undefined,
                      }}
                    />
                  ))}
                  {tca.cappedBy ? (
                    <div
                      aria-hidden
                      style={{
                        flex: 1,
                        background: "var(--surface-2)",
                        boxShadow: "inset 2px 0 0 var(--surface-1)",
                        borderLeft: "1px dashed var(--border)",
                      }}
                    />
                  ) : null}
                </>
              ) : (
                <div style={{ width: "100%", background: "var(--surface-2)", display: "grid", placeItems: "center", fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
                  {whatIfActive ? "no venue included in this what-if" : "no routable liquidity"}
                </div>
              )}
            </div>
            {tca.legs.length > 0 && (
              <div className="legend" aria-hidden>
                {tca.legs.map((l, i) => (
                  <span key={l.venue}>
                    <i style={{ background: i === 0 ? "var(--series-1)" : "var(--series-2)" }} />
                    {l.venue} {l.sharePct.toFixed(0)}%
                  </span>
                ))}
                {tca.cappedBy ? (
                  <span>
                    <i style={{ background: "var(--surface-2)", border: "1px dashed var(--border)" }} />
                    {tca.cappedBy === "slippage" ? "capped" : "no depth"} ${compact(tca.requestedNotional - tca.filledNotional)}
                  </span>
                ) : null}
              </div>
            )}
            {tca.cappedBy ? (
              <p className="muted" style={{ fontSize: "var(--fs-body)", marginBottom: 10 }}>
                Routable ${compact(tca.filledNotional)} of ${compact(tca.requestedNotional)}
                {tca.cappedBy === "slippage"
                  ? ` — the remainder would breach the ${capBps} bps cap.`
                  : " — the remainder finds no depth on the included venues."}
              </p>
            ) : null}

            <div className="tiles" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
              <StatTile label="Blended VWAP" value={fmt(tca.vwap, dp)} note="aggressive: pay the spread, fill now" />
              <StatTile
                label="Slippage"
                value={tca.slippageBps == null ? "—" : `${fmt(tca.slippageBps, 2)} bps`}
                note="vs consolidated mid"
                tone={(tca.slippageBps ?? 0) > 10 ? "neg" : undefined}
              />
              <StatTile
                label="Passive (join touch)"
                value={tca.passive == null ? "—" : fmt(tca.passive.price, dp)}
                note={tca.passive?.spreadCaptureBps == null
                  ? "no touch to join"
                  : `earns ${fmt(tca.passive.spreadCaptureBps, 2)} bps — if filled; no guarantee`}
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
          <p className="muted" style={{ fontSize: "var(--fs-xl)" }}>Waiting for a live book on both venues…</p>
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
