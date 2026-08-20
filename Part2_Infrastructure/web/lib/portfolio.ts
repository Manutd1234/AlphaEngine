/**
 * The portfolio contract, and a sandbox book to exercise it.
 * =========================================================
 *
 * The payload shapes were declared inside `PortfolioWorkspace.tsx`, which was
 * fine while one component consumed them. The risk engine and the sandbox both
 * need them now, so they live here — this is contract, not view.
 *
 * ── On the sandbox ──────────────────────────────────────────────────────────
 * The gateway is a long-lived process that has to be running somewhere. When it
 * is not — and in production it currently is not — the Portfolio tab is a dead
 * end: an error card, and nothing to evaluate. That is a bad outcome for a
 * surface whose whole job is showing how a book is monitored.
 *
 * So there is a sandbox book. The precedent for it is already in this codebase:
 * `syntheticBars` returns a deterministic price series when Binance is
 * unreachable, and every response carrying it says *"the workflow is real, the
 * prices are not."* This follows that rule exactly — `sandbox: true` rides in
 * the payload, the UI banners it continuously rather than once, and every
 * execution handoff is disabled while it is on. A mock book that could be
 * mistaken for a real one would be worse than the dead end it replaces.
 *
 * Deterministic on purpose. `Math.random()` here would mean the numbers moved
 * between a server render and a client hydrate, and every screenshot of the tab
 * would show a different book.
 */

import { sandboxBlotter } from "@/lib/blotter";
import { constraintLabel } from "@/lib/format";

export interface Headroom {
  used: number;
  limit: number;
  remaining: number;
  utilisation: number;
}

export interface PortfolioPosition {
  symbol: string;
  side: "LONG" | "SHORT" | "FLAT";
  quantity: number;
  avg_price: number;
  mark_price: number;
  notional: number;
  share_of_gross: number;
  unrealized_pnl: number;
  realized_pnl: number;
  total_pnl: number;
  symbol_limit: Headroom;
}

export interface StrategyAttribution {
  strategy: string | null;
  orders: number;
  filled: number;
  notional: number;
  fees: number;
  avg_slippage_bps: number | null;
  /**
   * Replayed from audited fills at average cost, so it exists only for sleeves
   * that actually closed something this session. Optional because a gateway
   * older than the replay query omits the key entirely — absent and zero are
   * different claims and must not render the same.
   */
  realized_pnl?: number | null;
  /** Closed trades that made money, over closed trades. Same optionality rule. */
  win_rate?: number | null;
  closed_trades?: number | null;
  /**
   * Realized P&L excludes open inventory, so a sleeve still carrying risk is only
   * partly scored. Without this flag a half-finished sleeve reads as final.
   */
  has_open_inventory?: boolean;
}

/**
 * Costs and realised P&L scoped to *this* session.
 *
 * Every other block under `attribution` is lifetime, because a PM reading flow
 * wants the whole record. A day's P&L cannot be decomposed with those figures:
 * subtracting a lifetime fee total from one session's P&L reports a loss the desk
 * did not take. Optional because a gateway older than this block omits it, and
 * absent is not zero.
 */
export interface SessionAttribution {
  session_date?: string;
  fills?: number;
  notional?: number;
  fees?: number;
  slippage_cost?: number;
  /** Fills whose slippage was never measured — the cost leg is a lower bound. */
  fills_without_slippage?: number;
  realized_pnl?: number;
  unrealized_pnl?: number;
  basis?: "audited" | "generated";
  /** Sandbox only: a supplied market leg, never a measured one. */
  market_pnl?: number;
  reference_symbol?: string;
  reference_return?: number;
}

export interface PortfolioPayload {
  as_of: string;
  session_date: string;
  trading_halted: boolean;
  halted_symbols: string[];
  equity: {
    current: number;
    start_of_day: number;
    daily_pnl: number;
    daily_return: number;
    realized_pnl: number;
    unrealized_pnl: number;
  };
  exposure: {
    gross: number;
    net: number;
    leverage: number;
    positions: PortfolioPosition[];
  };
  concentration: {
    positions: number;
    largest_symbol: string | null;
    largest_share: number;
    top_two_share: number;
    hhi: number;
    effective_positions: number;
  };
  risk_budget: {
    gross_exposure: Headroom;
    daily_drawdown: {
      used_pct: number;
      limit_pct: number;
      utilisation: number;
      equity_at_halt: number;
      cushion_usd: number;
    };
    binding_constraint: [string, number];
  };
  attribution: {
    by_strategy: StrategyAttribution[];
    by_symbol: Array<Record<string, unknown>>;
    session?: SessionAttribution;
  };
  execution_quality: Record<string, unknown>;
  gateway?: {
    environment: string;
    version: string;
    authoritative: boolean;
  };
  /** Present and true only on the sandbox book. Never set by the gateway. */
  sandbox?: true;
}

// --------------------------------------------------------------------------
// Sandbox book
// --------------------------------------------------------------------------

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

export interface BookStatus {
  level: "halted" | "critical" | "elevated" | "normal";
  label: string;
  glyph: string;
  detail: string;
  /** The utilisation the label is derived from, 0–1. */
  utilisation: number;
  constraint: string;
}

/**
 * The book's headline status, derived from the constraint that actually binds.
 *
 * Extracted from the component because it got this wrong once in a way a
 * screenshot would not catch: the utilisation was re-derived as
 * `max(gross, drawdown)` while the *name* came from the gateway's
 * `binding_constraint`. On a book whose largest position sat at 90% and gross at
 * 72%, the chip read "ELEVATED — symbol exposure at 72%": the right name beside
 * the wrong number, one severity band too low, on the one indicator a PM glances
 * at instead of reading the page.
 *
 * The gateway already computes which constraint binds and how hard. Trusting it
 * and taking the max against the headrooms we can see locally means the label
 * and the number cannot disagree.
 */
/**
 * Where a utilisation crosses from headroom into a warning and then into a
 * breach. One table, because it is quoted by the book status line, by every
 * headroom gauge and by the limits table, and three copies of a threshold are
 * three chances to disagree about whether 0.9 is a breach.
 */
export const LIMIT_TONE_BOUNDS: [number, number] = [0.7, 0.9];

export type LimitTone = "good" | "warning" | "critical";

export function limitTone(utilisation: number): LimitTone {
  const [warn, crit] = LIMIT_TONE_BOUNDS;
  // NaN falls through both comparisons to "good", which is wrong in the
  // dangerous direction, so it is caught explicitly rather than silently.
  if (!Number.isFinite(utilisation)) return "good";
  return utilisation >= crit ? "critical" : utilisation >= warn ? "warning" : "good";
}

/**
 * One pre-trade constraint.
 *
 * Values stay raw and carry their own `unit` rather than arriving pre-formatted:
 * drawdown is a fraction of start-of-day equity while the other two are dollars,
 * so a single formatter would have to guess. The component formats; this module
 * stays free of presentation and the test asserts numbers.
 */
export interface LimitRow {
  id: string;
  label: string;
  unit: "usd" | "pct";
  used: number;
  limit: number;
  /** In `unit`, except for drawdown where the meaningful cushion is in dollars. */
  headroom: number;
  headroomUnit: "usd" | "pct";
  utilisation: number;
  /** True for the constraint the gateway says binds first. */
  binding: boolean;
}

/**
 * The arithmetic behind the headroom gauges.
 *
 * HeadroomBar compresses each constraint to a bar and a sentence, which is the
 * right read at a glance and the wrong one when somebody asks "how much room is
 * left, exactly". This is the table that answers that, and it is a pure builder
 * so the numbers can be tested without a DOM.
 */
export function limitRows(book: PortfolioPayload): LimitRow[] {
  const [constraint] = book.risk_budget.binding_constraint;
  const gross = book.risk_budget.gross_exposure;
  const drawdown = book.risk_budget.daily_drawdown;
  const largest = book.exposure.positions[0];

  const rows: LimitRow[] = [
    {
      id: "gross_exposure",
      label: "Gross exposure",
      unit: "usd",
      used: gross.used,
      limit: gross.limit,
      headroom: gross.remaining,
      headroomUnit: "usd",
      utilisation: gross.utilisation,
      binding: constraint === "gross_exposure",
    },
    {
      id: "daily_drawdown",
      label: "Daily drawdown",
      unit: "pct",
      used: drawdown.used_pct,
      limit: drawdown.limit_pct,
      // The headroom that matters here is the equity cushion, in dollars — the
      // number a PM can compare against a position size.
      headroom: drawdown.cushion_usd,
      headroomUnit: "usd",
      utilisation: drawdown.utilisation,
      binding: constraint === "daily_drawdown",
    },
  ];

  if (largest) {
    rows.push({
      id: "symbol_limit",
      label: `Largest position, ${largest.symbol}`,
      unit: "usd",
      used: largest.symbol_limit.used,
      limit: largest.symbol_limit.limit,
      headroom: largest.symbol_limit.remaining,
      headroomUnit: "usd",
      utilisation: largest.symbol_limit.utilisation,
      // The live gateway names the binder `symbol:SYM` (modules/portfolio.py);
      // older payloads used the kind or the bare symbol. Match all three.
      binding: constraint === "symbol_limit" || constraint === largest.symbol
        || constraint === `symbol:${largest.symbol}`,
    });
  }

  return rows;
}

export function bookStatus(book: PortfolioPayload): BookStatus {
  const [constraint, bindingUtilisation] = book.risk_budget.binding_constraint;
  const utilisation = Math.max(bindingUtilisation,
    book.risk_budget.gross_exposure.utilisation, book.risk_budget.daily_drawdown.utilisation);
  const readable = constraintLabel(constraint);

  if (book.trading_halted) {
    return {
      level: "halted", label: "HALTED", glyph: "■",
      detail: "the kill switch is active", utilisation, constraint,
    };
  }
  const tone = limitTone(utilisation);
  if (tone === "critical") {
    return {
      level: "critical", label: "CRITICAL", glyph: "▲",
      detail: `${readable} at ${Math.round(utilisation * 100)}%`, utilisation, constraint,
    };
  }
  if (tone === "warning") {
    return {
      level: "elevated", label: "ELEVATED", glyph: "▲",
      detail: `${readable} at ${Math.round(utilisation * 100)}%`, utilisation, constraint,
    };
  }
  return {
    level: "normal", label: "NORMAL", glyph: "●",
    detail: `tightest limit at ${Math.round(utilisation * 100)}%`, utilisation, constraint,
  };
}

export interface EquityPoint {
  t: number;
  equity: number;
  /** Running maximum up to this point. */
  highWaterMark: number;
  /**
   * Gross exposure at this observation, when the source recorded it.
   *
   * The history endpoint has always sent this and the client read `ts` and
   * `equity` and threw the rest away. Optional because a locally observed point
   * (one this tab saw arrive, rather than one it backfilled) has no snapshot
   * behind it — and absent is not zero.
   */
  grossExposure?: number | null;
  /** Was the kill switch engaged at this observation? */
  killSwitch?: boolean | null;
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
