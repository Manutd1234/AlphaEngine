/**
 * Every tab opens with the same header, and with exactly one of them.
 *
 * The stylesheet used to claim six bespoke page headers had been retired. Two had;
 * four were still rendering. The claim was prose, so nothing caught the drift —
 * this measures it instead. Two heads on one tab is the scatter the workspace
 * converged out of; zero means a tab opens with no identity at all.
 *
 * These are source-level assertions on purpose. There is no DOM in this suite, and
 * the property worth pinning is structural: a future edit has to break it
 * deliberately.
 *
 * Split from `tests/workspace-routing-nav.test.ts` on 2026-08-21, whose first
 * invariant — that every tab in the nav has a panel at all — is now in
 * `workspace-routing-nav.test.ts`. This file asks what is at the top of that panel
 * once the reader arrives.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { navIds, read } from "./helpers/workspace-sources";

const header = read("../components/WorkspaceHeader.tsx");
const page = read("../app/dashboard/page.tsx");
/**
 * The eight `<section role="tabpanel">` elements left `page.tsx` on 2026-08-21
 * for `components/workspace/WorkspacePanels.tsx`; the shell kept the hooks, the
 * header and `#workspace-content`. The head-per-panel scan below reads `panels`
 * for that reason — left on `page` it would find no panel bodies and pass.
 */
const panels = read("../components/workspace/WorkspacePanels.tsx");
const researchWorkspace = read("../components/ResearchWorkspace.tsx");
const riskWorkspace = read("../components/RiskWorkspace.tsx");
const portfolioWorkspace = read("../components/PortfolioWorkspace.tsx");
const workspaceOverview = read("../components/WorkspaceOverview.tsx");
const dataConsole = read("../components/DataConsole.tsx");
const reliabilityConsole = read("../components/ReliabilityConsole.tsx");
const developerConsole = read("../components/DeveloperConsole.tsx");
const coherenceConsole = read("../components/CoherenceConsole.tsx");

describe("every tab opens with the same header", () => {
  /**
   * The stylesheet used to claim six bespoke page headers had been retired. Two
   * had; four were still rendering. The claim was prose, so nothing caught the
   * drift — this measures it instead.
   *
   * `PageHead` is the one grammar: identity, the numbers that frame it, the
   * controls that refresh them. `WorkspaceIntro` and `ConsoleChrome` are thin
   * adapters over it — they exist so the role tabs and the operational consoles
   * keep their own vocabularies (`insights`, `tiles`) without each growing a
   * second header. What must not happen is a ninth surface drawing its own.
   */
  const surfaces: Array<[string, string]> = [
    ["page.tsx", page],
    ["WorkspacePanels.tsx", panels],
    ["ResearchWorkspace.tsx", researchWorkspace],
    ["DataConsole.tsx", dataConsole],
    ["ReliabilityConsole.tsx", reliabilityConsole],
    ["DeveloperConsole.tsx", developerConsole],
    ["CoherenceConsole.tsx", coherenceConsole],
    ["RiskWorkspace.tsx", riskWorkspace],
    ["PortfolioWorkspace.tsx", portfolioWorkspace],
  ];

  it("the adapters really are adapters, not second implementations", () => {
    for (const name of ["WorkspaceIntro.tsx", "systems/ConsoleChrome.tsx"]) {
      const source = read(`../components/${name}`);
      assert.match(
        source,
        /from "@\/components\/workspace\/PageHead"/,
        `${name} stopped rendering through PageHead — that is a second header grammar, `
          + "which is the divergence PageHead was introduced to end",
      );
    }
  });

  it("every workspace surface reaches PageHead through one of them", () => {
    for (const [name, source] of surfaces) {
      const rendersHeader = /<(PageHead|WorkspaceIntro|ConsoleChrome)\b/.test(source);
      const importsHeader = /(PageHead|WorkspaceIntro|ConsoleChrome)/.test(source);
      assert.ok(
        rendersHeader || !importsHeader,
        `${name} imports a header component but renders none`,
      );
    }
  });

  it("no surface draws a bespoke header bar", () => {
    // The four that were retired. A fifth appearing means someone hand-rolled
    // a header rather than passing metrics to the shared one.
    const retired = ["data-cp-bar", "console-statusbar", "developer-cp-bar", "page-heading__meta"];
    for (const [name, source] of surfaces) {
      for (const bar of retired) {
        assert.ok(
          !source.includes(`"${bar}`) && !source.includes(` ${bar}"`),
          `${name} renders the retired .${bar}`,
        );
      }
    }
  });

  it("each of the nine tabs has exactly one head in its panel", () => {
    /**
     * Two heads on one tab is the scatter this converged out of; zero means a
     * tab opens with no identity at all.
     *
     * The panel is found by its `id="panel-…"`, not by the guard in front of
     * it: six of the eight are mounted as
     * `{(view === "x" || visitedViews.current.has("x")) && …}`, so the old
     * `{view === "x" &&` search returned -1 on them and `slice(-1)` measured a
     * single character. It passed on all six by scanning nothing.
     *
     * A tab whose panel delegates to a workspace component is followed into it:
     * Research renders its head inside `ResearchWorkspace`, exactly as
     * Portfolio's rail lives inside `PortfolioWorkspace`.
     */
    const owners: Record<string, string> = {
      research: researchWorkspace,
      portfolio: portfolioWorkspace,
      risk: riskWorkspace,
      data: dataConsole,
      reliability: reliabilityConsole,
      developer: developerConsole,
      overview: workspaceOverview,
      coherence: coherenceConsole,
    };
    const HEAD = /<(?:WorkspaceIntro|ConsoleChrome|PageHead)\b/g;
    for (const view of navIds(header)) {
      const start = panels.indexOf(`id="panel-${view}"`);
      assert.notEqual(start, -1, `no panel-${view} in WorkspacePanels.tsx — the panel scan is measuring nothing`);
      const rest = panels.slice(start);
      const end = rest.indexOf("</section>");
      assert.notEqual(end, -1, `panel-${view} never closes`);
      const body = rest.slice(0, end);
      const heads = (body.match(HEAD) ?? []).length
        + ((owners[view]?.match(HEAD) ?? []).length > 0 && !HEAD.test(body) ? 1 : 0);
      assert.ok(heads >= 1, `${view} opens with no head at all`);
      assert.ok(heads <= 1, `${view} renders ${heads} head elements`);
    }
  });
});
