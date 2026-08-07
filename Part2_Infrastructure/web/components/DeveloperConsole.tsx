"use client";

/**
 * AlphaEngine developer control plane.
 *
 * This is deliberately part of the main workspace rather than a second app.
 * It combines the live health snapshot already owned by `useSystemHealth` with
 * committed delivery evidence. Anything that is not connected to a live
 * source says so explicitly; a polished placeholder must never impersonate a
 * CI conclusion, schema comparison, or signed artifact.
 */

import type { CSSProperties } from "react";

import CodebaseExplorer from "@/components/developer/CodebaseExplorer";
import DeveloperApiCatalog, { API_OPERATIONS } from "@/components/developer/DeveloperApiCatalog";
import DeveloperWorkQueue from "@/components/developer/DeveloperWorkQueue";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import CategoryBars from "@/components/charts/CategoryBars";
import PageHead from "@/components/workspace/PageHead";
import type { DeveloperWorkItem } from "@/lib/developer-work";
import { DEPLOYABLES, GITHUB_SOURCE_ROOT, REPOSITORY_STATS } from "@/lib/repository-catalog";
import type { SystemHealthView } from "@/lib/use-system-health";
import { APP_COMMIT, APP_DEPLOYMENT_ENV, IS_VERCEL_DEPLOYMENT } from "@/lib/version";

const GITHUB_REPOSITORY_ROOT = GITHUB_SOURCE_ROOT.split("/blob/main")[0];
const HAS_COMMIT_IDENTITY = APP_COMMIT !== "dev";
const RUNTIME_LABEL = APP_DEPLOYMENT_ENV === "production"
  ? "Vercel production"
  : APP_DEPLOYMENT_ENV === "preview"
    ? "Vercel preview"
    : process.env.NODE_ENV === "production"
      ? "Local production build"
      : "Local development";

export type DeveloperSection = "overview" | "codebase" | "work" | "apis" | "quality";

/** IDs stay stable for saved workspace state; labels and order are the product IA. */
const DEVELOPER_SECTIONS = [
  { id: "overview", label: "Overview", description: "Topology, readiness & delivery posture" },
  { id: "quality", label: "CI / CD", description: "Pipelines, test gates & artifacts" },
  { id: "apis", label: "API & Schema", description: "Routes, payloads & contract drift" },
  { id: "codebase", label: "Code & Diffs", description: "Repository paths & change custody" },
  { id: "work", label: "Task Queue", description: "Engineering-impact work" },
] as const;

type ControlTone = "good" | "warn" | "bad" | "off" | "info";

interface ControlState {
  label: string;
  detail: string;
  tone: ControlTone;
}

const CI_JOBS = [
  {
    name: "Gateway",
    count: 342,
    command: "python -m pytest",
    evidence: "pytest · ruff · OpenAPI snapshot · money-path probe",
  },
  {
    name: "Web workspace",
    count: 680,
    command: "npm test && npm run typecheck && npm run build",
    evidence: "domain tests · contract fixtures · strict TypeScript · Next.js build",
  },
  {
    name: "OpenBB service",
    count: 13,
    command: "python -m pytest",
    evidence: "provider facade · authentication · API contracts",
  },
  {
    name: "Repository audit",
    count: null,
    command: "tools/check_repo_complete.sh",
    evidence: "exports Git HEAD and verifies the committed delivery tree",
  },
] as const;

const PIPELINE_STAGES = [
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

const SCHEMA_GATES = [
  {
    object: "Gateway OpenAPI",
    baseline: "tools/openapi.json",
    candidate: "FastAPI runtime",
    impact: "CI gated",
    tone: "good" as const,
  },
  {
    object: "Risk parity",
    baseline: "Python fixture",
    candidate: "TypeScript consumer",
    impact: "CI gated",
    tone: "good" as const,
  },
  {
    object: "Gateway payloads",
    baseline: "Canonical fixtures",
    candidate: "Web validators",
    impact: "CI gated",
    tone: "good" as const,
  },
  {
    object: "Production schema",
    baseline: "Authenticated endpoint",
    candidate: "Current commit",
    impact: "Not connected",
    tone: "warn" as const,
  },
] as const;

function StatusPill({ state, compact = false, role }: { state: ControlState; compact?: boolean; role?: "cell" }) {
  return (
    <span className={`developer-cp-status is-${state.tone}${compact ? " is-compact" : ""}`} title={state.detail} role={role}>
      <i aria-hidden="true" />
      {state.label}
    </span>
  );
}

function workspaceState(view: SystemHealthView): ControlState {
  if (view.healthError) return { label: "Degraded", detail: view.healthError, tone: "bad" };
  if (!view.health) return { label: "Checking", detail: "Waiting for the shared system-health snapshot.", tone: "info" };
  return {
    label: "Healthy",
    detail: `Serving commit ${APP_COMMIT}; instance ${view.health.instance.id}.`,
    tone: "good",
  };
}

function gatewayState(view: SystemHealthView): ControlState {
  const source = view.health?.sources?.gateway;
  const platform = view.health?.platform;
  if (!view.health) return { label: "Checking", detail: "Gateway health has not arrived yet.", tone: "info" };
  if (!platform) {
    return {
      label: source?.state === "not_configured" ? "Gateway Off" : "Unavailable",
      detail: source?.detail ?? "FastAPI Gateway is offline. Run 'python -m uvicorn main:app --port 8000' to connect.",
      tone: source?.state === "not_configured" ? "off" : "warn",
    };
  }
  if (platform.status === "critical" || platform.status === "halted") {
    return { label: platform.status, detail: `Gateway ${platform.version} reports ${platform.status}.`, tone: "bad" };
  }
  if (platform.status === "degraded" || source?.state === "stale") {
    return { label: "Degraded", detail: `Gateway ${platform.version}; ${source?.detail ?? "degraded"}.`, tone: "warn" };
  }
  return { label: "Healthy", detail: `Gateway ${platform.version} · ${platform.environment}.`, tone: "good" };
}

function schemaCompatibilityState(view: SystemHealthView): ControlState {
  if (!view.health) return { label: "Checking", detail: "Waiting for delivery evidence.", tone: "info" };
  const evidence = view.health.delivery?.schema;
  if (!evidence) {
    return { label: "Unverified", detail: "This health route does not expose live schema evidence yet.", tone: "warn" };
  }
  if (evidence.state === "match") {
    return { label: "Exact match", detail: evidence.detail, tone: "good" };
  }
  if (evidence.state === "mismatch") {
    return { label: "Drift detected", detail: evidence.detail, tone: "bad" };
  }
  return { label: "Unverified", detail: evidence.detail, tone: "warn" };
}

function artifactCustodyState(view: SystemHealthView): ControlState {
  if (!view.health) return { label: "Checking", detail: "Waiting for artifact evidence.", tone: "info" };
  const evidence = view.health.delivery?.artifact;
  if (!evidence) {
    return { label: "Unverified", detail: "This health route does not expose artifact attestation evidence yet.", tone: "warn" };
  }
  if (evidence.state === "attested") return { label: "Attested", detail: evidence.detail, tone: "good" };
  if (evidence.state === "invalid") return { label: "Invalid", detail: evidence.detail, tone: "bad" };
  if (evidence.state === "untrusted") return { label: "No trust root", detail: evidence.detail, tone: "warn" };
  if (evidence.state === "unsigned") return { label: "Unsigned", detail: evidence.detail, tone: "warn" };
  return { label: "Unverified", detail: evidence.detail, tone: "warn" };
}

function openBBState(view: SystemHealthView): ControlState {
  const provider = view.health?.providers.find((item) => item.id === "openbb");
  if (!view.health) return { label: "Checking", detail: "Provider health has not arrived yet.", tone: "info" };
  if (!provider?.configured) {
    return { label: "Off", detail: provider?.statusDetail ?? "OpenBB is not configured.", tone: "off" };
  }
  if (!provider.ready) return { label: "Degraded", detail: provider.statusDetail, tone: "warn" };
  return { label: "Healthy", detail: provider.statusDetail, tone: "good" };
}

function stateForDeployable(id: string, view: SystemHealthView): ControlState {
  if (id === "workspace") return workspaceState(view);
  if (id === "gateway") return gatewayState(view);
  return openBBState(view);
}

function PipelineStrip() {
  return (
    <div className="developer-cp-pipeline" aria-label="Configured delivery pipeline">
      {PIPELINE_STAGES.map((stage, index) => (
        <div className="developer-cp-pipeline__stage" key={stage.name}>
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

function SchemaGateTable({ view, compact = false }: { view: SystemHealthView; compact?: boolean }) {
  const liveSchema = schemaCompatibilityState(view);
  const rows = SCHEMA_GATES.map((row) => row.object === "Production schema"
    ? { ...row, impact: liveSchema.label, tone: liveSchema.tone, detail: liveSchema.detail }
    : { ...row, detail: `${row.baseline} → ${row.candidate}` });
  return (
    <div className={`developer-cp-table${compact ? " is-compact" : ""}`} role="table" aria-label="Schema compatibility gates">
      <div className="developer-cp-table__row is-head" role="row">
        <span role="columnheader">Contract</span><span role="columnheader">Baseline</span><span role="columnheader">Candidate</span><span role="columnheader">State</span>
      </div>
      {rows.map((row) => (
        <div className="developer-cp-table__row" role="row" key={row.object}>
          <strong role="cell">{row.object}</strong>
          <code role="cell">{row.baseline}</code>
          <span role="cell">{row.candidate}</span>
          <StatusPill state={{ label: row.impact, detail: row.detail, tone: row.tone }} compact role="cell" />
        </div>
      ))}
    </div>
  );
}

function ArtifactLineage({ view, compact = false }: { view: SystemHealthView; compact?: boolean }) {
  const states = Object.fromEntries(DEPLOYABLES.map((item) => [item.id, stateForDeployable(item.id, view)]));
  return (
    <div className={`developer-cp-artifacts${compact ? " is-compact" : ""}`} role="table" aria-label="Deployment artifact lineage">
      <div className="developer-cp-artifacts__row is-head" role="row">
        <span role="columnheader">Commit / build</span><span role="columnheader">Artifact</span><span role="columnheader">Runtime</span><span role="columnheader">Environment</span>
      </div>
      {DEPLOYABLES.map((deployable) => (
        <div className="developer-cp-artifacts__row" role="row" key={deployable.id}>
          <code role="cell">{deployable.id === "workspace" ? APP_COMMIT : "runtime"}</code>
          <span role="cell"><strong>{deployable.name}</strong><small>{deployable.stack}</small></span>
          <code role="cell">{deployable.entry}</code>
          <StatusPill state={states[deployable.id]} compact role="cell" />
        </div>
      ))}
    </div>
  );
}

interface DeveloperOverviewProps {
  view: SystemHealthView;
  workspaceSymbol: string;
  workItems: DeveloperWorkItem[];
  onOpenSection: (section: DeveloperSection) => void;
  onOpenResearch: () => void;
  onOpenLive: () => void;
  onOpenReliability: () => void;
}

function DeveloperOverview({
  view,
  workspaceSymbol,
  workItems,
  onOpenSection,
  onOpenResearch,
  onOpenLive,
  onOpenReliability,
}: DeveloperOverviewProps) {
  const deploymentStates = DEPLOYABLES.map((deployable) => ({
    deployable,
    state: stateForDeployable(deployable.id, view),
  }));
  const currentWorkspace = workspaceState(view);
  const currentGateway = gatewayState(view);
  const currentSchema = schemaCompatibilityState(view);
  const currentArtifact = artifactCustodyState(view);
  const readinessChecks = [
    {
      label: "Deployment",
      value: IS_VERCEL_DEPLOYMENT ? currentWorkspace.label : "Not deployed",
      passed: IS_VERCEL_DEPLOYMENT && currentWorkspace.tone === "good",
      detail: currentWorkspace.detail,
    },
    { label: "Gateway", value: currentGateway.label, passed: currentGateway.tone === "good", detail: currentGateway.detail },
    {
      label: "Providers",
      value: view.health ? `${view.health.summary.ready}/${view.health.summary.total}` : "Checking",
      passed: Boolean(view.health?.summary.total && view.health.summary.ready === view.health.summary.total),
      detail: view.health
        ? `${view.health.summary.configured} configured; ${view.health.summary.ready} currently routable.`
        : "Waiting for provider health.",
    },
    { label: "Schema compatibility", value: currentSchema.label, passed: currentSchema.tone === "good", detail: currentSchema.detail },
    { label: "Artifact custody", value: currentArtifact.label, passed: currentArtifact.tone === "good", detail: currentArtifact.detail },
  ];
  const readyCount = readinessChecks.filter((check) => check.passed).length;
  const blockedChecks = readinessChecks.filter((check) => !check.passed);
  const readinessAngle = `${Math.round((readyCount / readinessChecks.length) * 360)}deg`;
  const openWork = workItems.filter((item) => item.status !== "done");

  return (
    <div className="developer-cp-overview">
      {view.healthError && (
        <div className="banner error" role="alert">
          <span aria-hidden>✕</span>
          <div><strong>Health snapshot is stale.</strong> {view.healthError}</div>
        </div>
      )}

      <div className="developer-cp-overview__grid">
        <section className="card developer-cp-topology">
          <div className="developer-cp-heading">
            <div><span>Runtime map</span><h2>Deployment topology</h2></div>
            <button className="text-action" type="button" onClick={() => onOpenSection("quality")}>Open CI / CD →</button>
          </div>
          <div className="developer-cp-edge">
            <span>{IS_VERCEL_DEPLOYMENT ? "Vercel edge" : "Local runtime"}</span>
            <StatusPill state={currentWorkspace} compact />
          </div>
          <div className="developer-cp-topology__line" aria-hidden="true" />
          <div className="developer-cp-topology__nodes">
            {deploymentStates.map(({ deployable, state }, index) => (
              <article key={deployable.id} className={`developer-cp-node is-${state.tone}`}>
                <div><span className="num">0{index + 1}</span><StatusPill state={state} compact /></div>
                <h3>{deployable.name}</h3>
                <p>{deployable.role}</p>
                <code>{deployable.entry}</code>
                <small>{deployable.detail}</small>
              </article>
            ))}
          </div>
          <div className="developer-cp-legend">
            <span><i className="is-good" />Healthy</span>
            <span><i className="is-warn" />Degraded</span>
            <span><i className="is-off" />Off / not configured</span>
          </div>
        </section>

        <section className="card developer-cp-readiness">
          <div className="developer-cp-heading"><div><span>Promotion gates</span><h2>Launch readiness</h2></div></div>
          <div
            className="developer-cp-readiness__ring"
            style={{ "--developer-readiness-angle": readinessAngle } as CSSProperties}
            aria-label={`${readyCount} of ${readinessChecks.length} readiness checks pass`}
          >
            <div><strong>{readyCount}<span>/{readinessChecks.length}</span></strong><small>PASS</small></div>
          </div>
          <strong className="developer-cp-readiness__verdict">{readyCount === readinessChecks.length ? "READY" : "BLOCKED"}</strong>
          <div className="developer-cp-readiness__checks">
            {readinessChecks.map((check) => (
              <div key={check.label}>
                <i className={check.passed ? "is-good" : "is-warn"} aria-hidden="true">{check.passed ? "✓" : "!"}</i>
                <span><b>{check.label}</b><small>{check.detail}</small></span><strong>{check.value}</strong>
              </div>
            ))}
          </div>
          <p>
            {blockedChecks.length
              ? `${blockedChecks.map((check) => check.label).join(", ")} ${blockedChecks.length === 1 ? "is" : "are"} blocking launch.`
              : "All five launch gates have current evidence."}
          </p>
        </section>

        <section className="card developer-cp-pipeline-card">
          <div className="developer-cp-heading">
            <div><span>Delivery path</span><h2>CI pipeline</h2></div>
            <a className="text-action" href={`${GITHUB_REPOSITORY_ROOT}/actions`} target="_blank" rel="noreferrer">Open Actions ↗</a>
          </div>
          <PipelineStrip />
          <p className="developer-cp-disclosure">Stages are configured delivery evidence. GitHub Actions remains the authority for the current run conclusion.</p>
        </section>

        {/* The CI counts were prose inside the pipeline card — "342", "680",
            "13" as three numbers in three sentences. Drawn against each other
            they say the thing the sentences could not: nearly every test in
            this delivery is in the web workspace, and the repository audit
            contributes none because it asserts a tree rather than behaviour. */}
        <section className="card developer-cp-tests-card">
          <div className="developer-cp-heading">
            <div><span>Verification weight</span><h2>Automated checks by job</h2></div>
            <span className="section-note">committed gates · GitHub Actions is the authority</span>
          </div>
          <CategoryBars
            ariaLabel="Number of automated checks contributed by each CI job."
            rows={CI_JOBS.map((job) => ({
              label: job.name,
              note: job.count == null ? "tree audit" : `${job.count} checks`,
              segments: [{ label: "automated checks", value: job.count ?? 0, color: "var(--series-1)" }],
            }))}
            emptyNote="No job reports a check count."
          />
          <p className="developer-cp-disclosure">
            Counts are the gates configured in this repository, not the conclusion of the last run.
          </p>
        </section>

        <section className="card developer-cp-schema-card">
          <div className="developer-cp-heading">
            <div><span>Contract custody</span><h2>Schema diff</h2></div>
            <button className="text-action" type="button" onClick={() => onOpenSection("apis")}>Inspect routes →</button>
          </div>
          <SchemaGateTable view={view} compact />
        </section>

        <section className="card developer-cp-artifact-card">
          <div className="developer-cp-heading">
            <div><span>Build custody</span><h2>Artifact lineage</h2></div>
            <StatusPill state={currentArtifact} compact />
          </div>
          <ArtifactLineage view={view} compact />
        </section>
      </div>

      <section className="card developer-cp-context">
        <div>
          <span>Shared desk context</span>
          <h2>Trace a change into the running workflow</h2>
          <p><strong className="num">{workspaceSymbol}</strong> stays shared across research, execution, reliability, and this control plane.</p>
        </div>
        <div className="developer-cp-context__facts">
          <span><strong>{REPOSITORY_STATS.files}</strong> files</span>
          <span><strong>{API_OPERATIONS.length}</strong> API operations</span>
          <span><strong>{openWork.length}</strong> open tasks</span>
        </div>
        <div className="developer-cp-context__actions">
          <button type="button" className="primary-action" onClick={onOpenResearch}>Research {workspaceSymbol}</button>
          <button type="button" onClick={onOpenLive}>Open live book</button>
          <button type="button" onClick={onOpenReliability}>Open Reliability</button>
        </div>
      </section>
    </div>
  );
}

function DeveloperPipelines({ view }: { view: SystemHealthView }) {
  const totalTests = CI_JOBS.reduce((sum, job) => sum + (job.count ?? 0), 0);
  return (
    <div className="developer-cp-stack">
      <section className="card developer-cp-section-hero">
        <div>
          <span>Delivery workflow</span>
          <h2>Pipeline execution and release custody</h2>
          <p>Configured checks are visible here; the linked Actions run remains the source of truth for pending, passing, or failed state.</p>
        </div>
        <div className="developer-cp-section-hero__actions">
          <StatusPill state={{ label: `${totalTests} tests`, detail: "Documented offline baseline across three suites.", tone: "info" }} />
          <a className="primary-action" href={`${GITHUB_REPOSITORY_ROOT}/actions`} target="_blank" rel="noreferrer">Open GitHub Actions ↗</a>
        </div>
      </section>

      <section className="card developer-cp-pipeline-card">
        <div className="developer-cp-heading"><div><span>Current build path</span><h2>Commit {APP_COMMIT}</h2></div><StatusPill state={workspaceState(view)} /></div>
        <PipelineStrip />
      </section>

      <section className="card developer-cp-jobs">
        <div className="developer-cp-heading"><div><span>Verification matrix</span><h2>Configured jobs</h2></div><span>Every push</span></div>
        <div className="developer-cp-jobs__table" role="table" aria-label="Continuous integration jobs">
          <div className="developer-cp-jobs__row is-head" role="row"><span role="columnheader">Job</span><span role="columnheader">Evidence</span><span role="columnheader">Command</span><span role="columnheader">Baseline</span></div>
          {CI_JOBS.map((job) => (
            <div className="developer-cp-jobs__row" role="row" key={job.name}>
              <strong role="cell">{job.name}</strong><span role="cell">{job.evidence}</span><code role="cell">{job.command}</code><span role="cell">{job.count === null ? "tree audit" : `${job.count} tests`}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card developer-cp-artifact-card">
        <div className="developer-cp-heading"><div><span>Artifact registry</span><h2>Deployable lineage</h2></div><span>Runtime-observed state</span></div>
        <ArtifactLineage view={view} />
        <p className="developer-cp-disclosure">Artifact custody passes only when the pinned Ed25519 signer attests the deployment&apos;s full commit, environment, and content-addressed build provenance. Downloadable release bundles and promotion records remain separate evidence.</p>
      </section>
    </div>
  );
}

function DeveloperInterfaces({ view }: { view: SystemHealthView }) {
  const liveSchema = schemaCompatibilityState(view);
  return (
    <div className="developer-cp-stack">
      <section className="card developer-cp-section-hero">
        <div><span>Contract intelligence</span><h2>API &amp; Schema</h2><p>Browse the current route inventory and see exactly which compatibility gates are automated versus still missing.</p></div>
        <StatusPill state={{ label: `${API_OPERATIONS.length} operations`, detail: "Route handlers indexed from this runtime.", tone: "info" }} />
      </section>
      <section className="card developer-cp-schema-card">
        <div className="developer-cp-heading"><div><span>Breaking-change guard</span><h2>Schema compatibility</h2></div><StatusPill state={liveSchema} /></div>
        <SchemaGateTable view={view} />
      </section>
      <DeveloperApiCatalog />
    </div>
  );
}

function DeveloperChanges() {
  return (
    <div className="developer-cp-stack">
      <section className="card developer-cp-section-hero">
        <div><span>Repository evidence</span><h2>Code &amp; Diffs</h2><p>This runtime exposes the committed path manifest, not arbitrary source contents. GitHub remains the authenticated surface for blame, history, and executable diffs.</p></div>
        <div className="developer-cp-section-hero__actions">
          <StatusPill state={{ label: APP_COMMIT, detail: "Build-time Git identity.", tone: APP_COMMIT === "dev" ? "warn" : "good" }} />
          <a className="primary-action" href={APP_COMMIT === "dev" ? `${GITHUB_REPOSITORY_ROOT}/commits/main` : `${GITHUB_REPOSITORY_ROOT}/commit/${APP_COMMIT}`} target="_blank" rel="noreferrer">Open commit ↗</a>
        </div>
      </section>
      <div className="developer-cp-change-summary">
        <section className="card"><span>Repository snapshot</span><strong>{REPOSITORY_STATS.files}</strong><small>{REPOSITORY_STATS.areas} owned code areas</small></section>
        <section className="card"><span>Verification files</span><strong>{REPOSITORY_STATS.tests}</strong><small>tests indexed in committed HEAD</small></section>
        <section className="card"><span>API routes</span><strong>{REPOSITORY_STATS.webRoutes}</strong><small>server-side route handlers</small></section>
      </div>
      <CodebaseExplorer />
    </div>
  );
}

export interface DeveloperConsoleProps {
  view: SystemHealthView;
  workspaceSymbol: string;
  onOpenResearch: () => void;
  onOpenLive: () => void;
  onOpenReliability: () => void;
  section: DeveloperSection;
  onSectionChange: (section: DeveloperSection) => void;
  workItems: DeveloperWorkItem[];
  onWorkItemsChange: (items: DeveloperWorkItem[]) => void;
}

export default function DeveloperConsole({
  view,
  workspaceSymbol,
  onOpenResearch,
  onOpenLive,
  onOpenReliability,
  section,
  onSectionChange,
  workItems,
  onWorkItemsChange,
}: DeveloperConsoleProps) {
  const openWork = workItems.filter((item) => item.status !== "done");
  const currentState = workspaceState(view);
  const openSection = (next: DeveloperSection) => {
    onSectionChange(next);
    window.requestAnimationFrame(() => document.getElementById(`developer-subtab-${next}`)?.focus());
  };

  return (
    <div className="developer-control-plane">
      <PageHead
        kicker="Quant developer"
        title="Developer"
        description="What is deployed, what CI proved, and where the schema contracts stand — against this exact revision."
        metrics={[
          { label: "Repository", value: "Developer_Analyst_Infra", note: "committed delivery tree", mono: false },
          { label: "Revision", value: `main@${APP_COMMIT}`, note: HAS_COMMIT_IDENTITY ? "build identity" : "no commit stamped" },
          { label: "Environment", value: RUNTIME_LABEL, note: IS_VERCEL_DEPLOYMENT ? "hosted build" : "unverified local output", mono: false },
          {
            label: "Engineering queue",
            value: `${openWork.length} open`,
            note: "session-scoped",
            tone: openWork.length ? "warn" : "good",
          },
        ]}
        status={{
          label: currentState.label,
          tone: currentState.tone === "bad" ? "critical" : currentState.tone === "good" ? "good" : currentState.tone === "warn" ? "warn" : "neutral",
        }}
        actions={
          <button type="button" onClick={() => void view.refresh(false)} disabled={view.busyAction !== null}>
            Refresh health
          </button>
        }
      />

      <WorkspaceSubtabs
        workspaceId="developer"
        label="Developer control-plane sections"
        tabs={DEVELOPER_SECTIONS}
        activeId={section}
        onChange={onSectionChange}
        secondary={["work"]}
      />

      <WorkspaceSubtabPanel workspaceId="developer" tabId="overview" activeId={section}>
        <DeveloperOverview
          view={view}
          workspaceSymbol={workspaceSymbol}
          workItems={workItems}
          onOpenSection={openSection}
          onOpenResearch={onOpenResearch}
          onOpenLive={onOpenLive}
          onOpenReliability={onOpenReliability}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="developer" tabId="quality" activeId={section}>
        <DeveloperPipelines view={view} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="developer" tabId="apis" activeId={section}>
        <DeveloperInterfaces view={view} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="developer" tabId="codebase" activeId={section}>
        <DeveloperChanges />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="developer" tabId="work" activeId={section}>
        <div className="developer-cp-stack">
          <section className="card developer-cp-section-hero">
            <div><span>Engineering impact</span><h2>Task Queue</h2><p>Features, bugs, and delivery tickets only. Changes remain session-local until an authenticated tracker is connected.</p></div>
            <StatusPill state={{ label: `${openWork.length} open`, detail: "Session-scoped engineering queue.", tone: openWork.length ? "warn" : "good" }} />
          </section>
          <DeveloperWorkQueue items={workItems} onItemsChange={onWorkItemsChange} />
        </div>
      </WorkspaceSubtabPanel>
    </div>
  );
}
