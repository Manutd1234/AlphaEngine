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
import { usePolling } from "@/lib/use-polling";
import DeskTape from "./DeskTape";
import ExecutionQuality from "./ExecutionQuality";
import FillQualityHeatmap from "./FillQualityHeatmap";
import OrderTicket, { type OrderSubmissionResult } from "./OrderTicket";
import PnlStrip from "./PnlStrip";
import SpreadDecomposition from "./SpreadDecomposition";
import VenueMixDonut from "./VenueMixDonut";

/**
 * Fill quality was the densest section in the app: four analyses, three tables
 * and three charts in one scroll, which is two readings stacked rather than one.
 *
 * Cost is the headline — what execution cost against the model, and the latency
 * distribution behind it. Where is the attribution: which venue, which part of
 * the spread, and at which hour. Splitting on that seam also stops
 * `FillQualityHeatmap` from pushing the primary metric off screen; it draws only
 * above its own sample floor, so on a short window it is a paragraph explaining
 * how far along the collection is, and that paragraph does not belong between a
 * trader and their fill rate.
 *
 * Two panes, not three: the decomposition and the venue mix answer one question
 * between them and the pane below keeps them side by side.
 */
type QualityPane = "cost" | "where";

const QUALITY_PANES: Array<{ id: QualityPane; label: string; hint: string }> = [
  { id: "cost", label: "Cost", hint: "What execution cost against the model — fill rate, realised slippage, fees, and the tail of the decision-latency distribution" },
  { id: "where", label: "Where", hint: "Which venue and which component of the spread the cost came from, and at which hour of the day" },
];

/**
 * Activity, split along the record/stream seam.
 *
 * The blotter, the decision tape and the alert feed sat in one scroll, and the
 * only thing keeping them straight was order: the tape came after the blotter
 * so the record was read before the stream. A split states the same argument
 * with geometry instead of position. The Blotter pane is the record — every
 * order the desk sent, polled from the gateway's authoritative store, with the
 * resting book beside it. The Tape & alerts pane is the desk happening: the
 * realtime mirror of decisions as Postgres commits them, and what the risk
 * system decided on its own. The seg opens on Blotter for the reason the old
 * ordering existed — reading the stream first invites treating it as the
 * record, which is exactly what a channel that drops silently cannot be.
 */
type ActivityPane = "blotter" | "tape";

const ACTIVITY_PANES: Array<{ id: ActivityPane; label: string; hint: string }> = [
  { id: "blotter", label: "Blotter", hint: "The record: every order the desk sent, what it cost, which gate stopped it, and the resting book — polled from the gateway's authoritative store" },
  { id: "tape", label: "Tape & alerts", hint: "The stream: decisions mirrored as Postgres commits them, and the alerts the risk system raised on its own — watched beside the record, never instead of it" },
];

const REFRESH_MS = 4_000;
const MAX_BACKOFF_MS = 60_000;
/** 200, not 60: a nearest-rank p99 over 60 rows is just the maximum, and the
 *  latency distribution needs a window worth binning. The audit route clamps
 *  at 500, so this passes through untouched. */
// Append-only history: re-reading a 200-row and a 40-row page every 4 s spent
// three requests where one was needed. Every fifth tick, and on any mutation.
const AUDIT_EVERY = 5;
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
  /**
   * Above the loading bail-out below, with the rest of them, and a fixed
   * default rather than one derived from the reader's complexity tier: a pane
   * that opens somewhere different depending on a setting is a different
   * screen for every reader, and Cost is the metric the section is named for.
   */
  const [qualityPane, setQualityPane] = useState<QualityPane>("cost");
  /** Same discipline, and "blotter" for the reason ACTIVITY_PANES argues: the
   *  record is what opens first. */
  const [activityPane, setActivityPane] = useState<ActivityPane>("blotter");
  const sequence = useRef(0);
  const ticks = useRef(0);  // audit feeds ride every AUDIT_EVERY-th one

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
  const refresh = useCallback(async (auditToo = true) => {
    const current = ++sequence.current;
    const [bookOutcome, orderOutcome, eventOutcome] = await Promise.all([
      probeGateway<PortfolioSnapshot>("/api/gateway/portfolio"),
      auditToo ? probeGateway<{ rows?: unknown[] }>(`/api/gateway/audit?feed=orders&limit=${BLOTTER_LIMIT}`) : null,
      auditToo ? probeGateway<{ rows?: unknown[] }>(`/api/gateway/audit?feed=events&limit=${EVENT_LIMIT}`) : null,
    ]);
    // Resolved before this check: returning between awaits lets a superseded
    // response overwrite a newer one, and counting it would move a backoff.
    if (current !== sequence.current) return true;

    if (!bookOutcome.ok) {
      setProblem({
        code: bookOutcome.failure.code,
        error: bookOutcome.failure.message,
        hint: bookOutcome.failure.hint,
      });
      setBook(null);
      setUnconfigured(bookOutcome.failure.code === "gateway_not_configured");
    } else {
      setBook(bookOutcome.payload);
      setProblem(null);
      setUnconfigured(false);
    }

    // The audit panels are allowed to be empty without taking the whole
    // cockpit down: a gateway with no history yet is a working gateway.
    if (orderOutcome?.ok) {
      setOrders(((orderOutcome.payload.rows ?? []) as unknown[])
        .map(toBlotterRow).filter((r): r is BlotterRow => r !== null));
    }
    if (eventOutcome?.ok) {
      setEvents(((eventOutcome.payload.rows ?? []) as unknown[])
        .map(toRiskEvent).filter((r): r is RiskEventRow => r !== null));
    }
    setLastSyncAt(new Date());
    // Unconditional, and that is the fix: the old `finally` only ran because the
    // fetches always settled, which under a hang they did not.
    setLoading(false);
    return bookOutcome.ok;
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

  /**
   * One invalidation path for every mutation this surface makes: the ticket and
   * the blotter each re-read by hand, and disagreed about how much. A cancel
   * carries no result and stays local (this panel's blotter moves, not the book
   * Page owns); a sandbox submission touches no server; a live one does both.
   */
  const revalidate = useCallback((result?: OrderSubmissionResult) => {
    if (result && result.source !== "live") return;
    void refresh();
    if (result) onOrderSettled?.(result);
  }, [onOrderSettled, refresh]);

  /**
   * The first probe, and only the first.
   *
   * Deliberately its own effect. It used to open the interval effect below,
   * which re-runs on every `failures` change — so a failed probe incremented the
   * counter, the effect re-ran, and the immediate refresh at the top fired again
   * with no delay whatever the backoff said. Measured in a browser against a
   * refusing gateway: 1,542 requests in ten seconds from one idle guest tab,
   * every one of them doomed. The geometric backoff was never reached because
   * the loop never waited for the interval it computed.
   *
   * The failure is invisible to the desk sweep and to the unit suite: the panel
   * renders correctly, the sandbox fills in, and nothing on screen is wrong.
   */
  useEffect(() => {
    void refresh();
    return () => { sequence.current += 1; };
  }, [refresh]);

  /**
   * The backoff the comment above describes, now actually reachable.
   *
   * The old form recomputed its interval from `failures` and listed `failures`
   * as a dependency — so every failed probe tore the timer down and built a new
   * one, and the loop was permanently at its first tick. The controller holds
   * the failure count itself and reads the callback through a ref, so nothing a
   * render does can restart it.
   *
   * "No gateway in this deployment" cannot change without a redeploy, so an
   * unconfigured desk polls not at all — 45 doomed requests a minute in a
   * reviewer's network tab. One probe is enough; Retry owns any second attempt.
   */
  usePolling({
    /* `refresh` resolves either way — it turns a failed probe into panel state
       rather than a rejection, which is right for the panel and wrong for the
       loop: a tick that never fails never backs off. It reports the outcome
       now, and the loop raises on a bad one. Silently keeping the old
       swallowing form would have removed the backoff entirely while looking
       like an adoption of it. */
    tick: async () => {
      const ok = await refresh(ticks.current++ % AUDIT_EVERY === 0);
      if (!ok) throw new Error("gateway probe failed");
    },
    intervalMs: REFRESH_MS,
    maxBackoffMs: MAX_BACKOFF_MS,
    enabled: !unconfigured,
  });

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
            onSubmitted={revalidate}
          />
        </div>
      </WorkspaceSubtabPanel>

      {/* Two reading modes, and they were sharing a section. Quality is the
          analysis — what execution cost against the model. The blotter below
          is the record: what was actually sent, what landed, what alerted. */}
      <WorkspaceSubtabPanel workspaceId="execution" tabId="quality" activeId={section}>
        <div className="seg" role="group" aria-label="Fill quality view">
          {QUALITY_PANES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={qualityPane === option.id}
              title={option.hint}
              onClick={() => setQualityPane(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Conditional renders, not `hidden`. Nothing here holds typed input to
            preserve, and every panel below reads the same `effectiveOrders`
            array the cockpit already polls — so a switched-away pane that
            stayed mounted would buy nothing and keep three charts measuring
            their own width behind something nobody is reading. */}
        {qualityPane === "cost" && (
          <ExecutionQuality
            summary={summary}
            symbol={symbol}
            symbolOrders={symbolOrders}
            rows={effectiveOrders}
            source={feedSource}
          />
        )}

        {qualityPane === "where" && (
          <>
            {/* What each fill cost, and where it was filled. Side by side
                because they answer one question between them: the decomposition
                says how much, the mix says where — and a spread that only looks
                bad on one venue is a routing problem rather than a market one.
                The cut goes above this pair, never through it. */}
            <div className="cockpit-grid">
              <SpreadDecomposition rows={effectiveOrders} source={feedSource} />
              <VenueMixDonut rows={effectiveOrders} source={feedSource} />
            </div>
            {/* Renders only above its own sample floor — see the component. Its
                two neighbours have no floor, so this pane still says something
                on a short window rather than going quiet. */}
            <FillQualityHeatmap rows={effectiveOrders} source={feedSource} />
          </>
        )}
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="execution" tabId="activity" activeId={section}>
        <div className="seg" role="group" aria-label="Activity view">
          {ACTIVITY_PANES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={activityPane === option.id}
              title={option.hint}
              onClick={() => setActivityPane(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Conditional renders, not `hidden`, like Fill quality above — with
            one cost the quality panes do not pay: switching away unmounts the
            tape, and the rows its channel gathered this session are gone when
            it remounts. Accepted, on the tape's own doctrine — it is watched,
            not counted on, and every decision it ever showed is in the store
            the Blotter pane polls. Keeping it mounted to preserve a window
            nobody may read again would promote the stream toward being a
            record, which is the one thing this split exists to prevent. */}
        {activityPane === "blotter" && (
          <BlotterViews
            rows={effectiveOrders}
            focusSymbol={symbol}
            source={feedSource}
            active={section === "activity"}
            operatorToken={operatorToken}
            onChanged={revalidate}
            onOpenResearch={onOpenResearch}
          />
        )}

        {activityPane === "tape" && (
          <>
            <DeskTape symbol={symbol} />
            <AlertFeed events={effectiveEvents} source={feedSource} />
          </>
        )}
      </WorkspaceSubtabPanel>
    </div>
  );
}
