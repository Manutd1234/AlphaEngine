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
  beta,
  buildCovariance,
  portfolioRisk,
  rollingVarBacktest,
} from "@/lib/portfolio-risk";

export interface BookError {
  code?: string;
  error: string;
  hint?: string;
}

export type BookConnectionState = "live" | "stale" | "unconfigured" | "error";

export type PeriodReturns = Record<string, { pnl: number | null; return: number | null }>;

const REFRESH_MS = 15_000;

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
  riskPositions: RiskPosition[];
  returns: ReturnsBySymbol;
  riskLoading: boolean;
  /** Held symbols with too little aligned history to enter the covariance. */
  missingHistory: string[];
  referenceSymbol: string;
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
        for (const point of body.points as Array<{ ts: string; equity: number }>) {
          const t = Date.parse(point.ts.endsWith("Z") ? point.ts : `${point.ts}Z`);
          if (Number.isNaN(t)) continue;
          hwm = Math.max(hwm, point.equity);
          restored.push({ t, equity: point.equity, highWaterMark: hwm });
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
      setRiskLoading(false);
      return;
    }
    let cancelled = false;
    setRiskLoading(true);
    Promise.all(
      symbols.map(async (symbol) => {
        try {
          const response = await fetch(
            `/api/ohlcv?symbol=${encodeURIComponent(symbol)}&interval=1d&bars=180`,
            { cache: "no-store" },
          );
          if (!response.ok) return [symbol, [] as number[]] as const;
          const body = await response.json();
          const bars: { c: number }[] = body.bars ?? [];
          // Synthetic bars would silently become a covariance estimate. A book's
          // risk must not be measured against invented prices, so that source is
          // dropped rather than used.
          if (body.source !== "binance" || bars.length < 21) return [symbol, [] as number[]] as const;
          const series: number[] = [];
          for (let i = 1; i < bars.length; i++) {
            if (bars[i - 1].c > 0) series.push(bars[i].c / bars[i - 1].c - 1);
          }
          return [symbol, series] as const;
        } catch {
          return [symbol, [] as number[]] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setReturns(Object.fromEntries(entries.filter(([, r]) => r.length > 0)));
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
    () => (covarianceModel ? portfolioRisk(riskPositions, equityNow, covarianceModel, 365, returns) : null),
    [covarianceModel, riskPositions, equityNow, returns],
  );

  // Does the VaR above actually hold up? Computed from the same returns, so the
  // forecast and its scorecard can never describe different data.
  const varValidation = useMemo(
    () => (riskPositions.length ? rollingVarBacktest(riskPositions, returns) : null),
    [riskPositions, returns],
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
    riskPositions,
    returns,
    riskLoading,
    missingHistory,
    referenceSymbol,
    riskShare,
    betaBySymbol,
    allocationLimits,
    equityTrack,
    periods,
    historyBackfilled,
  };
}
