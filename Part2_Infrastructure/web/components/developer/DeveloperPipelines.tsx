"use client";

/**
 * CI / CD, as two panes, because it answered two questions in one scroll and
 * they have different sources.
 *
 * Split out of `DeveloperConsole` when that file passed the length ceiling.
 * Pipeline reads build-time identity — the commit, the environment, whether a
 * Vercel artifact exists — so it describes THIS build and changes on every
 * deploy. Verification reads the committed job matrix and the runtime artifact
 * lineage: what the gates prove, and which deployable each conclusion belongs
 * to. A reader arriving from "Open CI / CD" on the topology card wants the
 * first; a reader checking what shipped wants the second, and used to have to
 * scroll a full pipeline strip past it.
 *
 * **The test totals are measured, not remembered, and they say when.** Both
 * places a reader takes a total from — the hero pill and the verification
 * matrix heading — carry `TEST_COUNTS.generatedOn`. A generated figure with no
 * visible date is a hand-copied figure one step removed: right until it
 * silently is not, with no way for the reader to tell how old "right" is.
 */

import { useState, type CSSProperties } from "react";

import CategoryBars from "@/components/charts/CategoryBars";
import type { SystemHealthView } from "@/lib/use-system-health";
import { TEST_COUNTS } from "@/lib/test-counts.generated";
import { APP_COMMIT } from "@/lib/version";

import { GITHUB_REPOSITORY_ROOT } from "./console-identity";
import { ArtifactLineage, PipelineStrip, StatusPill, workspaceState } from "./DeveloperStatus";

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
    evidence: "pytest, ruff, OpenAPI snapshot, money-path probe",
  },
  {
    name: "Web workspace",
    count: TEST_COUNTS.web.total,
    command: "npm test && npm run typecheck && npm run build",
    evidence: "domain tests, contract fixtures, strict TypeScript, Next.js build",
  },
  {
    name: "OpenBB service",
    count: TEST_COUNTS.service.total,
    command: "python -m pytest",
    evidence: "provider façade, authentication, API contracts",
  },
  {
    name: "Repository audit",
    count: null,
    command: "tools/check_repo_complete.sh",
    evidence: "exports Git HEAD, verifies the committed tree",
  },
] as const;

type QualityPane = "pipeline" | "verification";

const QUALITY_PANES: Array<{ id: QualityPane; label: string; hint: string }> = [
  { id: "pipeline", label: "Pipeline", hint: "The stages this commit travels, and how far this build got" },
  { id: "verification", label: "Verification", hint: "What the configured gates prove, and for which artifact" },
];

export default function DeveloperPipelines({ view }: { view: SystemHealthView }) {
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
            {/* Panes conditionally remount (the rule recorded above), so the
                stagger replays exactly on pane switch and never on re-render. */}
            <section className="card developer-cp-section-hero stagger-reveal" style={{ "--stagger-i": 0 } as CSSProperties}>
              <div>
                <span>Delivery workflow</span>
                <h2>Pipeline execution</h2>
                <p>Configured checks only; the linked Actions run carries the verdicts.</p>
              </div>
              <div className="developer-cp-section-hero__actions">
                <StatusPill
                  state={{
                    label: `${totalTests} tests, counted ${TEST_COUNTS.generatedOn}`,
                    detail: "Counted by scripts/refresh-test-counts.mjs; not re-measured by this build.",
                    tone: "info",
                  }}
                />
                <a className="text-action" href={`${GITHUB_REPOSITORY_ROOT}/actions`} target="_blank" rel="noreferrer">Open GitHub Actions ↗</a>
              </div>
            </section>

            <section className="card developer-cp-pipeline-card stagger-reveal" style={{ "--stagger-i": 1 } as CSSProperties}>
              <div className="developer-cp-heading"><div><span>Current build path</span><h2>Commit {APP_COMMIT}</h2></div><StatusPill state={workspaceState(view)} live={workspaceState(view).tone === "good"} /></div>
              <PipelineStrip />
            </section>
          </>
        )}

        {pane === "verification" && (
          <>
            <section className="card developer-cp-jobs stagger-reveal" style={{ "--stagger-i": 0 } as CSSProperties}>
              <div className="developer-cp-heading"><div><span>Verification matrix</span><h2>Configured jobs</h2></div><span>Every push; counts as of {TEST_COUNTS.generatedOn}</span></div>
              <div className="developer-cp-jobs__table" role="table" aria-label="Continuous integration jobs">
                <div className="developer-cp-jobs__row is-head" role="row"><span role="columnheader">Job</span><span role="columnheader">Evidence</span><span role="columnheader">Command</span><span role="columnheader">Baseline</span></div>
                {CI_JOBS.map((job, index) => (
                  <div
                    className="developer-cp-jobs__row stagger-reveal"
                    style={{ "--stagger-i": index } as CSSProperties}
                    role="row"
                    key={job.name}
                  >
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

            <section className="card developer-cp-artifact-card stagger-reveal" style={{ "--stagger-i": 1 } as CSSProperties}>
              <div className="developer-cp-heading"><div><span>Artifact registry</span><h2>Deployable lineage</h2></div><span>Runtime-observed state</span></div>
              <ArtifactLineage view={view} />
              {/* The definition, not the verdict. What "Attested" means — and
                  which evidence it does NOT cover — is read once and not on
                  every visit, so it folds; the custody reading itself is a pill
                  on the lineage rows above and stays on screen, as does the
                  four-column table this sits under, which is why folding this
                  leaves runtime state rather than a blank card. The summary
                  names the two questions and answers neither. */}
              <details className="developer-cp-disclosure disclosure">
                <summary>What custody attests, and what it leaves to other evidence</summary>
                <p>Custody passes only when the pinned Ed25519 signer attests this commit, environment and build provenance; release bundles and promotion records are separate evidence.</p>
              </details>
            </section>
          </>
        )}
      </div>
    </>
  );
}
