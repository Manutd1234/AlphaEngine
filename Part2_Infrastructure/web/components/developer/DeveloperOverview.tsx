"use client";

/**
 * The Developer tab's two opening sections: the runtime map, and the launch
 * gates with the evidence behind them.
 *
 * Split out of `DeveloperConsole` when that file passed the length ceiling.
 * One component, two `part`s, because both read the same derivation and a
 * second copy of the readiness ladder is exactly the drift this console exists
 * to catch. The section carried seven cards, two of which restated the CI/CD
 * and API sections verbatim — those are gone rather than moved.
 *
 * **The ladder counts THREE verdicts and the third is load-bearing.** READY
 * needs every gate; BLOCKED needs a measured failure; anything else is
 * UNVERIFIED — neither a pass nor a failure. Promotion is refused either way,
 * but the reason differs, and the fix for "could not run" is to restore the
 * evidence rather than to chase a defect. The summary sentence names the two
 * groups separately for that reason, and the marks — ✓ ✕ ◌ — are what tell the
 * three apart, because the dot's colour never does.
 */

import { type CSSProperties } from "react";

import NumberTicker from "@/components/common/NumberTicker";
import { API_OPERATIONS } from "@/components/developer/DeveloperApiCatalog";
import type { DeveloperWorkItem } from "@/lib/developer-work";
import { DEPLOYABLES, REPOSITORY_MANIFEST_PROVENANCE, REPOSITORY_STATS } from "@/lib/repository-catalog";
import type { DeveloperSection } from "@/lib/sections";
import type { SystemHealthView } from "@/lib/use-system-health";
import { IS_VERCEL_DEPLOYMENT } from "@/lib/version";

import {
  ArtifactLineage,
  SchemaGateTable,
  StatusPill,
  artifactCustodyState,
  gateVerdict,
  gatewayState,
  schemaCompatibilityState,
  stateForDeployable,
  type ControlState,
} from "./DeveloperStatus";

interface DeveloperOverviewProps {
  view: SystemHealthView;
  /** The settled workspace reading from the shell's `useWorkspaceHealth` —
   *  never re-derived here, so this section cannot flap beside its siblings. */
  workspaceHealth: ControlState;
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

export default function DeveloperOverview({
  view,
  workspaceHealth,
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
    state: stateForDeployable(deployable.id, view, workspaceHealth),
  }));
  const currentWorkspace = workspaceHealth;
  const currentGateway = gatewayState(view);
  const currentSchema = schemaCompatibilityState(view);
  const currentArtifact = artifactCustodyState(view);
  const readinessChecks = [
    {
      label: "Deployment",
      value: IS_VERCEL_DEPLOYMENT ? currentWorkspace.label : "Not deployed",
      state: IS_VERCEL_DEPLOYMENT ? gateVerdict(currentWorkspace) : "unverified",
      detail: IS_VERCEL_DEPLOYMENT
        ? currentWorkspace.detail
        : "Not a Vercel deployment, so there is no promotion candidate to check.",
    },
    { label: "Gateway", value: currentGateway.label, state: gateVerdict(currentGateway), detail: currentGateway.detail },
    {
      label: "Providers",
      value: view.health
        ? <><NumberTicker value={view.health.summary.ready} />/{view.health.summary.total}</>
        : "Checking",
      // A registry with no providers in it measured nothing; 0 of 0 routable is
      // not a clean sweep and must not be counted as one.
      state: !view.health || !view.health.summary.total
        ? "unverified"
        : view.health.summary.ready === view.health.summary.total ? "pass" : "failed",
      detail: view.health
        ? `${view.health.summary.configured} configured; ${view.health.summary.ready} currently routable.`
        : "Waiting for provider health.",
    },
    { label: "Schema compatibility", value: currentSchema.label, state: gateVerdict(currentSchema), detail: currentSchema.detail },
    { label: "Artifact custody", value: currentArtifact.label, state: gateVerdict(currentArtifact), detail: currentArtifact.detail },
  ];
  const readyCount = readinessChecks.filter((check) => check.state === "pass").length;
  const failedChecks = readinessChecks.filter((check) => check.state === "failed");
  const unverifiedChecks = readinessChecks.filter((check) => check.state === "unverified");
  // Three verdicts, because a gate that could not run has not passed and has
  // not failed. Promotion is refused either way; the reason differs, and the
  // fix for "could not run" is to restore the evidence, not to chase a defect.
  const verdict = readyCount === readinessChecks.length ? "READY" : failedChecks.length ? "BLOCKED" : "UNVERIFIED";
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
          {/* One runtime band and three deployable cards. The previous dashed
              fork repeated a relationship the shared container already says,
              and read as stray guide marks between states. Geometry stays in
              section 7 of `app/globals/14i-density-developer.css`; nothing in
              this markup fixes a width or paints a connector. */}
          <div className="developer-cp-edge">
            <span>{IS_VERCEL_DEPLOYMENT ? "Vercel edge" : "Local runtime"}</span>
            <StatusPill state={currentWorkspace} compact live={currentWorkspace.tone === "good"} />
          </div>
          <div className="developer-cp-topology__nodes">
            {deploymentStates.map(({ deployable, state }, index) => (
              <article
                key={deployable.id}
                className={`developer-cp-node is-${state.tone} stagger-reveal`}
                style={{ "--stagger-i": index } as CSSProperties}
              >
                <div><span className="num">0{index + 1}</span><StatusPill state={state} compact live={state.tone === "good"} /></div>
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
            aria-label={`${readyCount} of ${readinessChecks.length} readiness checks pass, ${failedChecks.length} failed, ${unverifiedChecks.length} could not be checked`}
          >
            <div><strong><NumberTicker value={readyCount} /><span>/{readinessChecks.length}</span></strong><small>PASS</small></div>
          </div>
          {/* Keyed by verdict: the entrance replays only when the word itself
              flips, which is the one moment worth marking. */}
          <strong className="developer-cp-readiness__verdict mount-fade" key={verdict}>{verdict}</strong>
          <div className="developer-cp-readiness__checks">
            {readinessChecks.map((check, index) => (
              <div key={check.label} className="stagger-reveal" style={{ "--stagger-i": index } as CSSProperties}>
                {/* Three marks, three states. A failure and a check that could
                    not run both sit outside the pass count, and the glyph is
                    what tells them apart — the dot's colour never does. */}
                <i className={check.state === "pass" ? "is-good" : "is-warn"} aria-hidden="true">{check.state === "pass" ? "✓" : check.state === "failed" ? "✕" : "◌"}</i>
                {/* `title` on the detail, because the detail is clipped.
                    `.developer-cp-readiness__checks > div > span > small` is
                    `white-space: nowrap; text-overflow: ellipsis`, so in this
                    column "Not a Vercel deployment, so there is no promotion
                    candidate to check." renders as three or four words and an
                    ellipsis. That sentence is the REASON a gate is unverified
                    rather than failed — the one thing the ladder above exists
                    to distinguish — and the summary below names the gate but
                    not its reason. The full string reaches assistive
                    technology either way (clipping is presentational); this is
                    how a sighted reader gets it back, and it is the same
                    affordance `StatusPill` already uses for `state.detail`. */}
                <span><b>{check.label}</b><small title={check.detail}>{check.detail}</small></span><strong>{check.value}</strong>
              </div>
            ))}
          </div>
          <p>
            {failedChecks.length
              ? `${failedChecks.map((check) => check.label).join(", ")} ${failedChecks.length === 1 ? "is" : "are"} blocking launch. `
              : ""}
            {unverifiedChecks.length
              ? `${unverifiedChecks.map((check) => check.label).join(", ")} could not be checked at all, so ${unverifiedChecks.length === 1 ? "it is" : "they are"} neither a pass nor a failure.`
              : failedChecks.length ? "" : "All five gates have current evidence."}
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
          <ArtifactLineage view={view} workspace={workspaceHealth} compact />
        </section>
      </div>

      <section className="card developer-cp-context" hidden={!showTopology}>
        <div>
          <span>Shared desk context</span>
          <h2>Trace a change into the running workflow</h2>
          {/* No sentence: it named the tabs the buttons below already are. */}
        </div>
        <div className="developer-cp-context__facts">
          <span title={`Manifest generated ${REPOSITORY_MANIFEST_PROVENANCE.generatedAt} at ${REPOSITORY_MANIFEST_PROVENANCE.commit}`}>
            <strong>{REPOSITORY_STATS.files}</strong> files
          </span>
          <span><strong>{API_OPERATIONS.length}</strong> API operations</span>
          <span><strong><NumberTicker value={openWork.length} /></strong> open tasks</span>
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
