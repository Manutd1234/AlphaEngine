import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 8_000;

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
 */
function isPortfolioPayload(value: unknown): boolean {
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

  return validGateway
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

/**
 * Same-origin, read-only boundary to the authoritative FastAPI risk gateway.
 * The gateway address and bearer token never cross into the browser bundle.
 */
export async function GET() {
  const configuredBase = process.env.ALPHAENGINE_GATEWAY_URL?.trim();
  const base = configuredBase || (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8000" : "");

  if (!base) {
    return NextResponse.json(
      {
        code: "gateway_not_configured",
        error: "Portfolio gateway is not connected in this environment.",
        hint: "Set ALPHAENGINE_GATEWAY_URL on the server to enable the authoritative portfolio view.",
      },
      { status: 503 },
    );
  }

  let endpoint: URL;
  try {
    const parsed = new URL(base);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported protocol");
    endpoint = new URL("/api/portfolio", `${parsed.origin}/`);
  } catch {
    return NextResponse.json(
      { code: "gateway_misconfigured", error: "The configured portfolio gateway URL is invalid." },
      { status: 503 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const token = process.env.ALPHAENGINE_GATEWAY_TOKEN?.trim();

  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      signal: controller.signal,
      headers: token ? { "X-AlphaEngine-Token": token } : undefined,
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          code: response.status === 401 || response.status === 403 ? "gateway_auth_failed" : "gateway_unavailable",
          error: response.status === 401 || response.status === 403
            ? "The portfolio gateway rejected the server credential."
            : `The portfolio gateway responded with HTTP ${response.status}.`,
        },
        { status: response.status === 401 || response.status === 403 ? 502 : 503 },
      );
    }

    const payload: unknown = await response.json();
    if (!isPortfolioPayload(payload)) {
      return NextResponse.json(
        {
          code: "gateway_invalid_payload",
          error: "The portfolio gateway returned an unsupported portfolio schema.",
          hint: "Update the gateway and web workspace together before treating this book as live.",
        },
        { status: 502 },
      );
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      {
        code: timedOut ? "gateway_timeout" : "gateway_unavailable",
        error: timedOut
          ? "The portfolio gateway did not answer in time."
          : "The portfolio gateway is currently unreachable.",
      },
      { status: 503 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
