"use client";

/**
 * The vocabulary the Developer control plane reports in, and the three tables
 * every section of it draws from.
 *
 * Split out of `DeveloperConsole` when that file passed the length ceiling.
 * What lives here is the part that must not be restated: one `ControlState`
 * shape, one derivation per source, one pill that renders it.
 *
 * **The three-verdict ladder is the point of this file.** `gateVerdict` maps a
 * state to `pass`, `failed` or `unverified`, and the third is not a softer
 * second: a gate that could not run has not passed and has not failed, so it
 * may never be counted toward a pass nor named as blocking. `unmeasured` marks
 * the states that carry no reading at all — an unconfigured gateway, an
 * unpinned signing key, a build that is not a deployment. A refused connection
 * is the opposite: the gate ran, and the answer is that the gateway is not
 * healthy.
 *
 * `schemaCompatibilityState` is where that distinction was bought. The panel
 * reported "Drift detected" against an unreachable gateway because
 * `lib/delivery-readiness.ts` holds a comparison for five minutes and the
 * verdict outlived the port. A cached "Drift detected" claims a document
 * nothing read; a cached "Exact match" is worse — a promotion-grade pass
 * invented from a gateway refusing connections.
 */

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
  { name: "Code", note: APP_COMMIT, tone: HAS_COMMIT_IDENTITY ? "good" as const : "warn" as const },
  { name: "Build", note: IS_VERCEL_DEPLOYMENT ? "Vercel build" : "Local build", tone: IS_VERCEL_DEPLOYMENT ? "good" as const : "warn" as const },
  { name: "Tests", note: "Configured gates", tone: "warn" as const },
  { name: "Contracts", note: "Configured gates", tone: "warn" as const },
  { name: "Package", note: IS_VERCEL_DEPLOYMENT ? "Vercel artifact" : "Unverified local output", tone: IS_VERCEL_DEPLOYMENT ? "good" as const : "warn" as const },
  {
    name: "Deploy",
    note: APP_DEPLOYMENT_ENV === "production" ? "Production" : APP_DEPLOYMENT_ENV === "preview" ? "Preview" : "Not deployed",
    tone: IS_VERCEL_DEPLOYMENT ? "good" as const : "warn" as const,
  },
] as const;

/* The last two rows carry no committed verdict of their own: their state comes
   from the live evidence in the health payload, resolved in SchemaGateTable. */
export const SCHEMA_GATES = [
  { object: "Gateway OpenAPI", baseline: "tools/openapi.json", candidate: "FastAPI runtime", impact: "CI gated", tone: "good" as const },
  { object: "Risk parity", baseline: "Python fixture", candidate: "TypeScript consumer", impact: "CI gated", tone: "good" as const },
  { object: "Gateway payloads", baseline: "Canonical fixtures", candidate: "Web validators", impact: "CI gated", tone: "good" as const },
  { object: "Production schema", baseline: "Authenticated endpoint", candidate: "Current commit", impact: "Not connected", tone: "warn" as const },
  { object: "Monte Carlo numerics", baseline: "Committed reference", candidate: "Node, this instance", impact: "Not connected", tone: "warn" as const },
] as const;

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

export function numericsParityState(view: SystemHealthView): ControlState {
  if (!view.health) return { label: "Checking", detail: "Waiting for delivery evidence.", tone: "info" };
  const evidence = view.health.delivery?.numerics;
  if (!evidence) return { label: "Unverified", detail: "This health route carries no numerics parity evidence yet.", tone: "warn", unmeasured: true };
  // No gateway in this claim: the reference is committed and the run is this
  // deployment's own Node instance, so the verdict is measured every poll.
  if (evidence.state === "match") {
    /* The whole digest, not a twelve-character prefix with an ellipsis after
       it. This string is the row's `title`, where width is not the constraint
       a pill's width is, and a truncated hash is a hash a reader cannot check
       — the reported defect that produced the custody chain in the Numerics
       pane. The prefix was never wrong, only useless: it asserts that a digest
       exists rather than handing one over. */
    return { label: "Byte-exact", detail: `${evidence.detail} sha256 ${evidence.expectedDigest}`, tone: "good" };
  }
  return { label: "Drift detected", detail: evidence.detail, tone: "bad" };
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
  const liveSchema = schemaCompatibilityState(view);
  const liveNumerics = numericsParityState(view);
  const rows = SCHEMA_GATES.map((row) => {
    if (row.object === "Production schema") {
      return { ...row, impact: liveSchema.label, tone: liveSchema.tone, detail: liveSchema.detail };
    }
    if (row.object === "Monte Carlo numerics") {
      return { ...row, impact: liveNumerics.label, tone: liveNumerics.tone, detail: liveNumerics.detail };
    }
    return { ...row, detail: `${row.baseline} → ${row.candidate}` };
  });
  /*
   * WHICH THREE OF THESE FIVE WERE READ HERE, AND WHICH TWO WERE NOT.
   *
   * Three rows carry a committed verdict — `CI gated`, toned `good` — and two
   * are resolved from the live health payload above. Nothing on screen told
   * the two apart: the pill is the same shape and the same green in both, the
   * `live` pulse this file reserves for poll-fed states is passed on neither,
   * and a reader scanning the State column reasonably took five current
   * readings off a table that holds two. That is the file's own three-verdict
   * rule applied against itself — a gate that did not run in this deployment
   * has not passed here — so the split is stated rather than left to be
   * inferred from which two words happen to change.
   *
   * LABELLED, NOT RE-VERDICTED. The alternative was to demote the three to
   * `info` or to `unverified`. Both refused: `CI gated` is TRUE — `.github/
   * workflows/ci.yml` runs `tools/export_openapi.py --check`, the Python and
   * TypeScript engine parity suite and the payload fixture suite on every
   * push — and `info` is this file's "Checking" tone, so it would trade a
   * reader believing a stale pass for a reader believing a poll is in flight.
   * Downgrading a true claim is not the honest move; naming where it was read
   * is.
   *
   * Folded since 2026-08-23, on a reader's report: the caveat crowded the
   * figures it annotates, and the State pills already carry the distinction
   * ("CI gated" against "Exact match") in the same glance.
   */
  return (
    <>
    <div className={`developer-cp-table${compact ? " is-compact" : ""}`} role="table" aria-label="Schema compatibility gates">
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
          <StatusPill state={{ label: row.impact, detail: row.detail, tone: row.tone }} compact role="cell" />
        </div>
      ))}
    </div>
    {/* Folded on a reader's report that the table's footnotes crowded the
        figures. The caveat is one click away and the pills themselves still
        say "CI gated" against "Exact match", which is the distinction. */}
    <details className="disclosure">
      <summary>How to read the State column</summary>
      <p>
        Only Production schema and Monte Carlo numerics resolve from this poll. The three CI gated
        rows are the verdict of the continuous-integration run for this commit, not a check this
        deployment repeated.
      </p>
    </details>
    </>
  );
}

export function ArtifactLineage({ view, workspace, compact = false }: { view: SystemHealthView; workspace: ControlState; compact?: boolean }) {
  const states = Object.fromEntries(DEPLOYABLES.map((item) => [item.id, stateForDeployable(item.id, view, workspace)]));
  return (
    <div className={`developer-cp-artifacts${compact ? " is-compact" : ""}`} role="table" aria-label="Deployment artifact lineage">
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
