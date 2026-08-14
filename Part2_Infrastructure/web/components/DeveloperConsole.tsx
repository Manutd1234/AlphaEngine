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

import { useMemo, useState, type CSSProperties } from "react";

import CodebaseExplorer from "@/components/developer/CodebaseExplorer";
import DeveloperApiCatalog, { API_OPERATIONS } from "@/components/developer/DeveloperApiCatalog";
import DeveloperWorkQueue from "@/components/developer/DeveloperWorkQueue";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import CategoryBars from "@/components/charts/CategoryBars";
import PageHead from "@/components/workspace/PageHead";
import { canonicalJson } from "@/lib/canonical-json";
import type { DeveloperWorkItem } from "@/lib/developer-work";
import { mcParityFixture, MC_PARITY_PATHS } from "@/lib/mc-parity";
import { MC_PARITY_REFERENCE_JSON, MC_PARITY_REFERENCE_SHA256 } from "@/lib/mc-parity-reference.generated";
import { DEVELOPER_SECTIONS, type DeveloperSection } from "@/lib/sections";
import { TEST_COUNTS } from "@/lib/test-counts.generated";
import { useMcDistribution } from "@/lib/use-mc-distribution";
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

export { type DeveloperSection } from "@/lib/sections";

type ControlTone = "good" | "warn" | "bad" | "off" | "info";

interface ControlState {
  label: string;
  detail: string;
  tone: ControlTone;
}

/*
 * Measured, not remembered.
 *
 * These were three hand-copied integers and they drifted three times: first
 * 342/680/13 against a real 667/1976/13 — the pill below sums them, so the tab
 * advertised "1035 tests" while the suites ran 2650 — then 667/1976 against
 * 691/2013, then 2013 against 2169 inside a single afternoon.
 *
 * A figure nobody can reproduce is the one defect this console exists to
 * catch, so the console had stopped being able to make the claim honestly.
 * `scripts/refresh-test-counts.mjs` now runs the three suites and writes what
 * they print; each row's `command` is how a reader checks it themselves.
 */
const CI_JOBS = [
  {
    name: "Gateway",
    count: TEST_COUNTS.gateway.total,
    command: "python -m pytest",
    evidence: "pytest · ruff · OpenAPI snapshot · money-path probe",
  },
  {
    name: "Web workspace",
    count: TEST_COUNTS.web.total,
    command: "npm test && npm run typecheck && npm run build",
    evidence: "domain tests · contract fixtures · strict TypeScript · Next.js build",
  },
  {
    name: "OpenBB service",
    count: TEST_COUNTS.service.total,
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
  {
    object: "Monte Carlo numerics",
    baseline: "Committed reference",
    candidate: "Node · this instance",
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

function numericsParityState(view: SystemHealthView): ControlState {
  if (!view.health) return { label: "Checking", detail: "Waiting for delivery evidence.", tone: "info" };
  const evidence = view.health.delivery?.numerics;
  if (!evidence) {
    return { label: "Unverified", detail: "This health route does not expose numerics parity evidence yet.", tone: "warn" };
  }
  if (evidence.state === "match") {
    return {
      label: "Byte-exact",
      detail: `${evidence.detail} sha256 ${evidence.expectedDigest.slice(0, 12)}…`,
      tone: "good",
    };
  }
  return { label: "Drift detected", detail: evidence.detail, tone: "bad" };
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
  /** `topology` is the runtime map and shared context; `readiness` is the
   *  launch gates with the schema and artifact evidence behind them. The
   *  section carried seven cards, two of which restated the CI/CD and
   *  API sections verbatim — those are gone rather than moved. */
  part?: "topology" | "readiness";
}

function DeveloperOverview({
  view,
  workspaceSymbol,
  workItems,
  onOpenSection,
  onOpenResearch,
  onOpenLive,
  onOpenReliability,
  part = "topology",
}: DeveloperOverviewProps) {
  const showTopology = part === "topology";
  const showReadiness = part === "readiness";
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
        <section className="card developer-cp-topology" hidden={!showTopology}>
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

        <section className="card developer-cp-readiness" hidden={!showReadiness}>
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

        <section className="card developer-cp-schema-card" hidden={!showReadiness}>
          <div className="developer-cp-heading">
            <div><span>Contract custody</span><h2>Schema diff</h2></div>
            <button className="text-action" type="button" onClick={() => onOpenSection("apis")}>Inspect routes →</button>
          </div>
          <SchemaGateTable view={view} compact />
        </section>

        <section className="card developer-cp-artifact-card" hidden={!showReadiness}>
          <div className="developer-cp-heading">
            <div><span>Build custody</span><h2>Artifact lineage</h2></div>
            <StatusPill state={currentArtifact} compact />
          </div>
          <ArtifactLineage view={view} compact />
        </section>
      </div>

      <section className="card developer-cp-context" hidden={!showTopology}>
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
          {/* Three cross-tab links, three identical treatments. One of them
              used to wear the fill that Send order wears. */}
          <button type="button" onClick={onOpenResearch}>Research {workspaceSymbol}</button>
          <button type="button" onClick={onOpenLive}>Open live book</button>
          <button type="button" onClick={onOpenReliability}>Open Reliability</button>
        </div>
      </section>
    </div>
  );
}

/**
 * CI / CD answered two questions in one scroll, and they have different
 * sources. Pipeline reads build-time identity — the commit, the environment,
 * whether a Vercel artifact exists — so it describes THIS build and changes on
 * every deploy. Verification reads the committed job matrix and the runtime
 * artifact lineage: what the gates prove, and which deployable each conclusion
 * belongs to. A reader arriving from "Open CI / CD" on the topology card wants
 * the first; a reader checking what shipped wants the second, and used to have
 * to scroll a full pipeline strip past it.
 */
type QualityPane = "pipeline" | "verification";

const QUALITY_PANES: Array<{ id: QualityPane; label: string; hint: string }> = [
  { id: "pipeline", label: "Pipeline", hint: "The stages this commit travels, and how far the build in front of you actually got" },
  { id: "verification", label: "Verification", hint: "What the configured gates prove, at what cost, and which artifact each conclusion belongs to" },
];

function DeveloperPipelines({ view }: { view: SystemHealthView }) {
  const [pane, setPane] = useState<QualityPane>("pipeline");
  const totalTests = CI_JOBS.reduce((sum, job) => sum + (job.count ?? 0), 0);
  return (
    <>
      {/* The switcher sits outside `.developer-cp-stack`, in the subtab panel's
          own block flow, exactly as the Positions and Remediation switchers do.
          Inside the stack it would be a grid item: `.developer-cp-artifact-card`
          carries `grid-column: span 6` for the Readiness grid, and a six-column
          span in a container with no explicit columns creates six implicit ones,
          which lands the switcher in column 1 beside the first card rather than
          above it. */}
      <div className="seg" role="group" aria-label="CI / CD view">
        {QUALITY_PANES.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={pane === option.id}
            title={option.hint}
            onClick={() => setPane(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="developer-cp-stack">
        {/* Conditional renders, never `hidden` — the same rule Remediation
            records. Nothing here polls, but a pane left mounted is a pane that
            starts polling the day someone gives it a live source. */}
        {pane === "pipeline" && (
          <>
            <section className="card developer-cp-section-hero">
              <div>
                <span>Delivery workflow</span>
                <h2>Pipeline execution and release custody</h2>
                <p>Configured checks are visible here; the linked Actions run remains the source of truth for pending, passing, or failed state.</p>
              </div>
              <div className="developer-cp-section-hero__actions">
                <StatusPill state={{ label: `${totalTests} tests`, detail: "Documented offline baseline across three suites.", tone: "info" }} />
                <a className="text-action" href={`${GITHUB_REPOSITORY_ROOT}/actions`} target="_blank" rel="noreferrer">Open GitHub Actions ↗</a>
              </div>
            </section>

            <section className="card developer-cp-pipeline-card">
              <div className="developer-cp-heading"><div><span>Current build path</span><h2>Commit {APP_COMMIT}</h2></div><StatusPill state={workspaceState(view)} /></div>
              <PipelineStrip />
            </section>
          </>
        )}

        {pane === "verification" && (
          <>
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

              {/* The same four rows as bars, on one shared scale. `CategoryBars`'
                  own header names this exact caller — "CI test counts" — and the
                  import sat unused since it was written, which is its own small
                  evidence that nothing in this project catches a dead import.

                  Worth drawing rather than only tabulating: the numbers span an
                  order of magnitude, and a column of right-aligned figures hides
                  that the web suite is most of the estate. The tree audit has no
                  count and is deliberately absent rather than plotted as zero. */}
              <CategoryBars
                rows={CI_JOBS.filter((job) => job.count !== null).map((job) => ({
                  label: job.name,
                  note: `${job.count} tests`,
                  segments: [{ label: "tests", value: job.count ?? 0, color: "var(--series-1)" }],
                }))}
                ariaLabel="Test count by continuous-integration suite"
                emptyNote="No suite reports a documented baseline."
              />
            </section>

            <section className="card developer-cp-artifact-card">
              <div className="developer-cp-heading"><div><span>Artifact registry</span><h2>Deployable lineage</h2></div><span>Runtime-observed state</span></div>
              <ArtifactLineage view={view} />
              <p className="developer-cp-disclosure">Artifact custody passes only when the pinned Ed25519 signer attests the deployment&apos;s full commit, environment, and content-addressed build provenance. Downloadable release bundles and promotion records remain separate evidence.</p>
            </section>
          </>
        )}
      </div>
    </>
  );
}

/**
 * The third runtime of the numerics-parity claim: the committed reference was
 * authored offline, the server recomputes it per instance (the "Monte Carlo
 * numerics" row of the schema table, one pane away in Contracts), and this
 * button recomputes it in the visitor's own browser — same Blob worker the Risk
 * tab simulates with, same canonical serialisation, compared byte for byte.
 * Nothing is sent anywhere; the comparison is local.
 */
function McBrowserParityCheck() {
  const [runNonce, setRunNonce] = useState(0);
  const requested = runNonce > 0;
  // `nonce` changes request identity so "Run again" genuinely re-runs; the
  // math ignores it, so the result bytes stay comparable.
  const request = useMemo(() => (requested ? { ...mcParityFixture(), nonce: runNonce } : null), [requested, runNonce]);
  const simulation = useMcDistribution(request);

  let state: ControlState;
  if (!requested) {
    state = {
      label: "Not run",
      detail: "Runs entirely in this tab; nothing is uploaded.",
      tone: "off",
    };
  } else if (simulation.status === "error") {
    state = { label: "Failed", detail: simulation.error ?? "The simulation did not complete.", tone: "bad" };
  } else if (simulation.status !== "done" || !simulation.result) {
    state = { label: "Running", detail: "Simulating in this browser…", tone: "info" };
  } else if (canonicalJson(simulation.result) === MC_PARITY_REFERENCE_JSON) {
    state = {
      label: "Byte-exact",
      detail: `This browser (${simulation.engine === "worker" ? "worker thread" : "main thread"}) reproduced sha256 ${MC_PARITY_REFERENCE_SHA256.slice(0, 12)}… exactly.`,
      tone: "good",
    };
  } else {
    state = {
      label: "Differs",
      detail: "This browser's result does not match the committed reference — a real cross-engine numerics finding worth reporting.",
      tone: "bad",
    };
  }

  return (
    <section className="card developer-cp-schema-card">
      <div className="developer-cp-heading">
        <div><span>Numerics custody</span><h2>Run the parity check in this browser</h2></div>
        <StatusPill state={state} />
      </div>
      <p className="developer-cp-disclosure">
        The committed reference, this deployment&apos;s Node runtime and your browser&apos;s worker all
        recompute the same {MC_PARITY_PATHS.toLocaleString()}-path bootstrap simulation; agreement is
        byte-for-byte on the canonical JSON, not &quot;close enough&quot;. {state.detail}
      </p>
      <div className="developer-cp-section-hero__actions">
        <button
          type="button"
          className="primary-action"
          onClick={() => setRunNonce((nonce) => nonce + 1)}
          disabled={requested && simulation.status === "running"}
        >
          {requested && simulation.status === "running" ? "Simulating…" : requested ? "Run again" : "Run in this browser"}
        </button>
      </div>
    </section>
  );
}

/**
 * API and Schema carried three questions in one scroll: which contracts are
 * gated, what the route inventory is, and whether the numerics reproduce.
 *
 * Numerics is the third of those, and it stays here as its own pane rather
 * than moving to Readiness beside artifact custody. Two reasons, one of them
 * about meaning and one about the stylesheet.
 *
 * The browser run is one third of a three-way comparison. The other two — the
 * committed reference and this deployment's Node runtime — are the "Monte
 * Carlo numerics" row of the schema table, one pane away in Contracts. Moving
 * the run to Readiness would separate the reading from the row it corroborates,
 * and a reader who found a mismatch would then hold two sections in their head
 * to say which runtime disagreed.
 *
 * And Readiness is a fixed twelve-column grid: its three cards are pinned by
 * `grid-column` spans in globals.css, so a fourth would land alone on a row
 * with half of it empty. Fixing that is a stylesheet edit, and this component
 * does not own the stylesheet.
 */
type InterfacePane = "contracts" | "routes" | "numerics";

const INTERFACE_PANES: Array<{ id: InterfacePane; label: string; hint: string }> = [
  { id: "contracts", label: "Contracts", hint: "Which compatibility gates are automated against this commit, and which are still unverified" },
  { id: "routes", label: "Routes", hint: "Every operation this runtime serves, searchable by path or purpose, with a curl for each" },
  { id: "numerics", label: "Numerics", hint: "Recompute the committed Monte Carlo reference in this browser and compare it byte for byte" },
];

function DeveloperInterfaces({ view }: { view: SystemHealthView }) {
  const [pane, setPane] = useState<InterfacePane>("contracts");
  const liveSchema = schemaCompatibilityState(view);
  return (
    <>
      {/* Outside the stack, for the reason recorded above `QUALITY_PANES`:
          `.developer-cp-schema-card` spans six columns for the Readiness grid,
          and a stack holding one of those is a six-column grid. */}
      <div className="seg" role="group" aria-label="API and schema view">
        {INTERFACE_PANES.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={pane === option.id}
            title={option.hint}
            onClick={() => setPane(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="developer-cp-stack">
        {/* Conditional renders, never `hidden`. Numerics owns a Blob worker, and
            leaving it mounted behind another pane keeps a simulation the reader
            cannot see holding a thread it cannot stop. */}
        {pane === "contracts" && (
          <>
            <section className="card developer-cp-section-hero">
              <div><span>Contract intelligence</span><h2>API &amp; Schema</h2><p>Browse the current route inventory and see exactly which compatibility gates are automated versus still missing.</p></div>
              <StatusPill state={{ label: `${API_OPERATIONS.length} operations`, detail: "Route handlers indexed from this runtime.", tone: "info" }} />
            </section>
            <section className="card developer-cp-schema-card">
              <div className="developer-cp-heading"><div><span>Breaking-change guard</span><h2>Schema compatibility</h2></div><StatusPill state={liveSchema} /></div>
              <SchemaGateTable view={view} />
            </section>
          </>
        )}

        {pane === "routes" && <DeveloperApiCatalog />}

        {pane === "numerics" && <McBrowserParityCheck />}
      </div>
    </>
  );
}

function DeveloperChanges() {
  return (
    <div className="developer-cp-stack">
      <section className="card developer-cp-section-hero">
        <div><span>Repository evidence</span><h2>Code &amp; Diffs</h2><p>This runtime exposes the committed path manifest, not arbitrary source contents. GitHub remains the authenticated surface for blame, history, and executable diffs.</p></div>
        <div className="developer-cp-section-hero__actions">
          <StatusPill state={{ label: APP_COMMIT, detail: "Build-time Git identity.", tone: APP_COMMIT === "dev" ? "warn" : "good" }} />
          <a className="text-action" href={APP_COMMIT === "dev" ? `${GITHUB_REPOSITORY_ROOT}/commits/main` : `${GITHUB_REPOSITORY_ROOT}/commit/${APP_COMMIT}`} target="_blank" rel="noreferrer">Open commit ↗</a>
        </div>
      </section>
      {/* No stat-card row here: CodebaseExplorer opens with its own labelled
          stats strip reading the same REPOSITORY_STATS — files, tests and
          routes appeared twice in one viewport, back to back, and the strip
          additionally carries Areas. One source on screen. */}
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
      {/* No Refresh control on this head. It called `view.refresh(false)` —
          the identical handler `ConsoleChrome` gives Reliability — against
          `useSystemHealth`, which is one shared 30s poll for every console
          that reads it. Pressing it could not produce a snapshot the poll was
          not already about to fetch, and this tab's evidence is build-time
          identity and committed job definitions, neither of which a refetch
          can change. */}
      <PageHead
        kicker="Quant developer"
        title="Developer"
        description="What is deployed, what CI proved, and where the schema contracts stand."
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
          part="topology"
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="developer" tabId="readiness" activeId={section}>
        <DeveloperOverview
          view={view}
          workspaceSymbol={workspaceSymbol}
          workItems={workItems}
          onOpenSection={openSection}
          onOpenResearch={onOpenResearch}
          onOpenLive={onOpenLive}
          onOpenReliability={onOpenReliability}
          part="readiness"
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
            {/* The session-only caveat is the queue card's own pill and scope
                block, one screen down — not restated here. */}
            <div><span>Engineering impact</span><h2>Task Queue</h2><p>Features, bugs, and delivery tickets only.</p></div>
            <StatusPill state={{ label: `${openWork.length} open`, detail: "Session-scoped engineering queue.", tone: openWork.length ? "warn" : "good" }} />
          </section>
          <DeveloperWorkQueue items={workItems} onItemsChange={onWorkItemsChange} />
        </div>
      </WorkspaceSubtabPanel>
    </div>
  );
}
