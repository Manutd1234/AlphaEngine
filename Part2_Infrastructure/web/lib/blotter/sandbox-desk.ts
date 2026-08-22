import { ExecutionSummary } from "./parse";
import { SANDBOX_LIMITS, SANDBOX_MARKS, SANDBOX_SYMBOLS, SANDBOX_VENUES, mulberry32 } from "./sandbox-data";
import { BlotterRow, GateCheck, OrderStatus } from "./types";

export interface SandboxOrder {
  symbol: string;
  side: "BUY" | "SELL";
  notional: number;
  clientOrderId?: string | null;
  /** Defaults to MARKET, matching the gateway's OrderRequest. */
  orderType?: "MARKET" | "LIMIT";
  limitPrice?: number | null;
}

export interface SandboxDecision {
  accepted: boolean;
  status?: OrderStatus;
  order_id?: string;
  reason?: string | null;
  rejected_by?: string[];
  latency_ms?: number;
  checks?: GateCheck[];
  fill?: { price: number; quantity: number; venue: string; slippage_bps: number; fee_usd: number } | null;
}

interface SandboxBookShape {
  trading_halted: boolean;
  halted_symbols: string[];
  equity: { start_of_day: number; current: number };
  exposure: {
    gross: number;
    positions: Array<{
      symbol: string;
      side: string;
      notional: number;
      /** The cap this book trades under for the symbol — used + remaining. */
      symbol_limit: { used: number; remaining: number };
    }>;
  };
  risk_budget: { gross_exposure: { limit: number } };
}

/**
 * The gateway's pre-trade battery, replayed in the browser against the sandbox
 * book. Gate names, evaluation order and thresholds follow
 * `modules/risk_proxy.py` `submit()`; a divergence here is a bug, not a
 * simplification. Holds the mutable state the real gateway holds — the
 * rate-limit bucket and the idempotency set — so a burst preset trips the same
 * gate for the same reason.
 */
export function createSandboxDesk(book: SandboxBookShape) {
  const seen = new Set<string>();
  // The sandbox has no ladder, so marketability is decided against a synthesised
  // half-spread around the fixed mark. That is a sandbox-only approximation and
  // is the one place this judge does not replay the gateway literally — the
  // gateway reads a real consolidated touch. Everything downstream of the
  // decision (which gate vector runs, what fills, what rests) does match.
  const SANDBOX_HALF_SPREAD_BPS = 2;
  let resting = 0;
  const stamps: number[] = [];
  let counter = 0;
  const rand = mulberry32(0xdecade);

  function judge(order: SandboxOrder, at = Date.now()): SandboxDecision {
    const checks: GateCheck[] = [];
    const add = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });
    const limits = SANDBOX_LIMITS;

    // 1 — kill switch (sandbox book trades)
    add("kill_switch", !book.trading_halted, book.trading_halted ? "kill switch engaged" : "disengaged");
    // 2 — per-symbol halt
    add("symbol_halt", !book.halted_symbols.includes(order.symbol), `${order.symbol} halt status`);
    // 3 — instrument whitelist
    const whitelisted = (SANDBOX_SYMBOLS as readonly string[]).includes(order.symbol);
    add("symbol_whitelist", whitelisted, `${order.symbol} in [${SANDBOX_SYMBOLS.join(", ")}]`);
    // 4 — idempotency
    const dup = Boolean(order.clientOrderId && seen.has(order.clientOrderId));
    add("duplicate_order", !dup, `client_order_id=${order.clientOrderId ?? "-"}`);
    // 5 — rate limit: same shape as the gateway's token bucket, one-second window
    while (stamps.length && at - stamps[0] > 1_000) stamps.shift();
    const allowed = stamps.length < limits.maxOrdersPerSec;
    if (allowed) stamps.push(at);
    add("rate_limit", allowed, `${stamps.length}/s observed vs ${limits.maxOrdersPerSec}/s`);
    // 6 — price discovery
    const mark = SANDBOX_MARKS[order.symbol];
    add("price_available", Boolean(mark), mark ? `mark=${mark}` : "no live mark price");
    // sizing
    const notional = order.notional;
    add("order_sized", Number.isFinite(notional) && notional > 0, "quantity or notional required");

    if (Number.isFinite(notional) && notional > 0 && mark) {
      // 7 — fat-finger ceiling (order-level: config.py's default carries over)
      add("max_order_notional", notional <= limits.maxOrderNotionalUsd,
        `$${notional.toLocaleString()} vs $${limits.maxOrderNotionalUsd.toLocaleString()} cap`);
      // 8 — projected symbol concentration, against the cap THIS book declares
      // (the real gateway reads its cap from settings and publishes it in the
      // payload; the judge reads it off the book the same way)
      const held = book.exposure.positions.find((p) => p.symbol === order.symbol);
      const symbolCap = held
        ? held.symbol_limit.used + held.symbol_limit.remaining
        : Math.max(...book.exposure.positions.map((p) => p.symbol_limit.used + p.symbol_limit.remaining));
      const heldSigned = held ? (held.side === "SHORT" ? -held.notional : held.notional) : 0;
      const projectedSym = Math.abs(heldSigned + (order.side === "BUY" ? notional : -notional));
      add("symbol_concentration", projectedSym <= symbolCap,
        `$${Math.round(projectedSym).toLocaleString()} projected vs $${symbolCap.toLocaleString()}`);
      // 9 — projected gross exposure, against the book's declared gross limit
      const grossCap = book.risk_budget.gross_exposure.limit;
      const projectedGross = book.exposure.gross - Math.abs(heldSigned) + projectedSym;
      add("gross_exposure", projectedGross <= grossCap,
        `$${Math.round(projectedGross).toLocaleString()} projected vs $${grossCap.toLocaleString()}`);
    }

    // 10 — limit price sanity, the other half of fat-finger protection.
    // MARKET orders skip it exactly as risk_proxy.py does. No rand() here, so
    // the PRNG sequence for MARKET orders is bit-identical to before the gate.
    if (order.orderType === "LIMIT" && order.limitPrice && mark) {
      const devBps = (Math.abs(order.limitPrice - mark) / mark) * 1e4;
      add("price_band", devBps <= limits.maxPriceDeviationBps,
        `${devBps.toFixed(1)}bps from mark ${mark.toLocaleString()}`);
    }

    // 11 — drawdown budget
    const dd = Math.max(0, -(book.equity.current - book.equity.start_of_day) / book.equity.start_of_day);
    // 11 — resting-book ceiling, LIMIT only, exactly where risk_proxy.py runs it:
    // after price_band, before daily_drawdown.
    if (order.orderType === "LIMIT") {
      add("working_book", resting < limits.maxWorkingOrders,
        `${resting} resting vs ${limits.maxWorkingOrders} cap`);
    }

    add("daily_drawdown", dd < limits.maxDailyDrawdownPct,
      `${(dd * 100).toFixed(2)}% used of ${(limits.maxDailyDrawdownPct * 100).toFixed(2)}%`);
    // 12 — reduce-only engages between the soft threshold and the halt
    const budgetUsed = dd / limits.maxDailyDrawdownPct;
    if (budgetUsed >= limits.reduceOnlyThreshold) {
      const held = book.exposure.positions.find((p) => p.symbol === order.symbol);
      const heldSigned = held ? (held.side === "SHORT" ? -held.notional : held.notional) : 0;
      const orderSigned = order.side === "BUY" ? notional : -notional;
      const reducing = heldSigned !== 0 && (heldSigned > 0) !== (orderSigned > 0)
        && Math.abs(orderSigned) <= Math.abs(heldSigned) + 1e-9;
      add("reduce_only", reducing,
        `reduce-only at ${(budgetUsed * 100).toFixed(0)}% of the drawdown budget — `
        + (reducing ? "closing order allowed" : "only position-reducing orders accepted"));
    }
    // 12 — liquidity at a sane cost. The synthetic ladder deepens with the
    // mark, mirroring how route_estimate walks real depth.
    if (Number.isFinite(notional) && notional > 0 && mark) {
      const estSlippage = 1.2 + (notional / limits.maxOrderNotionalUsd) * 3.4 + rand() * 0.6;
      add("est_slippage", estSlippage <= limits.maxEstSlippageBps,
        `${estSlippage.toFixed(2)}bps routing ${SANDBOX_VENUES[counter % SANDBOX_VENUES.length]}`);
    }

    const rejectedBy = checks.filter((c) => !c.passed).map((c) => c.name);
    const accepted = rejectedBy.length === 0;
    if (order.clientOrderId && accepted) seen.add(order.clientOrderId);
    counter += 1;

    // Marketable, or resting? A limit that crosses the spread is a taker and
    // fills now; one nobody is willing to meet has something to wait for. The
    // gateway makes exactly this split, and a sandbox that filled everything
    // would teach a reviewer the wrong thing about what was built.
    const marketable = order.orderType !== "LIMIT" || !order.limitPrice || !mark
      ? true
      : order.side === "BUY"
        ? order.limitPrice >= mark * (1 + SANDBOX_HALF_SPREAD_BPS / 1e4)
        : order.limitPrice <= mark * (1 - SANDBOX_HALF_SPREAD_BPS / 1e4);
    const status: OrderStatus = !accepted ? "REJECTED" : marketable ? "FILLED" : "WORKING";
    if (status === "WORKING") resting += 1;

    const slippage = 1.4 + rand() * 1.8;
    // Quantity sizes at the same reference the gateway uses (risk_proxy.py:
    // ref_price = req.limit_price or mark); MARKET path unchanged.
    const refPrice = order.orderType === "LIMIT" && order.limitPrice ? order.limitPrice : mark;
    return {
      accepted,
      order_id: `SBX-${String(counter).padStart(4, "0")}`,
      reason: !accepted
        ? `rejected by ${rejectedBy.join(", ")} (sandbox)`
        : marketable
          ? "accepted against the sandbox book — no order was sent anywhere"
          : "resting on the sandbox book — nobody is showing this price",
      rejected_by: rejectedBy,
      latency_ms: 0.05 + rand() * 0.1,
      checks,
      status,
      fill: status === "FILLED" && mark
        ? {
            price: mark * (1 + (order.side === "BUY" ? 1 : -1) * slippage / 1e4),
            quantity: notional / refPrice,
            venue: SANDBOX_VENUES[counter % SANDBOX_VENUES.length],
            slippage_bps: slippage,
            fee_usd: notional * (SANDBOX_LIMITS.takerFeeBps / 1e4),
          }
        : null,
    };
  }

  return { judge };
}

export function summarise(rows: BlotterRow[]): ExecutionSummary {
  // Fills, not acceptances. Before resting orders those were the same set; now a
  // cancelled or expired order is accepted-but-unfilled, and a fill rate that
  // counted it would flatter the desk.
  const accepted = rows.filter((r) => r.status === "FILLED");
  const slippage = accepted.map((r) => r.slippageBps).filter((v): v is number => v != null);
  const fees = accepted.map((r) => r.feeUsd).filter((v): v is number => v != null);
  const latency = rows.map((r) => r.latencyMs).filter((v): v is number => v != null).sort((a, b) => a - b);

  const gates = new Map<string, number>();
  for (const row of rows) {
    for (const gate of row.rejectedBy) gates.set(gate, (gates.get(gate) ?? 0) + 1);
  }
  const worstGate = [...gates.entries()].sort((a, b) => b[1] - a[1])[0];

  // Nearest-rank: with a window this small, interpolating between two samples
  // would invent precision the window does not have.
  const quantile = (q: number): number | null =>
    latency.length ? latency[Math.min(latency.length - 1, Math.ceil(q * latency.length) - 1)] : null;

  return {
    orders: rows.length,
    accepted: accepted.length,
    rejected: rows.length - accepted.length,
    fillRate: rows.length ? accepted.length / rows.length : null,
    avgSlippageBps: slippage.length ? slippage.reduce((a, b) => a + b, 0) / slippage.length : null,
    worstSlippageBps: slippage.length ? Math.max(...slippage) : null,
    // `?? 0` inside a sum is the one place a null can be coerced without
    // looking like it: the total comes out lower and there is nothing on
    // screen saying over how many fills. The filter is the same discipline
    // `avgSlippageBps` above it already uses — the denominator is the rows
    // that HAVE the measure — and the two counts travel with the figure so a
    // partial total can say so. Rejected: nulling the total whenever one fee
    // is missing, which would throw away every fee the gateway did record.
    totalFees: fees.reduce((sum, fee) => sum + fee, 0),
    feePricedFills: fees.length,
    feeUnpricedFills: accepted.length - fees.length,
    p50LatencyMs: quantile(0.5),
    p90LatencyMs: quantile(0.9),
    p99LatencyMs: quantile(0.99),
    topRejectReason: worstGate ? { gate: worstGate[0], count: worstGate[1] } : null,
  };
}
