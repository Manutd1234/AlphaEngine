"use client";

/**
 * The gate between research and execution.
 *
 * Every check here is a **veto**, and all of them are shown whether they pass or
 * fail. A panel that only appears on success teaches its readers that the
 * absence of a warning means safety; showing the whole vector every time makes
 * the one red row the thing the eye goes to.
 *
 * The reveal is evidence assembly, not celebration: the six gates stagger in
 * keyed by the run's data identity, so a re-render is not a re-animate and a
 * resize is not a re-animate — only a new result replays the sequence. When
 * eligibility flips from blocked to clear, the hand-off button pulses exactly
 * once. That pulse carries `--ease-pop`, the single overshoot easing in the
 * product; its scarcity is deliberate and load-bearing.
 *
 * The hand-off button is disabled until every gate clears, and it does exactly
 * one thing: carry the instrument into the Execution tab so the candidate can be
 * priced against a live book. It does not submit an order, size a position, or
 * touch the risk gateway — those stay behind the authenticated service, and a
 * research surface that could reach them would be the wrong shape of tool.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";

import NumberTicker from "@/components/common/NumberTicker";
import { fmt } from "@/lib/format";
import type { PromotionGate } from "@/lib/types";

interface PromotionPanelProps {
  gate: PromotionGate;
  symbol: string;
  fast: number;
  slow: number;
  strategyLabel: string;
  slippageBps: number;
  /** The run's data identity — the reveal's animation key. */
  dataHash?: string | null;
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
  dataHash,
  blocked = false,
  blockedReason,
  onHandOff,
}: PromotionPanelProps) {
  const failing = gate.checks.filter((c) => !c.passed);
  const failed = failing.length;

  /**
   * Why the button is disabled, in the place a reader is already looking.
   *
   * This said "Hand-off stays disabled until every gate clears", which restates
   * the disabled state without naming a cause, and the COUNT lived only in the
   * button's `title`. A title needs a hover, so it does not exist on a touch
   * device and is not the first thing a mouse user tries either — the question
   * this answers was asked out loud, of a screen that was already showing it.
   *
   * Naming the gates beats counting them while the list is short enough to
   * read; past two it becomes a wall and the count is the more useful summary.
   */
  const blockedBy = failed === 0
    ? null
    : failed <= 2
    ? `Blocked by ${failing.map((c) => c.label).join(" and ")}.`
    : `${failed} of ${gate.total} gates still failing.`;

  // The one-shot pulse: fires on the false→true edge only, and the class is
  // removed on animationend so a re-render can never replay it.
  const [pulse, setPulse] = useState(false);
  const wasEligible = useRef(gate.eligible);
  useEffect(() => {
    if (!wasEligible.current && gate.eligible) setPulse(true);
    wasEligible.current = gate.eligible;
  }, [gate.eligible]);

  return (
    <div className="card promotion-card">
      <div className="section-heading compact">
        <div>
          {/* This card shares a row with Position sizing, whose head carries
              an "Allocation" kicker — without one here the two titles sat a
              rung apart and each card's heading rule landed at a different
              height. The word names the boundary the panel guards rather than
              repeating "gate" from the title beside it. */}
          <span className="page-kicker">Research to execution</span>
          <h2>Promotion gate</h2>
        </div>
        <span
          className="promotion-score"
          style={{
            color: gate.eligible ? "var(--success-text)" : "var(--critical-text)",
          }}
        >
          <span aria-hidden>{gate.eligible ? "✓" : "✕"}</span>{" "}
          <NumberTicker value={gate.passed} />/{gate.total} cleared
        </span>
      </div>

      {/* The score above counts what cleared and each row states its own
          measurement, so what is left to say is that the count is conjunctive. */}
      <p className="sub">Every row is a veto.</p>

      {/* Keyed by data identity: a new result remounts the list and replays
          the assembly; anything else — hover, resize, parent re-render —
          leaves the settled rows alone. */}
      <ul className="promotion-list" key={dataHash ?? "run"} style={{ "--stagger-step": "70ms" } as CSSProperties}>
        {gate.checks.map((check, index) => (
          <li
            key={check.id}
            className={`stagger-reveal ${check.passed ? "is-pass" : "is-fail"}`}
            style={{ "--stagger-i": index } as CSSProperties}
          >
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
            {symbol}, {strategyLabel} {fast}/{slow}
          </strong>
          <small>
            {blocked
              ? blockedReason ?? "Promotion is temporarily unavailable."
              : gate.eligible
              ? `Carries a modelled ${fmt(slippageBps, 0)} bps slippage budget into the execution probe.`
              : blockedBy}
          </small>
        </div>
        <button
          className={`primary-action${pulse ? " promotion-pulse" : ""}`}
          onClick={onHandOff}
          onAnimationEnd={() => setPulse(false)}
          disabled={!gate.eligible || blocked}
          title={
            blocked
              ? blockedReason ?? "Promotion is temporarily unavailable"
              : gate.eligible
              ? "Open the Execution tab with this instrument in context"
              : `${failed} of ${gate.total} gates still failing`
          }
        >
          Promote to execution desk
        </button>
      </div>

      {/* A paragraph stood here and said the boundary out loud: promotion
          reaches the paper-pricing surface only, while order submission,
          position sizing and the kill switch stay behind the authenticated
          risk gateway. The desk asked for the sentence to go, not the
          boundary — so the boundary now lives somewhere a copy edit cannot
          reach it. tests/promotion-boundary.test.ts walks this component's
          whole import closure and fails if any module in it gains a fetch, an
          /api/gateway path or a risk-control import, and it pins the hand-off
          at the call site to staging plus navigation. Read that file before
          widening onHandOff: the prop is a bare callback, so the panel is only
          as inert as what the page hands it. */}
    </div>
  );
}
