"use client";

/** Shared Developer control states and tables. `unmeasured` is the important
 * third verdict: a gate that did not run neither passed nor failed. Live rows
 * resolve only from their own evidence; configured cross-runtime comparisons
 * stay unverified until the health contract carries their result. */

import { type CSSProperties } from "react";

import { degradedCause } from "@/lib/dependency-graph";
import { DEPLOYABLES } from "@/lib/repository-catalog";
import type { SystemHealthView } from "@/lib/use-system-health";
import { APP_COMMIT, APP_DEPLOYMENT_ENV, IS_VERCEL_DEPLOYMENT } from "@/lib/version";

import { HAS_COMMIT_IDENTITY } from "./console-identity";

export type ControlTone = "good" | "warn" | "bad" | "off" | "info";

export interface ControlState {
  label: string;
  detail: string;
  tone: ControlTone;
  /** Nothing was measured. A check that could not run is not a check that ran
   *  and failed, and the readiness ladder reports the two separately. */
  unmeasured?: boolean;
}

export type GateVerdict = "pass" | "failed" | "unverified";

/** A gate's verdict from the state that feeds it. A poll that has not answered
 *  and an `unmeasured` state produce no evidence either way, so neither may be
 *  counted as a pass or named as blocking. */
export function gateVerdict(state: ControlState): GateVerdict {
  if (state.unmeasured || state.tone === "info") return "unverified";
  return state.tone === "good" ? "pass" : "failed";
}

export const PIPELINE_STAGES = [
  { name: "Code", note: HAS_COMMIT_IDENTITY ? `${APP_COMMIT}; run unverified` : "Identity unverified", tone: "warn" as const },
  { name: "Build", note: IS_VERCEL_DEPLOYMENT ? "Vercel configured; run unverified" : "Local build; run unverified", tone: "warn" as const },
  { name: "Tests", note: "Configured; result unverified", tone: "warn" as const },
  { name: "Contracts", note: "Configured; result unverified", tone: "warn" as const },
  { name: "Package", note: IS_VERCEL_DEPLOYMENT ? "Vercel output; unverified" : "Local output; unverified", tone: "warn" as const },
  {
    name: "Deploy",
    note: APP_DEPLOYMENT_ENV === "production"
      ? "Production target; unverified"
      : APP_DEPLOYMENT_ENV === "preview" ? "Preview target; unverified" : "Not deployed; unverified",
    tone: "warn" as const,
  },
] as const;

/* Definitions only: a row's state is always derived below from the evidence
   that actually proves that comparison. Keeping verdicts out of this array
   prevents repository metadata from becoming a green runtime claim. */
export const SCHEMA_GATES = [
  {
    id: "gateway-openapi",
    object: "Gateway OpenAPI",
    baseline: "tools/openapi.json",
    candidate: "Live FastAPI runtime",
  },
  {
    id: "gateway-payloads",
    object: "Gateway payloads",
    baseline: "Canonical fixtures",
    candidate: "Web validators",
  },
  {
    id: "runtime-payloads",
    object: "Runtime payload contracts",
    baseline: "Web validators",
    candidate: "Runtime validation window",
  },
  {
    id: "risk-parity",
    object: "Risk parity",
    baseline: "Python fixture",
    candidate: "TypeScript consumer",
  },
  {
    id: "mc-parity",
    object: "Monte Carlo numerics",
    baseline: "Committed reference",
    candidate: "Node, this instance",
  },
] as const;

export type SchemaGateId = typeof SCHEMA_GATES[number]["id"];

export function StatusPill({
  state,
  compact = false,
  role,
  live = false,
}: {
  state: ControlState;
  compact?: boolean;
  role?: "cell";
  /**
   * Pulses the dot. Only for states fed by the live 30s poll and currently
   * reporting — never for committed evidence (test totals, commit identity,
   * CI rows), where a pulse would impersonate a live conclusion, and never
   * for a dead service, whose dot has nothing to claim.
   */
  live?: boolean;
}) {
  return (
    <span className={`developer-cp-status is-${state.tone}${compact ? " is-compact" : ""}`} title={state.detail} role={role}>
      <i aria-hidden="true" className={live ? "pulse-live" : undefined} />
      {state.label}
    </span>
  );
}

/**
 * The immediate, per-packet reading. `healthError` is a transient the shared
 * poll sets on any failure and clears on any success, so rendered raw this
 * flips with each packet. The tab renders it only through
 * `useWorkspaceHealth`, which holds Degraded until `PROMOTION_STREAK`
 * consecutive successes — `tests/developer-stability.test.ts` pins both the
 * hold and this function's single-caller status.
 */
export function workspaceState(view: SystemHealthView): ControlState {
  if (view.healthError) return { label: "Degraded", detail: view.healthError, tone: "bad" };
  if (!view.health) return { label: "Checking", detail: "Waiting for the shared health snapshot.", tone: "info" };
  return { label: "Healthy", detail: `Serving commit ${APP_COMMIT}; instance ${view.health.instance.id}.`, tone: "good" };
}

export function gatewayState(view: SystemHealthView): ControlState {
  const source = view.health?.sources?.gateway;
  const platform = view.health?.platform;
  if (!view.health) return { label: "Checking", detail: "Waiting for gateway health.", tone: "info" };
  if (!platform) {
    const off = source?.state === "not_configured";
    const offline = "FastAPI gateway offline; start it with 'python -m uvicorn main:app --port 8000'.";
    // `off` is nothing to probe; a refused or timed-out probe is a measurement.
    return { label: off ? "Gateway Off" : "Unavailable", detail: source?.detail ?? offline, tone: off ? "off" : "warn", unmeasured: off };
  }
  if (platform.status === "critical" || platform.status === "halted") {
    return { label: platform.status, detail: `Gateway ${platform.version} reports ${platform.status}.`, tone: "bad" };
  }
  if (platform.status === "degraded" || source?.state === "stale") {
    // Name the disjunct: source.detail is FRESHNESS ("...snapshot is current").
    return { label: "Degraded", detail: `Gateway ${platform.version}; ${degradedCause(platform) ?? source?.detail ?? "degraded"}.`, tone: "warn" };
  }
  return { label: "Healthy", detail: `Gateway ${platform.version} in ${platform.environment}.`, tone: "good" };
}

/**
 * The live-contract comparison, and when this panel refuses to repeat it.
 *
 * `lib/delivery-readiness.ts` holds a comparison for five minutes so a 30s poll
 * is not a 111 KB transfer, and that cache outlives the gateway: after the port
 * stops answering, the payload still carries the verdict of the last document
 * anything read. Repeating it claims a reading nobody took — "Drift detected"
 * would be a finding with no live document behind it, and "Exact match" would
 * be worse, a promotion-grade pass invented from a gateway refusing
 * connections. `platform` is present only when the gateway answered this poll.
 */
export function schemaCompatibilityState(view: SystemHealthView): ControlState {
  if (!view.health) return { label: "Checking", detail: "Waiting for delivery evidence.", tone: "info" };
  const evidence = view.health.delivery?.schema;
  if (!evidence) return { label: "Unverified", detail: "This health route carries no live schema evidence yet.", tone: "warn", unmeasured: true };
  if (!view.health.platform && evidence.state !== "unavailable") {
    const earlier = evidence.state === "match" ? "an exact match" : "drift";
    const detail = `${gatewayState(view).detail} Nothing read the live contract this poll; an earlier reading found ${earlier}.`;
    return { label: "Unverified", detail, tone: "warn", unmeasured: true };
  }
  if (evidence.state === "match") return { label: "Exact match", detail: evidence.detail, tone: "good" };
  if (evidence.state === "mismatch") return { label: "Drift detected", detail: evidence.detail, tone: "bad" };
  return { label: "Unverified", detail: evidence.detail, tone: "warn", unmeasured: true };
}

/** Runtime ledger only. `passed` means no fatal finding, so green additionally
 * requires a non-zero denominator and zero warn, drift or unevaluated checks. */
export function payloadValidationState(view: SystemHealthView): ControlState {
  if (!view.health) return { label: "Checking", detail: "Waiting for runtime payload-validation evidence.", tone: "info" };
  const evidence = view.health.validation;
  if (!evidence) {
    return {
      label: "Unverified",
      detail: "This health route carries no runtime payload-validation ledger yet.",
      tone: "warn",
      unmeasured: true,
    };
  }

  const scope = evidence.scope === "gateway-ledger" ? "gateway ledger" : "current health-route instance";
  if (evidence.evaluated === 0) {
    return {
      label: "Unverified",
      detail: `The ${scope} contains no evaluated payloads; zero evidence is not a clean contract result.`,
      tone: "warn",
      unmeasured: true,
    };
  }

  const detail = `The ${scope} evaluated ${evidence.evaluated} payload${evidence.evaluated === 1 ? "" : "s"}: `
    + `${evidence.passed} had no fatal finding; ${evidence.fatal} fatal, ${evidence.warn} warn, `
    + `${evidence.drift} drift, and ${evidence.notEvaluated} checks not evaluated.`;
  if (evidence.fatal > 0) {
    return { label: "Fatal findings", detail, tone: "bad" };
  }
  if (evidence.passed !== evidence.evaluated) {
    return { label: "Ledger inconsistent", detail, tone: "bad" };
  }
  if (evidence.warn > 0 || evidence.drift > 0) {
    return { label: "Warnings / drift", detail, tone: "warn" };
  }
  if (evidence.notEvaluated > 0) {
    return { label: "Partial coverage", detail, tone: "warn" };
  }
  return { label: "Clean", detail, tone: "good" };
}

/** No field in `SystemHealth` compares the Python risk fixture with its
 * TypeScript consumer. Monte Carlo parity is a different computation and may
 * not be borrowed to turn this row green. */
export function riskParityState(): ControlState {
  return {
    label: "Unverified",
    detail: "The health snapshot carries no cross-language risk-parity result for this deployment.",
    tone: "warn",
    unmeasured: true,
  };
}

export function numericsParityState(view: SystemHealthView): ControlState {
  if (!view.health) return { label: "Checking", detail: "Waiting for delivery evidence.", tone: "info" };
  const evidence = view.health.delivery?.numerics;
  if (!evidence) return { label: "Unverified", detail: "This health route carries no numerics parity evidence yet.", tone: "warn", unmeasured: true };
  // No gateway in this claim: the reference is committed and the run is this
  // deployment's own Node instance, so the verdict is measured every poll.
  if (evidence.state === "match") {
    // The title carries the full digest so the custody result is checkable.
    return { label: "Byte-exact", detail: `${evidence.detail} sha256 ${evidence.expectedDigest}`, tone: "good" };
  }
  return { label: "Drift detected", detail: evidence.detail, tone: "bad" };
}

export function schemaGateRows(view: SystemHealthView) {
  const states: Record<SchemaGateId, ControlState> = {
    "gateway-openapi": schemaCompatibilityState(view),
    "gateway-payloads": {
      label: "Unverified",
      detail: "No live cross-runtime result compares the canonical gateway fixtures with the Web validators.",
      tone: "warn",
      unmeasured: true,
    },
    "runtime-payloads": payloadValidationState(view),
    "risk-parity": riskParityState(),
    "mc-parity": numericsParityState(view),
  };
  return SCHEMA_GATES.map((row) => ({ ...row, state: states[row.id] }));
}

export function artifactCustodyState(view: SystemHealthView): ControlState {
  if (!view.health) return { label: "Checking", detail: "Waiting for artifact evidence.", tone: "info" };
  const evidence = view.health.delivery?.artifact;
  if (!evidence) return { label: "Unverified", detail: "This health route carries no artifact attestation yet.", tone: "warn", unmeasured: true };
  if (evidence.state === "attested") return { label: "Attested", detail: evidence.detail, tone: "good" };
  // Invalid and unsigned are verdicts — a signature was checked, or looked for
  // and definitively absent. No trust root and unverified are the opposite: no
  // pinned key, or no deployed identity, so the check never ran.
  if (evidence.state === "invalid") return { label: "Invalid", detail: evidence.detail, tone: "bad" };
  if (evidence.state === "untrusted") return { label: "No trust root", detail: evidence.detail, tone: "warn", unmeasured: true };
  if (evidence.state === "unsigned") return { label: "Unsigned", detail: evidence.detail, tone: "warn" };
  return { label: "Unverified", detail: evidence.detail, tone: "warn", unmeasured: true };
}

export function openBBState(view: SystemHealthView): ControlState {
  const provider = view.health?.providers.find((item) => item.id === "openbb");
  if (!view.health) return { label: "Checking", detail: "Waiting for provider health.", tone: "info" };
  if (!provider?.configured) return { label: "Off", detail: provider?.statusDetail ?? "OpenBB is not configured.", tone: "off", unmeasured: true };
  if (!provider.ready) return { label: "Degraded", detail: provider.statusDetail, tone: "warn" };
  return { label: "Healthy", detail: provider.statusDetail, tone: "good" };
}

/**
 * `workspace` is the settled reading from `useWorkspaceHealth`, required
 * rather than derived here so a caller cannot quietly fall back to the
 * per-packet one and flap beside sections that hold.
 */
export function stateForDeployable(id: string, view: SystemHealthView, workspace: ControlState): ControlState {
  if (id === "workspace") return workspace;
  if (id === "gateway") return gatewayState(view);
  return openBBState(view);
}

export function PipelineStrip() {
  return (
    <div className="developer-cp-pipeline" aria-label="Configured delivery pipeline">
      {/* The entrance restates the sequence left to right. The connector stays
          static: marching ants would assert a running pipeline this tab
          cannot verify. */}
      {PIPELINE_STAGES.map((stage, index) => (
        <div
          className="developer-cp-pipeline__stage stagger-reveal"
          style={{ "--stagger-i": index } as CSSProperties}
          key={stage.name}
        >
          <div className={`developer-cp-pipeline__node is-${stage.tone}`} aria-hidden="true">
            {index + 1}
          </div>
          <strong>{stage.name}</strong>
          <small>{stage.note}</small>
          {index < PIPELINE_STAGES.length - 1 && <span className="developer-cp-pipeline__connector" aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}

export function SchemaGateTable({ view, compact = false }: { view: SystemHealthView; compact?: boolean }) {
  const rows = schemaGateRows(view);
  return (
    <>
    <div className={`developer-cp-table${compact ? " is-compact" : ""}`} tabIndex={0} role="table" aria-label="Schema compatibility gates">
      <div className="developer-cp-table__row is-head" role="row">
        <span role="columnheader">Contract</span><span role="columnheader">Baseline</span><span role="columnheader">Candidate</span><span role="columnheader">State</span>
      </div>
      {rows.map((row, index) => (
        <div
          className="developer-cp-table__row stagger-reveal"
          style={{ "--stagger-i": index } as CSSProperties}
          role="row"
          key={row.object}
        >
          <strong role="cell">{row.object}</strong>
          <code role="cell">{row.baseline}</code>
          <span role="cell">{row.candidate}</span>
          <StatusPill
            state={row.state}
            compact
            role="cell"
          />
        </div>
      ))}
    </div>
    {/* Method stays folded; pills separate measured rows from comparisons the
        current health contract cannot prove. */}
    <details className="disclosure developer-cp-state-guide">
      <summary>How to read the State column</summary>
      <p>
        Gateway OpenAPI, runtime payload contracts and Monte Carlo numerics take their verdicts
        from the current health payload. Gateway payloads and Risk parity remain unverified because
        that payload carries no cross-runtime result for either comparison.
      </p>
    </details>
    </>
  );
}

export function ArtifactLineage({ view, workspace, compact = false }: { view: SystemHealthView; workspace: ControlState; compact?: boolean }) {
  const states = Object.fromEntries(DEPLOYABLES.map((item) => [item.id, stateForDeployable(item.id, view, workspace)]));
  return (
    <div className={`developer-cp-artifacts${compact ? " is-compact" : ""}`} tabIndex={0} role="table" aria-label="Deployment artifact lineage">
      <div className="developer-cp-artifacts__row is-head" role="row">
        <span role="columnheader">Commit / build</span><span role="columnheader">Artifact</span><span role="columnheader">Runtime</span><span role="columnheader">Environment</span>
      </div>
      {DEPLOYABLES.map((deployable, index) => (
        <div
          className="developer-cp-artifacts__row stagger-reveal"
          style={{ "--stagger-i": index } as CSSProperties}
          role="row"
          key={deployable.id}
        >
          <code role="cell">{deployable.id === "workspace" ? APP_COMMIT : "runtime"}</code>
          <span role="cell"><strong>{deployable.name}</strong><small>{deployable.stack}</small></span>
          <code role="cell">{deployable.entry}</code>
          <StatusPill state={states[deployable.id]} compact role="cell" />
        </div>
      ))}
    </div>
  );
}
