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
 * The client-side controls are `SessionControls` — Remediation's Session pane.
 * Different card, and now a different file: they keep the cost-sentence rule
 * but not the guard, because a control that mutates no server state needs no
 * token. This module re-exports it, so no caller's import path changed.
 *
 * Three pieces left when this file passed the length ceiling, along seams the
 * panel already had: `OperatorControls` (the five rows and their prices),
 * `OperatorConfirmation` (the disruptive-action preview) and `SessionControls`.
 * What stayed is what the seam could not cut — authorisation, the pending
 * confirmation and its focus restore, the one derivation every figure on the
 * card reads, and the dispatch itself.
 *
 * **`part` renders one of two Remediation panes from one component.** The five
 * server writes and their map are `part="mutations"`; the scope summary — the
 * ring of provider routing states and the three counts under it — is
 * `part="scope"`. The panes are conditional renders, so only one is ever
 * mounted, and the shell hands the same props to both.
 *
 * The split is along a question, not along markup: `scope` answers "what would
 * a mutation reach", and reaching for it costs nothing and changes nothing;
 * `mutations` answers "what will this button do", and every surface a reader
 * needs before pressing one travels with it — the blast-radius banner, the
 * guard and its token field, the confirmation preview, the price under each
 * row, and the map of what each write clears. Splitting the guard away from
 * the buttons it gates was the alternative and it was refused: a disabled
 * button whose reason lives one pane away is a button with no reason on it.
 * `ReliabilityOverview` splits the same way, with the same prop name.
 */

import { useEffect, useRef, useState } from "react";

import DonutChart, { type DonutSlice } from "@/components/common/DonutChart";
import MutationScopeMap from "@/components/systems/MutationScopeMap";
import OperatorConfirmation from "@/components/systems/OperatorConfirmation";
import OperatorControls from "@/components/systems/OperatorControls";
import OperatorGuard from "@/components/systems/OperatorGuard";
import type { ActionResponse, GuardMode, ProviderRow } from "./types";

export { default as SessionControls } from "@/components/systems/SessionControls";

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
  /** Which Remediation pane is asking. See the `part` paragraph above. */
  part: "mutations" | "scope";
  guard: GuardMode;
  tokenEnv: string;
  providers: ProviderRow[] | null;
  symbol: string;
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

/**
 * A disruptive action, held after its trigger was pressed and before it is
 * dispatched. Exported because `OperatorConfirmation` renders one; the state
 * itself never leaves this file.
 */
export interface PendingConfirmation {
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
  part,
  guard,
  tokenEnv,
  providers,
  symbol,
  counters,
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
   * What is actually remediable right now. Every figure below is read from the
   * same provider snapshot the actions operate on, so the summary cannot
   * describe a system the buttons will not find.
   *
   * There is deliberately no history chart here. `RemediationLedger` — the
   * History pane — pairs open→closed transitions into a real but bounded,
   * per-instance, non-durable ledger, and its own header explains why even
   * that supports counts and a distribution but never a trend.
   */
  const rows = providers ?? [];
  /**
   * Whether the registry was READ, as against read and found empty.
   *
   * `providers ?? []` collapses the two, and every figure below is derived from
   * it — so with the health route refusing, the one card on the tab that can
   * mutate provider routing opened with "Not configured 0 — every provider has
   * a key", which is a claim about a registry nobody has seen. Threaded into
   * `OperatorControls` as well, because its row figures read the same counts
   * and half a fix would put a dash and a zero for the same fact ten pixels
   * apart. An empty array keeps its zeros: that is a measurement.
   */
  const observed = providers !== null;
  const openCircuits = rows.filter((row) => row.circuitOpen).length;
  const simulated = rows.filter((row) => row.simulatedOutage).length;
  const unconfigured = rows.filter((row) => !row.configured).length;
  const quotaLedgers = rows.filter((row) => row.quota !== null).length;
  const healthy = rows.filter((row) => row.configured && !row.circuitOpen && !row.simulatedOutage).length;
  const scopeSlices: DonutSlice[] = [
    { label: "routing normally", value: healthy, colour: "var(--status-good)" },
    { label: "circuit open", value: openCircuits, colour: "var(--status-critical)" },
    { label: "simulated outage", value: simulated, colour: "var(--status-warning)" },
    { label: "not configured", value: unconfigured, colour: "var(--axis)" },
  ];

  /**
   * The Scope pane: what a mutation would reach, and nothing that reaches it.
   *
   * Returned early rather than folded into one tree behind two ternaries — the
   * two panes share their derivations and share almost no markup, and a
   * `{part === "scope" && …}` around each of nine blocks reads as one pane with
   * holes in it rather than as two panes.
   */
  if (part === "scope") {
    return (
      <div className="card console-card console-actions">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Scope</span>
            <h2>What a mutation would act on</h2>
          </div>
          <span className="section-note">
            {observed ? `${rows.length} providers registered here` : "registry not observed"}
          </span>
        </div>

        <section className="remediation-scope" aria-label="What these controls would act on">
          <DonutChart
            slices={scopeSlices}
            centreValue={rows.length ? String(rows.length) : undefined}
            centreLabel="providers"
            ariaLabel="Provider routing states in this instance, the scope these controls act on."
            emptyNote={observed
              ? "No provider is registered in this instance."
              : "No provider snapshot yet."}
          />
          <dl className="remediation-scope__facts">
            <div>
              <dt>Open circuits</dt>
              <dd className="num">{observed ? openCircuits : "—"}</dd>
              {/* What the state IS. What closing one does is stated beside the
                  button that does it, which is where a caveat belongs. */}
              <small>{!observed ? "not observed" : openCircuits ? "held out of routing until a probe closes them" : "nothing held open"}</small>
            </div>
            <div>
              <dt>Simulated outages</dt>
              <dd className="num">{observed ? simulated : "—"}</dd>
              <small>{!observed ? "not observed" : simulated ? "operator-caused, cleared on demand" : "none active"}</small>
            </div>
            <div>
              <dt>Not configured</dt>
              <dd className="num">{observed ? unconfigured : "—"}</dd>
              <small>{!observed ? "not observed" : unconfigured ? "a missing key, not a failure" : "every provider has a key"}</small>
            </div>
          </dl>
        </section>

        {/* Only the dash/zero rule survives here. The sentence in front of it —
            "These are the counts every control on the Mutations pane is
            dispatched against" — was the third statement of the same claim on
            one screen, after the h2 and the section's own aria-label; the
            rejected alternative was cutting the aria-label instead, which would
            have taken the fact away from the readers who cannot see the h2. */}
        <p className="console-note">
          A dash is a registry this instance has not read; a zero is a registry it has read and
          found empty.
        </p>
      </div>
    );
  }

  return (
    <div className="card console-card console-actions">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Control</span>
          <h2>Operator actions</h2>
        </div>
        <span className="section-note">Preview required for disruptive actions.</span>
      </div>

      <div className="banner warn console-control-scope" role="note">
        <span aria-hidden>!</span>
        <div>
          <strong>These are not fleet or trading controls.</strong> A mutation affects only the
          Next.js provider-routing instance that receives it; nothing here halts or resumes the
          Python trading gateway.
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
        <small>Authenticated in production</small>
      </div>

      {pending ? (
        <OperatorConfirmation
          pending={pending}
          confirmButton={confirmButton}
          confirmDisabled={locked || missingToken || busyAction !== null}
          onCancel={closeConfirmation}
          onConfirm={confirmPending}
        />
      ) : null}

      {/* No server band inside the rows: `Provider routing controls` above
          already names the group and its scope, and a second header saying the
          same thing in different words is the clutter this pass removed. The
          session band on the Session card stays — it marks a change of blast
          radius, not a repeat. */}

      <OperatorControls
        symbol={symbol}
        counters={counters}
        busyAction={busyAction}
        disabled={disabled}
        registryObserved={observed}
        providerCount={rows.length}
        openCircuits={openCircuits}
        simulated={simulated}
        quotaLedgers={quotaLedgers}
        metered={metered}
        purgeScope={purgeScope}
        onPurgeScopeChange={setPurgeScope}
        quotaTarget={validQuotaTarget}
        onQuotaTargetChange={setQuotaTarget}
        onAction={onAction}
        onRequestConfirmation={requestConfirmation}
      />

      {/* The disclosure at the foot of `OperatorControls`, drawn. Same figures
          as the badges beside the rows — they are threaded from here, not
          re-derived there, so the map cannot state a quantity the buttons will
          not find. A capability with no caller is the defect this repository
          keeps a scar about, so the map is mounted where its subject is rather
          than offered as a component nothing renders. */}
      <MutationScopeMap
        registryObserved={observed}
        providerCount={rows.length}
        openCircuits={openCircuits}
        simulated={simulated}
        quotaLedgers={quotaLedgers}
        cacheEntries={counters?.cacheEntries ?? null}
        stateEntries={counters?.stateEntries ?? null}
        eventsRetained={counters?.eventsRetained ?? null}
        eventsCapacity={counters?.eventsCapacity ?? null}
      />
    </div>
  );
}
