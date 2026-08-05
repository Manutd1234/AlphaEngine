"use client";

/**
 * Operator controls — the only place this surface writes anything.
 *
 * Two things separate these from a row of buttons.
 *
 * **Every control says what it costs.** Purging a cache is not free: the next
 * request for each key goes upstream and spends real quota. Resetting a quota
 * ledger does not give you more calls, it only stops *us* counting — the vendor
 * still believes it served them. Those sentences are rendered next to the
 * buttons, not buried in a tooltip, because the person clicking is usually the
 * person who will be surprised by the bill.
 *
 * **The guard's state is visible before anything is clicked.** On a production
 * deployment without `ALPHAENGINE_OPERATOR_TOKEN` the actions are refused
 * server-side; showing enabled buttons that 503 would be a worse experience than
 * showing disabled ones with the reason attached.
 *
 * The last two controls are client-side only and say so: WebSocket connections
 * belong to this browser tab, and the poll cadence is this console's own.
 */

import { useState } from "react";

import type { ActionResponse, GuardMode, ProviderRow } from "./types";

export interface ActionOptions {
  provider?: string;
  scope?: string;
  ttlMs?: number;
}

/**
 * How long a UI-initiated outage lasts.
 *
 * Well below the server's 15-minute ceiling on purpose. Someone demonstrating
 * failover wants to see the chain move and then move back; being stuck with a
 * degraded data plane for a quarter of an hour because they clicked a button
 * once is a worse experience than the demonstration is worth. The API still
 * accepts anything up to the ceiling.
 */
export const UI_OUTAGE_MS = 120_000;

interface OperatorPanelProps {
  guard: GuardMode;
  tokenEnv: string;
  providers: ProviderRow[] | null;
  symbol: string;
  pollMs: number;
  onPollMsChange: (ms: number) => void;
  socketCount: number;
  onReconnectSockets: () => void;
  busyAction: string | null;
  lastResult: ActionResponse | null;
  token: string;
  onTokenChange: (token: string) => void;
  onAction: (action: string, options?: ActionOptions) => void;
}

/** Cadences the console offers. 0 is a genuine pause, not a very long interval. */
const CADENCES: { label: string; ms: number; note: string }[] = [
  { label: "1s", ms: 1_000, note: "debugging" },
  { label: "5s", ms: 5_000, note: "watching" },
  { label: "30s", ms: 30_000, note: "default" },
  { label: "Paused", ms: 0, note: "no polling" },
];

const PURGE_SCOPES = ["all", "quote", "bars", "news", "fundamentals"] as const;

/** Shared so actions launched from the Services matrix report outside Controls. */
export function OperatorActionResult({ result }: { result: ActionResponse }) {
  return (
    <div
      className={`banner console-action-result ${result.ok ? "context-change" : "error"}`}
      role={result.ok ? "status" : "alert"}
    >
      <span aria-hidden>{result.ok ? "✓" : "✕"}</span>
      <div>
        <strong>{result.summary ?? result.error}</strong>
        {result.caveat && <small className="console-wrap"> {result.caveat}</small>}
        {result.hint && <small className="console-wrap"> {result.hint}</small>}
      </div>
    </div>
  );
}

export default function OperatorPanel({
  guard,
  tokenEnv,
  providers,
  symbol,
  pollMs,
  onPollMsChange,
  socketCount,
  onReconnectSockets,
  busyAction,
  lastResult,
  token,
  onTokenChange,
  onAction,
}: OperatorPanelProps) {
  const [purgeScope, setPurgeScope] = useState<string>("all");
  const [quotaTarget, setQuotaTarget] = useState<string>("");

  const locked = guard === "locked";
  const missingToken = guard === "token" && token.trim() === "";
  const disabled = locked || missingToken || busyAction !== null;
  const metered = (providers ?? []).filter((p) => p.quota !== null);
  const validQuotaTarget = metered.some((provider) => provider.id === quotaTarget)
    ? quotaTarget
    : "";

  return (
    <div className="card console-card console-actions">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Control</span>
          <h2>Operator actions</h2>
        </div>
        <span className="section-note">Per-instance · cost and blast radius shown before action.</span>
      </div>

      {locked && (
        <div className="banner warn" role="status">
          <span aria-hidden>!</span>
          <div>
            <strong>Actions are disabled on this deployment.</strong> Every action spends real
            upstream quota, so a production build refuses them unless <code>{tokenEnv}</code> is set
            on the server. Read-only telemetry above is unaffected.
          </div>
        </div>
      )}

      {guard === "token" && (
        <label className="console-token">
          <span>Operator token</span>
          <input
            type="password"
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
            placeholder={tokenEnv}
            autoComplete="off"
            spellCheck={false}
          />
          <small className="muted">
            Held in memory for this tab only — never written to storage, never logged.
          </small>
        </label>
      )}

      {guard === "open-dev" && (
        <p className="console-note">
          Non-production build: actions are open. Set <code>{tokenEnv}</code> before deploying, or
          they will be refused there.
        </p>
      )}

      {lastResult && <OperatorActionResult result={lastResult} />}

      <div className="operator-group-heading">
        <div>
          <span className="page-kicker">Server mutations</span>
          <strong>Gateway state &amp; routing</strong>
        </div>
        <small>Authenticated in production · affects this function instance</small>
      </div>

      {/* ---- cache ------------------------------------------------------- */}
      <div className="console-action">
        <div className="console-action__head">
          <strong>Purge cached responses</strong>
          <div className="console-action__controls">
            <label className="sr-only" htmlFor="console-purge-scope">Purge scope</label>
            <select
              id="console-purge-scope"
              value={purgeScope}
              onChange={(event) => setPurgeScope(event.target.value)}
            >
              {PURGE_SCOPES.map((scope) => (
                <option key={scope} value={scope}>{scope}</option>
              ))}
              <option value="symbol">symbol: {symbol}</option>
            </select>
            <button
              type="button"
              onClick={() => onAction("purge_cache", {
                scope: purgeScope === "symbol" ? `symbol:${symbol}` : purgeScope,
              })}
              disabled={disabled}
              className="is-disruptive"
            >
              {busyAction === "purge_cache" ? "Purging…" : "Purge"}
            </button>
          </div>
        </div>
        <small className="muted">
          Drops matching entries only. Quota counters and breaker state are a different namespace and
          are left alone — the next request for each purged key goes upstream and spends a real call.
        </small>
      </div>

      {/* ---- routing ----------------------------------------------------- */}
      <div className="console-action">
        <div className="console-action__head">
          <strong>Restore routing</strong>
          <div className="console-action__controls">
            <button
              type="button"
              onClick={() => onAction("reset_breaker", { provider: "all" })}
              disabled={disabled}
              className="is-recovery"
            >
              Close all circuits
            </button>
            <button
              type="button"
              onClick={() => onAction("clear_outage", { provider: "all" })}
              disabled={disabled}
              className="is-recovery"
            >
              Clear simulated outages
            </button>
          </div>
        </div>
        <small className="muted">
          A circuit that is still failing reopens after three more consecutive failures — closing it
          asks the provider again, it does not declare it healthy.
        </small>
      </div>

      {/* ---- configuration ----------------------------------------------- */}
      <div className="console-action">
        <div className="console-action__head">
          <strong>Re-read provider configuration</strong>
          <div className="console-action__controls">
            <button type="button" onClick={() => onAction("reload_providers")} disabled={disabled}>
              {busyAction === "reload_providers" ? "Reloading…" : "Reload"}
            </button>
          </div>
        </div>
        <small className="muted">
          Re-evaluates the environment this process already holds and drops the cached OpenBB
          readiness verdict. It cannot import a changed <code>.env</code> from disk — Next.js reads
          those once at boot, so that still needs a restart or a redeploy.
        </small>
      </div>

      {/* ---- ledger ------------------------------------------------------ */}
      <div className="console-action">
        <div className="console-action__head">
          <strong>Reset a quota ledger</strong>
          <div className="console-action__controls">
            <label className="sr-only" htmlFor="console-quota-target">Provider</label>
            <select
              id="console-quota-target"
              value={validQuotaTarget}
              onChange={(event) => setQuotaTarget(event.target.value)}
            >
              <option value="">choose a provider…</option>
              {metered.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label} ({provider.quota!.used}/{provider.quota!.limit})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onAction("reset_quota", { provider: validQuotaTarget })}
              disabled={disabled || !validQuotaTarget}
              className="is-disruptive"
            >
              Reset counter
            </button>
          </div>
        </div>
        <small className="console-warn">
          This clears <em>our</em> count, not the vendor&apos;s meter. The provider still believes it
          served those calls; further requests may be rejected upstream or billed. Useful after an
          instance swap left the ledger pessimistic — not as a way to get more calls.
        </small>
      </div>

      {/* ---- telemetry --------------------------------------------------- */}
      <div className="console-action">
        <div className="console-action__head">
          <strong>Clear telemetry buffers</strong>
          <div className="console-action__controls">
            <button
              type="button"
              onClick={() => onAction("clear_telemetry")}
              disabled={disabled}
              className="is-disruptive"
            >
              Clear
            </button>
          </div>
        </div>
        <small className="muted">
          Empties the server event ring, latency samples and cache counters. Circuit state and
          simulated outages survive — those are behaviour, not observation.
        </small>
      </div>

      <div className="operator-group-heading is-session">
        <div>
          <span className="page-kicker">Session controls</span>
          <strong>This browser only</strong>
        </div>
        <small>No server state is mutated</small>
      </div>

      {/* ---- browser-side ------------------------------------------------ */}
      <div className="console-action console-action--client">
        <div className="console-action__head">
          <strong>Reconnect WebSockets</strong>
          <div className="console-action__controls">
            <button type="button" onClick={onReconnectSockets} disabled={socketCount === 0}>
              Cycle {socketCount} {socketCount === 1 ? "socket" : "sockets"}
            </button>
          </div>
        </div>
        <small className="muted">
          Browser-side. Drops and re-handshakes every exchange socket this tab owns, resetting the
          backoff and the sequence guard rather than waiting one out.
          {socketCount === 0 && " No socket is open — the wire tap opens them when it is on screen."}
        </small>
      </div>

      <div className="console-action console-action--client">
        <div className="console-action__head">
          <strong>Health snapshot cadence</strong>
          <div className="seg console-seg" role="group" aria-label="System health poll cadence">
            {CADENCES.map((cadence) => (
              <button
                key={cadence.label}
                type="button"
                aria-pressed={pollMs === cadence.ms}
                onClick={() => onPollMsChange(cadence.ms)}
              >
                {cadence.label}
              </button>
            ))}
          </div>
        </div>
        <small className="muted">
          Browser-side. Unattended ticks are sent at <code>background</code> priority — fenced out of
          each provider&apos;s interactive reserve — so a 1s debugging loop cannot spend the budget a
          person needs later. Only an explicit <em>Refresh now</em> requests interactive priority.
        </small>
      </div>

    </div>
  );
}
