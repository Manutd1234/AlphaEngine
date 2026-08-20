"use client";

/**
 * The gateway's answer, both ways round.
 *
 * The point of the order ticket is not that it sends orders — it is that it
 * renders the whole check vector for an acceptance AND a refusal. A panel that
 * says only "rejected" teaches a trader nothing; one that names the gate that
 * fired, with the number that tripped it, turns a refusal into information.
 * This is that panel, split out of `OrderTicket` when the file passed the
 * length ceiling.
 *
 * Nothing is inferred here. A missing latency prints nothing rather than a
 * zero, an absent fill is simply absent, and a LIMIT fill says which side of
 * the spread it crossed rather than leaving the reader to assume.
 */

import { type CSSProperties } from "react";

import NumberTicker from "@/components/common/NumberTicker";
import { fmt, formatDuration, usd } from "@/lib/format";
import type { Decision } from "@/components/execution/ticket-model";

interface OrderVerdictProps {
  /** Every decision from the last submit — a burst preset produces twelve. */
  decisions: Decision[];
  /** The animation key: bumped per submit, so settled rows do not replay. */
  sequence: number;
}

export default function OrderVerdict({ decisions, sequence }: OrderVerdictProps) {
  const latest = decisions[decisions.length - 1];
  const burstAccepted = decisions.filter((decision) => decision.accepted).length;
  // Nothing to answer for: the ticket mounts this only once a submit has
  // returned, and an empty list is not a rejection.
  if (!latest) return null;

  return (
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
           gate vector never makes a reader wait on the tail. */
        <ol className="cockpit-checks" key={sequence}>
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
  );
}
