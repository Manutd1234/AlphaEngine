"use client";

/**
 * The five server mutations, each with its price printed beside the button.
 *
 * Split out of `OperatorPanel` when that file passed the length ceiling. The
 * seam is deliberate and narrow: authorisation, the confirmation state and the
 * dispatch stayed in the panel — this renders rows and calls back.
 *
 * **Every rule that made these rows worth reading travelled with them.**
 *
 *  - The COST stays inline, on the `<small>` under the control. Purging is not
 *    free; resetting a quota ledger stops *us* counting while the vendor still
 *    believes it served the calls. The person clicking is the person who gets
 *    the bill, so those sentences are never folded away. Only SCOPE — what a
 *    control leaves alone — collapses into the disclosure at the foot.
 *  - A sentence appears inline or in the disclosure, NEVER both. Each of these
 *    used to be printed twice, so a reader met it twice on one pane.
 *  - `is-disruptive` and `is-recovery` are styled through DESCENDANT selectors
 *    (`.console-action__controls .is-disruptive` in globals.css). The wrapper
 *    div is therefore load-bearing: rename it and the red Purge and the green
 *    recovery buttons lose their tone with nothing failing anywhere.
 */

import type { ActionOptions, PendingConfirmation } from "@/components/systems/OperatorPanel";
import type { ProviderRow } from "@/components/systems/types";

const PURGE_SCOPES = ["all", "quote", "bars", "news", "fundamentals"] as const;

export default function OperatorControls({
  symbol,
  counters,
  busyAction,
  disabled,
  providerCount,
  openCircuits,
  simulated,
  quotaLedgers,
  metered,
  purgeScope,
  onPurgeScopeChange,
  quotaTarget,
  onQuotaTargetChange,
  onAction,
  onRequestConfirmation,
}: {
  symbol: string;
  counters?: {
    cacheEntries: number | null;
    stateEntries: number | null;
    eventsRetained: number | null;
    eventsCapacity: number | null;
  };
  busyAction: string | null;
  disabled: boolean;
  providerCount: number;
  openCircuits: number;
  simulated: number;
  quotaLedgers: number;
  metered: ProviderRow[];
  purgeScope: string;
  onPurgeScopeChange: (scope: string) => void;
  /** Already validated against `metered`; "" means nothing is selected. */
  quotaTarget: string;
  onQuotaTargetChange: (provider: string) => void;
  onAction: (action: string, options?: ActionOptions) => void;
  onRequestConfirmation: (trigger: HTMLButtonElement, confirmation: PendingConfirmation) => void;
}) {
  /** A dash, never a zero: an absent counter and an empty one are different. */
  const figure = (value: number | null | undefined, suffix: string) =>
    value == null ? null : `${value.toLocaleString()} ${suffix}`;

  return (
    <>
    {/* ---- cache ------------------------------------------------------- */}
    <div className="console-action">
      <div className="console-action__head">
        <strong>Purge cached responses</strong>
        <span className="console-action__figure num">{figure(counters?.cacheEntries, "cached") ?? "—"}{counters?.stateEntries != null ? `, ${counters.stateEntries} state` : ""}</span>
        <div className="console-action__controls">
          <label className="sr-only" htmlFor="console-purge-scope">Purge scope</label>
          <select
            id="console-purge-scope"
            value={purgeScope}
            onChange={(event) => onPurgeScopeChange(event.target.value)}
          >
            {PURGE_SCOPES.map((scope) => (
              <option key={scope} value={scope}>{scope}</option>
            ))}
            <option value="symbol">Symbol: {symbol}</option>
          </select>
          <button
            type="button"
            onClick={(event) => {
              const scope = purgeScope === "symbol" ? `symbol:${symbol}` : purgeScope;
              onRequestConfirmation(event.currentTarget, {
                action: "purge_cache",
                options: { scope },
                title: "Purge cached responses?",
                confirmLabel: "Confirm purge",
                target: purgeScope === "symbol" ? `Symbol: ${symbol}` : scope,
                effect: "Matching cached responses are dropped; the next request for each key spends real provider quota.",
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
        <span className="console-action__figure num">{`${openCircuits} open, ${simulated} simulated`}</span>
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
        <span className="console-action__figure num">{`${providerCount} providers`}</span>
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
        Cannot import a changed <code>.env</code> from disk; new keys need a redeploy.
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
            value={quotaTarget}
            onChange={(event) => onQuotaTargetChange(event.target.value)}
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
              const provider = metered.find((candidate) => candidate.id === quotaTarget);
              onRequestConfirmation(event.currentTarget, {
                action: "reset_quota",
                options: { provider: quotaTarget },
                title: "Reset the local quota ledger?",
                confirmLabel: "Confirm reset",
                target: provider ? `${provider.label} (${provider.id})` : quotaTarget,
                effect: "Only this instance's accounting is reset; the vendor's meter and billing are unchanged.",
              });
            }}
            disabled={disabled || !quotaTarget}
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
        This clears <em>our</em> count, not the vendor&apos;s meter; further requests may still be
        rejected upstream or billed.
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
            onClick={(event) => onRequestConfirmation(event.currentTarget, {
              action: "clear_telemetry",
              title: "Clear diagnostic telemetry?",
              confirmLabel: "Confirm clear",
              target: "event ring, latency samples and cache counters",
              effect: "This instance's investigation history is destroyed. Circuit and simulated-outage behaviour survives.",
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
      <summary>What each server control touches, and leaves alone</summary>
      <dl className="operator-scope-notes">
        <dt>Purge cached responses</dt>
        <dd>Drops matching entries only; quota counters and breaker state are a different namespace.</dd>
        <dt>Restore routing</dt>
        <dd>A still-failing circuit reopens after three more consecutive failures.</dd>
        <dt>Re-read provider configuration</dt>
        <dd>Re-evaluates the environment this process already holds, dropping the cached OpenBB readiness verdict.</dd>
        <dt>Reset a quota ledger</dt>
        <dd>Useful after an instance swap left the ledger pessimistic.</dd>
        <dt>Clear telemetry buffers</dt>
        <dd>Empties the event ring, latency samples and cache counters; circuit state and simulated outages survive.</dd>
      </dl>
    </details>
    </>
  );
}
