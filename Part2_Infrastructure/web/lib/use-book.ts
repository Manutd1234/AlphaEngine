"use client";

/**
 * The book, once, for every tab that reads it.
 *
 * Portfolio and Risk are two questions asked of one snapshot: what do we own,
 * and how close to the limits does owning it put us. Splitting the component
 * they shared would have duplicated the poll, the covariance fetch and the
 * sandbox toggle — three copies of state that must never disagree, and two
 * tabs quoting different equity is worse than one tab holding both. So the
 * data layer lives here and the tabs render it; only one is mounted at a time,
 * so it costs what the single component cost.
 *
 * It also fixes a latent crash. The previous component returned early while
 * loading and then called `useMemo` further down, so the first render with a
 * book called one more hook than the render before it — React's "rendered more
 * hooks than during the previous render", reachable by clicking into the
 * sandbox from the unconfigured state. Every hook here runs before any caller
 * can branch, which makes that unrepresentable rather than merely fixed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DataTier, TierCause } from "@/lib/data-tier";
import {
  NO_HELD_BARS,
  fetchHeldBars,
  type AdvBySymbol,
  type HeldBars,
  type SessionBars,
} from "@/lib/book-bars";
import { fetchEquityHistory, type PeriodReturns } from "@/lib/book-history";
import type { BookConnectionState, BookError, BookView } from "@/lib/book-view";
import { useDeskSource } from "@/lib/use-desk-source";
import { useBookRisk } from "@/lib/use-book-risk";
import { deskSeed } from "@/lib/desk-identity";
import {
  type EquityPoint,
  type PortfolioPayload,
  sandboxBook,
  sandboxEquityPath,
} from "@/lib/portfolio";
import { useSession } from "@/lib/use-session";
import { probeGateway } from "@/lib/use-gateway-connection";
import { useStreamedRefresh } from "@/lib/use-desk-stream";
import { usePolling } from "@/lib/use-polling";
import type { ReturnsBySymbol } from "@/lib/portfolio-risk";

const REFRESH_MS = 15_000;

/**
 * Re-exported from the modules that own them, so a dozen consumers importing
 * the hook's shape and its field types from `@/lib/use-book` keep one import.
 */
export type { AdvBySymbol, SessionBars } from "@/lib/book-bars";
export type { PeriodReturns } from "@/lib/book-history";
export type { BookConnectionState, BookError, BookView } from "@/lib/book-view";

export function useBook(): BookView {
  const session = useSession();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Payload, failure, staleness and the Live/Sandbox choice as one state with
   * one rule — see `lib/desk-source.ts` for the rule and the argument.
   *
   * What it adds here is hysteresis. `isStale` was a pure function of the last
   * probe, so a gateway dropping every other poll flipped "Last known book" on
   * and off every fifteen seconds — and `WorkingOrders` reads `isStale` as
   * `writesDisabled`, so amend and cancel flipped with it.
   */
  const { state: source, observe, choose, restore } = useDeskSource<PortfolioPayload>();

  const sandbox = source.showing.kind === "generated";
  // An explicit click on either side of the Live/Sandbox toggle is a decision;
  // the machine's auto-entry never overrides one. Session-scoped on purpose —
  // a fresh visit starts from the same defaults a reviewer's first visit does.
  const setSandbox = useCallback((on: boolean) => {
    try { sessionStorage.setItem("alphaengine-book-source", on ? "sandbox" : "live"); } catch { /* private mode */ }
    choose(on ? "sandbox" : "live");
  }, [choose]);
  const [returns, setReturns] = useState<ReturnsBySymbol>({});
  const [sessionBars, setSessionBars] = useState<SessionBars>({});
  const [barTimes, setBarTimes] = useState<Record<string, number[]>>({});
  const [advBySymbol, setAdvBySymbol] = useState<AdvBySymbol>({});
  const [riskLoading, setRiskLoading] = useState(false);
  // One writer for the four maps `fetchHeldBars` returns, so a symbol can never
  // reach one of them and be missing from another.
  const applyHeldBars = useCallback((held: HeldBars) => {
    setReturns(held.returns);
    setBarTimes(held.barTimes);
    setAdvBySymbol(held.advBySymbol);
    setSessionBars(held.sessionBars);
  }, []);
  // The gateway persists equity snapshots from its risk monitor, but only from
  // the moment it started. Whatever this tab observes is appended to whatever
  // the endpoint could restore.
  const [observed, setObserved] = useState<EquityPoint[]>([]);
  const [periods, setPeriods] = useState<PeriodReturns | null>(null);
  const [historyBackfilled, setHistoryBackfilled] = useState(false);
  const sequence = useRef(0);

  /**
   * This visitor's seed, resolved after mount and never during render.
   *
   * `deskSeed` reads sessionStorage, which does not exist on the server pass. A
   * seed read during render would therefore be `undefined` in the server HTML
   * and a real number on hydration — React would paint one generated book and
   * silently replace it with a different one, numbers and all, with no error to
   * say why. Resolving it in an effect makes the first client render match the
   * server's by construction, and the sandbox is normally entered by an effect
   * anyway once a probe has failed.
   */
  const [seed, setSeed] = useState<number | undefined>(undefined);
  useEffect(() => {
    /*
     * Not while the session probe is still out — the header stops guessing for
     * the same reason.
     *
     * `deskSeed` falls back to a per-tab guest id when it has no user id, and
     * during `loading` there is no user id *yet*, so seeding there produced a
     * guest desk that the resolving session then replaced with the account's:
     * every position and P&L figure in the generated book changed under the
     * reader for no reason they could see. Waiting costs nothing — `seed`
     * stays undefined, the shared worked example the server already rendered —
     * and leaves one transition, when we actually learn who this is.
     */
    if (session.status === "loading") return;
    setSeed(deskSeed(session.userId));
  }, [session.status, session.userId]);

  // The sandbox replaces the payload entirely rather than patching gaps in it.
  // A book that is half real and half generated is the one thing worse than
  // either, because no banner can say which half you are reading.
  //
  // Memoised on the seed: this was regenerating the entire book on every render
  // of every consumer, which was merely wasteful while it was a constant and
  // becomes a new object identity per render now that it takes an argument.
  const generated = useMemo(() => sandboxBook(undefined, seed), [seed]);
  const measured = source.showing.kind === "measured" ? source.showing.payload : null;
  const book: PortfolioPayload | null = sandbox ? generated : measured;

  const refresh = useCallback(async (quiet = false) => {
    const current = ++sequence.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);

    try {
      /**
       * Through the connection manager, for the deadline it carries.
       *
       * This was a bare `fetch` with no AbortController, which is fine against a
       * gateway that refuses — that fails in milliseconds — and unbounded
       * against one that accepts the connection and then stops answering. The
       * second is what a redeploying container actually does, and it left "book
       * connecting" on screen for as long as the tab stayed open. Coalescing
       * comes with it: Portfolio and Risk read this hook on the same tick.
       */
      const outcome = await probeGateway<PortfolioPayload>("/api/gateway/portfolio");
      // Superseded: neither success nor failure, so it moves no backoff.
      if (current !== sequence.current) return true;
      observe(outcome);
      if (!outcome.ok) return false;
      const payload = outcome.payload;
      setObserved((current) => {
        const equity = payload.equity.current;
        const at = Date.parse(payload.as_of) || Date.now();
        // One snapshot twice is one observation: otherwise an idle tab draws
        // a flat line that looks like measured stability.
        if (current.length && current[current.length - 1].t === at) return current;
        const hwm = Math.max(current[current.length - 1]?.highWaterMark ?? equity, equity);
        return [...current, { t: at, equity, highWaterMark: hwm }].slice(-240);
      });
      return true;
    } catch {
      if (current === sequence.current) {
        observe({
          ok: false,
          failure: { message: "The portfolio view could not reach its same-origin gateway route." },
        });
      }
      return false;
    } finally {
      if (current === sequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [observe]);

  // One backfill on mount, so the curve does not start blank every time someone
  // opens the tab — and the period figures are derived from the same rows.
  useEffect(() => {
    let cancelled = false;
    void fetchEquityHistory().then((history) => {
      if (cancelled || !history) return;
      // Prepended, never merged blindly: whatever this tab has already
      // observed is newer than anything the endpoint returned.
      setObserved((current) => [...history.restored, ...current].slice(-400));
      setPeriods(history.periods);
      setHistoryBackfilled(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Restore a choice made earlier this session before the first paint settles.
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("alphaengine-book-source");
      if (stored === "sandbox" || stored === "live") {
        restore(stored);
      }
    } catch { /* private mode */ }
  }, [restore]);

  /**
   * One probe on mount, and one more whenever someone returns to Live.
   *
   * This re-probed on any change to `sandbox`, so *entering* the sandbox fired
   * a request nothing would read and — the non-quiet path setting `loading` —
   * dragged every consumer through a loading state into a book already in
   * memory. Entering is a local switch; only leaving asks the gateway.
   */
  const probed = useRef(false);
  useEffect(() => {
    if (probed.current && sandbox) return;
    probed.current = true;
    void refresh();
    return () => { sequence.current += 1; };
  }, [refresh, sandbox]);

  /**
   * The gateway pushes when the risk state changes; this refetches when it does.
   *
   * The book is re-marked every second server-side and polled every fifteen
   * here, so a change could sit unseen for most of a poll interval —
   * ~16s worst case once the cockpit's 4s and WorkingOrders' 5s are in the
   * picture. `seq` moves only on a real change, so an idle desk still costs
   * nothing and a moving one is fetched within about a second of moving.
   *
   * The poll stays underneath: the fallback for a deployment with no stream and
   * the backstop for one that dies quietly. A signal, never the only way.
   */
  const stream = useStreamedRefresh(() => refresh(true), !sandbox);

  /*
   * While the sandbox is on there is nothing to poll: the book is generated
   * locally and the gateway probe already ran once. Leaving the interval
   * running cost four dead 503s a minute and a needless re-render per tick.
   */
  usePolling({
    // `refresh` resolved either way, so maxBackoffMs below never engaged.
    tick: async () => { if (!await refresh(true)) throw new Error("book refresh failed"); },
    intervalMs: REFRESH_MS,
    maxBackoffMs: 120_000,
    enabled: !sandbox,
  });

  /*
   * Auto-entry into the sandbox on a settled failure — for any reason, not
   * only `gateway_not_configured` — used to be an effect here. It is now a
   * rule in the machine, which is strictly stronger: the effect only ran while
   * `portfolio` was null, so "a cached payload beats a generated one" was a
   * guard to remember; the machine cannot enter the sandbox with a reading in
   * hand at all. The doctrine and its argument are on `DeskSourceMachine`.
   */

  // Daily closes for whatever the book holds. The gateway knows the positions
  // and nothing about how they co-move, so the covariance has to be measured
  // here — from the same `/api/ohlcv` route the research tab uses, not from
  // assumed factor loadings.
  const heldSymbols = (book?.exposure.positions ?? [])
    .filter((position) => position.notional > 0)
    .map((position) => position.symbol)
    .join(",");

  useEffect(() => {
    const symbols = heldSymbols ? heldSymbols.split(",") : [];
    if (!symbols.length) {
      applyHeldBars(NO_HELD_BARS);
      setRiskLoading(false);
      return;
    }
    let cancelled = false;
    setRiskLoading(true);
    void fetchHeldBars(symbols).then((held) => {
      if (cancelled) return;
      applyHeldBars(held);
      setRiskLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [heldSymbols]);

  // ---- derived, all unconditional ---------------------------------------- //

  // Every risk figure the two book tabs share, derived once. Unconditional by
  // construction — see the hook's own header for why that matters here.
  const {
    riskPositions, covarianceModel, risk, varValidation, varSeries,
    missingHistory, referenceSymbol, riskShare, referenceSessionReturn,
    betaBySymbol, allocationLimits,
  } = useBookRisk({ book, heldSymbols, returns, barTimes, sessionBars });

  // Memoised: `sandboxEquityPath(book)` built a fresh array identity on every
  // render, which alone would defeat the stable view identity below.
  const equityTrack: EquityPoint[] = useMemo(
    () => (book?.sandbox ? sandboxEquityPath(book) : observed),
    [book, observed],
  );

  /** The failure, in the shape a dozen components already read. */
  const error: BookError | null = source.failure
    ? {
        code: source.failure.code,
        error: source.failure.message ?? "The risk gateway did not return a usable response.",
        hint: source.failure.hint,
      }
    : null;
  const lastSuccessAt = source.lastGoodAt;

  /**
   * `connectionState` stays — a dozen components read it, and "stale" carries a
   * meaning for the book specifically — but it cannot describe the desk as a
   * whole: it has no word for "generated" and cannot tell an absent gateway
   * from a broken one. Both now read the machine rather than recomputing the
   * decision from `book` and `error`, which is what puts the hysteresis
   * behind them.
   */
  const connectionState: BookConnectionState = book
    ? source.tier === "cached" ? "stale" : "live"
    : error?.code === "gateway_not_configured" ? "unconfigured" : "error";

  const tier: DataTier = source.tier;
  const cause: TierCause | null = source.cause;

  /**
   * One identity per set of facts.
   *
   * This object used to be rebuilt on every render, so every consumer saw a
   * fresh `BookView` even when nothing inside it had changed. Now that the
   * workspace panels persist behind `hidden` and are memoised, the view's
   * identity is what decides whether six mounted tabs re-render — so it
   * changes only when a field does.
   */
  return useMemo(
    () => ({
      book,
      loading,
      refreshing,
      error,
      connectionState,
      tier,
      cause,
      provenance: { tier, cause, lastGoodAt: lastSuccessAt },
      isStale: !sandbox && connectionState === "stale",
      lastSuccessAt,
      streamState: stream.state,
      refresh,
      sandbox,
      setSandbox,
      seed,
      risk,
      covarianceModel,
      varValidation,
      varSeries,
      riskPositions,
      returns,
      riskLoading,
      missingHistory,
      referenceSymbol,
      sessionBars,
      barTimes,
      advBySymbol,
      referenceSessionReturn,
      riskShare,
      betaBySymbol,
      allocationLimits,
      equityTrack,
      periods,
      historyBackfilled,
    }),
    [
      book, loading, refreshing, error, connectionState, tier, cause,
      lastSuccessAt, stream.state, refresh, sandbox, setSandbox, seed, risk, covarianceModel,
      varValidation, varSeries, riskPositions, returns, riskLoading,
      missingHistory, referenceSymbol, sessionBars, barTimes, advBySymbol,
      referenceSessionReturn, riskShare, betaBySymbol, allocationLimits,
      equityTrack, periods, historyBackfilled,
    ],
  );
}
