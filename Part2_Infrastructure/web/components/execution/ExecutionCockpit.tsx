"use client";

/**
 * The cockpit: everything a trader needs about their own flow, in one place.
 *
 * The Execution tab used to show market data only — books, spreads, cost
 * estimates. Everything about what the desk had actually *done* lived on other
 * surfaces: positions on the portfolio tab, the decision trail in the gateway
 * console, alerts in Telegram. A trader watching a book cannot answer "did that
 * order fill, and what did it cost" without leaving the screen they are
 * watching, which is exactly when they should not be leaving it.
 *
 * So this composes four panels around one polled snapshot of gateway state:
 *
 *   P&L strip   what the book is worth and how close it is to a halt
 *   Ticket      send an order and see every gate's verdict
 *   Blotter     what was sent, what it cost, and which gate stopped it
 *   Alert feed  what the system decided on its own
 *
 * One poll drives all four. Four panels polling independently would show four
 * different moments of the same book, and a trader comparing a position against
 * the fill that created it would be comparing across time without knowing it.
 *
 * The cockpit runs in one of three modes, decided by the gateway routes'
 * failure codes and never guessed:
 *
 *   live          the gateway answered; everything is authoritative
 *   sandbox       there IS no gateway in this deployment
 *                 (`gateway_not_configured` from every route) — the desk runs
 *                 on generated, banner-labelled data, and the ticket judges
 *                 orders locally with the gateway's own gate logic
 *   outage        a gateway is configured but failing — nothing is generated,
 *                 because fake data is most dangerous during a real incident
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type BlotterRow,
  type RiskEventRow,
  createSandboxDesk,
  sandboxBlotter,
  sandboxRiskEvents,
  summarise,
  toBlotterRow,
  toRiskEvent,
} from "@/lib/blotter";
import { sandboxBook } from "@/lib/portfolio";
import { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import type { ExecutionSection } from "@/lib/sections";
import type { Strategy } from "@/lib/types";

import AlertFeed from "./AlertFeed";
import BlotterViews from "./BlotterViews";
import { probeGateway } from "@/lib/use-gateway-connection";
import DeskTape from "./DeskTape";
import ExecutionQuality from "./ExecutionQuality";
import FillQualityHeatmap from "./FillQualityHeatmap";
import OrderTicket, { type OrderSubmissionResult } from "./OrderTicket";
import PnlStrip from "./PnlStrip";
import SpreadDecomposition from "./SpreadDecomposition";
import VenueMixDonut from "./VenueMixDonut";

const REFRESH_MS = 4_000;
const MAX_BACKOFF_MS = 60_000;
/** 200, not 60: a nearest-rank p99 over 60 rows is just the maximum, and the
 *  latency distribution needs a window worth binning. The audit route clamps
 *  at 500, so this passes through untouched. */
const BLOTTER_LIMIT = 200;
const EVENT_LIMIT = 40;

interface PortfolioSnapshot {
  trading_halted: boolean;
  halted_symbols: string[];
  equity: { current: number; daily_pnl: number; daily_return: number; realized_pnl: number; unrealized_pnl: number };
  exposure: { gross: number; net: number; leverage: number; positions: Array<{
    symbol: string; side: string; notional: number; share_of_gross: number; total_pnl: number;
  }> };
  risk_budget: { daily_drawdown: { used_pct: number; limit_pct: number; utilisation: number; cushion_usd: number } };
}

export type CockpitMode = "live" | "sandbox" | "outage";

export interface CockpitProps {
  /**
   * This visitor's sandbox seed, from `useBook` so there is one of them.
   * Undefined is a valid value — the server pass and the first client render —
   * and means the shared worked example.
   */
  seed?: number;
  symbol: string;
  side: "BUY" | "SELL";
  notional: number;
  orderType: "MARKET" | "LIMIT";
  limitPrice: number | null;
  section: ExecutionSection;
  onSideChange: (side: "BUY" | "SELL") => void;
  onNotionalChange: (notional: number) => void;
  onOrderTypeChange: (orderType: "MARKET" | "LIMIT") => void;
  onLimitPriceChange: (price: number | null) => void;
  /** Operator credential shared with the Reliability tab and the header. */
  operatorToken?: string;
  operatorGuard?: "token" | "open-dev" | "open-demo" | "locked";
  operatorTokenEnv?: string;
  paperOrderDefaultAvailable?: boolean;
  onOperatorTokenChange?: (token: string) => void;
  /** Execution-owned strategy sleeve; promotion may seed it, the ticket may override it. */
  strategy: Strategy;
  onStrategyChange: (strategy: Strategy) => void;
  /** Experiment id to stamp on the order so a fill can be traced to its idea. */
  researchExperimentId?: string | null;
  /** Invalidates the shared Portfolio/Risk snapshot after a live decision. */
  onOrderSettled?: (result: OrderSubmissionResult) => void;
  onOpenResearch?: () => void;
}

interface Unavailable { code?: string; error: string; hint?: string }

export default function ExecutionCockpit({
  seed,
  symbol,
  side,
  notional,
  orderType,
  limitPrice,
  section,
  onSideChange,
  onNotionalChange,
  onOrderTypeChange,
  onLimitPriceChange,
  operatorToken,
  operatorGuard,
  operatorTokenEnv,
  paperOrderDefaultAvailable,
  onOperatorTokenChange,
  strategy,
  onStrategyChange,
  researchExperimentId,
  onOrderSettled,
  onOpenResearch,
}: CockpitProps) {
  const [book, setBook] = useState<PortfolioSnapshot | null>(null);
  const [orders, setOrders] = useState<BlotterRow[]>([]);
  const [events, setEvents] = useState<RiskEventRow[]>([]);
  const [problem, setProblem] = useState<Unavailable | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  /** Set once the first refresh settles on "there is no gateway here". */
  const [unconfigured, setUnconfigured] = useState(false);
  /** Explicit opt-out: "Live gateway" pressed on a deployment that has none. */
  const [sandboxOff, setSandboxOff] = useState(false);
  const [failures, setFailures] = useState(0);
  const sequence = useRef(0);

  /**
   * Three probes, each with a deadline.
   *
   * These were bare `fetch` calls inside a `Promise.all`, which is unbounded by
   * construction: a gateway that accepts the connection and never answers left
   * this `Promise.all` pending forever, so `loading` never cleared and the
   * Trade, Fill quality and Blotter sections sat on "Connecting to the risk
   * gateway…" for as long as the tab stayed open. The desk sweep found all three
   * under its hang profile; nothing found them before, because a refused
   * connection fails in milliseconds and looks fine.
   *
   * `probeGateway` also coalesces by URL, and /api/gateway/portfolio is exactly
   * the route `useBook` polls for Portfolio and Risk — so the cockpit's copy of
   * that request now joins the existing one instead of doubling it.
   */
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    const [bookOutcome, orderOutcome, eventOutcome] = await Promise.all([
      probeGateway<PortfolioSnapshot>("/api/gateway/portfolio"),
      probeGateway<{ rows?: unknown[] }>(`/api/gateway/audit?feed=orders&limit=${BLOTTER_LIMIT}`),
      probeGateway<{ rows?: unknown[] }>(`/api/gateway/audit?feed=events&limit=${EVENT_LIMIT}`),
    ]);
    // Every outcome is resolved before this check, for the reason the previous
    // version documented: returning between awaits lets a superseded response
    // write over a newer one.
    if (current !== sequence.current) return;

    if (!bookOutcome.ok) {
      setProblem({
        code: bookOutcome.failure.code,
        error: bookOutcome.failure.message,
        hint: bookOutcome.failure.hint,
      });
      setBook(null);
      setUnconfigured(bookOutcome.failure.code === "gateway_not_configured");
      setFailures((n) => n + 1);
    } else {
      setBook(bookOutcome.payload);
      setProblem(null);
      setUnconfigured(false);
      setFailures(0);
    }

    // The audit panels are allowed to be empty without taking the whole
    // cockpit down: a gateway with no history yet is a working gateway.
    if (orderOutcome.ok) {
      setOrders(((orderOutcome.payload.rows ?? []) as unknown[])
        .map(toBlotterRow).filter((r): r is BlotterRow => r !== null));
    }
    if (eventOutcome.ok) {
      setEvents(((eventOutcome.payload.rows ?? []) as unknown[])
        .map(toRiskEvent).filter((r): r is RiskEventRow => r !== null));
    }
    setLastSyncAt(new Date());
    // Unconditional, and that is the fix: the old `finally` only ran because the
    // fetches always settled, which under a hang they did not.
    setLoading(false);
  }, []);

  /**
   * A settled failure enters the sandbox, whatever the reason.
   *
   * This read `unconfigured && !sandboxOff`, so only a deployment with no
   * gateway at all got a filled-in desk; a gateway that was refusing, hanging or
   * returning 503 produced "outage" and three sections with nothing in them.
   * That is the same doctrine `useBook` carried and the same correction: what
   * makes generated data safe is that it is labelled and that writes are locked,
   * not that we withhold it during an incident. `sandboxOff` still wins — it is
   * the explicit "Live gateway" click — and `problem` is only set once a probe
   * has actually settled, so this never pre-empts the first load.
   */
  const mode: CockpitMode = book
    ? "live"
    : problem && !sandboxOff ? "sandbox" : "outage";

  const handleSubmitted = useCallback((result: OrderSubmissionResult) => {
    if (result.source !== "live") return;
    // Cockpit owns its tape and verdict panels; Page owns the single book used
    // by Portfolio and Risk. Both snapshots are invalidated from one decision.
    void refresh();
    onOrderSettled?.(result);
  }, [onOrderSettled, refresh]);

  useEffect(() => {
    void refresh();
    // "No gateway in this deployment" cannot change without a redeploy, so
    // polling it is 45 doomed requests a minute in a reviewer's network tab.
    // One probe is enough; the Retry button owns any second attempt.
    if (unconfigured) {
      return () => { sequence.current += 1; };
    }
    // Real outages back off geometrically instead of hammering a struggling
    // service at a fixed 4s forever.
    const interval = Math.min(REFRESH_MS * 2 ** Math.min(failures, 8), MAX_BACKOFF_MS);
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, interval);
    return () => {
      clearInterval(timer);
      sequence.current += 1;
    };
  }, [refresh, unconfigured, failures]);

  // The sandbox desk: one deterministic book, blotter and event stream, plus a
  // local judge replaying the gateway's gates. Rebuilt only when the seed
  // resolves — the judge holds the rate bucket and idempotency set a burst
  // preset needs, so it must not be recreated on every render.
  //
  // The seed comes from the book rather than being read again here. Generating
  // from an unseeded call would put a second, different generated desk beside
  // the one Portfolio and Risk are showing, which is exactly the disagreement
  // the reconciliation tests exist to prevent.
  const sandboxState = useMemo(() => {
    const generatedBook = sandboxBook(undefined, seed);
    return {
      book: generatedBook as unknown as PortfolioSnapshot,
      desk: createSandboxDesk(generatedBook),
      orders: sandboxBlotter(undefined, seed),
      events: sandboxRiskEvents(),
    };
  }, [seed]);

  const effectiveBook = mode === "sandbox" ? sandboxState.book : book;
  const effectiveOrders = mode === "sandbox" ? sandboxState.orders : orders;
  const effectiveEvents = mode === "sandbox" ? sandboxState.events : events;
  const feedSource = mode === "live" ? "live" as const : mode === "sandbox" ? "sandbox" as const : "unavailable" as const;

  // Deliberately the whole fetched window, not the blotter's current filter:
  // the summary describes the window, filters are a view onto it, and a
  // headline that moved when someone clicked "Rejected" would be unreadable.
  // The blotter states "showing X of N" so the two always reconcile on screen.
  const summary = useMemo(() => summarise(effectiveOrders), [effectiveOrders]);
  const symbolOrders = useMemo(
    () => effectiveOrders.filter((o) => o.symbol === symbol),
    [effectiveOrders, symbol],
  );

  if (loading && !book && !problem) {
    return (
      <>
        <WorkspaceSubtabPanel workspaceId="execution" tabId="trade" activeId={section}>
          <div className="card cockpit-placeholder" aria-busy="true">
            <p>Connecting to the risk gateway…</p>
            <div className="skeleton" style={{ height: 120, marginTop: 10 }} aria-hidden />
          </div>
        </WorkspaceSubtabPanel>
        <WorkspaceSubtabPanel workspaceId="execution" tabId="quality" activeId={section}>
          <div className="card cockpit-placeholder" aria-busy="true">
            <p>Measuring realised execution cost…</p>
            <div className="skeleton" style={{ height: 120, marginTop: 10 }} aria-hidden />
          </div>
        </WorkspaceSubtabPanel>
        <WorkspaceSubtabPanel workspaceId="execution" tabId="activity" activeId={section}>
          <div className="card cockpit-placeholder" aria-busy="true">
            <p>Loading orders, fills and risk events…</p>
            <div className="skeleton" style={{ height: 120, marginTop: 10 }} aria-hidden />
          </div>
        </WorkspaceSubtabPanel>
      </>
    );
  }

  return (
    <div className="cockpit">
      {mode === "sandbox" && (
        /* Same grammar as the book chrome: persistent, above everything, on
           every render — a one-time notice is how a generated desk gets
           mistaken for a real one after ten minutes of reading. */
        <div className="banner warn sandbox-banner" role="status">
          <span aria-hidden>◆</span>
          <div>
            <strong>Sandbox desk — these orders were never sent.</strong> The blotter, alerts and
            P&amp;L below are generated from a fixed seed. The ticket is real: it replays the
            gateway&apos;s own pre-trade gates against this generated book — order-level limits from
            the gateway&apos;s config, book-level limits from the book itself, exactly as the live
            gateway reads them.
          </div>
          <button type="button" className="text-action" onClick={() => setSandboxOff(true)}>
            Live gateway →
          </button>
        </div>
      )}
      {mode === "outage" && unconfigured && sandboxOff && (
        <div className="banner warn" role="status">
          <span aria-hidden>◆</span>
          <div>
            No gateway exists in this deployment, so the live desk has nothing to show.
            <button type="button" className="text-action" onClick={() => setSandboxOff(false)}>
              Back to the sandbox desk →
            </button>
          </div>
        </div>
      )}

      {(section === "trade" || mode === "outage") && (
        <PnlStrip
          book={effectiveBook}
          mode={mode}
          problem={problem}
          lastSyncAt={lastSyncAt}
          onRefresh={() => void refresh()}
          onEnterSandbox={unconfigured ? () => setSandboxOff(false) : undefined}
          compact={section === "trade"}
        />
      )}

      <WorkspaceSubtabPanel workspaceId="execution" tabId="trade" activeId={section}>
        <div className="cockpit-grid cockpit-grid--ticket">
          <OrderTicket
            symbol={symbol}
            side={side}
            notional={notional}
            orderType={orderType}
            limitPrice={limitPrice}
            onSideChange={onSideChange}
            onNotionalChange={onNotionalChange}
            onOrderTypeChange={onOrderTypeChange}
            onLimitPriceChange={onLimitPriceChange}
            operatorToken={operatorToken}
            operatorGuard={operatorGuard}
            operatorTokenEnv={operatorTokenEnv}
            paperOrderDefaultAvailable={paperOrderDefaultAvailable}
            onOperatorTokenChange={onOperatorTokenChange}
            strategy={strategy}
            onStrategyChange={onStrategyChange}
            experimentId={researchExperimentId ?? null}
            halted={effectiveBook?.trading_halted ?? false}
            haltedSymbols={effectiveBook?.halted_symbols ?? []}
            mode={mode}
            judge={mode === "sandbox" ? sandboxState.desk.judge : undefined}
            onSubmitted={handleSubmitted}
            onOpenResearch={onOpenResearch}
          />
        </div>
      </WorkspaceSubtabPanel>

      {/* Two reading modes, and they were sharing a section. Quality is the
          analysis — what execution cost against the model. The blotter below
          is the record: what was actually sent, what landed, what alerted. */}
      <WorkspaceSubtabPanel workspaceId="execution" tabId="quality" activeId={section}>
        <ExecutionQuality
          summary={summary}
          symbol={symbol}
          symbolOrders={symbolOrders}
          rows={effectiveOrders}
          source={feedSource}
        />
        {/* What each fill cost, and where it was filled. Side by side because
            they answer one question between them: the decomposition says how
            much, the mix says where — and a spread that only looks bad on one
            venue is a routing problem rather than a market one. */}
        <div className="cockpit-grid">
          <SpreadDecomposition rows={effectiveOrders} source={feedSource} />
          <VenueMixDonut rows={effectiveOrders} source={feedSource} />
        </div>
        {/* Renders only above its own sample floor — see the component. */}
        <FillQualityHeatmap rows={effectiveOrders} source={feedSource} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="execution" tabId="activity" activeId={section}>
        <BlotterViews
          rows={effectiveOrders}
          focusSymbol={symbol}
          source={feedSource}
          active={section === "activity"}
          operatorToken={operatorToken}
          /* The cockpit's own refresh, not `onOrderSettled`: that one carries a
             submission result and invalidates the shared book after a NEW order.
             A cancel from this table changes the resting book, so what has to
             re-read is this panel's poll. */
          onChanged={() => void refresh()}
          onOpenResearch={onOpenResearch}
        />
        {/* After the blotter, deliberately: the blotter is the complete
            polled record and the tape is the stream of what has just
            landed. Reading the stream first would invite treating it as
            the record, which is exactly what it cannot be. */}
        <DeskTape symbol={symbol} />
        <AlertFeed events={effectiveEvents} source={feedSource} />
      </WorkspaceSubtabPanel>
    </div>
  );
}
