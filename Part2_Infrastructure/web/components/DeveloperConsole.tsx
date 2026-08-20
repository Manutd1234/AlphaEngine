"use client";

/**
 * AlphaEngine developer control plane.
 *
 * This is deliberately part of the main workspace rather than a second app.
 * It combines the live health snapshot already owned by `useSystemHealth` with
 * committed delivery evidence. Anything that is not connected to a live
 * source says so explicitly; a polished placeholder must never impersonate a
 * CI conclusion, schema comparison, or signed artifact.
 *
 * This file is now the tab's shell: the head, the section rail and one panel
 * per section. Each section moved to its own file under `components/developer/`
 * when this one passed the length ceiling, along the seams the rail already
 * drew, and the shared vocabulary they all report in — the `ControlState`
 * shape, the three-verdict ladder and the pill that renders them — is
 * `DeveloperStatus`. Nothing about what the console may claim changed: a check
 * that could not run is still neither a pass nor a failure, wherever it is
 * derived.
 */

import CodebaseExplorer from "@/components/developer/CodebaseExplorer";
import DeveloperInterfaces from "@/components/developer/DeveloperInterfaces";
import DeveloperOverview from "@/components/developer/DeveloperOverview";
import DeveloperPipelines from "@/components/developer/DeveloperPipelines";
import DeveloperWorkQueue from "@/components/developer/DeveloperWorkQueue";
import { GITHUB_REPOSITORY_ROOT, HAS_COMMIT_IDENTITY, RUNTIME_LABEL } from "@/components/developer/console-identity";
import { StatusPill, workspaceState } from "@/components/developer/DeveloperStatus";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import FreshnessStamp from "@/components/workspace/FreshnessStamp";
import PageHead from "@/components/workspace/PageHead";
import type { DeveloperWorkItem } from "@/lib/developer-work";
import { DEVELOPER_SECTIONS, type DeveloperSection } from "@/lib/sections";
import type { SystemHealthView } from "@/lib/use-system-health";
import { APP_COMMIT, IS_VERCEL_DEPLOYMENT } from "@/lib/version";

export { type DeveloperSection } from "@/lib/sections";

function DeveloperChanges() {
  return (
    <div className="developer-cp-stack">
      <section className="card developer-cp-section-hero">
        <div><span>Repository evidence</span><h2>Code &amp; Diffs</h2><p>This runtime exposes the committed path manifest, not source contents; GitHub carries blame, history and diffs.</p></div>
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
  /** Whether this workspace is the visible tab; gates the rail's `--rail-h` publisher. */
  active?: boolean;
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
  active = true,
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
          can change. The stamp beside the metrics states that shared poll's
          age — it adds no second poll and no refetch. */}
      <PageHead
        kicker="Quant developer"
        title="Developer"
        description="What is deployed, what CI proved, and where the schema contracts stand."
        actions={<FreshnessStamp updatedAt={view.updatedAt} pollMs={view.pollMs} paused={view.paused} />}
        metrics={[
          { label: "Repository", value: "Developer_Analyst_Infra", note: "committed delivery tree", mono: false },
          { label: "Revision", value: `main@${APP_COMMIT}`, note: HAS_COMMIT_IDENTITY ? "build identity" : "no commit stamped" },
          { label: "Environment", value: RUNTIME_LABEL, note: IS_VERCEL_DEPLOYMENT ? "hosted build" : "unverified local output", mono: false },
          {
            label: "Engineering queue",
            value: `${openWork.length} open`,
            note: "stored in this browser",
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
        active={active}
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
            {/* Two things used to be restated here and the comment that stood
                in their place claimed otherwise. The queue card one screen down
                heads itself "Features, bugs & current tickets", so the noun
                list was printed twice in one viewport; and the count was
                rendered three times — the PageHead tile above the rail reads
                "Engineering queue / N open / stored in this browser", this
                pill repeated both, and the queue's own stats row prints it a
                third time. What is left is the boundary only this line draws:
                where the OTHER kind of work is triaged. */}
            <div><span>Engineering impact</span><h2>Task Queue</h2><p>Data-pipeline work is triaged in Data operations.</p></div>
          </section>
          <DeveloperWorkQueue items={workItems} onItemsChange={onWorkItemsChange} />
        </div>
      </WorkspaceSubtabPanel>
    </div>
  );
}
