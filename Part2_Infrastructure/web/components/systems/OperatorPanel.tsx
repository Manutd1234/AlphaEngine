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
 * showing disabled ones with the reason attached. That block is now
 * `OperatorGuard`, rendered here — one authorisation state for the whole
 * surface, as against a cost, which is a fact about a single control and
 * therefore stays welded to it.
 *
 * The last two controls are client-side only, and the session group heading
 * says so once for both: WebSocket connections belong to this browser tab, and
 * the poll cadence is this console's own.
 */

import { useEffect, useRef, useState } from "react";

import DonutChart, { type DonutSlice } from "@/components/common/DonutChart";
import OperatorGuard from "@/components/systems/OperatorGuard";
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
  /**
   * What each server control would actually touch, so a row can say it. A
   * control list with no figures on it is five sentences and five buttons —
   * the operator still has to go elsewhere to learn whether pressing one has
   * anything to act on. Optional: an older gateway simply omits the figure.
   */
  counters?: {
    cacheEntries: number | null;
    stateEntries: number | null;
    eventsRetained: number | null;
    eventsCapacity: number | null;
  };
  onReconnectSockets: () => void;
  busyAction: string | null;
  lastResult: ActionResponse | null;
  token: string;
  onTokenChange: (token: string) => void;
  /** Open mode with a server token set — typing a credential can elevate the tab. */
  tokenOverrideAvailable?: boolean;
  /** Server-checked state of the entered token; drives the badge, not the gate. */
  tokenStatus?: "none" | "checking" | "valid" | "rejected";
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

interface PendingConfirmation {
  action: string;
  options?: ActionOptions;
  title: string;
  confirmLabel: string;
  target: string;
  effect: string;
}

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
  counters,
  onReconnectSockets,
  busyAction,
  lastResult,
  token,
  onTokenChange,
  tokenOverrideAvailable = false,
  tokenStatus = "none",
  onAction,
}: OperatorPanelProps) {
  const [purgeScope, setPurgeScope] = useState<string>("all");
  const [quotaTarget, setQuotaTarget] = useState<string>("");
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const confirmButton = useRef<HTMLButtonElement | null>(null);
  const confirmationTrigger = useRef<HTMLButtonElement | null>(null);

  const locked = guard === "locked";
  const missingToken = guard === "token" && token.trim() === "";
  const disabled = locked || missingToken || busyAction !== null || pending !== null;
  const metered = (providers ?? []).filter((p) => p.quota !== null);
  const validQuotaTarget = metered.some((provider) => provider.id === quotaTarget)
    ? quotaTarget
    : "";

  useEffect(() => {
    if (pending) confirmButton.current?.focus();
  }, [pending]);

  const closeConfirmation = () => {
    setPending(null);
    window.requestAnimationFrame(() => confirmationTrigger.current?.focus());
  };

  const requestConfirmation = (
    trigger: HTMLButtonElement,
    confirmation: PendingConfirmation,
  ) => {
    confirmationTrigger.current = trigger;
    setPending(confirmation);
  };

  const confirmPending = () => {
    if (!pending || locked || missingToken || busyAction !== null) return;
    const { action, options } = pending;
    setPending(null);
    onAction(action, options);
  };

  /**
   * What is actually remediable right now.
   *
   * Every figure below is read from the same provider snapshot the actions
   * operate on, so the summary cannot describe a system the buttons will not
   * find.
   *
   * This comment used to end "there is deliberately no history chart here: this
   * instance keeps no durable remediation ledger, and a 'resolutions over time'
   * line would have to invent its own past." The reasoning still holds; the
   * inputs changed. `resetBreaker` now emits the closing transition it used to
   * swallow, so open→closed pairs are observable and `RemediationLedger` — now
   * the History pane rather than the card underneath this one — pairs them: a
   * real ledger, but a bounded, per-instance, non-durable one:
   * 600 events shared with dispatch and cache traffic, reset by redeploy and by
   * Clear telemetry.
   *
   * That supports a count, a split between automatic and operator closures, and
   * a distribution of how long circuits stayed open. It still does NOT support
   * a trend, and the ledger renders that refusal rather than caveating a line:
   * the longest outages lose their opening line to eviction first, so the
   * surviving sample is biased short and a trend through it would slope toward
   * a recovery time nobody achieved.
   */
  const rows = providers ?? [];
  const openCircuits = rows.filter((row) => row.circuitOpen).length;
  const simulated = rows.filter((row) => row.simulatedOutage).length;
  const unconfigured = rows.filter((row) => !row.configured).length;
  const quotaLedgers = rows.filter((row) => row.quota !== null).length;
  /** A dash, never a zero: an absent counter and an empty one are different. */
  const figure = (value: number | null | undefined, suffix: string) =>
    value == null ? null : `${value.toLocaleString()} ${suffix}`;
  const healthy = rows.filter((row) => row.configured && !row.circuitOpen && !row.simulatedOutage).length;
  const scopeSlices: DonutSlice[] = [
    { label: "routing normally", value: healthy, colour: "var(--status-good)" },
    { label: "circuit open", value: openCircuits, colour: "var(--status-critical)" },
    { label: "simulated outage", value: simulated, colour: "var(--status-warning)" },
    { label: "not configured", value: unconfigured, colour: "var(--axis)" },
  ];

  return (
    <div className="card console-card console-actions">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Control</span>
          <h2>Operator actions</h2>
        </div>
        <span className="section-note">Routing instance only · preview required for disruptive actions.</span>
      </div>

      <section className="remediation-scope" aria-label="What these controls would act on">
        <DonutChart
          slices={scopeSlices}
          centreValue={rows.length ? String(rows.length) : undefined}
          centreLabel="providers"
          ariaLabel="Provider routing states in this instance, which is the scope these controls act on."
          emptyNote="No provider snapshot yet — the controls have nothing to describe."
        />
        <dl className="remediation-scope__facts">
          <div>
            <dt>Open circuits</dt>
            <dd className="num">{openCircuits}</dd>
            <small>{openCircuits ? "closing one asks the provider again" : "nothing held open"}</small>
          </div>
          <div>
            <dt>Simulated outages</dt>
            <dd className="num">{simulated}</dd>
            <small>{simulated ? "operator-caused, cleared on demand" : "none active"}</small>
          </div>
          <div>
            <dt>Not configured</dt>
            <dd className="num">{unconfigured}</dd>
            <small>{unconfigured ? "a missing key, not a failure" : "every provider has a key"}</small>
          </div>
        </dl>
      </section>

      <div className="banner warn console-control-scope" role="note">
        <span aria-hidden>!</span>
        <div>
          <strong>These are not authoritative fleet or trading controls.</strong> Server mutations
          affect only the Next.js provider-routing instance that receives the request. Another
          instance may retain different caches, ledgers and circuits, and these actions do not halt
          or resume the Python trading gateway.
        </div>
      </div>

      {/* Authorisation, which is one state for the whole surface, rather than a
          per-control fact. Extracted for that reason and no other — every cost
          sentence below stayed beside the button that spends it. */}
      <OperatorGuard
        guard={guard}
        tokenEnv={tokenEnv}
        token={token}
        onTokenChange={onTokenChange}
        tokenOverrideAvailable={tokenOverrideAvailable}
        tokenStatus={tokenStatus}
      />

      {lastResult && <OperatorActionResult result={lastResult} />}

      <div className="operator-group-heading">
        <div>
          <span className="page-kicker">Server mutations</span>
          <strong>Provider routing controls</strong>
        </div>
        <small>Authenticated in production · provider-routing scope</small>
      </div>

      {pending ? (
        <section
          className="operator-confirmation"
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="operator-confirmation-title"
          aria-describedby="operator-confirmation-effect"
          onKeyDown={(event) => {
            if (event.key === "Escape") closeConfirmation();
          }}
        >
          <div className="operator-confirmation__heading">
            <div>
              <span className="page-kicker">Confirmation preview</span>
              <h3 id="operator-confirmation-title">{pending.title}</h3>
            </div>
            <span className="operator-confirmation__badge">Disruptive</span>
          </div>
          <dl className="operator-confirmation__facts">
            <div><dt>Target</dt><dd><code>{pending.target}</code></dd></div>
            <div><dt>Control plane</dt><dd>Next.js provider routing</dd></div>
            <div><dt>Blast radius</dt><dd>One function instance; other instances may retain different state</dd></div>
          </dl>
          <p id="operator-confirmation-effect">{pending.effect}</p>
          <div className="operator-confirmation__actions">
            <button type="button" onClick={closeConfirmation}>Cancel</button>
            <button
              ref={confirmButton}
              type="button"
              className="is-disruptive"
              onClick={confirmPending}
              disabled={locked || missingToken || busyAction !== null}
            >
              {pending.confirmLabel}
            </button>
          </div>
          <small>Press Escape or choose Cancel to leave state unchanged.</small>
        </section>
      ) : null}

      {/* No server band here: `Provider routing controls` above this panel
          already names the group and its scope, and a second header saying
          the same thing in different words is the clutter this pass is
          removing. The session band below stays — it marks a change of blast
          radius, not a repeat. */}

      {/* ---- cache ------------------------------------------------------- */}
      <div className="console-action">
        <div className="console-action__head">
          <strong>Purge cached responses</strong>
          <span className="console-action__figure num">{figure(counters?.cacheEntries, "cached") ?? "—"}{counters?.stateEntries != null ? ` · ${counters.stateEntries} state` : ""}</span>
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
              onClick={(event) => {
                const scope = purgeScope === "symbol" ? `symbol:${symbol}` : purgeScope;
                requestConfirmation(event.currentTarget, {
                  action: "purge_cache",
                  options: { scope },
                  title: "Purge cached responses?",
                  confirmLabel: "Confirm purge",
                  target: scope,
                  effect: "Matching cached responses will be dropped. The next request for every removed key goes upstream and spends real provider quota.",
                });
              }}
              disabled={disabled}
              className="is-disruptive"
            >
              {busyAction === "purge_cache" ? "Purging…" : "Purge"}
            </button>
          </div>
        </div>
        {/* The COST stays inline. This file's own rule: costs are rendered next
            to the buttons, not buried, because the person clicking is usually
            the person who will be surprised by the bill. Only the scope — what
            a control does not touch — collapses into the disclosure below. */}
        <small className="muted">
          The next request for each purged key goes upstream and spends a real call.
        </small>
      </div>

      {/* ---- routing ----------------------------------------------------- */}
      <div className="console-action">
        <div className="console-action__head">
          <strong>Restore routing</strong>
          <span className="console-action__figure num">{`${openCircuits} open · ${simulated} simulated`}</span>
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
          Closing a circuit asks the provider again; it does not declare it healthy.
        </small>
      </div>

      {/* ---- configuration ----------------------------------------------- */}
      <div className="console-action">
        <div className="console-action__head">
          <strong>Re-read provider configuration</strong>
          <span className="console-action__figure num">{`${rows.length} providers`}</span>
          <div className="console-action__controls">
            <button type="button" onClick={() => onAction("reload_providers")} disabled={disabled}>
              {busyAction === "reload_providers" ? "Reloading…" : "Reload"}
            </button>
          </div>
        </div>
        {/* Only the caveat stays inline: acting on the belief that Reload
            applied a new key is how a dead provider gets declared configured.
            What the reload actually re-reads is scope, and scope lives in the
            disclosure below. */}
        <small className="muted">
          Cannot import a changed <code>.env</code> from disk — new keys still need a restart or a
          redeploy.
        </small>
      </div>

      {/* ---- ledger ------------------------------------------------------ */}
      <div className="console-action">
        <div className="console-action__head">
          <strong>Reset a quota ledger</strong>
          <span className="console-action__figure num">{`${quotaLedgers} ledgers`}</span>
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
              onClick={(event) => {
                const provider = metered.find((candidate) => candidate.id === validQuotaTarget);
                requestConfirmation(event.currentTarget, {
                  action: "reset_quota",
                  options: { provider: validQuotaTarget },
                  title: "Reset the local quota ledger?",
                  confirmLabel: "Confirm reset",
                  target: provider ? `${provider.label} (${provider.id})` : validQuotaTarget,
                  effect: "Only this instance's accounting is reset. The vendor's meter and billing remain unchanged, so subsequent calls can still be rejected or billed upstream.",
                });
              }}
              disabled={disabled || !validQuotaTarget}
              className="is-disruptive"
            >
              Reset counter
            </button>
          </div>
        </div>
        {/* Cost inline, use-case in the disclosure — the panel's own rule.
            The "useful after an instance swap" sentence lives in the "What
            each server control touches" dd below; it was printed here too,
            verbatim, twice on one pane. */}
        <small className="console-warn">
          This clears <em>our</em> count, not the vendor&apos;s meter. The provider still believes it
          served those calls; further requests may be rejected upstream or billed.
        </small>
      </div>

      {/* ---- telemetry --------------------------------------------------- */}
      <div className="console-action">
        <div className="console-action__head">
          <strong>Clear telemetry buffers</strong>
          <span className="console-action__figure num">{counters?.eventsRetained != null ? `${counters.eventsRetained}/${counters.eventsCapacity ?? "—"} events` : "—"}</span>
          <div className="console-action__controls">
            <button
              type="button"
              onClick={(event) => requestConfirmation(event.currentTarget, {
                action: "clear_telemetry",
                title: "Clear diagnostic telemetry?",
                confirmLabel: "Confirm clear",
                target: "event ring, latency samples and cache counters",
                effect: "The current instance's retained investigation history will be destroyed. Circuit and simulated-outage behaviour survives, but the evidence that led here does not.",
              })}
              disabled={disabled}
              className="is-disruptive"
            >
              Clear
            </button>
          </div>
        </div>
        {/* The cost alone. What survives — circuit state, simulated outages —
            is scope, and the disclosure below already says it in its own words;
            printed here too it was this panel's one duplicated sentence. */}
        <small className="muted">
          Destroys this instance&rsquo;s investigation history.
        </small>
      </div>

      <details className="disclosure">
        <summary>What each server control touches, and what it deliberately leaves alone</summary>
        <dl className="operator-scope-notes">
          <dt>Purge cached responses</dt>
          <dd>Drops matching entries only. Quota counters and breaker state are a different namespace and are left alone.</dd>
          <dt>Restore routing</dt>
          <dd>A circuit that is still failing reopens after three more consecutive failures.</dd>
          <dt>Re-read provider configuration</dt>
          <dd>Re-evaluates the environment this process already holds and drops the cached OpenBB readiness verdict. Next.js reads <code>.env</code> once at boot.</dd>
          <dt>Reset a quota ledger</dt>
          <dd>Useful after an instance swap left the ledger pessimistic — not as a way to get more calls.</dd>
          <dt>Clear telemetry buffers</dt>
          <dd>Empties the server event ring, latency samples and cache counters. Circuit state and simulated outages survive — those are behaviour, not observation.</dd>
        </dl>
      </details>

      {/* "This browser only" is said once, here, for the whole group. Each row
          under it used to open with "Browser-side." as well — the heading
          restated two words at a time, on every line. */}
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
          Drops and re-handshakes every exchange socket this tab owns.
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
          Unattended ticks are sent at <code>background</code> priority, so a 1s debugging loop
          cannot spend the budget a person needs later.
        </small>
      </div>

      <details className="disclosure">
        <summary>Why a browser-side control cannot change server state</summary>
        <dl className="operator-scope-notes">
          <dt>Reconnect WebSockets</dt>
          <dd>Resets the backoff and the sequence guard rather than waiting one out. The sockets belong to this tab, so nothing on the server is touched.</dd>
          <dt>Health snapshot cadence</dt>
          <dd>Background priority is fenced out of each provider&rsquo;s interactive reserve. Only an explicit <em>Refresh now</em> requests interactive priority.</dd>
        </dl>
      </details>

    </div>
  );
}
