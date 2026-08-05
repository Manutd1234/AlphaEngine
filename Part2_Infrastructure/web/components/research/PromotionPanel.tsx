"use client";

/**
 * The gate between research and execution.
 *
 * Every check here is a **veto**, and all of them are shown whether they pass or
 * fail. A panel that only appears on success teaches its readers that the
 * absence of a warning means safety; showing the whole vector every time makes
 * the one red row the thing the eye goes to.
 *
 * The hand-off button is disabled until every gate clears, and it does exactly
 * one thing: carry the instrument into the Execution tab so the candidate can be
 * priced against a live book. It does not submit an order, size a position, or
 * touch the risk gateway — those stay behind the authenticated service, and a
 * research surface that could reach them would be the wrong shape of tool.
 */

import { fmt } from "@/lib/format";
import type { PromotionGate } from "@/lib/types";

interface PromotionPanelProps {
  gate: PromotionGate;
  symbol: string;
  fast: number;
  slow: number;
  strategyLabel: string;
  slippageBps: number;
  blocked?: boolean;
  blockedReason?: string;
  onHandOff: () => void;
}

export default function PromotionPanel({
  gate,
  symbol,
  fast,
  slow,
  strategyLabel,
  slippageBps,
  blocked = false,
  blockedReason,
  onHandOff,
}: PromotionPanelProps) {
  const failed = gate.total - gate.passed;

  return (
    <div className="card promotion-card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Decision</span>
          <h2>Promotion gate</h2>
        </div>
        <span
          className="promotion-score"
          style={{
            color: gate.eligible ? "var(--success-text)" : "var(--critical-text)",
          }}
        >
          <span aria-hidden>{gate.eligible ? "✓" : "✕"}</span> {gate.passed}/{gate.total} cleared
        </span>
      </div>

      <p className="sub">
        Every row is a veto. {gate.eligible
          ? "All of them cleared — this candidate may be priced against a live book."
          : `${failed} ${failed === 1 ? "gate blocks" : "gates block"} promotion. Each one names what it measured and why it exists.`}
      </p>

      <ul className="promotion-list">
        {gate.checks.map((check) => (
          <li key={check.id} className={check.passed ? "is-pass" : "is-fail"}>
            <span className="promotion-mark" aria-hidden>
              {check.passed ? "✓" : "✕"}
            </span>
            <div className="promotion-body">
              <div className="promotion-head">
                <strong>{check.label}</strong>
                <span className="num">
                  {check.value}
                  <span className="muted"> vs {check.hurdle}</span>
                </span>
              </div>
              <small className="muted">{check.why}</small>
            </div>
            <span className="sr-only">{check.passed ? "passed" : "failed"}</span>
          </li>
        ))}
      </ul>

      <div className="promotion-handoff">
        <div>
          <strong className="num">
            {symbol} · {strategyLabel} {fast}/{slow}
          </strong>
          <small>
            {blocked
              ? blockedReason ?? "Promotion is temporarily unavailable."
              : gate.eligible
              ? `Carries a modelled ${fmt(slippageBps, 0)} bps slippage budget into the execution probe.`
              : "Hand-off stays disabled until every gate clears."}
          </small>
        </div>
        <button
          className="primary-action"
          onClick={onHandOff}
          disabled={!gate.eligible || blocked}
          title={
            blocked
              ? blockedReason ?? "Promotion is temporarily unavailable"
              : gate.eligible
              ? "Open the Execution tab with this instrument in context"
              : `${failed} gate${failed === 1 ? "" : "s"} still failing`
          }
        >
          Promote to execution desk
        </button>
      </div>

      <p className="research-note">
        Promotion moves a candidate to the paper-pricing surface only. Order submission, position
        sizing and the kill switch stay behind the authenticated risk gateway — this tab cannot reach
        them, by design.
      </p>
    </div>
  );
}
