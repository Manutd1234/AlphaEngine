"use client";

/**
 * The controls a reader touches, and the three gate demonstrations beside them.
 *
 * Split out of `OrderTicket` when that file passed the length ceiling. The
 * division is deliberate: everything that DECIDES stayed behind — the submit
 * itself, its deliberately undeadlined write, the verdict it produces — and
 * what moved is the markup that collects an intent. Nothing here fetches, and
 * nothing here judges.
 *
 * `seg--side` lives in this file now. It is the one segmented control in the
 * app that keeps a saturated fill, and `accent-budget.test.ts` names the
 * files allowed to claim it.
 */

import { fmt, priceDp } from "@/lib/format";
import { STRATEGY_LABELS, type Strategy } from "@/lib/types";
import { PRESETS, STRATEGY_GROUPS } from "@/components/execution/ticket-model";

interface OrderTicketFormProps {
  symbol: string;
  side: "BUY" | "SELL";
  notional: number;
  orderType: "MARKET" | "LIMIT";
  limitPrice: number | null;
  timeInForce: "GTC" | "DAY" | "IOC";
  strategy: Strategy;
  /** The live mid, for the limit field's placeholder. Null when unmeasured. */
  mid: number | null;
  /** Distance from mid in bps, or null when there is no limit to measure. */
  bandBps: number | null;
  busy: boolean;
  disabled: boolean;
  credentialMissing: boolean;
  limitInvalid: boolean;
  equityLimitUnsupported: boolean;
  paperEquity: boolean;
  onSideChange: (side: "BUY" | "SELL") => void;
  onNotionalChange: (notional: number) => void;
  onOrderTypeChange: (orderType: "MARKET" | "LIMIT") => void;
  onLimitPriceChange: (price: number | null) => void;
  onTimeInForceChange: (tif: "GTC" | "DAY" | "IOC") => void;
  onStrategyChange: (strategy: Strategy) => void;
  onSubmit: (count?: number, overrideNotional?: number, kind?: "ticket" | "preset") => void;
}

export default function OrderTicketForm({
  symbol, side, notional, orderType, limitPrice, timeInForce, strategy, mid,
  bandBps, busy, disabled, credentialMissing, limitInvalid,
  equityLimitUnsupported, paperEquity, onSideChange, onNotionalChange,
  onOrderTypeChange, onLimitPriceChange, onTimeInForceChange, onStrategyChange,
  onSubmit,
}: OrderTicketFormProps) {
  return (
    <>
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
            title={paperEquity && option === "LIMIT" ? "Equity paper orders are MARKET-only; no equity L2 book is connected." : undefined}
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
          title="Tags the order for Portfolio attribution; any resulting position updates aggregate Risk."
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
              onClick={() => onTimeInForceChange(option)}
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
            ? "Enter the operator credential above to send live orders."
            : equityLimitUnsupported
            ? "Equity paper orders are MARKET-only; no L2 book backs a resting limit."
            : limitInvalid
            ? "Limit orders need a price; the grey number is the mark, not a value."
            : !(notional > 0) ? "Set a notional first." : undefined
        }
        onClick={() => onSubmit()}
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
          Type a limit price to enable Send, or switch back to Market. The grey number is the
          mark, not a filled-in value.
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
          onClick={() => onSubmit(preset.repeat ?? 1, preset.notional, "preset")}
        >
          {preset.label}
        </button>
      ))}
    </div>
    </>
  );
}
