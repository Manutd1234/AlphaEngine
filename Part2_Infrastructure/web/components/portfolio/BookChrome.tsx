"use client";

/**
 * The parts of the book view that must read identically on Portfolio and Risk.
 *
 * Both tabs are the same snapshot asked a different question, so both have to
 * carry the same warnings. If only one of them said "this book is generated" or
 * "this data is stale", the other would be a quietly misleading screen — and the
 * risk tab is precisely where a stale number does the most damage.
 */

import type { BookView } from "@/lib/use-book";

export interface BookFallbackProps {
  view: BookView;
  /** Where "open research instead" should land. */
  onOpenResearch: () => void;
}

/**
 * Loading, unconfigured and unreachable states. Returns null once a book
 * exists, so callers read `?? <the real panel>`.
 */
export function BookFallback({ view, onOpenResearch }: BookFallbackProps) {
  const { book, loading, error, connectionState, refresh, setSandbox } = view;

  if (book) return null;

  if (loading) {
    return (
      <div className="portfolio-loading" aria-label="Loading portfolio">
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    );
  }

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
          <button onClick={onOpenResearch}>Open Research</button>
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
        <button className="primary-action" onClick={() => void refresh()} disabled={loading}>
          {loading ? "Connecting…" : "Retry connection"}
        </button>
        <button onClick={() => setSandbox(true)}>Explore the sandbox book</button>
        <button onClick={onOpenResearch}>Open Research</button>
      </div>
      <p className="research-note">
        The gateway is a long-lived process and may simply be asleep. The sandbox is a generated
        book, labelled on every panel, so this surface can still be evaluated.
      </p>
    </div>
  );
}

/**
 * Halt / stale / sandbox banners and the source-and-refresh strip. Rendered at
 * the top of both tabs.
 */
export function BookChrome({ view }: { view: BookView }) {
  const { book, error, isStale, sandbox, setSandbox, refresh, refreshing, lastSuccessAt } = view;
  if (!book) return null;

  const lastRefreshLabel = (lastSuccessAt ?? new Date(book.as_of)).toLocaleTimeString();
  const gatewayEnvironment = book.gateway?.environment?.trim().toLowerCase();
  const gatewayLabel = gatewayEnvironment && gatewayEnvironment !== "production"
    ? `${gatewayEnvironment[0].toUpperCase()}${gatewayEnvironment.slice(1)} risk gateway live`
    : "Authoritative risk gateway live";

  return (
    <>
      {book.trading_halted && (
        <div className="banner error" role="alert">
          <span aria-hidden>■</span>
          <div>
            <strong>{isStale ? "Trading was halted at the last successful refresh." : "Trading is halted."}</strong>{" "}
            {book.halted_symbols.length
              ? `Halted instruments: ${book.halted_symbols.join(", ")}.`
              : "The global kill switch is active."}
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
              disabled={!view.book && !error}
            >
              Live gateway
            </button>
            <button type="button" aria-pressed={sandbox} onClick={() => setSandbox(true)}>
              Sandbox
            </button>
          </div>
          <button onClick={() => void refresh(true)} disabled={refreshing || sandbox}>
            {refreshing ? (isStale ? "Reconnecting…" : "Refreshing…") : (isStale ? "Reconnect" : "Refresh book")}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * The compact cross-tab tile. Each role tab is self-sufficient — a PM should see
 * that the book is near a limit without opening the risk tab — but only one tab
 * owns the full panel, and this links to it rather than duplicating it.
 */
export interface CrossLinkTileProps {
  kicker: string;
  title: string;
  actionLabel: string;
  onNavigate: () => void;
  metrics: { label: string; value: string; note?: string; tone?: "pos" | "neg" | "warn" }[];
  children?: React.ReactNode;
}

export function CrossLinkTile({
  kicker,
  title,
  actionLabel,
  onNavigate,
  metrics,
  children,
}: CrossLinkTileProps) {
  return (
    <div className="card cross-link-tile">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">{kicker}</span>
          <h2>{title}</h2>
        </div>
        <button className="text-action" onClick={onNavigate}>{actionLabel} →</button>
      </div>
      <div className="cross-link-metrics">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <span>{metric.label}</span>
            <strong className={`num${metric.tone ? ` ${metric.tone}` : ""}`}>{metric.value}</strong>
            {metric.note && <small>{metric.note}</small>}
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}
