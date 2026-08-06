/**
 * Shape validation for the gateway's /api/portfolio payload.
 *
 * The browser treats this payload as risk state, so a 200 response alone is not
 * enough — an HTML error envelope or an older gateway schema must become an
 * explicit unavailable state instead of crashing a client component.
 */

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isHeadroom(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ["used", "limit", "remaining", "utilisation"].every((key) => isFiniteNumber(value[key]));
}

/**
 * The browser treats this payload as risk state, so a 200 response alone is not
 * enough. Validate the fields the PM surface reads before it can be labelled
 * live; an HTML error envelope or an older gateway schema becomes an explicit
 * unavailable state instead of crashing a client component.
 *
 * Lives in lib/ because a Next.js route file may export only route handlers,
 * and both the gateway route and the test suite need this predicate.
 */
export function isPortfolioPayload(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const equity = value.equity;
  const exposure = value.exposure;
  const concentration = value.concentration;
  const riskBudget = value.risk_budget;
  const attribution = value.attribution;
  const gateway = value.gateway;
  if (
    typeof value.as_of !== "string"
    || Number.isNaN(Date.parse(value.as_of))
    || typeof value.session_date !== "string"
    || typeof value.trading_halted !== "boolean"
    || !Array.isArray(value.halted_symbols)
    || !value.halted_symbols.every((symbol) => typeof symbol === "string")
    || !isRecord(equity)
    || !isRecord(exposure)
    || !isRecord(concentration)
    || !isRecord(riskBudget)
    || !isRecord(attribution)
  ) return false;

  if (!["current", "start_of_day", "daily_pnl", "daily_return", "realized_pnl", "unrealized_pnl"]
    .every((key) => isFiniteNumber(equity[key]))) return false;
  if (!["gross", "net", "leverage"].every((key) => isFiniteNumber(exposure[key]))) return false;
  if (!["positions", "largest_share", "top_two_share", "hhi", "effective_positions"]
    .every((key) => isFiniteNumber(concentration[key]))) return false;
  if (!Array.isArray(exposure.positions) || !exposure.positions.every((position) => {
    if (!isRecord(position)) return false;
    return typeof position.symbol === "string"
      && typeof position.side === "string"
      && ["quantity", "avg_price", "mark_price", "notional", "share_of_gross", "unrealized_pnl", "realized_pnl", "total_pnl"]
        .every((key) => isFiniteNumber(position[key]))
      && isHeadroom(position.symbol_limit);
  })) return false;

  const drawdown = riskBudget.daily_drawdown;
  const binding = riskBudget.binding_constraint;
  const validGateway = gateway === undefined || (
    isRecord(gateway)
    && typeof gateway.environment === "string"
    && typeof gateway.version === "string"
    && typeof gateway.authoritative === "boolean"
  );
  const strategies = attribution.by_strategy;
  const validStrategies = Array.isArray(strategies) && strategies.every((strategy) => {
    if (!isRecord(strategy)) return false;
    return (strategy.strategy === null || typeof strategy.strategy === "string")
      && ["orders", "filled", "notional", "fees"].every((key) => isFiniteNumber(strategy[key]))
      && (strategy.avg_slippage_bps === null || isFiniteNumber(strategy.avg_slippage_bps));
  });

  // Validated only when present. Making it required would flip every gateway
  // older than the session block to `gateway_invalid_payload` — a deployment
  // that works becoming one that reports itself broken, which is the worse
  // failure of the two. Absent means the waterfall withholds its cost legs and
  // says so, which is the behaviour the consumer already implements.
  const session = attribution.session;
  const validSession = session === undefined || (
    isRecord(session)
    && (session.session_date === undefined || typeof session.session_date === "string")
    && (session.basis === undefined || session.basis === "audited" || session.basis === "generated")
    && ["fills", "notional", "fees", "slippage_cost", "fills_without_slippage", "realized_pnl", "unrealized_pnl", "market_pnl", "reference_return"]
      .every((key) => session[key] === undefined || isFiniteNumber(session[key]))
  );

  return validGateway
    && validSession
    && isHeadroom(riskBudget.gross_exposure)
    && isRecord(drawdown)
    && ["used_pct", "limit_pct", "utilisation", "equity_at_halt", "cushion_usd"]
      .every((key) => isFiniteNumber(drawdown[key]))
    && Array.isArray(binding)
    && binding.length === 2
    && typeof binding[0] === "string"
    && isFiniteNumber(binding[1])
    && validStrategies;
}
