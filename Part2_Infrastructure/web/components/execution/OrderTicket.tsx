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
 * displays the verdict. The credential stays on the server — the browser calls
 * a same-origin route, never the gateway.
 */

import { useState } from "react";

import { useLiveMid } from "@/components/execution/live-mid-context";
import { type GateCheck, type SandboxDecision, type SandboxOrder } from "@/lib/blotter";
import { fmt, priceDp, usd } from "@/lib/format";
import { operatorHeaders } from "@/lib/risk-control";

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
   * The operator credential from the Reliability tab. Live submissions carry
   * it as a Bearer header — the route's write guard rejects without it on
   * token-guarded deployments, which this ticket used to trigger silently.
   */
  operatorToken?: string;
  strategy: string | null;
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
  onSubmitted: () => void;
  onOpenResearch?: () => void;
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

const PRESETS: Preset[] = [
  { id: "valid", label: "Valid $25k", hint: "Passes every gate and fills on the live ladder.", notional: 25_000 },
  { id: "fat-finger", label: "Fat finger $500k", hint: "Blocked by the per-order notional cap.", notional: 500_000, tone: "warn" },
  { id: "burst", label: "Rate-limit burst", hint: "Twelve $1k orders — the token bucket stops the tail.", notional: 1_000, repeat: 12, tone: "notice" },
];

export default function OrderTicket({
  symbol, side, notional, orderType, limitPrice, onSideChange, onNotionalChange,
  onOrderTypeChange, onLimitPriceChange, operatorToken, strategy, experimentId,
  halted, haltedSymbols, mode, judge, onSubmitted, onOpenResearch,
}: OrderTicketProps) {
  const [busy, setBusy] = useState(false);
  // Local rather than lifted. `orderType` and `limitPrice` live in page.tsx so
  // the ladder can stage a limit the ticket picks up; nothing stages a
  // time-in-force from another panel, so lifting it would add a prop for no reader.
  const [timeInForce, setTimeInForce] = useState<"GTC" | "DAY" | "IOC">("GTC");
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [error, setError] = useState<{ error: string; hint?: string } | null>(null);
  const mid = useLiveMid();

  const symbolHalted = halted || haltedSymbols.includes(symbol);
  const disabled = mode === "outage";
  const limitInvalid = orderType === "LIMIT" && !(limitPrice != null && limitPrice > 0);
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
    let failed = false;
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
          ...(strategy ? { strategy } : {}),
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

        const response = await fetch("/api/gateway/orders", {
          method: "POST",
          // The route's write guard rejects tokenless requests on guarded
          // deployments — the credential rides the same header everywhere.
          headers: operatorHeaders(operatorToken),
          body: JSON.stringify(order),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError({ error: body.error ?? `The order route answered HTTP ${response.status}.`, hint: body.hint });
          failed = true;
          break;
        }
        collected.push({ ...(body.decision as Decision), order_type: effectiveType });
      }
      // A mid-burst failure must not wipe the verdicts already collected, and
      // a submit that produced nothing has nothing to tell the cockpit to
      // refresh for — the old path did both.
      if (collected.length) setDecisions(collected);
      if (collected.length && !failed) onSubmitted();
    } catch {
      setError({ error: "The order could not be submitted from this browser." });
    } finally {
      setBusy(false);
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
            Every order is judged by the gateway&apos;s pre-trade gates. A rejection is the answer, not an error.
          </p>
        </div>
        {strategy ? (
          <button type="button" className="icon" onClick={onOpenResearch}>
            tagged {strategy}
          </button>
        ) : null}
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

      <div className="cockpit-ticket__form">
        <div className="seg" role="group" aria-label="Side">
          {(["BUY", "SELL"] as const).map((option) => (
            <button
              key={option}
              type="button"
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
              onClick={() => onOrderTypeChange(option)}
            >
              {option === "MARKET" ? "Market" : "Limit"}
            </button>
          ))}
        </div>

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
          disabled={busy || disabled || !(notional > 0) || limitInvalid}
          onClick={() => void submit()}
        >
          {busy
            ? "Submitting…"
            : `Send ${side} ${symbol}${orderType === "LIMIT" && limitPrice ? ` @ ${fmt(limitPrice, mid != null ? priceDp(mid) : 2)}` : ""}`}
        </button>

        {bandBps != null && bandBps > 500 ? (
          <p className="cockpit-ticket__hint">
            Limit is {bandBps.toFixed(0)} bps from mid — the gateway&apos;s price_band gate rejects
            beyond 500 bps.
          </p>
        ) : null}
      </div>

      <div className="cockpit-ticket__presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`icon${preset.tone ? ` preset--${preset.tone}` : ""}`}
            disabled={busy || disabled}
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
              <span className="muted">decided in {fmt(latest.latency_ms, 2)} ms</span>
            ) : null}
          </div>

          {latest.reason ? <p>{latest.reason}</p> : null}

          {latest.fill ? (
            <p className="muted">
              Filled {fmt(latest.fill.quantity, 6)} @ {usd(latest.fill.price, 2)} on {latest.fill.venue} ·
              slippage {fmt(latest.fill.slippage_bps, 1)} bps · fee {usd(latest.fill.fee_usd, 2)}
              {latest.order_type === "LIMIT"
                // A marketable limit crosses the spread and pays for it; one that
                // rests is filled by someone crossing to reach it and takes its
                // own price. Naming which happened is the difference between a
                // cost the desk paid and one it collected.
                ? <> · marketable limit — crossed the spread at route VWAP</>
                : null}
            </p>
          ) : null}

          {latest.checks?.length ? (
            <ol className="cockpit-checks">
              {latest.checks.map((check) => (
                <li key={check.name} className={check.passed ? "is-pass" : "is-fail"}>
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
