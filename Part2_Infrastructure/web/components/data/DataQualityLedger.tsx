"use client";

/**
 * The durable data-quality ledger, as the Data tab shows it.
 *
 * Every web instance's contract findings, merged on the gateway and kept in
 * SQLite on its data volume — the ledger this deployment used to name as a
 * production gap. Escalations lead: an operator reading this card wants to
 * know first whether anything was escalated, to which channel, and whether it
 * has since cleared. Then the per-provider table (a fail rate is a dash until
 * something was evaluated — never 0), then the most recent findings, with a
 * way to load older ones through the gateway.
 *
 * When the gateway did not return a ledger, the card says so and says what
 * that absence does not prove: this instance's own window is what the other
 * panels then show, and it is not the fleet's history.
 */

import { useCallback, useState } from "react";

import type { DataQualityEscalation, DataQualityFinding, GuardMode, ValidationTelemetry } from "@/components/systems/types";
import { operatorHeaders } from "@/lib/risk-control";
import { GATEWAY_DEADLINE_MS, probeGateway } from "@/lib/use-gateway-connection";

interface DataQualityLedgerProps {
  validation: ValidationTelemetry | null | undefined;
  /** False while the console has no health snapshot at all. */
  healthLoaded: boolean;
  /** How this deployment guards writes, so a refusal can be named before it is earned. */
  guard: GuardMode;
  /**
   * Whether an action fired right now would carry a usable credential.
   *
   * This card gates on this flag and not on `operatorToken`, for the reason
   * every other gated control does: on an open demo deployment the gateway
   * accepts the acknowledgement with no header at all, and a Take button
   * withheld there would be refusing an action that genuinely works.
   */
  operatorReady: boolean;
  /**
   * The operator credential, when this tab has one. It rides on the ack when
   * set; `operatorReady` — not this — decides whether Take is offered.
   */
  operatorToken?: string;
}

export const DATA_QUALITY_LEDGER_HEADING = "Quality ledger & escalations";

const RULE_LABEL: Record<DataQualityEscalation["rule"], string> = {
  fatal_burst: "fatal burst",
  fail_rate: "fail rate",
};

const SEVERITY_MARK: Record<DataQualityFinding["severity"], string> = {
  fatal: "✕",
  warn: "▲",
  drift: "≠",
  clean: "●",
};

function utc(iso: string | null): string {
  if (!iso) return "—";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function pct(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export default function DataQualityLedger({
  validation, healthLoaded, guard, operatorReady, operatorToken,
}: DataQualityLedgerProps) {
  const ledger = validation?.scope === "gateway-ledger" ? validation.ledger ?? null : null;
  const [older, setOlder] = useState<DataQualityFinding[] | null>(null);
  const [olderTotal, setOlderTotal] = useState<number | null>(null);
  const [olderState, setOlderState] = useState<"idle" | "loading" | "error">("idle");
  const [olderError, setOlderError] = useState<string | null>(null);
  /** Escalation ids taken in this tab, so the row updates before the next poll. */
  const [taken, setTaken] = useState<Record<number, string>>({});
  const [acking, setAcking] = useState<number | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);

  const acknowledge = useCallback(async (id: number) => {
    setAcking(id);
    setAckError(null);
    // `probeGateway` is GET-only — it coalesces by URL, and collapsing two
    // writes would drop one — so the deadline it would have carried is built
    // here. An AbortController rather than AbortSignal.timeout, because
    // "timed out" and "the component unmounted" raise the same DOMException
    // and only one of them is worth putting in front of a reader.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), GATEWAY_DEADLINE_MS);
    try {
      const response = await fetch(`/api/gateway/data-quality/escalations/${id}/ack`, {
        method: "POST",
        headers: operatorHeaders(operatorToken),
        body: "{}",
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setAckError(typeof body.error === "string" ? body.error : `The acknowledgement was refused (${response.status}).`);
        return;
      }
      // `taken: false` is not a failure. "Already resolved" and "no such
      // escalation" are both "there is nothing to take", and the gateway says
      // so rather than erroring — so the panel does too.
      setTaken((prev) => ({
        ...prev,
        [id]: body.taken ? new Date().toISOString() : "",
      }));
      if (!body.taken) setAckError("Nothing was open to take — it has already resolved.");
    } catch {
      setAckError("The acknowledgement could not be sent.");
    } finally {
      clearTimeout(deadline);
      setAcking(null);
    }
  }, [operatorToken]);

  const loadOlder = useCallback(async () => {
    setOlderState("loading");
    setOlderError(null);
    // Through probeGateway, so a gateway that accepts and never answers cannot
    // hold this button in "Loading…" forever — the same deadline every other
    // gateway read carries.
    const outcome = await probeGateway<{ findings: DataQualityFinding[]; total: number }>(
      "/api/gateway/data/quality?limit=100",
    );
    if (!outcome.ok) {
      setOlderState("error");
      setOlderError(outcome.failure.timedOut
        ? "The gateway did not answer within the deadline; the ledger is unreachable."
        : outcome.failure.message);
      return;
    }
    setOlder(outcome.payload.findings);
    setOlderTotal(outcome.payload.total);
    setOlderState("idle");
  }, []);

  const open = ledger?.escalations.filter((e) => e.resolved_at === null) ?? [];
  const resolved = ledger?.escalations.filter((e) => e.resolved_at !== null) ?? [];
  const providers = ledger
    ? Object.entries(validation!.byProvider).sort(([a], [b]) => a.localeCompare(b))
    : [];

  // The gate every other write surface on this desk already uses — one
  // `locked` flag, one sentence naming the reason, and the control left on
  // screen wearing it. Until now the row offered a live-looking Take to a
  // reader with no credential and let the route refuse it after the click,
  // which spends a click to learn a fact the tab already knew. Disabling it
  // rather than dropping it is the other half: a control that vanishes takes
  // the knowledge that the row is actionable with it.
  const locked = guard === "locked" || !operatorReady;
  const lockNote = guard === "locked"
    ? "Take is disabled: operator actions are switched off on this deployment; /ack from Telegram still works."
    : !operatorReady
      ? "Take is disabled: it needs the operator credential. Enter the operator token in Reliability → Remediation, or /ack from Telegram."
      : undefined;
  /** Rows a Take would act on, so the note appears only where a button does. */
  const takeable = ledger?.escalations.filter(
    (e) => !e.resolved_at && !e.acknowledged_at && !taken[e.id],
  ) ?? [];

  return (
    <details className="card console-card data-quality-ledger" aria-labelledby="data-quality-ledger-heading">
      <summary>
        <span className="data-quality-ledger__summary">
          <span>
            <span className="page-kicker">Data quality</span>
            {/* "&", not "and". Every other card title on this tab joins its two
                halves with an ampersand — "Providers & failover depth", "Payload
                verdict & findings", "Feed throughput & freshness", "Exact payload
                & instance sample", "Requests, tickets & bugs" — and so does the
                rail that routes to them ("Feeds & Contracts", "Lineage &
                Payloads", "Providers & Capacity"). This heading and Replay &
                backfill's were the two spelling it out, which put two title
                styles in one scroll. Prose keeps "and": a sentence is not a
                title, which is why the disabled-control notes below are
                untouched. */}
            <span id="data-quality-ledger-heading" className="data-quality-ledger__title" role="heading" aria-level={2}>
              {DATA_QUALITY_LEDGER_HEADING}
            </span>
          </span>
          <span className="section-note">
            {ledger
              ? `gateway SQLite, ${ledger.retentionDays}-day retention; ${ledger.instances} ${ledger.instances === 1 ? "instance" : "instances"} reporting`
              : healthLoaded
                ? "gateway ledger not returned"
                : "waiting for health snapshot"}
          </span>
        </span>
      </summary>

      <div className="data-quality-ledger__body" role="region" aria-labelledby="data-quality-ledger-heading">
        {!ledger && (
          // The absence, and what it does not prove. The other panels fall back
          // to this instance's own window; that is not the fleet's history.
          <p className="sub">
            {healthLoaded
              ? "The gateway did not return its quality ledger, so the counts here are this instance's own window and say nothing about other instances or earlier hours."
              : "The ledger arrives with the first health snapshot."}
          </p>
        )}

        {ledger && (
          <>
          {/* Two tiles, not four. Payloads evaluated and the fatal/warn/drift
              split stand in the page head of this same section, read off this
              same `validation` object (`data-console-metrics.tsx`, the
              `quality` branch), so the card was restating its own header — the
              defect the work board's deck had already cut. What stays is
              the window every count in this card is bounded by, and the open
              count, which the head prints only when it is above zero. */}
          <dl className="console-facts console-facts--tight" aria-label="Ledger totals">
            <div>
              <dt>Window</dt>
              <dd>{ledger.windowMinutes >= 1440 ? `${Math.round(ledger.windowMinutes / 60)} h` : `${ledger.windowMinutes} min`}</dd>
            </div>
            <div>
              <dt>Escalations open</dt>
              <dd>{open.length}</dd>
            </div>
          </dl>

          <p className="console-subhead">Escalations</p>
          {/* The rule definition remains adjacent to the vocabulary it defines.
              RULE_LABEL prints "fatal burst" and "fail rate" verbatim on every
              row below, beside Open / Taken / Cleared, so every escalation
              stays readable. The lock note beneath stays on screen: it is the
              reason a visible control is dimmed, which is never a fold. */}
          <div className="data-quality-ledger__context">
            <strong>What opens one of these, and what closes it?</strong>
            <p className="sub"> — a fatal burst or a fail rate over threshold, per provider; auto-resolved when it clears.</p>
          </div>
          {lockNote && takeable.length > 0 && (
            // On screen, not only in the disabled button's tooltip: a dimmed
            // control with no visible reason is the same dead end as a missing
            // one, and a tooltip is not reachable by touch.
            <p className="console-note">{lockNote}</p>
          )}
          {ledger.escalations.length === 0 ? (
            <p className="sub">
              No escalation in the last {ledger.windowMinutes >= 1440 ? `${Math.round(ledger.windowMinutes / 60)} hours` : `${ledger.windowMinutes} minutes`};{" "}
              {validation!.evaluated} {validation!.evaluated === 1 ? "payload" : "payloads"} evaluated. An empty list means the rules did not fire, not that every payload was clean.
            </p>
          ) : (
            <ul className="console-skips" aria-label="Escalations">
              {[...open, ...resolved].map((e) => (
                <li key={e.id}>
                  <strong>
                    <span aria-hidden>{e.resolved_at ? "✓" : (e.acknowledged_at ?? taken[e.id]) ? "●" : "▲"}</span>{" "}
                    {e.resolved_at ? "Cleared" : (e.acknowledged_at ?? taken[e.id]) ? "Taken" : "Open"}
                    : {RULE_LABEL[e.rule]}, {e.provider}
                    {" "}<span className="muted">#{e.id}</span>
                    {!e.resolved_at && !e.acknowledged_at && !taken[e.id] && (
                      <button
                        type="button"
                        className="text-action"
                        onClick={() => void acknowledge(e.id)}
                        disabled={locked || acking === e.id}
                        title={lockNote}
                      >
                        {acking === e.id ? "Taking…" : "Take"}
                      </button>
                    )}
                  </strong>
                  <span className="console-skip__reason">
                    {e.channel === "telegram"
                      ? `escalated to Telegram at ${utc(e.notified_at)}`
                      : e.channel === "log"
                        ? `escalated to the gateway log at ${utc(e.notified_at)} (Telegram not configured)`
                        : "delivery pending"}
                  </span>
                  <small className="muted console-wrap">
                    {e.detail}; opened {utc(e.opened_at)}{e.resolved_at ? `; cleared ${utc(e.resolved_at)}` : ""}.
                    {/* A Telegram id names a person; `web:token` names the
                        credential that made the call and nothing more. Said
                        differently, because they are different facts. The
                        credential branch reads "names no person" rather than
                        "does not name a person": shorter, same negation, and
                        the negation is the whole content of the clause. */}
                    {e.acknowledged_at && e.acknowledged_by?.startsWith("telegram:")
                      && ` Taken by ${e.acknowledged_by.slice("telegram:".length)} at ${utc(e.acknowledged_at)}.`}
                    {e.acknowledged_at && !e.acknowledged_by?.startsWith("telegram:")
                      && ` Taken at ${utc(e.acknowledged_at)} by an operator credential, which names no person.`}
                    {!e.acknowledged_at && taken[e.id]
                      && ` Taken from this desk just now; the ledger catches up next poll.`}
                  </small>
                </li>
              ))}
            </ul>
          )}
          {ackError && <p className="console-skip__reason">{ackError}</p>}

          <p className="console-subhead">
            By provider
            <small className="muted"> — a fail rate is a dash until something was evaluated.</small>
          </p>
          {providers.length === 0 ? (
            <p className="sub">No provider has a finding in the window.</p>
          ) : (
            <div className="table-wrap table-wrap--clamped" tabIndex={0}>
              <table>
                <caption className="sr-only">Contract findings by provider in the ledger window.</caption>
                <thead>
                  <tr>
                    <th scope="col">Provider</th>
                    <th scope="col">Evaluated</th>
                    <th scope="col">Passed</th>
                    <th scope="col">Fail rate</th>
                    <th scope="col">Fatal</th>
                    <th scope="col">Warn</th>
                    <th scope="col">Drift</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map(([provider, counts]) => (
                    <tr key={provider}>
                      <td>{provider}</td>
                      <td className="num">{counts.evaluated}</td>
                      <td className="num">{counts.passed}</td>
                      <td className="num">{pct(ledger.byProviderFailRate[provider] ?? null)}</td>
                      <td className="num">{counts.fatal}</td>
                      <td className="num">{counts.warn}</td>
                      <td className="num">{counts.drift}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="console-subhead">Recent findings</p>
          {/* Provenance and ordering remain beside the rows they qualify. Every row below
              prints its own observation time and its own source — the instance
              id, or the replay job — so the list stays readable. The empty
              state beneath, the fail-rate dash note above and the lock note all
              remain inside the ledger's single disclosure owner. */}
          <div className="data-quality-ledger__context">
            <strong>The order, and who writes here</strong>
            <p className="sub"> — newest first; every instance and every replay job writes here.</p>
          </div>
          {(older ?? ledger.recent).length === 0 ? (
            <p className="sub">No finding recorded in the window.</p>
          ) : (
            <ul className="console-skips" aria-label="Recent findings">
              {(older ?? ledger.recent).map((f) => (
                <li key={f.id}>
                  <strong>
                    <span aria-hidden>{SEVERITY_MARK[f.severity]}</span> {f.severity}: {f.capability}, {f.provider}
                    {f.symbol ? `, ${f.symbol}` : ""}
                  </strong>
                  <span className="console-skip__reason">{utc(f.observed_at)}, {f.source === "web" ? `instance ${f.instance}` : f.source}</span>
                  {f.checks.length > 0 && (
                    <small className="muted console-wrap">{f.checks.join(", ")}</small>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="console-inspector__controls" style={{ marginTop: 8, marginBottom: 0 }}>
            <button type="button" onClick={() => void loadOlder()} disabled={olderState === "loading"}>
              {olderState === "loading" ? "Loading…" : older ? "Reload older findings" : "Load older findings"}
            </button>
            {olderTotal !== null && (
              <span className="muted">{olderTotal} in the ledger; showing {older?.length ?? 0}</span>
            )}
          </div>
          {olderState === "error" && (
            <div className="banner error" role="alert">
              <span aria-hidden>✕</span>
              <div>{olderError}</div>
            </div>
          )}
          </>
        )}
      </div>
    </details>
  );
}
