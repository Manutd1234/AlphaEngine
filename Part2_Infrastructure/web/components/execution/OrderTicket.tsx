"use client";

/**
 * Order entry that shows its work.
 *
 * The point of this panel is not that it sends orders — it is that it renders
 * the gateway's whole check vector for *both* outcomes. A ticket that says only
 * "rejected" teaches a trader nothing; one that says which of the pre-trade gates
 * fired, with the number that tripped it, turns a refusal into information.
 *
 * What is left here is the deciding half. The controls a reader touches are
 * `OrderTicketForm`, the answer they get is `OrderVerdict`, and the three gate
 * demonstrations are `ticket-model`; this file holds the submit itself, its
 * deliberately undeadlined write, the operator credential field, and the
 * reachability notices that close the ticket.
 *
 * Nothing here decides anything. Every order goes to the gateway and is judged
 * by the same gates a Telegram or console order faces; this component only
 * displays the verdict. The gateway credential stays on the server. A separate
 * operator credential, when required, is held only in this tab's memory and is
 * sent to the same-origin route — never directly to the gateway.
 */

import { useRef, useState } from "react";

import { useLiveMid } from "@/components/execution/live-mid-context";
import OrderTicketForm from "@/components/execution/OrderTicketForm";
import OrderVerdict from "@/components/execution/OrderVerdict";
import { type Decision } from "@/components/execution/ticket-model";
import { type SandboxDecision, type SandboxOrder } from "@/lib/blotter";
import { operatorHeaders } from "@/lib/risk-control";
import { classify } from "@/lib/providers/symbols";
import { type Strategy } from "@/lib/types";

interface OrderTicketProps {
  symbol: string;
  side: "BUY" | "SELL";
  notional: number;
  orderType: "MARKET" | "LIMIT";
  limitPrice: number | null;
  onSideChange: (side: "BUY" | "SELL") => void;
  onNotionalChange: (notional: number) => void;
  onOrderTypeChange: (orderType: "MARKET" | "LIMIT") => void;
  onLimitPriceChange: (price: number | null) => void;
  /**
   * The operator credential shared with Reliability. Live submissions carry it
   * as a Bearer header to the same-origin route.
   */
  operatorToken?: string;
  operatorGuard?: "token" | "open-dev" | "open-demo" | "locked";
  operatorTokenEnv?: string;
  /** True means a blank field uses the server-held credential for this route. */
  paperOrderDefaultAvailable?: boolean;
  onOperatorTokenChange?: (token: string) => void;
  strategy: Strategy;
  onStrategyChange: (strategy: Strategy) => void;
  experimentId: string | null;
  halted: boolean;
  haltedSymbols: string[];
  /**
   * live — POST to the gateway; sandbox — judge locally with the gateway's
   * gate logic; outage — the ticket is disabled, because inviting a click
   * that can only produce a 503 teaches a reviewer the wrong lesson.
   */
  mode: "live" | "sandbox" | "outage";
  /** The sandbox desk's judge, present only in sandbox mode. */
  judge?: (order: SandboxOrder) => SandboxDecision;
  onSubmitted: (result: OrderSubmissionResult) => void;
}

export interface OrderSubmissionResult {
  source: "live" | "sandbox";
  decisions: number;
  hasFill: boolean;
}

/**
 * Longer than `lib/gateway.ts`'s own 8s server-side deadline, deliberately: the
 * proxy in front of the gateway should be the thing that gives up first, so a
 * slow-but-alive decision still reaches the reader with its real verdict rather
 * than being aborted by the browser into an ambiguous one.
 */
const ORDER_TIMEOUT_MS = 15_000;

export default function OrderTicket({
  symbol, side, notional, orderType, limitPrice, onSideChange, onNotionalChange,
  onOrderTypeChange, onLimitPriceChange, operatorToken, operatorGuard,
  operatorTokenEnv, paperOrderDefaultAvailable, onOperatorTokenChange, strategy, onStrategyChange,
  experimentId, halted, haltedSymbols, mode, judge, onSubmitted,
}: OrderTicketProps) {
  const [busy, setBusy] = useState(false);
  // Local rather than lifted. `orderType` and `limitPrice` live in page.tsx so
  // the ladder can stage a limit the ticket picks up; nothing stages a
  // time-in-force from another panel, so lifting it would add a prop for no reader.
  const [timeInForce, setTimeInForce] = useState<"GTC" | "DAY" | "IOC">("GTC");
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [error, setError] = useState<{ code?: string; error: string; hint?: string } | null>(null);
  // Monotonic per submit: the cascade's animation key. A decision id would
  // also work when present, but rejections can arrive without one.
  const decisionSeq = useRef(0);
  const mid = useLiveMid();
  const paperEquity = classify(symbol) === "equity";

  const symbolHalted = halted || haltedSymbols.includes(symbol);
  const disabled = mode === "outage";
  const credentialMissing = mode === "live"
    && operatorGuard === "token"
    && !paperOrderDefaultAvailable
    && !operatorToken?.trim();
  const limitInvalid = orderType === "LIMIT" && !(limitPrice != null && limitPrice > 0);
  const equityLimitUnsupported = paperEquity && orderType === "LIMIT";
  const bandBps = orderType === "LIMIT" && limitPrice && mid
    ? (Math.abs(limitPrice - mid) / mid) * 1e4
    : null;

  async function submit(count = 1, overrideNotional?: number, kind: "ticket" | "preset" = "ticket") {
    setBusy(true);
    setError(null);
    // Presets stay MARKET regardless of the seg: their gate demonstrations
    // (fat-finger, burst) are pinned behaviours, not order drafts.
    const effectiveType = kind === "preset" ? "MARKET" : orderType;
    const collected: Decision[] = [];
    try {
      for (let i = 0; i < count; i += 1) {
        const order = {
          symbol,
          side,
          notional: overrideNotional ?? notional,
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

        if (mode === "sandbox" && judge) {
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
          setError({
            code: body.code,
            error: body.error ?? `The order route answered HTTP ${response.status}.`,
            hint: body.hint,
          });
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
      setError(timedOut
        ? {
          error: `No verdict within ${ORDER_TIMEOUT_MS / 1000}s. The order may still have been decided.`,
          hint: "Check the blotter before resubmitting — the gateway's idempotency gate makes a deliberate retry safe.",
        }
        : { error: "The order could not be submitted from this browser." });
    } finally {
      setBusy(false);
      // A mid-burst transport failure must not discard earlier fills. The
      // shared book and audit snapshot still changed before the failed request.
      if (collected.length) {
        decisionSeq.current += 1;
        setDecisions(collected);
        onSubmitted({
          source: mode === "sandbox" ? "sandbox" : "live",
          decisions: collected.length,
          hasFill: collected.some((decision) => decision.accepted && decision.fill != null),
        });
      }
    }
  }

  const latest = decisions[decisions.length - 1];
  const burstAccepted = decisions.filter((d) => d.accepted).length;

  return (
    <section className="card cockpit-ticket">
      <header className="section-heading compact">
        <div>
          <h3>Order ticket</h3>
          <p className="muted">
            {paperEquity
              ? `${symbol} prices off a server-verified provider quote, paper model, MARKET only; no L2 routing is claimed.`
              : "Judged by the gateway's pre-trade gates. A rejection is the answer, not an error."}
          </p>
        </div>
        {/* No sleeve chip here. It read as a status chip and navigated to
            Research — an action its face never stated — and the sleeve it
            named is the "Strategy sleeve" select a few fields below, which
            can say it as a control rather than a caption. Research stays
            reachable through the workspace nav, the routing hand-off's
            "Review evidence", and the blotter's per-experiment link. */}
      </header>

      {symbolHalted ? (
        <p className="notice notice--stop">
          Trading is halted{haltedSymbols.includes(symbol) ? ` for ${symbol}` : " across the book"}. The
          kill-switch gate will reject orders.
        </p>
      ) : null}

      {disabled ? (
        <p className="notice notice--stop">
          No gateway is answering, so the ticket is disabled.
        </p>
      ) : null}
      {mode === "sandbox" ? (
        <p className="muted">
          Sandbox: verdicts are computed in this browser. No order leaves this page.
        </p>
      ) : null}

      {mode === "live" && operatorGuard === "token" && onOperatorTokenChange ? (
        <div className="cockpit-ticket__credential">
          <label>
            <span>{paperOrderDefaultAvailable ? "Credential override (optional)" : "Operator credential"}</span>
            <input
              type="password"
              value={operatorToken ?? ""}
              onChange={(event) => {
                onOperatorTokenChange(event.target.value);
                if (error?.code === "operator_auth_failed") setError(null);
              }}
              placeholder={operatorTokenEnv ?? "Operator token"}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error?.code === "operator_auth_failed" || undefined}
            />
          </label>
          <small className="muted">
            {operatorToken?.trim()
              ? "Override ready; held in memory for this tab only."
              : paperOrderDefaultAvailable
                ? "Using the deployment credential; paste a token to override."
                : "Required for live orders. Held in memory for this tab only."}
          </small>
        </div>
      ) : null}

      <OrderTicketForm
        symbol={symbol}
        side={side}
        notional={notional}
        orderType={orderType}
        limitPrice={limitPrice}
        timeInForce={timeInForce}
        strategy={strategy}
        mid={mid}
        bandBps={bandBps}
        busy={busy}
        disabled={disabled}
        credentialMissing={credentialMissing}
        limitInvalid={limitInvalid}
        equityLimitUnsupported={equityLimitUnsupported}
        paperEquity={paperEquity}
        onSideChange={onSideChange}
        onNotionalChange={onNotionalChange}
        onOrderTypeChange={onOrderTypeChange}
        onLimitPriceChange={onLimitPriceChange}
        onTimeInForceChange={setTimeInForce}
        onStrategyChange={onStrategyChange}
        onSubmit={(count, overrideNotional, kind) => void submit(count, overrideNotional, kind)}
      />

      {error ? (
        <p className="notice notice--stop">
          {error.error}
          {error.hint ? <><br /><span className="muted">{error.hint}</span></> : null}
        </p>
      ) : null}

      {decisions.length ? (
        <OrderVerdict decisions={decisions} sequence={decisionSeq.current} />
      ) : null}
    </section>
  );
}
