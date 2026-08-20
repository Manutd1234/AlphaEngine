/**
 * The order write: one request per order, judged by the gateway or by the
 * sandbox desk, and never by this file.
 *
 * Split out of `OrderTicket` so the panel is markup and state and this is the
 * network contract. The three things that make the contract are all here, with
 * the arguments they were written from:
 *
 *   - it is a WRITE, so it is exempt from `probeGateway`'s 2.5s read budget;
 *   - it is exempt from the budget, not from a deadline — see the fetch;
 *   - it never claims an outcome it does not know. A timeout is reported as a
 *     timeout, because "could not be submitted" would tell a trader nothing
 *     was sent and invite them to send it twice.
 *
 * `submitOrder` collects decisions as they arrive and returns whatever it has
 * when it stops, failure included. A burst that fills three orders and then
 * loses the connection has produced three fills, and discarding them because
 * the fourth request failed would leave the ticket disagreeing with the book.
 */

import { type GateCheck, type SandboxDecision, type SandboxOrder } from "@/lib/blotter";
import { operatorHeaders } from "@/lib/risk-control";
import { type Strategy } from "@/lib/types";

export interface OrderSubmissionResult {
  source: "live" | "sandbox";
  decisions: number;
  hasFill: boolean;
}

export interface Decision {
  accepted: boolean;
  order_id?: string;
  reason?: string | null;
  rejected_by?: string[];
  latency_ms?: number;
  checks?: GateCheck[];
  fill?: { price: number; quantity: number; venue: string; slippage_bps: number; fee_usd: number } | null;
  /** Stamped client-side so the verdict can label a LIMIT fill honestly even
   *  after the type seg has moved on. */
  order_type?: "MARKET" | "LIMIT";
}

/** What the ticket shows when there is no verdict to show. */
export interface SubmissionError {
  code?: string;
  error: string;
  hint?: string;
}

/**
 * Longer than `lib/gateway.ts`'s own 8s server-side deadline, deliberately: the
 * proxy in front of the gateway should be the thing that gives up first, so a
 * slow-but-alive decision still reaches the reader with its real verdict rather
 * than being aborted by the browser into an ambiguous one.
 */
const ORDER_TIMEOUT_MS = 15_000;

export interface SubmitParams {
  /** How many orders to send. The burst preset is the only caller above 1. */
  count: number;
  symbol: string;
  side: "BUY" | "SELL";
  /** Already resolved: a preset's own size, or the ticket's field. */
  notional: number;
  orderType: "MARKET" | "LIMIT";
  limitPrice: number | null;
  timeInForce: "GTC" | "DAY" | "IOC";
  strategy: Strategy;
  experimentId: string | null;
  operatorToken?: string;
  /**
   * Presets stay MARKET regardless of the seg: their gate demonstrations
   * (fat-finger, burst) are pinned behaviours, not order drafts.
   */
  kind: "ticket" | "preset";
  /**
   * The sandbox desk's judge, and the whole switch between the two paths.
   * Present means no network at all; the caller decides that on its mode, so
   * this module never has to know what a mode is.
   */
  judge?: (order: SandboxOrder) => SandboxDecision;
}

export interface SubmitOutcome {
  /** Every decision collected, in order, however the run ended. */
  decisions: Decision[];
  /** Null when every order was decided — a rejection is a decision. */
  error: SubmissionError | null;
}

/**
 * Never rejects. A caller that has to `catch` to find out whether it has
 * decisions would drop the ones it already had, which is the defect the
 * collected-so-far return exists to prevent.
 */
export async function submitOrder({
  count,
  symbol,
  side,
  notional,
  orderType,
  limitPrice,
  timeInForce,
  strategy,
  experimentId,
  operatorToken,
  kind,
  judge,
}: SubmitParams): Promise<SubmitOutcome> {
  // Presets stay MARKET regardless of the seg: their gate demonstrations
  // (fat-finger, burst) are pinned behaviours, not order drafts.
  const effectiveType = kind === "preset" ? "MARKET" : orderType;
  const collected: Decision[] = [];
  let failure: SubmissionError | null = null;
  try {
    for (let i = 0; i < count; i += 1) {
      const order = {
        symbol,
        side,
        notional,
        order_type: effectiveType,
        ...(effectiveType === "LIMIT" && limitPrice ? { limit_price: limitPrice } : {}),
        // LIMIT only. The gateway rejects a resting MARKET order with a 422
        // rather than coercing it, so sending one would be asking for an error.
        ...(effectiveType === "LIMIT" ? { time_in_force: timeInForce } : {}),
        strategy,
        // Stamping the experiment id is what later lets a fill in the
        // blotter be traced back to the run that argued for it.
        ...(experimentId ? { client_order_id: `${experimentId}-${Date.now()}-${i}` } : {}),
      };

      if (judge) {
        // No network. The gates are the gateway's own — names, order and
        // thresholds — replayed against the generated book, and the burst
        // preset trips the same token bucket for the same reason.
        collected.push({
          ...(judge({
            symbol: order.symbol,
            side: order.side,
            notional: order.notional,
            clientOrderId: order.client_order_id ?? null,
            orderType: effectiveType,
            limitPrice: effectiveType === "LIMIT" ? limitPrice : null,
          }) as Decision),
          order_type: effectiveType,
        });
        continue;
      }

      /**
       * Deliberately NOT deadlined, unlike every read in this app.
       *
       * The pass that put a 2.5s budget on the gateway reads left this one
       * alone on purpose. Aborting a read costs nothing — you did not learn
       * the number, you try again. Aborting a *write* mid-flight tells you
       * nothing about whether the order was accepted: the gateway may have
       * booked it, logged it to the audit ledger and been unable to say so.
       * A client that then reported "timed out" would be claiming an outcome
       * it does not know, and a trader who resubmits on that basis sends the
       * order twice.
       *
       * So this waits. The idempotency gate on the gateway side is what makes
       * a deliberate retry safe, and the blotter is the authority on what
       * actually happened.
       */
      const response = await fetch("/api/gateway/orders", {
        method: "POST",
        /**
         * A deadline, because the comment above explains why this waits — and
         * waiting forever is a different thing. Without it a hung gateway
         * leaves the ticket spinning with no verdict and no way back, which is
         * the one state an order form must never reach. The timeout is longer
         * than the gateway's own so a slow-but-alive decision still lands.
         */
        signal: AbortSignal.timeout(ORDER_TIMEOUT_MS),
        // The route's write guard rejects tokenless requests on guarded
        // deployments — the credential rides the same header everywhere.
        headers: operatorHeaders(operatorToken),
        body: JSON.stringify(order),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        failure = {
          code: body.code,
          error: body.error ?? `The order route answered HTTP ${response.status}.`,
          hint: body.hint,
        };
        break;
      }
      collected.push({ ...(body.decision as Decision), order_type: effectiveType });
    }
  } catch (cause) {
    /**
     * A timeout is not a transport failure, and saying so matters here more
     * than anywhere else in the app: "could not be submitted" tells a reader
     * nothing was sent, which for an abort is a claim this code cannot make.
     * The request may well have reached the gateway and been decided.
     */
    const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
    failure = timedOut
      ? {
        error: `No verdict within ${ORDER_TIMEOUT_MS / 1000}s. The order may still have been decided.`,
        hint: "Check the blotter before resubmitting — the gateway's idempotency gate makes a deliberate retry safe.",
      }
      : { error: "The order could not be submitted from this browser." };
  }
  return { decisions: collected, error: failure };
}
