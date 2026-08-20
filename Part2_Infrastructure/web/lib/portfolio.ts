/**
 * The portfolio contract, and the limit arithmetic that reads it.
 * ==============================================================
 *
 * The payload shapes were declared inside `PortfolioWorkspace.tsx`, which was
 * fine while one component consumed them. The risk engine and the sandbox both
 * need them now, so they live here — this is contract, not view.
 *
 * ── Where the sandbox went ──────────────────────────────────────────────────
 * There is also a sandbox book, because the gateway is a long-lived process
 * that has to be running somewhere, and when it is not the Portfolio tab is a
 * dead end. The generators that build that book — the seeds, the sleeve P&L,
 * the session and symbol attribution, the equity path — moved to
 * `./portfolio-sandbox` when this file passed 640 lines, along with the
 * argument for their existence. They are re-exported at the bottom, so every
 * importer still says `@/lib/portfolio` and none of them changed.
 *
 * The seam is that everything over there INVENTS a number and nothing here
 * does: what is left in this file describes or judges values that arrive from
 * the gateway.
 */

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

// --------------------------------------------------------------------------
// The sandbox book, re-exported
//
// Named one by one rather than `export *`: a rename in `./portfolio-sandbox`
// should be a compile error here, at the path 30-odd modules actually import,
// not a name that silently stops existing.
// --------------------------------------------------------------------------

export { REFERENCE_EQUITY, sandboxBook, sandboxEquityPath } from "./portfolio-sandbox";
