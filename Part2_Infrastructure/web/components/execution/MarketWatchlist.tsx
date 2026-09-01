"use client";

/**
 * The watchlist and the venue-status strip — the market-analysis half of the
 * Execution tab's context panel.
 *
 * Split out of `LiveMarket` verbatim: this is the panel the Liquidity and
 * Routing sections show, and it is the tall one. `LiveMarket` still decides
 * WHICH context a section gets (this or the compact Trade strip), because that
 * decision is about the section, not about the panel.
 *
 * It renders no book of its own. Every figure arrives as a prop from the one
 * `useLiveBook` snapshot the tab holds, so the watchlist, the ladder and the
 * cost probe can never be quoting three different moments of the same market.
 */

import { fmt, priceDp, signedPct } from "@/lib/format";
import type { LiveSnapshot } from "@/lib/livebook";
import type { ExecutionSection } from "@/lib/sections";
import { SYMBOLS, type Ticker } from "@/lib/venues";
import { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import {
  EQUITY_QUOTE_STALE_MS,
  EQUITY_QUOTE_TTL_MS,
  equityQuoteHealthLabel,
  type EquityQuoteHealth,
  type EquityQuotePreview,
} from "./use-equity-quote";

const STATUS_STYLE = {
  live: { icon: "●", label: "live" },
  connecting: { icon: "◌", label: "connecting" },
  stale: { icon: "▲", label: "stale" },
  error: { icon: "✕", label: "down" },
} as const;

interface MarketWatchlistProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  /** False for a symbol with no direct L2 stream — quote coverage only. */
  liveSupported: boolean;
  snap: LiveSnapshot | null;
  tickerBySymbol: Record<string, Ticker>;
  /** Direction of each symbol's last real price change, for the tick flash. */
  tickDirection: Record<string, "up" | "down">;
  equityHealth?: EquityQuoteHealth | null;
}

/**
 * Equity market context for the two tabs whose crypto implementation is L2.
 * A quote-backed paper route is useful evidence, so it stays visible while the
 * absent licensed equity depth feed is named as one narrow boundary.
 */
export function EquityMarketPath({
  symbol,
  tabId,
  activeId,
  quote,
  quotePending,
  quoteHealth,
  onOpenData,
  onOpenResearch,
}: {
  symbol: string;
  tabId: "liquidity" | "routing";
  activeId: ExecutionSection;
  quote: EquityQuotePreview | null;
  quotePending: boolean;
  quoteHealth: EquityQuoteHealth;
  onOpenData: () => void;
  onOpenResearch: () => void;
}) {
  const titleId = `equity-market-path-${tabId}`;
  const quoteAsOf = quote
    ? new Date(quote.asOf).toISOString().replace("T", " ").replace(".000Z", " UTC")
    : null;
  return (
    <WorkspaceSubtabPanel workspaceId="execution" tabId={tabId} activeId={activeId}>
      <section className="card console-card" aria-labelledby={titleId}>
        <header className="section-heading compact">
          <div>
            <span className="page-kicker">Equity market path</span>
            <h2 id={titleId}>{symbol} provider quote &amp; paper execution</h2>
          </div>
          <span className="section-note">
            {quotePending && quoteHealth.state === "fresh"
              ? "REST quote refreshing" : equityQuoteHealthLabel(quoteHealth)}
          </span>
        </header>

        <dl className="console-facts" aria-label={`${symbol} equity quote evidence`}>
          <div>
            <dt>Last provider quote</dt>
            <dd>
              {quote
                ? `${quote.currency} ${fmt(quote.price, priceDp(quote.price))}`
                : quotePending ? "Checking…" : "— no answer"}
            </dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd>{quote?.source ?? (quotePending ? "Routing…" : "— no provenance")}</dd>
          </div>
          <div>
            <dt>Quote as of</dt>
            <dd>{quoteAsOf ? <time dateTime={quote?.asOf}>{quoteAsOf}</time> : "— no timestamp"}</dd>
          </div>
          <div>
            <dt>Delivery</dt>
            <dd>
              {quote
                ? quote.synthetic ? "Synthetic preview — display only"
                  : quote.delayed ? "Provider delayed/EOD tier" : "Provider current tier"
                : "— not observed"}
            </dd>
          </div>
          <div className="console-facts__span">
            <dt>Refresh health</dt>
            <dd>
              {equityQuoteHealthLabel(quoteHealth)}
              <small className="muted console-wrap">
                {`stale after ${EQUITY_QUOTE_STALE_MS / 1_000} s; live-status TTL ${EQUITY_QUOTE_TTL_MS / 60_000} min; expired values stay as context`}
              </small>
            </dd>
          </div>
        </dl>

        <p className="console-subhead">Available paper MARKET path</p>
        <ol className="console-lineage" aria-label={`${symbol} paper order route`}>
          <li>
            <strong>Provider registry</strong>
            <small>
              {quote
                ? `${quote.source} supplied the display quote above.`
                : "The REST quote chain is available; no usable preview is retained yet."}
            </small>
          </li>
          <li>
            <strong>Risk gateway</strong>
            <small>Order submission re-fetches and validates a server-side USD quote; browser prices are never trusted.</small>
          </li>
          <li>
            <strong>Paper execution</strong>
            <small>MARKET only. The gateway returns a modelled paper fill, not a broker order or venue allocation.</small>
          </li>
        </ol>

        <div className="banner context-change">
          <span aria-hidden>i</span>
          <div>
            <strong>Direct equity L2 is not provisioned.</strong> That limits depth and live TCA; it does not take the REST quote or paper-order route down.
          </div>
        </div>
        <div className="page-actions">
          <button type="button" onClick={onOpenData}>Inspect quote lineage</button>
          <button type="button" onClick={onOpenResearch}>Review research context</button>
        </div>
      </section>
    </WorkspaceSubtabPanel>
  );
}

export default function MarketWatchlist({
  symbol,
  onSymbolChange,
  liveSupported,
  snap,
  tickerBySymbol,
  tickDirection,
  equityHealth,
}: MarketWatchlistProps) {
  return (
    <section className="card instrument-panel market-context-card" aria-labelledby="market-watchlist-title">
      <div className="market-context-card__heading">
        <div>
          <span className="page-kicker">Live market context</span>
          <h2 id="market-watchlist-title">Watchlist</h2>
        </div>
        <span className={`market-context-card__mode${liveSupported ? " is-live" : ""}`}>
          <i aria-hidden /> {liveSupported
            ? "Direct L2 streaming"
            : equityHealth
              ? `REST quote ${equityHealth.state}${equityHealth.refreshFailed ? "; refresh failed" : ""}`
              : "Quote coverage only"}
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

      {/* Only where there is a venue socket to report on. `.venue-status-strip`
          carries a top border and 20px of its own padding, so for an
          instrument with no direct L2 stream it drew a hairline rule with
          nothing beneath it — a divider separating the watchlist from empty
          plane. No fact goes with it: the mode chip in this card's own heading
          already reads "Quote coverage only" at rest, which is the reason
          there is no venue row to draw. */}
      {liveSupported ? (
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
        {!snap ? (
          <div className="venue-status is-connecting">
            <span className="venue-status__name"><i aria-hidden /><strong>VENUES</strong><small>connecting</small></span>
            <span className="venue-status__metrics">Opening public sockets…</span>
          </div>
        ) : null}
      </div>
      ) : null}
    </section>
  );
}
