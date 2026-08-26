"use client";

/**
 * One line of state a trader must never have to go looking for.
 *
 * Equity, day P&L, exposure and — the one that decides whether the next order
 * is even possible — how much of the drawdown budget is spent. The halt state
 * leads, because every other figure here is irrelevant if the desk is stopped.
 *
 * Distance-to-halt is shown in dollars as well as percent. A budget "78% used"
 * invites the reading "22% left to lose", which is 22% of the *budget*, not of
 * the book; the cushion figure is the number that actually answers "how much
 * further can this go".
 */

import NumberTicker from "@/components/common/NumberTicker";
import { fmt, pct, sign, usd } from "@/lib/format";
import { transportLabel, useDeskStream } from "@/lib/use-desk-stream";

interface Book {
  trading_halted: boolean;
  halted_symbols: string[];
  equity: { current: number; daily_pnl: number; daily_return: number; realized_pnl: number; unrealized_pnl: number };
  exposure: { gross: number; net: number; leverage: number; positions: Array<{ symbol: string }> };
  risk_budget: { daily_drawdown: { used_pct: number; limit_pct: number; utilisation: number; cushion_usd: number } };
}

interface PnlStripProps {
  book: Book | null;
  mode: "live" | "sandbox" | "outage";
  problem: { code?: string; error: string; hint?: string } | null;
  lastSyncAt: Date | null;
  onRefresh: () => void;
  /** Present only when the deployment has no gateway — re-enters the sandbox. */
  onEnterSandbox?: () => void;
  /** Trade keeps only decision-critical figures in one row; other desks own the detail. */
  compact?: boolean;
}

export default function PnlStrip({
  book,
  mode,
  problem,
  lastSyncAt,
  onRefresh,
  onEnterSandbox,
  compact = false,
}: PnlStripProps) {
  /**
   * How the figures below last arrived, read from the shared stream store
   * rather than passed down.
   *
   * Not a prop on purpose: a label describing a connection is only trustworthy
   * if it comes from the same place the connection does. Threading it through
   * the cockpit would put a second copy of the transport in the tree, and a
   * copy is a thing that can be stale, forgotten on one render path, or simply
   * not updated when the stream drops — which is precisely the moment the
   * label has to be right.
   *
   * Above the `!book` bail-out with every other hook. A hook after a
   * conditional return is React's "rendered more hooks than during the
   * previous render", and this component returns early on three paths.
   */
  const stream = useDeskStream(mode === "live");

  if (!book) {
    // Two different absences. "No gateway in this deployment" is an
    // architectural fact with nothing to retry — a Retry button there is a
    // promise the button cannot keep. An unreachable configured gateway is an
    // incident, and Retry is exactly right.
    if (problem?.code === "gateway_not_configured" && onEnterSandbox) {
      return (
        <div className="card cockpit-strip cockpit-strip--offline">
          <div>
            <strong>No execution gateway in this deployment</strong>
            <p>
              The risk gateway is a long-lived process, which a serverless deployment cannot
              host. The sandbox desk runs the same workflow on a generated book.
            </p>
          </div>
          <button type="button" className="primary-action" onClick={onEnterSandbox}>
            Open the sandbox desk
          </button>
        </div>
      );
    }
    return (
      <div className="card cockpit-strip cockpit-strip--offline">
        <div>
          <strong>Book state unavailable</strong>
          <p>{problem?.error ?? "The authoritative gateway is not connected."}</p>
          {problem?.hint ? <p className="muted">{problem.hint}</p> : null}
        </div>
        <button type="button" className="icon" onClick={onRefresh}>Retry</button>
      </div>
    );
  }

  const drawdown = book.risk_budget.daily_drawdown;
  const utilisation = Math.min(1, Math.max(0, drawdown.utilisation));
  // Amber well before the stop: a breaker that surprises the desk has already
  // failed at the only job that matters here.
  const tone = drawdown.utilisation >= 0.8 ? "neg" : drawdown.utilisation >= 0.5 ? "warn" : "pos";
  const transport = transportLabel(stream.state);

  return (
    <div className={`card cockpit-strip${compact ? " cockpit-strip--compact" : ""}${book.trading_halted ? " cockpit-strip--halted" : ""}`}>
      <div className="cockpit-strip__status">
        <span className={`pill ${book.trading_halted ? "pill--stop" : "pill--live"}`}>
          {book.trading_halted ? "HALTED" : mode === "sandbox" ? "SANDBOX" : "TRADING"}
        </span>
        {book.halted_symbols.length ? (
          <span className="muted">halted: {book.halted_symbols.join(", ")}</span>
        ) : null}
        {/* The transport is said in words, never implied by the freshness of
            the number beside it. A desk on the fallback poll looked exactly
            like one running live, so the stream implied a guarantee it had
            stopped delivering — the same correction `BookChrome` carries, in
            the same vocabulary, from the same helper. */}
        <span
          className="muted cockpit-strip__sync"
          title={
            transport === "live-pushed"
              ? "Pushed by the gateway on a risk-state change — about a second old."
              : "Polled on a timer — up to one poll interval old; the stream is not carrying it."
          }
        >
          {mode === "sandbox"
            ? "generated book — deterministic, never synced"
            : lastSyncAt
              ? `synced ${lastSyncAt.toLocaleTimeString("en-GB")}, ${transport}`
              : "never synced"}
        </span>
      </div>

      <dl className="cockpit-strip__metrics">
        <div>
          <dt>Equity</dt>
          {/* One tick per arrival, and only when the book actually moved —
              NumberTicker is inert on identical values. It said "15s poll",
              which was never this component's cadence (the cockpit polls at
              4s) and is no longer the cadence of anything: the stream delivers
              a change in about a second and the poll is the fallback. */}
          <dd><NumberTicker value={book.equity.current} format={(v) => usd(v)} /></dd>
        </div>
        <div>
          <dt>Day P&amp;L</dt>
          <dd className={sign(book.equity.daily_pnl)}>
            <NumberTicker value={book.equity.daily_pnl} format={(v) => usd(v)} />{" "}
            <small>{pct(book.equity.daily_return, 2)}</small>
          </dd>
        </div>
        {!compact ? (
          <div>
            <dt>Realised / open</dt>
            <dd>
              <span className={`num ${sign(book.equity.realized_pnl)}`}>{usd(book.equity.realized_pnl)}</span>
              {" / "}
              <span className={`num ${sign(book.equity.unrealized_pnl)}`}>{usd(book.equity.unrealized_pnl)}</span>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Gross / net</dt>
          <dd className="num">{usd(book.exposure.gross)} <small>net {usd(book.exposure.net)}</small></dd>
        </div>
        {!compact ? (
          <div>
            <dt>Positions</dt>
            <dd>{book.exposure.positions.length} <small>{fmt(book.exposure.leverage, 2)}x</small></dd>
          </div>
        ) : null}
        <div className="cockpit-strip__budget">
          <dt>Drawdown budget</dt>
          <dd className={`cockpit-strip__gauge is-${tone}`}>
            {pct(drawdown.utilisation, 0)} used
            <small>{usd(drawdown.cushion_usd)} to halt</small>
          </dd>
          <div className="cockpit-meter" role="img"
               aria-label={`${pct(drawdown.utilisation, 0)} of the daily drawdown budget used`}>
            <span className={`cockpit-meter__fill is-${tone}`} style={{ width: `${utilisation * 100}%` }} />
          </div>
        </div>
      </dl>
    </div>
  );
}
