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

import {
  type DataTier,
  type Provenance,
  type TierCause,
} from "@/lib/data-tier";
import { deskSeed } from "@/lib/desk-identity";
import {
  type EquityPoint,
  type PortfolioPayload,
  sandboxBook,
  sandboxEquityPath,
} from "@/lib/portfolio";
import { useSession } from "@/lib/use-session";
import { probeGateway } from "@/lib/use-gateway-connection";
import { useDeskStream, type DeskStreamState } from "@/lib/use-desk-stream";
import { usePolling } from "@/lib/use-polling";
import {
  type AllocationLimits,
  type CovarianceModel,
  type PortfolioRisk,
  type ReturnsBySymbol,
  type RiskPosition,
  type VarBacktest,
  type VarSeries,
  beta,
  buildCovariance,
  portfolioRisk,
  rollingVarBacktest,
  rollingVarSeries,
} from "@/lib/portfolio-risk";
import { sessionReturn } from "@/lib/pnl-attribution";
import { averageDailyVolume } from "@/lib/quant";
import { BARS_PER_YEAR, isMeasuredSource, type Bar } from "@/lib/types";

export interface BookError {
  code?: string;
  error: string;
  hint?: string;
}

export type BookConnectionState = "live" | "stale" | "unconfigured" | "error";

export type PeriodReturns = Record<string, { pnl: number | null; return: number | null }>;

const REFRESH_MS = 15_000;

/** Newest daily bar per symbol, keyed for the session-alignment check. */
export type SessionBars = Record<string, { openMs: number; prevClose: number; close: number }>;

/** Quote-currency average daily volume, measured from the same bars as `returns`. */
export type AdvBySymbol = Record<string, { adv: number; observations: number }>;

export interface BookView {
  /** Null only while the first request is in flight, or when it failed. */
  book: PortfolioPayload | null;
  loading: boolean;
  refreshing: boolean;
  error: BookError | null;
  connectionState: BookConnectionState;
  /**
   * What the book on screen is made of, in the desk-wide vocabulary. Prefer this
   * over `connectionState` in anything new: it has a word for generated data and
   * it distinguishes a gateway that is absent by design from one that is broken.
   */
  tier: DataTier;
  cause: TierCause | null;
  /** Ready to hand to `describeTier` for a badge. */
  provenance: Provenance;
  /** A book is on screen but the most recent refresh failed. Writes are disabled. */
  isStale: boolean;
  lastSuccessAt: Date | null;
  streamState: DeskStreamState;
  refresh: (q?: boolean) => Promise<boolean>;  // false is what lets a tick back off

  sandbox: boolean;
  setSandbox: (on: boolean) => void;
  /**
   * This visitor's sandbox seed, so every surface that generates its own
   * stand-in generates the *same* desk. Undefined on the server pass and until
   * the first effect runs, which is deliberate — see the note where it is
   * resolved. A consumer that generates from its own unseeded call would put a
   * second, different fiction beside this one.
   */
  seed: number | undefined;

  /** Measured, not assumed — see `returns` below. */
  risk: PortfolioRisk | null;
  covarianceModel: CovarianceModel | null;
  varValidation: VarBacktest | null;
  /** Per-observation series behind `varValidation`. Null when it could not be built. */
  varSeries: VarSeries | null;
  riskPositions: RiskPosition[];
  returns: ReturnsBySymbol;
  riskLoading: boolean;
  /** Held symbols with too little aligned history to enter the covariance. */
  missingHistory: string[];
  referenceSymbol: string;
  /** The newest daily bar per symbol, so a consumer can verify its own alignment. */
  sessionBars: SessionBars;
  /** Bar open-times, index-aligned with `returns[symbol]`. Same measured-source rule. */
  barTimes: Record<string, number[]>;
  /** Quote-currency ADV per symbol, measured from the same bars as `returns`. */
  advBySymbol: AdvBySymbol;
  /**
   * The reference instrument's session-to-date return, or null when the newest
   * daily bar does not cover the gateway's session. Checked rather than assumed:
   * a restarted or stale gateway can carry a session_date that is not today's.
   */
  referenceSessionReturn: number | null;
  riskShare: Map<string, number>;
  betaBySymbol: Map<string, number | null>;
  allocationLimits: AllocationLimits;

  equityTrack: EquityPoint[];
  periods: PeriodReturns | null;
  historyBackfilled: boolean;
}

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
    // Deadlined like every other read. The failure path here is deliberately
    // silent — "a missing history endpoint is not an error worth showing" — but
    // silent and unbounded are different things: without this, a hung gateway
    // left this promise pending for the life of the tab.
    probeGateway<{ points?: unknown[]; periods?: PeriodReturns }>("/api/gateway/portfolio/history?limit=400")
      .then((outcome) => (outcome.ok ? outcome.payload : null))
      .then((body) => {
        if (cancelled || !body?.points?.length) return;
        const restored: EquityPoint[] = [];
        let hwm = -Infinity;
        // Each history row carries gross exposure and the kill-switch state
        // alongside the equity mark. Reading only `equity` threw away a leverage
        // band and a halt shading that cost nothing to draw.
        type HistoryPoint = {
          ts: string;
          equity: number;
          gross_exposure?: number;
          kill_switch?: boolean;
        };
        for (const point of body.points as HistoryPoint[]) {
          const t = Date.parse(point.ts.endsWith("Z") ? point.ts : `${point.ts}Z`);
          if (Number.isNaN(t)) continue;
          hwm = Math.max(hwm, point.equity);
          restored.push({
            t,
            equity: point.equity,
            highWaterMark: hwm,
            grossExposure: typeof point.gross_exposure === "number" ? point.gross_exposure : null,
            killSwitch: typeof point.kill_switch === "boolean" ? point.kill_switch : null,
          });
        }
        // Prepended, never merged blindly: whatever this tab has already
        // observed is newer than anything the endpoint returned.
        setObserved((current) => [...restored, ...current].slice(-400));
        setPeriods(body.periods ?? null);
        setHistoryBackfilled(true);
      })
      .catch(() => { /* a missing history endpoint is not an error worth showing */ });
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
  const stream = useDeskStream(!sandbox);
  const lastSeq = useRef(0);
  useEffect(() => {
    if (sandbox || stream.state !== "live" || stream.seq === 0) return;
    if (stream.seq === lastSeq.current) return;
    lastSeq.current = stream.seq;
    void refresh(true);
  }, [sandbox, stream.state, stream.seq, refresh]);

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
      setReturns({});
      setSessionBars({});
      setBarTimes({});
      setAdvBySymbol({});
      setRiskLoading(false);
      return;
    }
    let cancelled = false;
    setRiskLoading(true);
    Promise.all(
      symbols.map(async (symbol) => {
        const empty = {
          symbol,
          series: [] as number[],
          times: [] as number[],
          bar: null as SessionBars[string] | null,
          adv: null as { adv: number; observations: number } | null,
        };
        try {
          const response = await fetch(
            // 400 rather than 180: a 60-bar rolling VaR backtest scores only
            // `n - 60` points, so 180 bars is 119 — a sketch rather than a
            // chart. `fetchBinanceKlines` pages at <= 1000, so this is still one
            // request. It is NOT free in meaning: buildCovariance aligns to the
            // shortest common series, so every figure on this tab moves from a
            // ~6-month to a ~13-month window. The panel prints `observations`,
            // so the change announces itself.
            `/api/ohlcv?symbol=${encodeURIComponent(symbol)}&interval=1d&bars=400`,
            { cache: "no-store" },
          );
          if (!response.ok) return empty;
          const body = await response.json();
          const bars: Bar[] = body.bars ?? [];
          // Synthetic bars would silently become a covariance estimate. A book's
          // risk must not be measured against invented prices, so that source
          // is dropped rather than used. Dropped by the NAMED predicate, not by
          // venue: this line used to read `source !== "binance"`, and the day
          // bars started arriving from Bybit it rejected every crypto symbol —
          // the Risk tab reported "not enough price history" against 400 real
          // daily bars, forever, with every test green.
          if (!isMeasuredSource(body.source) || bars.length < 21) return empty;
          // Returns and their bar times are built in one pass so `times[k]` is
          // by construction the open of the bar whose close produced
          // `series[k]`. Every downstream x-axis rests on that alignment, and it
          // must not be re-derived anywhere else.
          const series: number[] = [];
          const times: number[] = [];
          for (let i = 1; i < bars.length; i++) {
            if (bars[i - 1].c > 0) {
              series.push(bars[i].c / bars[i - 1].c - 1);
              times.push(Number(bars[i].t));
            }
          }
          // The newest bar's open time is what lets a consumer check that the
          // return it is about to use covers the gateway's session rather than
          // yesterday's. The pipeline used to read `c` and drop `t`, which made
          // that check impossible and the alignment an assumption.
          const newest = bars[bars.length - 1];
          const previous = bars[bars.length - 2];
          const bar = newest && previous && previous.c > 0
            ? { openMs: Number(newest.t), prevClose: previous.c, close: newest.c }
            : null;
          // Quote-currency ADV from the same bars the risk numbers use, so a
          // position can never have a liquidity figure but no risk figure.
          return {
            symbol,
            series,
            times,
            bar,
            adv: { adv: averageDailyVolume(bars, "1d"), observations: bars.length },
          };
        } catch {
          return empty;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      // One predicate for every map, so a symbol can never appear in one and
      // not another.
      const measured = entries.filter((e) => e.series.length > 0);
      setReturns(Object.fromEntries(measured.map((e) => [e.symbol, e.series])));
      setBarTimes(Object.fromEntries(measured.map((e) => [e.symbol, e.times])));
      setAdvBySymbol(Object.fromEntries(
        measured.filter((e) => e.adv !== null).map((e) => [e.symbol, e.adv!]),
      ));
      setSessionBars(Object.fromEntries(
        entries.filter((e) => e.bar !== null).map((e) => [e.symbol, e.bar!]),
      ));
      setRiskLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [heldSymbols]);

  // ---- derived, all unconditional ---------------------------------------- //

  const positions = book?.exposure.positions ?? [];

  // Signed notionals: a short must reduce the book's variance, and it only can
  // if the sign survives into the covariance maths.
  const riskPositions = useMemo(
    () =>
      positions
        .filter((position) => position.notional > 0)
        .map((position) => ({
          symbol: position.symbol,
          signedNotional: position.side === "SHORT" ? -position.notional : position.notional,
        })),
    // `positions` is a fresh array each render; its content is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [heldSymbols, book?.as_of],
  );

  const covarianceModel = useMemo(
    () => (riskPositions.length ? buildCovariance(riskPositions.map((r) => r.symbol), returns) : null),
    [riskPositions, returns],
  );

  const equityNow = book?.equity.current ?? 0;
  const risk = useMemo(
    // One annualisation constant, shared with the factor decomposition. Two
    // literals that must agree is one too many.
    () => (covarianceModel ? portfolioRisk(riskPositions, equityNow, covarianceModel, BARS_PER_YEAR["1d"], returns) : null),
    [covarianceModel, riskPositions, equityNow, returns],
  );

  // Does the VaR above actually hold up? Computed from the same returns, so the
  // forecast and its scorecard can never describe different data.
  const varValidation = useMemo(
    () => (riskPositions.length ? rollingVarBacktest(riskPositions, returns) : null),
    [riskPositions, returns],
  );

  // The same points the scorer counts, kept rather than discarded. Recomputing
  // is deliberate and cheap — `returns` only changes when the OHLCV effect
  // resolves, not on the 15s poll — and it buys one exported entry point per
  // question instead of a scorer that also returns a chart payload.
  const varSeries = useMemo(
    () => (riskPositions.length ? rollingVarSeries(riskPositions, returns, { times: barTimes }) : null),
    [riskPositions, returns, barTimes],
  );

  const missingHistory = useMemo(() => {
    const measured = new Set(covarianceModel?.symbols ?? []);
    return riskPositions.map((r) => r.symbol).filter((symbol) => !measured.has(symbol));
  }, [covarianceModel, riskPositions]);

  const referenceSymbol = riskPositions[0]?.symbol ?? "BTCUSDT";

  // Beta against the largest position, and each position's share of book
  // volatility. Both belong on the positions row: a PM reading exposure should
  // not have to open the risk tab to learn that the third-largest line carries
  // the most risk.
  const riskShare = useMemo(
    () => new Map(risk?.contributions.map((c) => [c.symbol, c.contributionShare]) ?? []),
    [risk],
  );

  const referenceSessionReturn = useMemo(
    () => sessionReturn(sessionBars[referenceSymbol], book?.session_date ?? ""),
    [sessionBars, referenceSymbol, book?.session_date],
  );

  const betaBySymbol = useMemo(
    () =>
      new Map<string, number | null>(
        riskPositions.map((r) => [
          r.symbol,
          r.symbol === referenceSymbol ? 1 : beta(r.symbol, referenceSymbol, returns),
        ]),
      ),
    [riskPositions, referenceSymbol, returns],
  );

  // The same caps the risk gateway enforces, read off the payload rather than
  // duplicated as constants — a proposal built against a stale limit would be
  // rejected order by order at the gate.
  const allocationLimits = useMemo<AllocationLimits>(
    () => ({
      maxSymbolNotional: positions[0]
        ? positions[0].symbol_limit.used + positions[0].symbol_limit.remaining
        : undefined,
      maxGrossNotional: book?.risk_budget.gross_exposure.limit,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [heldSymbols, book?.risk_budget.gross_exposure.limit, book?.as_of],
  );

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
