"use client";

/**
 * The five server mutations, as one table: a row per control, a column per
 * kind of fact — what it is, what it touches, what it costs, and the control.
 *
 * Split out of `OperatorPanel` when that file passed the length ceiling. The
 * seam is deliberate and narrow: authorisation, the confirmation state and the
 * dispatch stayed in the panel — this renders rows and calls back.
 *
 * It was five boxes, each with the name, a figure pill, the buttons and the
 * cost line laid out on its own terms, so the same kind of fact sat in a
 * different place on every box and a reader scanning for "which one spends
 * money" read five layouts. A table puts each kind of fact in one column, and
 * the reader reads down.
 *
 * **Every rule that made these rows worth reading travelled with them.**
 *
 *  - The COST stays inline, in its own column. Purging is not free; resetting
 *    a quota ledger stops *us* counting while the vendor still believes it
 *    served the calls. The person clicking is the person who gets the bill,
 *    so those sentences are never folded away. Only SCOPE — what a control
 *    leaves alone — collapses into the disclosure at the foot.
 *  - A sentence appears inline or in the disclosure, NEVER both. Each of these
 *    used to be printed twice, so a reader met it twice on one pane.
 *  - `is-disruptive` and `is-recovery` are styled through DESCENDANT selectors
 *    (`.console-action__controls .is-disruptive` in globals.css). The wrapper
 *    div in the Action cell is therefore load-bearing: rename it and the red
 *    Purge and the green recovery buttons lose their tone with nothing
 *    failing anywhere.
 */

import type { ActionOptions, PendingConfirmation } from "@/components/systems/OperatorPanel";
import type { ProviderRow } from "@/components/systems/types";

const PURGE_SCOPES = ["all", "quote", "bars", "news", "fundamentals"] as const;

export default function OperatorControls({
  symbol,
  counters,
  busyAction,
  disabled,
  registryObserved,
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
  /**
   * Whether the provider registry was read at all. The four counts below are
   * derived from `providers ?? []` upstream, so a refusing health route made
   * them zeros — "0 open, 0 simulated" next to Close all circuits, and "0
   * providers" next to Reload. A zero here is an answer; the dash is the
   * absence of one, and `OperatorPanel` states the reason once above.
   */
  registryObserved: boolean;
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
    <div className="operator-mutations__wrap">
    <table className="operator-mutations">
      <caption className="sr-only">Server mutations: what each control touches, what it costs, and the control</caption>
      <thead>
        <tr>
          <th>Control</th>
          <th>Touches</th>
          <th>Cost</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {/* ---- cache ----------------------------------------------------- */}
        <tr>
          <th scope="row">Purge cached responses</th>
          <td className="operator-mutations__figure num">{figure(counters?.cacheEntries, "cached") ?? "—"}{counters?.stateEntries != null ? `, ${counters.stateEntries} state` : ""}</td>
          {/* The COST stays inline. This file's own rule: costs are rendered
              next to the buttons, not buried, because the person clicking is
              usually the person who will be surprised by the bill. Only the
              scope — what a control does not touch — collapses into the
              disclosure below. */}
          <td className="operator-mutations__cost">
            <small className="muted">
              The next request for each purged key goes upstream and spends a real call.
            </small>
          </td>
          <td className="operator-mutations__action">
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
          </td>
        </tr>

        {/* ---- routing --------------------------------------------------- */}
        <tr>
          <th scope="row">Restore routing</th>
          <td className="operator-mutations__figure num">{registryObserved ? `${openCircuits} open, ${simulated} simulated` : "—"}</td>
          <td className="operator-mutations__cost">
            <small className="muted">
              Closing a circuit asks the provider again; it does not declare it healthy.
            </small>
          </td>
          <td className="operator-mutations__action">
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
          </td>
        </tr>

        {/* ---- configuration --------------------------------------------- */}
        <tr>
          <th scope="row">Re-read provider configuration</th>
          <td className="operator-mutations__figure num">{registryObserved ? `${providerCount} providers` : "—"}</td>
          {/* Only the caveat stays inline: acting on the belief that Reload
              applied a new key is how a dead provider gets declared
              configured. What the reload actually re-reads is scope, and
              scope lives in the disclosure below. */}
          <td className="operator-mutations__cost">
            <small className="muted">
              Cannot import a changed <code>.env</code> from disk; new keys need a redeploy.
            </small>
          </td>
          <td className="operator-mutations__action">
            <div className="console-action__controls">
              <button type="button" onClick={() => onAction("reload_providers")} disabled={disabled}>
                {busyAction === "reload_providers" ? "Reloading…" : "Reload"}
              </button>
            </div>
          </td>
        </tr>

        {/* ---- ledger ---------------------------------------------------- */}
        <tr>
          <th scope="row">Reset a quota ledger</th>
          <td className="operator-mutations__figure num">{registryObserved ? `${quotaLedgers} ledgers` : "—"}</td>
          {/* Cost inline, use-case in the disclosure — the panel's own rule.
              The "useful after an instance swap" sentence lives in the "What
              each server control touches" dd below; it was printed here too,
              verbatim, twice on one pane. */}
          <td className="operator-mutations__cost">
            <small className="console-warn">
              This clears <em>our</em> count, not the vendor&apos;s meter; further requests may still be
              rejected upstream or billed.
            </small>
            {/* The absence names itself: with no metered provider the select
                is empty and the button is dimmed, and a reader was left to
                guess which. */}
            {metered.length === 0 && (
              <small className="muted">
                {registryObserved
                  ? "No provider in this instance keeps a local quota ledger, so there is nothing to reset."
                  : "The provider registry has not been observed, so no quota ledger can be listed here."}
              </small>
            )}
          </td>
          <td className="operator-mutations__action">
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
                /* A dimmed control names its own reason, as the Session card's
                   Reconnect does. This one dims for two different reasons and
                   used to give neither. */
                title={!registryObserved
                  ? "The provider registry has not been observed."
                  : metered.length === 0
                    ? "No provider in this instance keeps a quota ledger."
                    : quotaTarget ? undefined : "Choose a provider first."}
              >
                Reset counter
              </button>
            </div>
          </td>
        </tr>

        {/* ---- telemetry ------------------------------------------------- */}
        <tr>
          <th scope="row">Clear telemetry buffers</th>
          <td className="operator-mutations__figure num">{counters?.eventsRetained != null ? `${counters.eventsRetained}/${counters.eventsCapacity ?? "—"} events` : "—"}</td>
          {/* The cost alone. What survives — circuit state, simulated outages
              — is scope, and the disclosure below already says it in its own
              words; printed here too it was this panel's one duplicated
              sentence. */}
          <td className="operator-mutations__cost">
            <small className="muted">
              Destroys this instance&rsquo;s investigation history.
            </small>
          </td>
          <td className="operator-mutations__action">
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
          </td>
        </tr>
      </tbody>
    </table>
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
