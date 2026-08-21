/**
 * The one book every P&L attribution suite argues against.
 *
 * `pnl-attribution-reconciliation.test.ts` was split by concern — reconciliation, the market
 * leg, session scope, the sandbox, degraded payloads, negative zero — and all
 * six successors have to be reasoning about the *same* portfolio. A second copy
 * of these fixtures would let one suite's book drift from another's, and the
 * suite that drifted would keep passing while it stopped describing the module.
 *
 * `EXPECTED_MARKET` is the reason this matters most: it is hand-computed from
 * the positions and betas below, so the tests are not the code. That only holds
 * while there is exactly one set of positions and betas to compute it from.
 */

import assert from "node:assert/strict";

import {
  type PnlLeg,
  type PnlWaterfall,
  buildPnlWaterfall,
} from "../../lib/pnl-attribution";
// One declaration of the wire shape, in the module that owns the payload. The
// attribution module imports it from here too; a fixture built against a second
// copy would keep compiling after the gateway changed and prove nothing.
import type { PortfolioPayload, SessionAttribution } from "../../lib/portfolio";
import type { RiskPosition } from "../../lib/portfolio-risk";

export const SESSION_DATE = "2026-08-06";

export const POSITIONS: RiskPosition[] = [
  { symbol: "BTCUSDT", signedNotional: 3_600_000 },
  { symbol: "ETHUSDT", signedNotional: 2_400_000 },
  { symbol: "SOLUSDT", signedNotional: 1_450_000 },
  { symbol: "BNBUSDT", signedNotional: -1_150_000 },
];

export const BETAS = new Map<string, number | null>([
  ["BTCUSDT", 1],
  ["ETHUSDT", 1.2],
  ["SOLUSDT", 1.5],
  ["BNBUSDT", 0.9],
]);

export const DAY_PNL = 142_500;
export const REFERENCE_RETURN = 0.01;
/** 0.01 × (3.6m + 2.88m + 2.175m − 1.035m). Hand-computed so the test is not the code. */
export const EXPECTED_MARKET = 76_200;

export const AUDITED_SESSION: SessionAttribution = {
  session_date: SESSION_DATE,
  fills: 77,
  notional: 9_600_000,
  fees: 5_760,
  slippage_cost: 3_240,
  fills_without_slippage: 0,
  realized_pnl: 51_400,
  unrealized_pnl: 91_100,
  basis: "audited",
};

export interface BookOptions {
  dayPnl?: number;
  sessionDate?: string;
  session?: SessionAttribution | Record<string, never> | undefined;
  sandbox?: boolean;
  realized?: number;
  unrealized?: number;
}

/**
 * A payload with every contract field filled, because the module reads the
 * equity block and the sandbox flag and must not be handed a shape the gateway
 * could never send.
 */
export function makeBook(options: BookOptions = {}): PortfolioPayload {
  const dayPnl = options.dayPnl ?? DAY_PNL;
  const start = 10_000_000;
  const attribution: PortfolioPayload["attribution"] & { session?: unknown } = {
    by_strategy: [],
    by_symbol: [],
  };
  if (options.session !== undefined) attribution.session = options.session;

  const book: PortfolioPayload = {
    as_of: `${options.sessionDate ?? SESSION_DATE}T14:00:00Z`,
    session_date: options.sessionDate ?? SESSION_DATE,
    trading_halted: false,
    halted_symbols: [],
    equity: {
      current: start + dayPnl,
      start_of_day: start,
      daily_pnl: dayPnl,
      daily_return: dayPnl / start,
      realized_pnl: options.realized ?? 51_400,
      unrealized_pnl: options.unrealized ?? 91_100,
    },
    exposure: {
      gross: 8_600_000,
      net: 6_300_000,
      leverage: 0.86,
      positions: [],
    },
    concentration: {
      positions: POSITIONS.length,
      largest_symbol: "BTCUSDT",
      largest_share: 0.42,
      top_two_share: 0.7,
      hhi: 0.3,
      effective_positions: 3.3,
    },
    risk_budget: {
      gross_exposure: { used: 8_600_000, limit: 12_000_000, remaining: 3_400_000, utilisation: 0.72 },
      daily_drawdown: {
        used_pct: 0, limit_pct: 0.05, utilisation: 0,
        equity_at_halt: 9_500_000, cushion_usd: 642_500,
      },
      binding_constraint: ["gross_exposure", 0.72],
    },
    attribution,
    execution_quality: {},
  };

  if (options.sandbox) book.sandbox = true;
  return book;
}

export function build(overrides: Partial<Parameters<typeof buildPnlWaterfall>[0]> = {}): PnlWaterfall {
  const result = buildPnlWaterfall({
    book: makeBook({ session: AUDITED_SESSION }),
    positions: POSITIONS,
    betaBySymbol: BETAS,
    referenceSymbol: "BTCUSDT",
    referenceReturn: REFERENCE_RETURN,
    ...overrides,
  });
  assert.ok(result, "the waterfall should build for a well-formed payload");
  return result;
}

export function leg(waterfall: PnlWaterfall, key: PnlLeg["key"]): PnlLeg | undefined {
  return waterfall.legs.find((candidate) => candidate.key === key);
}

export function required(waterfall: PnlWaterfall, key: PnlLeg["key"]): PnlLeg {
  const found = leg(waterfall, key);
  assert.ok(found, `expected a ${key} leg`);
  return found;
}

export function sum(waterfall: PnlWaterfall): number {
  return waterfall.legs.reduce((acc, candidate) => acc + (candidate.value ?? 0), 0);
}
