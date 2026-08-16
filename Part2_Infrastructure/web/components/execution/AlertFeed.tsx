"use client";

/**
 * What the system decided on its own.
 *
 * Kill-switch trips, drawdown warnings, feed outages and recoveries — the
 * events that arrive without anyone asking. Until now these were pushed to
 * Telegram and nowhere else, so a trader with the workspace open and their
 * phone face-down had no way to know the desk had halted itself.
 *
 * Severity leads each row because that is what decides whether it is read now
 * or later, and the actor is always shown: "who halted this" has a different
 * answer for a human and for the circuit breaker, and the two demand different
 * responses.
 */

import { useMemo, useState } from "react";

import type { RiskEventRow } from "@/lib/blotter";

interface AlertFeedProps {
  events: RiskEventRow[];
  /** Where the events came from. */
  source?: "live" | "sandbox" | "unavailable";
}

const SEVERITY_RANK: Record<string, number> = { critical: 3, error: 3, warning: 2, warn: 2, info: 1 };

function tone(severity: string): string {
  const rank = SEVERITY_RANK[severity.toLowerCase()] ?? 1;
  return rank >= 3 ? "stop" : rank === 2 ? "warn" : "info";
}

function time(ts: string): string {
  const parsed = Date.parse(ts.endsWith("Z") ? ts : `${ts}Z`);
  return Number.isNaN(parsed)
    ? ts.slice(11, 19)
    : new Date(parsed).toLocaleTimeString("en-GB", { hour12: false });
}

export default function AlertFeed({ events, source = "live" }: AlertFeedProps) {
  const [importantOnly, setImportantOnly] = useState(false);

  const visible = useMemo(
    () => (importantOnly ? events.filter((e) => (SEVERITY_RANK[e.severity.toLowerCase()] ?? 1) >= 2) : events),
    [events, importantOnly],
  );

  const unresolved = events.filter((e) => (SEVERITY_RANK[e.severity.toLowerCase()] ?? 1) >= 3).length;

  return (
    <section className="card cockpit-alerts">
      <header className="section-heading compact">
        <div>
          <h3>Alerts &amp; risk events</h3>
          <p className="muted">
            {source === "sandbox"
              ? "A generated event stream — the shape the risk monitor produces, from a seed rather than a desk."
              : "Everything the gateway decided without being asked — the same stream the Telegram companion pushes."}
          </p>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={importantOnly}
            onChange={(event) => setImportantOnly(event.target.checked)}
          />
          <span>Warnings and above{unresolved ? ` (${unresolved})` : ""}</span>
        </label>
      </header>

      {!visible.length ? (
        <p className="muted">
          {events.length
            ? "Nothing at this severity."
            : source === "unavailable"
              // "A quiet desk is the good case" is only true when a live feed
              // reported zero events. Saying it about an absent feed tells a
              // reviewer the risk monitor is silent when nothing is listening.
              ? "The event stream has no source in this deployment."
              : "No risk events recorded yet — a quiet desk is the good case."}
        </p>
      ) : (
        <ul className="cockpit-alert-list">
          {visible.map((event, index) => (
            <li key={`${event.ts}-${event.event}-${index}`} className={`mount-fade is-${tone(event.severity)}`}>
              <span className="cockpit-alert-list__time">{time(event.ts)}</span>
              <span className={`pill pill--${tone(event.severity)}`}>{event.severity}</span>
              <span className="cockpit-alert-list__event">
                <strong>{event.event.replace(/_/g, " ")}</strong>
                {event.symbol ? <span className="muted"> · {event.symbol}</span> : null}
                {event.detail ? <span className="cockpit-alert-list__detail">{event.detail}</span> : null}
              </span>
              <span className="muted cockpit-alert-list__actor">{event.actor ?? "system"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
