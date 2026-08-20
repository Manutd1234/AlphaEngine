/**
 * The sandbox book, and the deterministic generators behind it.
 * ============================================================
 *
 * Lifted out of `lib/portfolio.ts` when that file passed 640 lines. The seam is
 * the one the contract already implied: everything here INVENTS a number, and
 * everything left behind in `lib/portfolio.ts` describes or judges numbers that
 * arrive from the gateway. Nothing in this module is ever reached on a live
 * book — `sandbox: true` rides in the payload, the UI banners it continuously,
 * and every execution handoff is disabled while it is on.
 *
 * ── On the sandbox ──────────────────────────────────────────────────────────
 * The gateway is a long-lived process that has to be running somewhere. When it
 * is not — and in production it currently is not — the Portfolio tab is a dead
 * end: an error card, and nothing to evaluate. That is a bad outcome for a
 * surface whose whole job is showing how a book is monitored.
 *
 * The precedent is already in this codebase: `syntheticBars` returns a
 * deterministic price series when Binance is unreachable, and every response
 * carrying it says *"the workflow is real, the prices are not."* This follows
 * that rule exactly. A mock book that could be mistaken for a real one would be
 * worse than the dead end it replaces.
 *
 * Deterministic on purpose. `Math.random()` here would mean the numbers moved
 * between a server render and a client hydrate, and every screenshot of the tab
 * would show a different book.
 *
 * Every import of a portfolio shape below is `import type`, so this module and
 * `./portfolio` — which re-exports it — share no runtime edge and the cycle
 * exists only in the checker.
 */

import { sandboxBlotter } from "@/lib/blotter";

import type {
  EquityPoint,
  PortfolioPayload,
  PortfolioPosition,
  SessionAttribution,
} from "@/lib/portfolio";

/**
 * The book size every allocation on the site is quoted against.
 *
 * Exported because the research tab sizes candidates in dollars, and a Kelly
 * fraction shown as "$400k" against one number here and a different number on
 * the portfolio tab would be two books wearing one label.
 */
/**
 * Sleeve-level realised P&L for the sandbox.
 *
 * Sums to `equity.realized_pnl` (50,700) by construction, so a reader who adds
 * the Performance column and compares it to the headline finds them equal — the
 * same cross-check the live gateway's replay gives for free.
 */
const SANDBOX_SLEEVE_PNL: Record<string, { realized: number; winRate: number; closes: number; open: boolean }> = {
  ma_cross: { realized: 34_900, winRate: 0.61, closes: 28, open: true },
  donchian: { realized: 12_600, winRate: 0.54, closes: 15, open: true },
  rsi_reversion: { realized: 3_200, winRate: 0.44, closes: 5, open: false },
};

/**
 * The sandbox's own session attribution block.
 *
 * Fees and slippage are **computed from `sandboxBlotter()`** rather than restated
 * as constants: those rows already reconcile to the cent with this book's
 * attribution table, and a second hand-written total is a second thing to keep in
 * step. The market leg, by contrast, is *supplied* — attributing part of a
 * generated day P&L to a real measured market move would be a fabricated
 * attribution, and it would make the panel disagree between server render and
 * hydrate, which is the one property `sandboxEquityPath` exists to guarantee.
 */
function sandboxSession(sessionDate: string, dailyPnl: number, net: number, seed?: number): SessionAttribution {
  const fills = sandboxBlotter(undefined, seed).filter((row) => row.status === "FILLED");
  const fees = fills.reduce((acc, row) => acc + (row.feeUsd ?? 0), 0);
  const slippageCost = fills.reduce(
    (acc, row) => acc + (row.notional ?? 0) * (row.slippageBps ?? 0) / 1e4,
    0,
  );
  // Beta of one against the reference: the sandbox has no measured betas to
  // apply, and inventing per-symbol ones would dress an assumption as a
  // measurement. Net exposure times the move is the honest simplification, and
  // `basis: "generated"` is what tells a reader not to trust it as anything else.
  const referenceReturn = 0.0187;
  const marketPnl = Math.round(net * referenceReturn * 100) / 100;

  return {
    session_date: sessionDate,
    fills: fills.length,
    notional: Math.round(fills.reduce((acc, row) => acc + (row.notional ?? 0), 0) * 100) / 100,
    fees: Math.round(fees * 100) / 100,
    slippage_cost: Math.round(slippageCost * 100) / 100,
    // Every generated fill carries a slippage figure, so the cost leg is exact
    // here rather than a lower bound.
    fills_without_slippage: 0,
    realized_pnl: Object.values(SANDBOX_SLEEVE_PNL).reduce((acc, s) => acc + s.realized, 0),
    unrealized_pnl: Math.round((dailyPnl - marketPnl) * 100) / 100,
    basis: "generated",
    market_pnl: marketPnl,
    reference_symbol: "BTCUSDT",
    reference_return: referenceReturn,
  };
}

/**
 * Per-symbol flow, folded out of the same generated rows as everything else.
 *
 * The previous sandbox shipped `by_symbol: []`, which read as "this desk traded
 * nothing per symbol" — untrue of a book whose blotter has 86 rows. Filling it
 * with zeros would have been worse: a symbol that traded and a symbol that did
 * not are different claims.
 */
function sandboxSymbolFlow(seed?: number): Array<Record<string, unknown>> {
  const bySymbol = new Map<string, { orders: number; filled: number; rejected: number; fees: number; latency: number[] }>();
  for (const row of sandboxBlotter(undefined, seed)) {
    const slot = bySymbol.get(row.symbol)
      ?? { orders: 0, filled: 0, rejected: 0, fees: 0, latency: [] };
    slot.orders += 1;
    if (row.status === "FILLED") { slot.filled += 1; slot.fees += row.feeUsd ?? 0; }
    else slot.rejected += 1;
    if (row.latencyMs != null) slot.latency.push(row.latencyMs);
    bySymbol.set(row.symbol, slot);
  }
  return [...bySymbol.entries()]
    .map(([symbol, slot]) => ({
      symbol,
      orders: slot.orders,
      filled: slot.filled,
      rejected: slot.rejected,
      fees: Math.round(slot.fees * 100) / 100,
      avg_latency_ms: slot.latency.length
        ? Math.round((slot.latency.reduce((a, b) => a + b, 0) / slot.latency.length) * 1000) / 1000
        : null,
    }))
    .sort((a, b) => b.filled - a.filled);
}

export const REFERENCE_EQUITY = 10_000_000;

const EQUITY = REFERENCE_EQUITY;
const START_OF_DAY = 9_857_500;
const GROSS_LIMIT = 12_000_000;
const SYMBOL_LIMIT = 4_000_000;
const DRAWDOWN_LIMIT_PCT = 0.05;

interface Seed {
  symbol: string;
  side: "LONG" | "SHORT";
  notional: number;
  markPrice: number;
  /** Entry relative to mark, so P&L is implied rather than stated twice. */
  entryDrift: number;
  realized: number;
}

/**
 * A book with something to look at.
 *
 * Deliberately not four longs. It carries a short (BNB) so the risk
 * decomposition has a negative contributor, and a mid-cap (SOL) whose
 * standalone volatility is well above the majors — the two cases where a
 * naive "share of notional" reading and a real risk contribution disagree, which
 * is the entire argument for showing the latter.
 */
const SEEDS: Seed[] = [
  { symbol: "BTCUSDT", side: "LONG", notional: 3_600_000, markPrice: 63_580, entryDrift: -0.0162, realized: 41_200 },
  { symbol: "ETHUSDT", side: "LONG", notional: 2_400_000, markPrice: 1_858.4, entryDrift: -0.0089, realized: 12_800 },
  { symbol: "SOLUSDT", side: "LONG", notional: 1_450_000, markPrice: 96.42, entryDrift: 0.0231, realized: -8_400 },
  { symbol: "BNBUSDT", side: "SHORT", notional: 1_150_000, markPrice: 589.6, entryDrift: 0.0104, realized: 5_100 },
];

function buildPositions(): PortfolioPosition[] {
  const gross = SEEDS.reduce((acc, s) => acc + s.notional, 0);
  return SEEDS.map((s) => {
    const direction = s.side === "LONG" ? 1 : -1;
    const entry = s.markPrice * (1 + s.entryDrift);
    // Unrealised is derived from entry vs mark rather than asserted, so the
    // numbers on screen are internally consistent under any edit to the seeds.
    const unrealized = direction * s.notional * ((s.markPrice - entry) / entry);
    const used = s.notional;
    return {
      symbol: s.symbol,
      side: s.side,
      quantity: (s.notional / s.markPrice) * direction,
      avg_price: entry,
      mark_price: s.markPrice,
      notional: s.notional,
      share_of_gross: s.notional / gross,
      unrealized_pnl: unrealized,
      realized_pnl: s.realized,
      total_pnl: unrealized + s.realized,
      symbol_limit: {
        used,
        limit: SYMBOL_LIMIT,
        remaining: Math.max(0, SYMBOL_LIMIT - used),
        utilisation: used / SYMBOL_LIMIT,
      },
    };
  });
}


/**
 * An intraday equity path for the sandbox.
 *
 * The gateway serves a *snapshot* — current equity and start-of-day, and no
 * history endpoint — so there is no real intraday series to draw for a live
 * book. On the live path the chart plots only what this tab has actually
 * observed while open, and says so. Here the path is generated, deterministic,
 * and ends exactly on the book's stated equity so the chart and the header can
 * never disagree.
 *
 * Shaped to be worth looking at: it goes underwater mid-session before
 * recovering, so the high-water-mark line separates from the equity line and the
 * drawdown it measures is visible rather than implied.
 */
export function sandboxEquityPath(
  book: PortfolioPayload,
  points = 78,
): EquityPoint[] {
  const start = book.equity.start_of_day;
  const end = book.equity.current;
  const openedAt = Date.parse(book.session_date + "T00:00:00Z");
  const stepMs = (6.5 * 3_600_000) / Math.max(1, points - 1);

  // Fixed wobble, not random: the same book must draw the same curve on a
  // server render and a client hydrate.
  const wobble = (i: number) =>
    Math.sin(i * 0.7) * 0.0031 + Math.sin(i * 0.23 + 1.1) * 0.0042 - Math.sin(i * 0.11) * 0.0018;

  const out: EquityPoint[] = [];
  let hwm = start;
  for (let i = 0; i < points; i++) {
    const progress = i / (points - 1);
    // A dip through the middle of the session, then a recovery to `end`.
    const drift = (end - start) * progress;
    const dip = -Math.sin(progress * Math.PI) * (start * 0.0089);
    const equity = i === points - 1 ? end : start + drift + dip + start * wobble(i);
    hwm = Math.max(hwm, equity);
    out.push({ t: openedAt + i * stepMs, equity, highWaterMark: hwm });
  }
  return out;
}

/** A realistic, clearly-flagged book. Always the same one. */
/**
 * A realistic, clearly-flagged book. The same one for a given seed.
 *
 * `seed` exists so two visitors to the same deployment get two self-consistent
 * desks rather than one shared fiction — the isolation the brief asks for. It is
 * threaded to the blotter rather than applied here, because this book's
 * attribution is *derived* from those rows; seeding the two independently is how
 * a PM reading attribution and a trader reading execution quality would come to
 * disagree about the same generated day.
 *
 * Positions are deliberately NOT seeded. They are the desk's worked example —
 * the concentration warning, the symbol at 90% of its cap, the drift that
 * justifies rebalancing — and randomising them would sometimes generate a book
 * with nothing worth looking at.
 */
export function sandboxBook(
  now = Date.parse("2026-08-04T12:00:00Z"),
  seed?: number,
): PortfolioPayload {
  const positions = buildPositions();
  const gross = positions.reduce((acc, p) => acc + p.notional, 0);
  const net = positions.reduce((acc, p) => acc + (p.side === "LONG" ? p.notional : -p.notional), 0);
  const unrealized = positions.reduce((acc, p) => acc + p.unrealized_pnl, 0);
  const realized = positions.reduce((acc, p) => acc + p.realized_pnl, 0);
  const dailyPnl = EQUITY - START_OF_DAY;

  const shares = positions.map((p) => p.share_of_gross);
  const sorted = [...shares].sort((a, b) => b - a);
  const hhi = shares.reduce((acc, s) => acc + s * s, 0);

  const drawdownUsed = Math.max(0, -(dailyPnl / START_OF_DAY));
  const grossUtilisation = gross / GROSS_LIMIT;
  const drawdownUtilisation = drawdownUsed / DRAWDOWN_LIMIT_PCT;
  const largestSymbolUtilisation = Math.max(...positions.map((p) => p.symbol_limit.utilisation));

  const binding: [string, number] =
    grossUtilisation >= Math.max(drawdownUtilisation, largestSymbolUtilisation)
      ? ["gross_exposure", grossUtilisation]
      : drawdownUtilisation >= largestSymbolUtilisation
        ? ["daily_drawdown", drawdownUtilisation]
        : ["symbol_exposure", largestSymbolUtilisation];

  return {
    as_of: new Date(now).toISOString(),
    session_date: new Date(now).toISOString().slice(0, 10),
    trading_halted: false,
    halted_symbols: [],
    equity: {
      current: EQUITY,
      start_of_day: START_OF_DAY,
      daily_pnl: dailyPnl,
      daily_return: dailyPnl / START_OF_DAY,
      realized_pnl: realized,
      unrealized_pnl: unrealized,
    },
    exposure: { gross, net, leverage: gross / EQUITY, positions },
    concentration: {
      positions: positions.length,
      largest_symbol: positions[0]?.symbol ?? null,
      largest_share: sorted[0] ?? 0,
      top_two_share: (sorted[0] ?? 0) + (sorted[1] ?? 0),
      hhi,
      // Inverse HHI: how many equally-sized positions this book behaves like.
      effective_positions: hhi > 0 ? 1 / hhi : 0,
    },
    risk_budget: {
      gross_exposure: {
        used: gross,
        limit: GROSS_LIMIT,
        remaining: Math.max(0, GROSS_LIMIT - gross),
        utilisation: grossUtilisation,
      },
      daily_drawdown: {
        used_pct: drawdownUsed,
        limit_pct: DRAWDOWN_LIMIT_PCT,
        utilisation: drawdownUtilisation,
        equity_at_halt: START_OF_DAY * (1 - DRAWDOWN_LIMIT_PCT),
        cushion_usd: EQUITY - START_OF_DAY * (1 - DRAWDOWN_LIMIT_PCT),
      },
      binding_constraint: binding,
    },
    attribution: {
      by_strategy: [
        { strategy: "ma_cross", orders: 48, filled: 44, notional: 5_820_000, fees: 3_492, avg_slippage_bps: 2.4 },
        { strategy: "donchian", orders: 26, filled: 24, notional: 2_910_000, fees: 1_746, avg_slippage_bps: 3.1 },
        { strategy: "rsi_reversion", orders: 12, filled: 9, notional: 870_000, fees: 522, avg_slippage_bps: 4.8 },
      ].map((row) => {
        const sleeve = SANDBOX_SLEEVE_PNL[row.strategy];
        return {
          ...row,
          realized_pnl: sleeve.realized,
          win_rate: sleeve.winRate,
          closed_trades: sleeve.closes,
          has_open_inventory: sleeve.open,
        };
      }),
      by_symbol: sandboxSymbolFlow(seed),
      session: sandboxSession(new Date(now).toISOString().slice(0, 10), dailyPnl, net, seed),
    },
    execution_quality: {},
    gateway: { environment: "sandbox", version: "mock", authoritative: false },
    sandbox: true,
  };
}
