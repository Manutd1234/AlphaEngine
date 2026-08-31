import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (relative: string) => readFileSync(
  new URL(relative, import.meta.url),
  "utf8",
);

const workspace = read("../components/ResearchWorkspace.tsx");
const controls = read("../components/Controls.tsx");
const routing = read("../lib/use-workspace-routing.ts");
const rails = read("../lib/use-rail-sections.ts");
const panels = read("../components/workspace/WorkspacePanels.tsx");
const summarySwitcher = read("../components/research/ResearchSummaryViewSwitcher.tsx");
const researchCss = read("../app/globals/03-research-lab.css");
const tabs = read("../components/ui/tabs.tsx");

describe("Research experiment setup is a routed Summary view", () => {
  it("keeps the canonical Summary result at two segments and gives Setup a third", async () => {
    const { defaultView, locationHash, railView, viewsFor } = await import("../lib/section-views");

    assert.deepEqual(viewsFor("research", "summary"), [
      ["results", "Results"],
      ["setup", "Setup"],
    ]);
    assert.equal(defaultView("research", "summary"), "results");
    assert.equal(locationHash("research", "summary", "results"), "research/summary");
    assert.equal(locationHash("research", "summary", "setup"), "research/summary/setup");
    assert.equal(railView("research", "summary", "unknown"), "results");
  });

  it("resolves and writes the Research view through the shared router", () => {
    assert.match(rails, /research:\s*bind\(RESEARCH_SECTION_IDS,\s*setResearchSection,\s*"research"\)/);
    assert.match(routing, /const changeResearchView = useViewWriter\([^\n]+"research"/);
    assert.match(routing, /if \(tab === "research"\) changeResearchView\(section, next\)/);
    assert.match(panels, /summaryView=\{sectionViews\.research\?\.summary/);
    assert.match(panels, /onSummaryViewChange=/);
  });

  it("mounts Controls only for the active Summary Setup view", () => {
    const summary = workspace.indexOf(
      '<WorkspaceSubtabPanel workspaceId="research" tabId="summary"',
    );
    const parameters = workspace.indexOf(
      '<WorkspaceSubtabPanel workspaceId="research" tabId="parameters"',
    );
    const summaryPanel = workspace.slice(summary, parameters);

    assert.ok(summary >= 0 && parameters > summary, "the Summary panel is absent");
    assert.match(summaryPanel, /summaryView === "setup"/);
    assert.match(summaryPanel, /<Controls/);
    assert.match(summaryPanel, /section === "summary"/);
    assert.equal(workspace.slice(parameters).match(/<Controls/g)?.length ?? 0, 0,
      "Experiment setup leaked into a non-Summary section");
    assert.equal(workspace.slice(0, summary).match(/<Controls/g)?.length ?? 0, 0,
      "Experiment setup is still mounted globally above the section panels");
    assert.match(summarySwitcher, /id=\{`research-summary-\$\{id\}-tab`\}/);
    assert.match(summarySwitcher, /aria-controls="research-summary-view-panel"/);
    assert.match(summaryPanel, /id="research-summary-view-panel"[\s\S]*?role="tabpanel"/);
    assert.match(summaryPanel, /aria-labelledby=\{`research-summary-\$\{summaryView\}-tab`\}/);
  });

  it("shows the editor directly and splits core parameters from adjustments with source-owned Tabs", () => {
    assert.match(controls, /from "@\/components\/ui\/tabs"/);
    assert.match(controls, /<Tabs\b/);
    assert.match(controls, /<TabsList\b/);
    assert.match(controls, /setupViews\.map/);
    assert.match(controls, /<TabsContent value="core"/);
    assert.match(controls, /<TabsContent value="adjustments"/);
    assert.doesNotMatch(controls, /setupExpanded/);
    assert.doesNotMatch(controls, /hidden=\{!setupExpanded\}/);
    assert.doesNotMatch(controls, /aria-expanded=\{setupExpanded\}/);
  });

  it("retains native change commit semantics across both setup views", () => {
    assert.match(controls, /node\.addEventListener\("change", handler\)/);
    assert.match(controls, /return \(\) => node\.removeEventListener\("change", handler\)/);
    assert.doesNotMatch(controls, /onChange=\{onCommit\}/);
  });

  it("keeps Frictions expansion under the reader's control", () => {
    assert.match(controls, /const \[frictionsExpanded, setFrictionsExpanded\] = useState\(frictionsConfigured\)/);
    assert.match(controls, /open=\{frictionsExpanded\}/);
    assert.match(controls, /onToggle=\{\(event\) => setFrictionsExpanded\(event\.currentTarget\.open\)\}/);
    assert.doesNotMatch(controls, /open=\{frictionsOn\}/);
  });

  it("only calls impact modelled when both k and order size can apply", () => {
    assert.match(controls, /const impactApplied = impactCoefficient > 0 && orderNotional > 0/);
    assert.match(controls, /impact needs order size/);
    assert.match(controls, /impact needs k/);
  });

  it("owns one explicit Frictions marker grid at every browser width", () => {
    assert.match(researchCss, /\.friction-group > summary \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: 0\.75rem minmax\(0, 1fr\);/);
    assert.match(researchCss, /\.friction-group > summary::before \{[\s\S]*?content: "▸";/);
    assert.match(researchCss, /\.friction-group\[open\] > summary::before \{[\s\S]*?rotate\(90deg\)/);
    assert.doesNotMatch(researchCss, /\.friction-group > summary \{[\s\S]*?display: list-item;/);
    assert.doesNotMatch(researchCss, /width: calc\(100% - 1\.2em\)/);
  });

  it("aligns both tab rows on the same white selection and inset highlight", () => {
    assert.match(tabs, /border-transparent bg-transparent/);
    assert.match(tabs, /data-\[state=active\]:bg-\[var\(--control-selected-bg\)\]/);
    assert.match(tabs, /box-shadow:inset_0_-2px_0_var\(--series-1\),var\(--shadow-control\)/);
    assert.doesNotMatch(tabs, /data-\[state=active\]:bg-surface-0/);
    assert.doesNotMatch(tabs, /data-\[state=active\]:shadow-card/);
  });
});
