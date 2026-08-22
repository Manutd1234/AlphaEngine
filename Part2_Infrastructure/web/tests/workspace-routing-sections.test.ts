/**
 * Inside a tab, the rail. Every dense role workspace splits into feature sections,
 * and each defined section must have a panel that renders it.
 *
 * `lib/sections.ts` is the single source the rails, the palette and the hash
 * whitelist all read. That makes the definition half of the contract cheap and
 * the render half invisible: a section can be declared, listed in the rail and
 * addressable by URL while nothing renders it, and the reader lands on a heading
 * with nothing under it. This file pins the other half — plus the things that make
 * a rail usable rather than merely present: one roving-tab pattern, a hash that
 * carries the section and not just the view, shortcuts that fire on physical keys
 * rather than on the characters Option produces, and panels that stop polling when
 * they are not on screen.
 *
 * These are source-level assertions on purpose. There is no DOM in this suite,
 * and the property worth pinning is structural: a future edit has to break it
 * deliberately.
 *
 * Split from `tests/workspace-routing-nav.test.ts` on 2026-08-21; the nav-to-panel
 * table it sits under is in `workspace-routing-nav.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

/**
 * The shell split. `page.tsx` still mounts the eight panels and still owns the
 * header controls read below, but where the reader is, and every way the desk
 * moves them, moved to `lib/use-workspace-routing.ts`, the panels themselves to
 * `components/workspace/WorkspacePanels.tsx`, and the Research tab's panels to
 * `components/ResearchWorkspace.tsx`. Each assertion below reads the file its
 * subject now lives in; left pointed at page.tsx they would scan a file that no
 * longer contains what they were written to guard.
 */
const page = read("../app/dashboard/page.tsx");
const panels = read("../components/workspace/WorkspacePanels.tsx");
const routingHook = read("../lib/use-workspace-routing.ts");
const researchWorkspace = read("../components/ResearchWorkspace.tsx");
const header = read("../components/WorkspaceHeader.tsx");
const subtabs = read("../components/WorkspaceSubtabs.tsx");
const riskWorkspace = read("../components/RiskWorkspace.tsx");
const portfolioWorkspace = read("../components/PortfolioWorkspace.tsx");
const liveMarket = read("../components/LiveMarket.tsx");
const executionCockpit = read("../components/execution/ExecutionCockpit.tsx");
const workspaceOverview = read("../components/WorkspaceOverview.tsx");
const sectionsSource = read("../lib/sections.ts");

/** Section ids for a workspace, in rail order, from the lib/sections literal. */
function sectionIdsFor(workspace: string): string[] {
  const start = sectionsSource.indexOf(`export const ${workspace}_SECTIONS`);
  assert.ok(start >= 0, `lib/sections.ts defines no ${workspace}_SECTIONS`);
  const block = sectionsSource.slice(start, sectionsSource.indexOf("] as const", start));
  return [...block.matchAll(/\{\s*id:\s*"([a-z]+)"/g)].map((match) => match[1]);
}
const dataConsole = read("../components/DataConsole.tsx");
const reliabilityConsole = read("../components/ReliabilityConsole.tsx");
const developerConsole = read("../components/DeveloperConsole.tsx");
const dataWorkBoard = ["../components/data/DataWorkBoard.tsx", "../components/data/DataWorkCard.tsx", "../components/data/WorkComposer.tsx", "../components/data/work-board-model.ts"]
  .map((p) => { try { return read(p); } catch { return ""; } }).join("\n");
const developerWorkQueue = read("../components/developer/DeveloperWorkQueue.tsx");
const pipelineInspector = read("../components/systems/PipelineInspector.tsx");
const traceConsole = read("../components/systems/TraceConsole.tsx");
const repositoryManifest = JSON.parse(read("../lib/repository-manifest.generated.json")) as {
  version: number;
  files: string[];
};

describe("dense role workspaces expose accessible feature sections", () => {
  it("uses one roving tab pattern for every nested workspace", () => {
    assert.match(subtabs, /role="tablist"/);
    assert.match(subtabs, /role="tab"/);
    assert.match(subtabs, /role="tabpanel"/);
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
      assert.ok(subtabs.includes(key), `nested tabs do not handle ${key}`);
    }
  });

  it("workspace switches write the full location, never a bare view", () => {
    // A bare `#research` while the rail shows Strategies was the copy-link /
    // reload desync. navigate() must read the live section at click time.
    assert.match(routingHook, /url\.hash = detail\?\.hash \?\? `\$\{next\}\/\$\{sectionByViewRef\.current\[next\]\}`/);
    assert.ok(
      !/if \(next === "data"\) setDataSection\("overview"\)/.test(routingHook),
      "the forced data reset is back — it hid the desync instead of fixing it",
    );
  });

  it("Alt+1–8 reads physical key codes and never fires while typing", () => {
    // macOS Option+digit produces "¡™£…", so an e.key range test never
    // matches — the advertised shortcut was dead on every Mac.
    assert.match(header, /e\.code/);
    assert.ok(header.includes("Digit[1-8]"), "workspace shortcuts no longer match Digit codes");
    assert.match(header, /isContentEditable/);
  });

  it("opens each internally scrolled Research section at its own beginning", () => {
    assert.match(researchWorkspace, /const researchContentRef = useRef<HTMLDivElement \| null>/);
    assert.match(researchWorkspace, /researchContentRef\.current\.scrollTop = 0/);
    assert.match(researchWorkspace, /className="research-content" ref=\{researchContentRef\}/);
  });

  it("resets the shell to the top of every subtab change, instantly, from one owner", () => {
    // The reported bug: a workspace's visited panels stay mounted behind
    // `display: none` and share the shell scroller, so its scrollHeight
    // follows the tallest open panel. Portfolio measured 1066px (Performance)
    // against 406px (Positions) — switching down clamped scrollTop 650 -> 5
    // and slid the page heading back under the sticky rail.
    const code = stripNonCode(routingHook);

    // Keyed on the view AND the ACTIVE workspace's section, so every one of
    // the eight rails is covered by this single reset.
    assert.match(routingHook, /const activeSection = sectionByViewRef\.current\[view\];/);
    assert.match(routingHook, /shellRef\.current\?\.scrollTo\(\{ top: 0, behavior: "auto" \}\)/);

    // Instant, never animated: the point is to remove motion, not restyle it.
    // Prose is stripped but string literals are kept — `stripNonCode` blanks
    // them, which would blank a `"smooth"` this is meant to catch.
    const noProse = routingHook.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!noProse.includes('behavior: "smooth"'), "the shell reset animates — a cut has nothing to reduce");

    // Scoped to the visible workspace. Keying on every section state would let
    // a hidden rail scroll the panel the reader is on; keying on the ref
    // object itself would fire on every render, throwing a reader who is
    // merely being re-rendered by a data poll back to the top mid-read.
    const resetDeps = code.match(/useLayoutEffect\(\(\) => \{\s*shellRef\.current\?\.scrollTo\(\{ top: 0, behavior: "" \}\);\s*\}, (\[[^\]]*\])\);/)?.[1];
    assert.equal(
      resetDeps,
      "[view, activeSection]",
      "the reset is keyed on something other than the view and the active workspace's section",
    );
    assert.equal(
      routingHook.match(/shellRef\.current\?\.scrollTo/g)?.length,
      2,
      "a third shell reset appeared — the keyed effect and navigate's same-tab click are the two",
    );

    // One mechanism, not eight: every rail's section change lands in the same
    // `change` table this hook owns, so rail clicks, arrow keys, cross-links,
    // the palette, the tour and Back/Forward all reach the reset.
    for (const workspace of [
      "overview", "research", "live", "developer", "risk", "portfolio", "data", "reliability",
    ]) {
      assert.ok(
        routingHook.includes(`${workspace}: bind("${workspace}", set`),
        `${workspace} sections do not route through the hook that resets the shell`,
      );
    }

    // No rival owner of the shell scroller. Research keeps its own reset —
    // asserted above — but that one names `.research-content`, the inner pane
    // the desk-width media query gives its own overflow, and never the shell.
    assert.ok(!/scrollTo\(/.test(stripNonCode(researchWorkspace)), "Research holds a second shell reset");
    assert.ok(!/scrollTo\(/.test(stripNonCode(page)), "page.tsx scrolls the shell behind the hook's back");
  });

  it("splits every dense role workspace into focused feature groups", () => {
    // Section definitions live in lib/sections.ts — the single source the
    // rails, palette and hash whitelist read. The invariant pinned here is the
    // other half of the contract: every DEFINED section has a rendered panel
    // in the component(s) that own that workspace.
    const expectPanels = (workspace: string, sources: string[], label: string) => {
      const ids = sectionIdsFor(workspace);
      assert.ok(ids.length >= 3, `${label} defines too few sections (${ids.length})`);
      for (const id of ids) {
        assert.ok(
          sources.some((source) => source.includes(`tabId="${id}"`)),
          `${label} is missing the ${id} panel`,
        );
      }
    };
    expectPanels("OVERVIEW", [workspaceOverview], "overview");
    expectPanels("RESEARCH", [researchWorkspace], "research");
    expectPanels("EXECUTION", [panels, liveMarket, executionCockpit], "execution");
    expectPanels("PORTFOLIO", [portfolioWorkspace], "portfolio");
    expectPanels("RISK", [riskWorkspace], "risk");
    expectPanels("DATA", [dataConsole], "data");
    expectPanels("RELIABILITY", [reliabilityConsole], "reliability");
    expectPanels("DEVELOPER", [developerConsole], "developer");

    // The board has a native keyboard alternative to dragging and announces
    // moves without stealing focus. Hidden pipeline panels remain mounted, so
    // their poll and venue sockets must also be explicitly gated by `active`.
    assert.match(dataWorkBoard, /aria-label=\{`Status for \$\{item\.id\}`\}/);
    assert.match(dataWorkBoard, /aria-live="polite"/);
    assert.ok(!dataWorkBoard.includes("draggable="), "the board must not rely on drag-only movement");
    assert.match(developerWorkQueue, /aria-label=\{`Status for \$\{item\.id\}:/);
    assert.match(developerWorkQueue, /aria-live="polite"/);
    assert.ok(!developerWorkQueue.includes("draggable="), "developer work must not rely on drag-only movement");

    assert.equal(repositoryManifest.version, 2);
    assert.ok(repositoryManifest.files.length >= 221, "repository catalog lost committed paths");
    assert.equal(new Set(repositoryManifest.files).size, repositoryManifest.files.length, "repository catalog has duplicate paths");
    for (const path of [
      "README.md",
      "Part1_Data_Handling/README.md",
      "Part2_Infrastructure/main.py",
      "Part2_Infrastructure/OpenBB_Service/app.py",
      "Part2_Infrastructure/web/app/dashboard/page.tsx",
      "Part2_Infrastructure/web/components/DeveloperConsole.tsx",
    ]) {
      assert.ok(repositoryManifest.files.includes(path), `repository catalog is missing ${path}`);
    }
    assert.ok(pipelineInspector.includes('if (!active || tab !== "rest"'), "hidden pipeline keeps polling");
    assert.ok(
      pipelineInspector.includes('active && tab === "socket" && socketSupported'),
      "hidden pipeline keeps venue sockets open",
    );
    assert.ok(
      routingHook.includes('useState<DataSection>("overview")'),
      "data must open on trust evidence rather than the sample work queue",
    );
    assert.ok(
      routingHook.includes('data: bind("data", setDataSection)')
        && routingHook.includes("url.hash = `${workspace}/${next}`"),
      "data subtabs are not addressable by URL hash",
    );
    assert.ok(
      routingHook.includes('reliability: bind("reliability", setReliabilitySection)'),
      "reliability subtabs are not addressable by URL hash",
    );
    assert.ok(
      page.includes('openReliabilitySection("services", "reliability-latency-guide")')
        && page.includes('openReliabilitySection("services", "reliability-provider-health")'),
      "header health controls no longer land on their matching reliability evidence",
    );
    assert.ok(
      panels.includes("workspaceInterval={req.interval}")
        && dataConsole.includes("interval={workspaceInterval}"),
      "the lineage trace silently falls back to its own bar interval",
    );
    assert.equal(
      reliabilityConsole.match(/<TraceConsole/g)?.length,
      1,
      "reliability must have one correlated event stream",
    );
    assert.ok(
      reliabilityConsole.includes('active={active && section === "events"}'),
      "hidden reliability events are not deactivated",
    );
    assert.ok(
      traceConsole.includes("if (!active || paused) return;"),
      "hidden or paused trace performs its initial pull",
    );
    // The poll is a `usePolling` call now; its gate is the `enabled` term.
    // Same three conditions, asserted where they live.
    assert.match(
      traceConsole,
      /enabled: active && !paused && Boolean\(pollMs\)/,
      "hidden, paused or uncadenced trace keeps its polling interval",
    );
  });
});
