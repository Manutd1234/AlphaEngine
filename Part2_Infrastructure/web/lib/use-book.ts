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
  const [portfolio, setPortfolio] = useState<PortfolioPayload | null>(null);
  const [error, setError] = useState<BookError | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sandbox, setSandboxState] = useState(false);
  // An explicit click on either side of the Live/Sandbox toggle is a decision;
  // the auto-entry below must never override one. Session-scoped on purpose —
  // a fresh visit starts from the same defaults a reviewer's first visit does.
  const chose = useRef(false);

  const setSandbox = useCallback((on: boolean) => {
    chose.current = true;
    try { sessionStorage.setItem("alphaengine-book-source", on ? "sandbox" : "live"); } catch { /* private mode */ }
    setSandboxState(on);
  }, []);
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
  useEffect(() => { setSeed(deskSeed(session.userId)); }, [session.userId]);

  // The sandbox replaces the payload entirely rather than patching gaps in it.
  // A book that is half real and half generated is the one thing worse than
  // either, because no banner can say which half you are reading.
  //
  // Memoised on the seed: this was regenerating the entire book on every render
  // of every consumer, which was merely wasteful while it was a constant and
  // becomes a new object identity per render now that it takes an argument.
  const generated = useMemo(() => sandboxBook(undefined, seed), [seed]);
  const book: PortfolioPayload | null = sandbox ? generated : portfolio;

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
      if (!outcome.ok) {
        setError({
          code: outcome.failure.code,
          error: outcome.failure.message,
          hint: outcome.failure.hint,
        });
        return false;
      }
      const payload = outcome.payload;
      setPortfolio(payload);
      setObserved((current) => {
        const equity = payload.equity.current;
        const at = Date.parse(payload.as_of) || Date.now();
        // One snapshot twice is one observation: otherwise an idle tab draws
        // a flat line that looks like measured stability.
        if (current.length && current[current.length - 1].t === at) return current;
        const hwm = Math.max(current[current.length - 1]?.highWaterMark ?? equity, equity);
        return [...current, { t: at, equity, highWaterMark: hwm }].slice(-240);
      });
      setLastSuccessAt(new Date());
      setError(null);
      return true;
    } catch {
      if (current === sequence.current) {
        setError({ error: "The portfolio view could not reach its same-origin gateway route." });
      }
      return false;
    } finally {
      if (current === sequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

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
        chose.current = true;
        setSandboxState(stored === "sandbox");
      }
    } catch { /* private mode */ }
  }, []);

  useEffect(() => {
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

  /**
   * Fill the book in when the first probe settles without one — for any reason.
   *
   * This used to admit only `gateway_not_configured`, on the grounds that
   * auto-faking a book during an incident is what this codebase exists to
   * refuse. Right about the danger, wrong about the remedy: refusing left
   * Portfolio a single GATEWAY UNAVAILABLE card and Risk reading "Connecting /
   * Pending / Pending", so the desk showed nothing at all — not a safer
   * failure than generated numbers, only a less useful one.
   *
   * What makes it safe is the labelling and the lock, not the refusal.
   * `describeTier` reports an incident sandbox as "△ Sandbox · gateway
   * incident" rather than the "◇ Sandbox · no gateway here" a
   * configuration-absent desk gets, and `writesEnabled` is false in every tier
   * but `live`. A reader is told the numbers are generated and cannot act.
   *
   * Only when there is nothing else: a cached payload beats a generated one
   * (hence the wait on `portfolio` being null), and never a human choice —
   * `chose.current` is checked first, as always.
   */
  useEffect(() => {
    if (loading || portfolio || chose.current) return;
    if (error) setSandboxState(true);
  }, [loading, portfolio, error]);

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

  const connectionState: BookConnectionState = book
    ? error ? "stale" : "live"
    : error?.code === "gateway_not_configured" ? "unconfigured" : "error";

  /**
   * The same facts in the vocabulary every other surface now uses.
   *
   * `connectionState` stays — a dozen components read it, and "stale" carries a
   * meaning for the book specifically — but it cannot describe the desk as a
   * whole, because it has no word for "generated" and no way to distinguish an
   * absent gateway from a broken one. Derived rather than stored so the two can
   * never drift: a sandbox book is `sandbox` whatever the probe last said, real
   * numbers with a failed refresh behind them are `cached`, and nothing else is
   * `live`.
   */
  const tier: DataTier = sandbox ? "sandbox" : book ? (error ? "cached" : "live") : "sandbox";
  const cause: TierCause | null = tier !== "sandbox"
    ? null
    : chose.current
      ? "chosen"
      : error && error.code !== "gateway_not_configured"
        ? "incident"
        : "not-configured";

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
