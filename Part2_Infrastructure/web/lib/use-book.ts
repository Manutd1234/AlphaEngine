"use client";

/**
 * The book, once, for every tab that reads it.
 *
 * Portfolio and Risk are two questions asked of one snapshot: what do we own,
 * and how close to the limits does owning it put us. They were a single
 * component while they shared a tab, and the split would otherwise duplicate
 * the poll, the covariance fetch and the sandbox toggle — three copies of state
 * that must never disagree, since two tabs quoting different equity is worse
 * than one tab holding both.
 *
 * So the data layer lives here and the tabs render it. Only one tab is mounted
 * at a time (the workspace swaps panels rather than hiding them), so this costs
 * exactly what the single component cost.
 *
 * It also fixes a latent crash. The previous component returned early while
 * loading and then called `useMemo` further down, so the first render with a
 * book called one more hook than the render before it — React's
 * "rendered more hooks than during the previous render". Reachable by clicking
 * into the sandbox from the unconfigured state. Every hook here runs before any
 * caller can branch, which makes that unrepresentable rather than merely fixed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type EquityPoint,
  type PortfolioPayload,
  sandboxBook,
  sandboxEquityPath,
} from "@/lib/portfolio";
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
import { BARS_PER_YEAR, type Bar } from "@/lib/types";

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
  /** A book is on screen but the most recent refresh failed. Writes are disabled. */
  isStale: boolean;
  lastSuccessAt: Date | null;
  refresh: (quiet?: boolean) => Promise<void>;

  sandbox: boolean;
  setSandbox: (on: boolean) => void;

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
  /** Bar open-times, index-aligned with `returns[symbol]`. Same binance-only rule. */
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

  // The sandbox replaces the payload entirely rather than patching gaps in it.
  // A book that is half real and half generated is the one thing worse than
  // either, because no banner can say which half you are reading.
  const book: PortfolioPayload | null = sandbox ? sandboxBook() : portfolio;

  const refresh = useCallback(async (quiet = false) => {
    const current = ++sequence.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);

    try {
      const response = await fetch("/api/gateway/portfolio", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (current !== sequence.current) return;
      if (!response.ok) {
        setError({
          code: body.code,
          error: body.error ?? `Portfolio request failed with HTTP ${response.status}.`,
          hint: body.hint,
        });
        return;
      }
      const payload = body as PortfolioPayload;
      setPortfolio(payload);
      setObserved((current) => {
        const equity = payload.equity.current;
        const at = Date.parse(payload.as_of) || Date.now();
        // Same snapshot polled twice is one observation, not two — otherwise an
        // idle tab draws a flat line that looks like measured stability.
        if (current.length && current[current.length - 1].t === at) return current;
        const hwm = Math.max(current[current.length - 1]?.highWaterMark ?? equity, equity);
        return [...current, { t: at, equity, highWaterMark: hwm }].slice(-240);
      });
      setLastSuccessAt(new Date());
      setError(null);
    } catch {
      if (current === sequence.current) {
        setError({ error: "The portfolio view could not reach its same-origin gateway route." });
      }
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
    fetch("/api/gateway/portfolio/history?limit=400", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
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
    // While the sandbox is on there is nothing to poll: the book is generated
    // locally and the gateway probe already ran once. Leaving the interval
    // running cost four dead 503s a minute and a needless re-render per tick.
    if (sandbox) {
      return () => { sequence.current += 1; };
    }
    const timer = setInterval(() => {
      if (!document.hidden) void refresh(true);
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
      sequence.current += 1;
    };
  }, [refresh, sandbox]);

  // The deployed workspace has no gateway by design — it cannot host a
  // long-lived WebSocket/DuckDB process. When the very first probe settles on
  // exactly that state, enter the sandbox unprompted so a reviewer lands on a
  // working, banner-labelled book instead of a setup card. Only for
  // `gateway_not_configured`: an unreachable or misconfigured gateway is an
  // incident, and auto-faking a book during an incident is the one thing this
  // codebase exists to refuse.
  useEffect(() => {
    if (loading || portfolio || chose.current) return;
    if (error?.code === "gateway_not_configured") setSandboxState(true);
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
          // risk must not be measured against invented prices, so that source is
          // dropped rather than used.
          if (body.source !== "binance" || bars.length < 21) return empty;
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

  const equityTrack: EquityPoint[] = book?.sandbox ? sandboxEquityPath(book) : observed;

  const connectionState: BookConnectionState = book
    ? error ? "stale" : "live"
    : error?.code === "gateway_not_configured" ? "unconfigured" : "error";

  return {
    book,
    loading,
    refreshing,
    error,
    connectionState,
    isStale: !sandbox && connectionState === "stale",
    lastSuccessAt,
    refresh,
    sandbox,
    setSandbox,
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
  };
}
