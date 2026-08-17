"use client";

/**
 * Order entry that shows its work.
 *
 * The point of this panel is not that it sends orders — it is that it renders
 * the gateway's whole check vector for *both* outcomes. A ticket that says only
 * "rejected" teaches a trader nothing; one that says which of the fourteen gates
 * fired, with the number that tripped it, turns a refusal into information.
 *
 * The three presets exist for the same reason. "Fat finger" and "rate limit"
 * are the two rejections worth seeing before they happen for real, and a demo
 * that requires typing a plausible-looking bad order is a demo nobody runs.
 *
 * Nothing here decides anything. Every order goes to the gateway and is judged
 * by the same gates a Telegram or console order faces; this component only
 * displays the verdict. The gateway credential stays on the server. A separate
 * operator credential, when required, is held only in this tab's memory and is
 * sent to the same-origin route — never directly to the gateway.
 */

import { useRef, useState, type CSSProperties } from "react";

import NumberTicker from "@/components/common/NumberTicker";
import { useLiveMid } from "@/components/execution/live-mid-context";
import { type GateCheck, type SandboxDecision, type SandboxOrder } from "@/lib/blotter";
import { fmt, formatDuration, priceDp, usd } from "@/lib/format";
import { operatorHeaders } from "@/lib/risk-control";
import { classify } from "@/lib/providers/symbols";
import { strategiesByFamily } from "@/lib/strategy-progress";
import { STRATEGY_LABELS, type Strategy } from "@/lib/types";

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

interface Decision {
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

type Preset = {
  id: string;
  label: string;
  hint: string;
  notional: number;
  repeat?: number;
  /** Risk intent, so a gate-tripping demo never looks like a neutral chip. */
  tone?: "warn" | "notice";
};

/**
 * Longer than `lib/gateway.ts`'s own 8s server-side deadline, deliberately: the
 * proxy in front of the gateway should be the thing that gives up first, so a
 * slow-but-alive decision still reaches the reader with its real verdict rather
 * than being aborted by the browser into an ambiguous one.
 */
const ORDER_TIMEOUT_MS = 15_000;

const PRESETS: Preset[] = [
  { id: "valid", label: "Valid $25k", hint: "Passes every gate and fills on the live ladder.", notional: 25_000 },
  { id: "fat-finger", label: "Fat finger $500k", hint: "Blocked by the per-order notional cap.", notional: 500_000, tone: "warn" },
  { id: "burst", label: "Rate-limit burst", hint: "Twelve $1k orders — the token bucket stops the tail.", notional: 1_000, repeat: 12, tone: "notice" },
];

const STRATEGY_GROUPS = [...strategiesByFamily()];

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
              ? `${symbol} uses a server-verified provider quote and a disclosed paper model. MARKET only; no L2 routing is claimed.`
              : "Every order is judged by the gateway's pre-trade gates. A rejection is the answer, not an error."}
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
          Trading is halted{haltedSymbols.includes(symbol) ? ` for ${symbol}` : " across the book"}. Orders will be
          rejected by the kill-switch gate — which is exactly what you should see below if you send one.
        </p>
      ) : null}

      {disabled ? (
        <p className="notice notice--stop">
          The order path needs a reachable gateway and none is answering, so the ticket is
          disabled rather than letting a demo click end in an error it cannot explain.
        </p>
      ) : null}
      {mode === "sandbox" ? (
        <p className="muted">
          Sandbox: verdicts are computed in this browser by the gateway&apos;s own gate logic against
          the generated book. No order leaves this page.
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
                ? "Using the deployment credential. Paste a token to override this request."
                : "Required for live orders. Held in memory for this tab only."}
          </small>
        </div>
      ) : null}

      <div className="cockpit-ticket__form">
        {/* `seg--side` is the one segmented control that keeps a saturated
            fill. Selection everywhere else is a raised surface now, and the
            control deciding which direction an order goes must not read as
            quietly as a log-level filter. The hue comes from the side, matching
            how the desk colours long and short elsewhere; the word is what
            actually says which is which. */}
        <div className="seg seg--side" role="group" aria-label="Side">
          {(["BUY", "SELL"] as const).map((option) => (
            <button
              key={option}
              type="button"
              value={option}
              aria-pressed={side === option}
              onClick={() => onSideChange(option)}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="seg seg--type" role="group" aria-label="Order type">
          {(["MARKET", "LIMIT"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={orderType === option}
              disabled={paperEquity && option === "LIMIT"}
              title={paperEquity && option === "LIMIT" ? "Equity paper orders are MARKET-only because no equity L2 book is connected." : undefined}
              onClick={() => onOrderTypeChange(option)}
            >
              {option === "MARKET" ? "Market" : "Limit"}
            </button>
          ))}
        </div>

        <label className="cockpit-ticket__strategy" htmlFor="execution-strategy">
          <span>Strategy sleeve</span>
          <select
            id="execution-strategy"
            value={strategy}
            onChange={(event) => onStrategyChange(event.target.value as Strategy)}
            aria-describedby="execution-strategy-help"
            title="This tag groups the order in Portfolio attribution; any resulting position updates aggregate Risk."
          >
            {STRATEGY_GROUPS.map(([family, strategies]) => (
              <optgroup key={family} label={family}>
                {strategies.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {STRATEGY_LABELS[candidate]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {/* Screen-reader only. Printed under the select, this line was the
              one control in the row with text below it, so the row's shared
              bottom edge ran under the hint and the sleeve sat a line higher
              than BUY/SELL beside it. The select's own title carries the same
              fact for a sighted reader on hover. */}
          <small id="execution-strategy-help" className="sr-only">
            Tags this paper order; it does not run the model automatically.
          </small>
        </label>

        {orderType === "LIMIT" && (
          <div className="seg seg--type" role="group" aria-label="Time in force">
            {(["GTC", "DAY", "IOC"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={timeInForce === option}
                onClick={() => setTimeInForce(option)}
                title={
                  option === "GTC" ? "Rests until it fills or is cancelled"
                    : option === "DAY" ? "Rests until the UTC session boundary, then expires"
                      : "Fills against what is showing now, or expires immediately"
                }
              >
                {option}
              </button>
            ))}
          </div>
        )}

        <label>
          <span>Notional</span>
          <input
            type="number"
            min={1}
            step={1000}
            value={notional}
            onChange={(event) => onNotionalChange(Math.max(0, Number(event.target.value) || 0))}
          />
        </label>

        {orderType === "LIMIT" ? (
          <label>
            <span>Limit price</span>
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={limitPrice ?? ""}
              placeholder={mid != null ? fmt(mid, priceDp(mid)) : "price"}
              onChange={(event) =>
                onLimitPriceChange(event.target.value === "" ? null : Math.max(0, Number(event.target.value) || 0))}
            />
          </label>
        ) : null}

        <button
          type="button"
          className="primary-action"
          disabled={busy || disabled || credentialMissing || !(notional > 0) || limitInvalid || equityLimitUnsupported}
          title={
            credentialMissing
              ? "Enter the operator credential above to enable live order submission."
              : equityLimitUnsupported
              ? "Covered US equity paper orders are MARKET-only; no L2 book is available for a resting limit."
              : limitInvalid
              ? "Limit orders need a price — the grey number in the field is the current mark, not a value."
              : !(notional > 0) ? "Set a notional first." : undefined
          }
          onClick={() => void submit()}
        >
          {busy
            ? "Submitting…"
            : `Send ${side} ${symbol}${orderType === "LIMIT" && limitPrice ? ` @ ${fmt(limitPrice, mid != null ? priceDp(mid) : 2)}` : ""}`}
        </button>

        {/* This ticket's whole stance is "a rejection is the answer, not an
            error" — so a disabled Send with no stated reason is a bug in that
            stance, and it was reported as exactly that ("why does this not
            work?"). The placeholder shows the mark to type against, which
            reads as a filled-in value at a glance; when it is the reason the
            button is dead, say so in text, not only in a hover title. */}
        {limitInvalid && !busy && !disabled ? (
          <p className="cockpit-ticket__hint">
            Type a limit price to enable Send — the grey {mid != null ? fmt(mid, priceDp(mid)) : ""}{" "}
            is the current mark shown as a hint, not a filled-in value. Or switch back to Market.
          </p>
        ) : null}

        {bandBps != null && bandBps > 500 ? (
          <p className="cockpit-ticket__hint">
            Limit is {bandBps.toFixed(0)} bps from mid — the gateway&apos;s price_band gate rejects
            beyond 500 bps.
          </p>
        ) : null}
      </div>

      {/* A named group, not a seg: these are submit actions, so aria-pressed
          would be a lie, but a screen reader still deserves to know the three
          are one family — the same fix LiveMarket's notional shortcuts got. */}
      <div className="cockpit-ticket__presets" role="group" aria-label="Gate demonstration presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`icon${preset.tone ? ` preset--${preset.tone}` : ""}`}
            disabled={busy || disabled || credentialMissing}
            title={preset.hint}
            onClick={() => void submit(preset.repeat ?? 1, preset.notional, "preset")}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="notice notice--stop">
          {error.error}
          {error.hint ? <><br /><span className="muted">{error.hint}</span></> : null}
        </p>
      ) : null}

      {latest ? (
        <div className={`cockpit-verdict ${latest.accepted ? "is-accepted" : "is-rejected"}`}>
          <div className="cockpit-verdict__headline">
            <strong>{latest.accepted ? "ACCEPTED" : "REJECTED"}</strong>
            {decisions.length > 1 ? (
              <span className="muted">{burstAccepted} of {decisions.length} accepted</span>
            ) : null}
            {latest.latency_ms != null ? (
              // Counting up to a sub-millisecond figure is the honest flex.
              <span className="muted">
                decided in <NumberTicker value={latest.latency_ms} format={(v) => formatDuration(v, "ms")} />
              </span>
            ) : null}
          </div>

          {latest.reason ? <p>{latest.reason}</p> : null}

          {latest.fill ? (
            <p className="muted">
              Filled {fmt(latest.fill.quantity, 6)} @ {usd(latest.fill.price, 2)} on {latest.fill.venue};
              slippage {fmt(latest.fill.slippage_bps, 1)} bps, fee {usd(latest.fill.fee_usd, 2)}
              {latest.order_type === "LIMIT"
                // A marketable limit crosses the spread and pays for it; one that
                // rests is filled by someone crossing to reach it and takes its
                // own price. Naming which happened is the difference between a
                // cost the desk paid and one it collected.
                ? <>; marketable limit — crossed the spread at route VWAP</>
                : null}
            </p>
          ) : null}

          {latest.checks?.length ? (
            /* Keyed per decision so every submit replays the assembly of the
               gate vector — and only a submit: re-renders and resizes leave
               the settled rows alone. The stagger delay caps at 480ms so a
               14-gate vector never makes a reader wait on the tail. */
            <ol className="cockpit-checks" key={decisionSeq.current}>
              {latest.checks.map((check, index) => (
                <li
                  key={check.name}
                  className={`stagger-reveal ${check.passed ? "is-pass" : "is-fail"}`}
                  style={{ "--stagger-i": Math.min(index, 12) } as CSSProperties}
                >
                  <span className="cockpit-checks__mark" aria-hidden>{check.passed ? "✓" : "✗"}</span>
                  <span className="cockpit-checks__name">{check.name}</span>
                  {check.detail ? <span className="cockpit-checks__detail">{check.detail}</span> : null}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
