"use client";

/**
 * The cockpit's data layer: one poll, one mode, one invalidation path.
 *
 * Split out of `ExecutionCockpit` whole. Everything that decides WHAT the
 * panels are showing lives here; the component that mounts this hook decides
 * how it is drawn. Nothing about the loop changed in the move, and the reason
 * is recorded on the effects below — this file is where a 1,542-request-in-ten-
 * seconds bug was fixed once, and a split that quietly re-opened it would look
 * exactly like a split that did not.
 *
 * Four properties this owes its caller, all of them argued at the code:
 *
 *   deadlines   every probe is `probeGateway`, which carries the 2.5s budget
 *   backoff     one `PollingController`, never restarted by a render
 *   hidden-gate the controller does not wake a backgrounded tab at all
 *   sequencing  a superseded response never overwrites a newer one
 *
 * The hook takes no `active` flag on purpose. The cockpit's panels stay mounted
 * across subtabs, and `unconfigured` — "there is no gateway in this deployment"
 * — is the only thing that stops the loop, because it is the only one that
 * cannot change without a redeploy.
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
import { DeskSourceMachine, type DeskSourceState } from "@/lib/desk-source";
import { sandboxBook } from "@/lib/portfolio";
import { probeGateway } from "@/lib/use-gateway-connection";
import { usePolling } from "@/lib/use-polling";
import { useStreamedRefresh } from "@/lib/use-desk-stream";

import type { OrderSubmissionResult } from "./OrderTicket";

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

interface Unavailable { code?: string; error: string; hint?: string }

export interface CockpitFeedOptions {
  /**
   * This visitor's sandbox seed, from `useBook` so there is one of them.
   * Undefined is a valid value — the server pass and the first client render —
   * and means the shared worked example.
   */
  seed?: number;
  /** The instrument the ticket is on; only `symbolOrders` narrows by it. */
  symbol: string;
  /** Invalidates the shared Portfolio/Risk snapshot after a live decision. */
  onOrderSettled?: (result: OrderSubmissionResult) => void;
}

export function useCockpitFeed({ seed, symbol, onOrderSettled }: CockpitFeedOptions) {
  const [orders, setOrders] = useState<BlotterRow[]>([]);
  const [events, setEvents] = useState<RiskEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * Who decides what this surface is showing.
   *
   * The book, the problem, the last good sync and the sandbox opt-out were
   * four pieces of state that had to agree and did not: a failed probe called
   * `setBook(null)`, which threw away the last good reading and dropped `mode`
   * to `"sandbox"` — so at this hook's 4s cadence a gateway dropping one poll
   * in three made the entire cockpit alternate between measured fills and
   * generated ones. Worse than the flicker, `judge` is handed to the ticket on
   * `mode === "sandbox"`, so which of the two order paths a click took was
   * decided by whichever way the last probe happened to land.
   *
   * `DeskSourceMachine` holds all four as one state with one rule — measured
   * data is never replaced by generated data — and the alternation is not a
   * behaviour it can express. See `lib/desk-source.ts`.
   */
  const machine = useRef<DeskSourceMachine<PortfolioSnapshot> | null>(null);
  if (machine.current === null) machine.current = new DeskSourceMachine<PortfolioSnapshot>();
  /** The machine is mutable; this is the snapshot React renders from. */
  const [source, setSource] = useState<DeskSourceState<PortfolioSnapshot>>(
    () => machine.current!.state,
  );
  const publish = useCallback(() => setSource(machine.current!.state), []);
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

    /*
     * One observation, and the machine decides what it means.
     *
     * This branch used to null the book on failure. It no longer can: the
     * outcome goes in, and a desk that has ever had a reading demotes to
     * `cached` and keeps its numbers rather than falling to a generated desk.
     */
    machine.current!.observe(bookOutcome);
    publish();

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
    // Unconditional, and that is the fix: the old `finally` only ran because the
    // fetches always settled, which under a hang they did not.
    setLoading(false);
    return bookOutcome.ok;
  }, [publish]);

  /**
   * The four facts the panels read, all now derived from one state.
   *
   * A settled failure still enters the sandbox whatever the reason — a gateway
   * that is refusing, hanging or returning 503 gets a filled-in desk rather
   * than three empty sections, because what makes generated data safe is that
   * it is labelled and that writes are locked, not that we withhold it during
   * an incident. What changed is that it can only do so from a desk that has
   * never had a reading. With one in hand, a failure is `cached`: the same
   * numbers, marked stale, which is what `useBook` always did.
   */
  const { showing } = source;
  const book = showing.kind === "measured" ? showing.payload : null;
  /**
   * Measured but not current. The panels keep rendering; the chrome says how
   * old it is. This is the state that used to be a generated desk.
   */
  const stale = showing.kind === "measured" && showing.tier === "cached";
  const problem: Unavailable | null = source.failure
    ? {
        code: source.failure.code,
        error: source.failure.message ?? "The risk gateway did not return a usable response.",
        hint: source.failure.hint,
      }
    : null;
  const unconfigured = source.failure?.code === "gateway_not_configured";
  /** Explicit opt-out: "Live gateway" pressed on a deployment that has none. */
  const sandboxOff = source.chosen === "live";
  const setSandboxOff = useCallback((off: boolean) => {
    if (off) machine.current!.choose("live");
    else machine.current!.release();
    publish();
  }, [publish]);

  const mode: CockpitMode = showing.kind === "measured"
    ? "live"
    : showing.kind === "generated" ? "sandbox" : "outage";

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
  useStreamedRefresh(() => refresh(false), !unconfigured);  // equity, drawdown and the kill switch, pushed; the 4s poll above stays as the fallback

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

  return {
    mode,
    book,
    problem,
    loading,
    /**
     * When the gateway last actually answered — not when we last asked.
     *
     * This was stamped `new Date()` at the end of every refresh, successful or
     * not, so "last sync" ticked forward all through an outage and the one
     * figure that could have revealed a stale desk was the one guaranteed to
     * look fresh.
     */
    lastSyncAt: source.lastGoodAt,
    /** Measured, but not current. The panels render; the chrome dates them. */
    stale,
    unconfigured,
    sandboxOff,
    setSandboxOff,
    refresh,
    revalidate,
    /** The sandbox desk's local judge — present whatever the mode; the ticket
     *  is what decides to use it, on `mode === "sandbox"`. */
    judge: sandboxState.desk.judge,
    effectiveBook,
    effectiveOrders,
    effectiveEvents,
    feedSource,
    summary,
    symbolOrders,
  };
}
