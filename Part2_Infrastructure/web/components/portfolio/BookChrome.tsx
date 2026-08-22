"use client";

/**
 * The parts of the book view that must read identically on Portfolio and Risk.
 *
 * Both tabs are the same snapshot asked a different question, so both have to
 * carry the same warnings. If only one of them said "this book is generated" or
 * "this data is stale", the other would be a quietly misleading screen — and the
 * risk tab is precisely where a stale number does the most damage.
 */

import { useState } from "react";

import type { BookView } from "@/lib/use-book";
import { transportLabel } from "@/lib/use-desk-stream";

export interface BookFallbackProps {
  view: BookView;
  /** Where "open research instead" should land. */
  onOpenResearch: () => void;
  /** Which tab is asking, so the failure card names what actually failed. */
  surface?: "portfolio" | "risk";
}

/**
 * Loading, unconfigured and unreachable states. Returns null once a book
 * exists, so callers read `?? <the real panel>`.
 */
export function BookFallback({ view, onOpenResearch, surface = "portfolio" }: BookFallbackProps) {
  const { book, loading, error, connectionState, refresh, setSandbox } = view;

  // A reviewer opening the Risk tab first must be told about limits and
  // headroom, not "the portfolio" — a failure card that names the wrong
  // surface reads like it belongs to a different page.
  const noun = surface === "risk" ? "risk view" : "portfolio book";
  const failedThing = surface === "risk"
    ? "Limits, headroom and tail risk are temporarily unavailable"
    : "Portfolio state is temporarily unavailable";

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
    // Normally unreachable: useBook auto-enters the sandbox on this exact
    // state. It renders only when someone pressed "Live gateway" on a
    // deployment that has none — so the copy explains *why* there is none.
    return (
      <div className="card portfolio-setup-card" role="status" aria-labelledby="book-setup-title">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">No gateway in this deployment</span>
            <h2 id="book-setup-title">The live {noun} needs the always-on gateway</h2>
          </div>
        </div>
        <p className="sub">
          Serverless cannot host a long-lived process, and the gateway is one. The sandbox runs
          instead: a generated book judged by the same gate logic.
        </p>
        <div className="page-actions">
          <button className="primary-action" onClick={() => setSandbox(true)}>
            Back to the sandbox book
          </button>
          <button onClick={onOpenResearch}>Open Research</button>
        </div>
        {/* Operator configuration, for a different reader than the one who
            landed here. Nothing about the state of the book: the sub above
            says why there is no gateway and both actions stay enabled. */}
        <details className="disclosure">
          <summary>What self-hosting needs on the server</summary>
          <p className="research-note">
            Self-hosting? Set <code>ALPHAENGINE_GATEWAY_URL</code> and{" "}
            <code>ALPHAENGINE_GATEWAY_TOKEN</code> on the server and this surface switches to the
            authoritative book.
          </p>
        </details>
      </div>
    );
  }

  return (
    <div className="card portfolio-setup-card" role="alert" aria-labelledby="book-error-title">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Gateway unavailable</span>
          <h2 id="book-error-title">{failedThing}</h2>
        </div>
      </div>
      <p className="sub">{error?.error ?? "The risk gateway did not return a usable response."}</p>
      {error?.hint && <p className="muted">{error.hint}</p>}
      <div className="page-actions">
        <button className="primary-action" onClick={() => void refresh()} disabled={loading}>
          {loading ? "Connecting…" : "Retry connection"}
        </button>
        <button onClick={() => setSandbox(true)}>Explore the sandbox book</button>
        <button onClick={onOpenResearch}>Open Research</button>
      </div>
      <p className="research-note">
        A configured gateway is not answering. Nothing is generated in its place — a sandbox
        appearing during an outage is how generated numbers get mistaken for a desk.
      </p>
    </div>
  );
}

/**
 * Halt / stale / sandbox banners and the source-and-refresh strip. Rendered at
 * the top of both tabs.
 */
export function BookChrome({ view }: { view: BookView }) {
  const { book, error, isStale, sandbox, setSandbox, refresh, refreshing, lastSuccessAt, streamState } = view;
  if (!book) return null;

  // How the last change arrived. The stream and the poll beneath it deliver the
  // same numbers at about a second and up to fifteen, and a desk running on the
  // fallback looked exactly like one running live — so the stream implied a
  // freshness it had stopped delivering. Said in words, never by the dot alone.
  // Through the shared helper, not spelled out here: the cockpit's strip says
  // the same thing, and two literals that must agree is one too many.
  const transport = sandbox ? null : transportLabel(streamState);
  const lastRefreshLabel = (lastSuccessAt ?? new Date(book.as_of)).toLocaleTimeString()
    + (transport ? `, ${transport}` : "");
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

      {/* The refresh time is NOT repeated here. `isStale` is `!sandbox &&
          connectionState === "stale"`, so the strip below renders under exactly
          this condition and prints the same `lastRefreshLabel` off the same
          variable, in the tabular face a timestamp belongs in — this said it and
          then the strip said it again, two lines apart. What is left is the half
          the strip cannot carry: what went wrong, and what stops working until
          it is fixed. */}
      {isStale && (
        <div className="banner warn" role="status" aria-live="polite">
          <span aria-hidden>!</span>
          <div>
            <strong>Portfolio data is stale.</strong>{" "}
            {error?.error} Execution handoffs are disabled until the gateway reconnects.
          </div>
        </div>
      )}

      {/* One strip, three readings, one height.

          The source controls that used to share this strip moved to the section
          rail (`BookSourceControl`), where they stay reachable while scrolling
          instead of costing ~70px at the top of two tabs. The declaration that
          the book is generated did NOT move with them: it is rendered on every
          pass for as long as the mode is on, at full width, on the notice rail.
          A one-time or shrunken banner is how a generated book gets mistaken for
          a real one after ten minutes of reading, and globals.css says outright
          that this marker must never be subtle.

          The live path used to render no strip at all, and that was the jump:
          pressing Sandbox inserted a 43px block above the rail and pressing
          Live removed it, so the rail, every panel and the shell's scroll
          position moved with each press. The live reading now occupies the
          same slot — the gateway the book comes from and when it last
          answered, which at desk width the rail's meta slot does not show —
          so the toggle changes the words in the strip and nothing below it. */}
      {sandbox && (
        <div className="portfolio-statusbar is-sandbox" role="status">
          <div>
            <span className="system-health is-warn">
              <i aria-hidden /> Sandbox book (generated)
            </span>
            <span>
              <strong>These positions do not exist.</strong> Equity, P&amp;L, exposure and every risk
              figure below come from a fixed seed. Execution handoffs are disabled.
            </span>
          </div>
        </div>
      )}
      {!sandbox && isStale && (
        <div className="portfolio-statusbar" role="status">
          <div>
            <span className="system-health is-warn">
              <i aria-hidden /> Stale portfolio snapshot
            </span>
            <span className="num">Last successful refresh {lastRefreshLabel}</span>
          </div>
        </div>
      )}
      {!sandbox && !isStale && (
        <div className="portfolio-statusbar" role="status">
          <div>
            <span className="system-health">
              <i aria-hidden /> Live book
            </span>
            <span className="num">{gatewayLabel}; last refresh {lastRefreshLabel}</span>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Book source and refresh, sized for the sticky section rail.
 *
 * Portfolio and Risk read the same snapshot, so both mount this and both get
 * the control in the same place — one row down from the workspace tabs, in the
 * slot every other tab uses for its own surface-level controls.
 */
export function BookSourceControl({ view }: { view: BookView }) {
  const { book, isStale, sandbox, setSandbox, refresh, lastSuccessAt } = view;
  /**
   * The button's own press, not the desk's background refresh.
   *
   * This read `view.refreshing`, which every quiet refresh sets — the 15s
   * poll and, on a live desk, the stream's refetch about once a second. So
   * the label flipped to "Refreshing…" and the button greyed out on a cadence
   * nobody had clicked; and because the long label is wider, the Live/Sandbox
   * control beside it slid left and back with every flip. That was the
   * twitch on the rail. A background refresh changes no pixel here now: the
   * pending state is this control's, and only a press sets it.
   *
   * Declared above the bail-out with the rest of the hooks, for the reason
   * `useBook` records: a hook after an early return is the "rendered more
   * hooks" crash on the first snapshot that arrives.
   */
  const [pending, setPending] = useState(false);
  if (!book) return null;

  const lastRefreshLabel = (lastSuccessAt ?? new Date(book.as_of)).toLocaleTimeString();
  // Always rendered, so the row it sits in is the same row in every state.
  // Words for the two states that have no time to show: a slot that emptied
  // on the toggle moved the controls beside it on phones, where the rail
  // actually shows this span.
  const meta = sandbox
    ? "generated book"
    : isStale ? `stale, last good ${lastRefreshLabel}` : lastRefreshLabel;
  const metaTitle = sandbox
    ? "Generated book: no gateway is being read"
    : isStale ? "The gateway is not answering; this is the last read that succeeded"
      : "Last successful gateway refresh";
  const label = pending
    ? (isStale ? "Reconnecting…" : "Refreshing…")
    : (isStale ? "Reconnect" : "Refresh");

  const press = async () => {
    setPending(true);
    try {
      await refresh(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      {/* The tooltip says what the span says. It read "Last successful gateway
          refresh" in all three states, so on the sandbox it captioned the words
          "generated book" as a refresh time, and while stale it re-stated the
          "last good" the span was already printing. A tooltip that contradicts
          the text under it is worse than none on a surface an auditor reads. */}
      <span className="rail-meta num" title={metaTitle}>
        {meta}
      </span>
      <div className="seg research-seg" role="group" aria-label="Book source">
        <button type="button" aria-pressed={!sandbox} onClick={() => setSandbox(false)}>
          Live
        </button>
        <button type="button" aria-pressed={sandbox} onClick={() => setSandbox(true)}>
          Sandbox
        </button>
      </div>
      {/* Sized once, by the widest label it can ever show. Both spans share
          one grid cell; the hidden one is the measure, the visible one is the
          word. The button therefore has one width in all four states, and the
          seg beside it has one position. */}
      <button
        onClick={() => void press()}
        disabled={pending || sandbox}
        aria-busy={pending}
        style={{ display: "inline-grid", justifyItems: "center", alignItems: "center" }}
      >
        <span aria-hidden style={{ gridArea: "1 / 1", visibility: "hidden" }}>Reconnecting…</span>
        <span style={{ gridArea: "1 / 1" }}>{label}</span>
      </button>
    </>
  );
}

/**
 * The compact cross-tab tile. Each role tab is self-sufficient — a PM should see
 * that the book is near a limit without opening the risk tab — but only one tab
 * owns the full panel, and this links to it rather than duplicating it.
 *
 * `onNavigate` used to be a bare thunk, which meant the tile could name the
 * other TAB but not the panel inside it. Both call sites therefore landed on
 * whichever section the reader happened to visit last — a tile quoting VaR and
 * headroom could open Monte Carlo — and the destination was decided by history
 * rather than by the numbers on the tile. `targetSection` is that missing half:
 * the tile hands it to `onNavigate`, so a caller that can route to a section
 * lands on the panel that explains the figures, and a caller that cannot simply
 * ignores the argument and behaves exactly as it did before.
 */
export interface CrossLinkTileProps<Section extends string = string> {
  kicker: string;
  title: string;
  actionLabel: string;
  /**
   * The section id is optional on purpose: a `() => void` handler stays
   * assignable, so no existing caller has to be rewritten to keep working.
   */
  onNavigate: (section?: Section) => void;
  /** Which panel on the destination tab actually explains these metrics. */
  targetSection?: Section;
  metrics: { label: string; value: string; note?: string; tone?: "pos" | "neg" | "warn" }[];
  children?: React.ReactNode;
}

export function CrossLinkTile<Section extends string = string>({
  kicker,
  title,
  actionLabel,
  onNavigate,
  targetSection,
  metrics,
  children,
}: CrossLinkTileProps<Section>) {
  return (
    <div className="card cross-link-tile">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">{kicker}</span>
          <h2>{title}</h2>
        </div>
        <button className="text-action" onClick={() => onNavigate(targetSection)}>{actionLabel} →</button>
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
