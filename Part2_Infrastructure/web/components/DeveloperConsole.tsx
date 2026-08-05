"use client";

/**
 * Quant developer workspace: where is the code, what work is active, and can a
 * change cross its contracts safely? The repository, workflow, APIs, and CI
 * evidence are separate subtabs so each question fits in one viewport instead
 * of becoming a single documentation wall.
 */

import CodebaseExplorer from "@/components/developer/CodebaseExplorer";
import DeveloperApiCatalog, { API_OPERATIONS } from "@/components/developer/DeveloperApiCatalog";
import DeveloperWorkQueue from "@/components/developer/DeveloperWorkQueue";
import { ConsoleChrome, type ConsoleTile } from "@/components/systems/ConsoleChrome";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import type { DeveloperWorkItem } from "@/lib/developer-work";
import { DEPLOYABLES, REPOSITORY_STATS } from "@/lib/repository-catalog";
import type { SystemHealthView } from "@/lib/use-system-health";

export type DeveloperSection = "overview" | "codebase" | "work" | "apis" | "quality";

const DEVELOPER_SECTIONS = [
  { id: "overview", label: "Overview", description: "Architecture & active work" },
  { id: "codebase", label: "Codebase", description: "Every repository path" },
  { id: "work", label: "Work", description: "Features, bugs & tickets" },
  { id: "apis", label: "APIs", description: "Routes & copy-ready calls" },
  { id: "quality", label: "Quality", description: "Tests, contracts & CI" },
] as const;

/** Each entry is a configured CI gate — see .github/workflows/ci.yml. */
const VERIFICATION = [
  {
    gate: "Contract snapshot",
    detail: "tools/export_openapi.py --check diffs the served schema against tools/openapi.json.",
    breaks: "A gateway route or field changing shape without a deliberate snapshot update.",
  },
  {
    gate: "Cross-language parity",
    detail: "TypeScript backtest and risk maths are pinned to Python-generated fixtures.",
    breaks: "The browser and gateway disagreeing on a Sharpe, VaR, fold, or risk contribution.",
  },
  {
    gate: "Gateway contract fixtures",
    detail: "Canonical gateway payloads are replayed through web-side validators.",
    breaks: "A consumer drifting from what the authoritative gateway actually emits.",
  },
  {
    gate: "Money-path probe",
    detail: "tools/synthetic_probe.py walks health → book → cost → risk gate → audit in-process.",
    breaks: "A broken order journey even when its individual units still pass.",
  },
  {
    gate: "Lint, types & build",
    detail: "ruff, strict tsc, and a production Next.js build run before delivery.",
    breaks: "Unsafe Python, payload type drift, route analysis errors, or a failed production bundle.",
  },
] as const;

const TEST_SUITES = [
  { name: "Gateway + companion", count: 241, command: "python -m pytest", detail: "Risk, execution, audit, jobs, research, and Telegram" },
  { name: "Web workspace", count: 377, command: "npm test", detail: "UI structure, domain logic, providers, and parity" },
  { name: "OpenBB service", count: 12, command: "python -m pytest", detail: "Provider facade and authenticated route contracts" },
] as const;

const CI_JOBS = [
  { name: "Gateway", detail: "pytest · ruff · OpenAPI snapshot · money-path probe" },
  { name: "OpenBB service", detail: "isolated provider and API suite" },
  { name: "Web workspace", detail: "tests · strict typecheck · production build" },
  { name: "Repository audit", detail: "exports HEAD and verifies the committed tree" },
] as const;

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
  const openWork = workItems.filter((item) => item.status !== "done");
  const priorityRank = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;
  const nextWork = [...openWork]
    .sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority] || left.openedAt - right.openedAt)
    .slice(0, 4);
  const health = view.health;

  return (
    <div className="developer-overview">
      <section className="card developer-architecture">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Change map</span>
            <h2>Three deployables, one reviewed path</h2>
          </div>
          <button className="text-action" type="button" onClick={() => onOpenSection("codebase")}>Browse all files →</button>
        </div>
        <div className="developer-architecture__flow" aria-label="AlphaEngine deployable architecture">
          {DEPLOYABLES.map((deployable, index) => (
            <div className="developer-deployable" key={deployable.id}>
              <div className="developer-deployable__topline">
                <span className="num">0{index + 1}</span>
                <span>{deployable.role}</span>
              </div>
              <h3>{deployable.name}</h3>
              <p>{deployable.detail}</p>
              <code>{deployable.entry}</code>
              <small>{deployable.stack}</small>
            </div>
          ))}
        </div>
        <div className="developer-architecture__legend">
          <span><i className="status-dot" /> Browser and server routes</span>
          <span>→ authenticated gateway state</span>
          <span>→ isolated research data</span>
        </div>
      </section>

      <div className="developer-overview__grid">
        <section className="card developer-work-preview">
          <div className="section-heading compact">
            <div>
              <span className="page-kicker">Next engineering work</span>
              <h2>{openWork.length} open items</h2>
            </div>
            <button className="text-action" type="button" onClick={() => onOpenSection("work")}>Open queue →</button>
          </div>
          <div className="developer-work-preview__list">
            {nextWork.map((item) => (
              <div key={item.id}>
                <span className={`developer-work-kind is-${item.kind}`}>{item.kind}</span>
                <div>
                  <strong>{item.title}</strong>
                  <small><code>{item.id}</code> · {item.area} · {item.owner}</small>
                </div>
                <span className={`developer-work-preview__priority is-${item.priority.toLocaleLowerCase()}`}>{item.priority}</span>
              </div>
            ))}
          </div>
          <p className="developer-work-preview__note">
            Representative, session-only planning data. Connect an authenticated issue backend before
            treating this queue as a durable source of truth.
          </p>
        </section>

        <section className="card developer-confidence">
          <div className="section-heading compact">
            <div>
              <span className="page-kicker">Change confidence</span>
              <h2>Configured delivery gates</h2>
            </div>
            <button className="text-action" type="button" onClick={() => onOpenSection("quality")}>See evidence →</button>
          </div>
          <div className="developer-confidence__total">
            <strong className="num">630</strong>
            <span>documented offline tests across three suites</span>
          </div>
          <div className="developer-confidence__jobs">
            {CI_JOBS.map((job) => (
              <div key={job.name}>
                <i className="status-dot" />
                <span><strong>{job.name}</strong><small>{job.detail}</small></span>
                <em>defined</em>
              </div>
            ))}
          </div>
          <p>Configuration evidence, not a live GitHub Actions conclusion.</p>
        </section>
      </div>

      <section className="card developer-context">
        <div>
          <span className="page-kicker">Shared desk context</span>
          <h2>Trace a change into the running workflow</h2>
          <p>
            Use <strong className="num">{workspaceSymbol}</strong> to reproduce the same instrument in
            research, execution, and reliability. The system snapshot remains shared across tabs.
          </p>
        </div>
        <div className="developer-context__health">
          <span>Providers ready</span>
          <strong className="num">{health ? `${health.summary.ready}/${health.summary.total}` : "—"}</strong>
          <small>{view.degraded ? `${view.degraded} degraded` : health ? "all nominal" : "checking"}</small>
        </div>
        <div className="developer-context__actions">
          <button type="button" className="primary-action" onClick={onOpenResearch}>Research {workspaceSymbol}</button>
          <button type="button" onClick={onOpenLive}>Open live book</button>
          <button type="button" onClick={onOpenReliability}>Open Reliability</button>
        </div>
      </section>
    </div>
  );
}

function DeveloperQuality({ view }: { view: SystemHealthView }) {
  return (
    <div className="developer-quality">
      <section className="card developer-test-suites">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Offline verification</span>
            <h2>630 tests, three independent suites</h2>
          </div>
          <span className="section-note">Documented repository baseline</span>
        </div>
        <div className="developer-test-suites__grid">
          {TEST_SUITES.map((suite) => (
            <div key={suite.name}>
              <span>{suite.name}</span>
              <strong className="num">{suite.count}</strong>
              <p>{suite.detail}</p>
              <code>{suite.command}</code>
            </div>
          ))}
          <div className="is-total">
            <span>All suites</span>
            <strong className="num">630</strong>
            <p>No market-data network or secret is required to reproduce the baseline.</p>
            <code>CI on every push</code>
          </div>
        </div>
      </section>

      <section className="card developer-ci-jobs">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Delivery workflow</span>
            <h2>Four jobs protect different failure modes</h2>
          </div>
          <a className="text-action" href="https://github.com/Manutd1234/Developer_Analyst_Infra/actions" target="_blank" rel="noreferrer">Open Actions ↗</a>
        </div>
        <div className="developer-ci-jobs__flow">
          {CI_JOBS.map((job, index) => (
            <div key={job.name}>
              <span className="num">{index + 1}</span>
              <strong>{job.name}</strong>
              <small>{job.detail}</small>
            </div>
          ))}
        </div>
        <div className="developer-ci-jobs__state">
          <span>Write guard <strong>{view.guard}</strong></span>
          <span>Contract <strong>committed snapshot</strong></span>
          <span>Live CI result <strong>open Actions to verify</strong></span>
        </div>
      </section>

      <section className="card verification-card">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Continuous verification</span>
            <h2>What breaks the build</h2>
          </div>
          <span className="section-note">Every push · reproducible offline</span>
        </div>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Continuous integration gates and the regressions they catch</caption>
            <thead><tr><th>Gate</th><th>What it does</th><th>What it catches</th></tr></thead>
            <tbody>
              {VERIFICATION.map((row) => (
                <tr key={row.gate}>
                  <th scope="row">{row.gate}</th>
                  <td>{row.detail}</td>
                  <td className="muted">{row.breaks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
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
  const openBugs = openWork.filter((item) => item.kind === "bug");

  const tiles: ConsoleTile[] = [
    {
      label: "Repository snapshot",
      value: `${REPOSITORY_STATS.files} files`,
      note: `${REPOSITORY_STATS.areas} code areas · full path index`,
      tone: "good",
    },
    {
      label: "Deployable units",
      value: String(DEPLOYABLES.length),
      note: "workspace · gateway · OpenBB",
      tone: "good",
    },
    {
      label: "Open engineering work",
      value: String(openWork.length),
      note: `${openBugs.length} bug${openBugs.length === 1 ? "" : "s"} · session queue`,
      tone: openBugs.length ? "warn" : "good",
    },
    {
      label: "Web API operations",
      value: String(API_OPERATIONS.length),
      note: "20 route handlers · grouped catalog",
      tone: "good",
    },
  ];

  const openSection = (next: DeveloperSection) => {
    onSectionChange(next);
    window.requestAnimationFrame(() => document.getElementById(`developer-subtab-${next}`)?.focus());
  };

  return (
    <>
      <ConsoleChrome view={view} tiles={tiles} />

      <WorkspaceSubtabs
        workspaceId="developer"
        label="Quant developer sections"
        tabs={DEVELOPER_SECTIONS}
        activeId={section}
        onChange={onSectionChange}
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

      <WorkspaceSubtabPanel workspaceId="developer" tabId="codebase" activeId={section}>
        <CodebaseExplorer />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="developer" tabId="work" activeId={section}>
        <DeveloperWorkQueue items={workItems} onItemsChange={onWorkItemsChange} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="developer" tabId="apis" activeId={section}>
        <DeveloperApiCatalog />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="developer" tabId="quality" activeId={section}>
        <DeveloperQuality view={view} />
      </WorkspaceSubtabPanel>
    </>
  );
}
