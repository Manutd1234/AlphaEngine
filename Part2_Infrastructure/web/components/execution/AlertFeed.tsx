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
              ? "Generated in the risk monitor's shape, from a seed rather than a desk."
              : "Everything the gateway decided unasked, the stream the Telegram companion pushes."}
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
        // A real table since 2026-08-23, on a reader's request: the grid list
        // it replaces had no frame, no header and no column rules, so five
        // facts per row read as a ragged line. `.table-wrap` is focusable so a
        // keyboard reader can reach the sideways scroll on a narrow screen.
        <div className="table-wrap" tabIndex={0}>
          <table className="cockpit-alert-list">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Severity</th>
                <th scope="col">Event</th>
                <th scope="col">Detail</th>
                <th scope="col">Actor</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((event, index) => (
                <tr key={`${event.ts}-${event.event}-${index}`} className={`mount-fade is-${tone(event.severity)}`}>
                  <td className="cockpit-alert-list__time">{time(event.ts)}</td>
                  <td><span className={`pill pill--${tone(event.severity)}`}>{event.severity}</span></td>
                  <td className="cockpit-alert-list__event">
                    <strong>{event.event.replace(/_/g, " ")}</strong>
                    {event.symbol ? <span className="muted">, {event.symbol}</span> : null}
                  </td>
                  <td className="cockpit-alert-list__detail">
                    {event.detail ? event.detail : <span aria-hidden>—</span>}
                  </td>
                  {/* "system" was a value this component invented. `actor` is
                      nullable all the way from the gateway's row (parse.ts
                      keeps it null), and this file's own opening note is that
                      "who halted this" has a different answer for a human and
                      for the circuit breaker — so printing "system" over a
                      null answered that question with a guess, and named the
                      automation, which is the reading that changes what a
                      trader does next. Rejected: a bare dash, which every
                      other column on the desk uses for an absent measurement;
                      the actor is one word and the space is already there, so
                      the row can say why. */}
                  <td className="cockpit-alert-list__actor">
                    {event.actor ?? "actor not recorded"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
