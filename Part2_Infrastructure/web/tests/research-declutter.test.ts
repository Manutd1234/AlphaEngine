/**
 * The research surface's declutter pass, pinned so it stays done.
 *
 * Four shapes were removed and each is the kind that grows back quietly: an
 * unreachable empty-state carrying a duplicate primary action, N identical
 * banners stacked for one answer, a third trigger for the same run, and a
 * row of two-letter buttons inside a scroller that clips menus. The tests
 * below assert the consolidated shape rather than merely the absence, so a
 * regression fails with a sentence about why the line was drawn where it is.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

/**
 * The Research tab is a component now, not 490 lines of JSX inside the shell.
 * Each assertion follows the file its subject moved to, and the two that count
 * occurrences count them across the whole workspace — a per-file count would
 * report "exactly one" on a file that holds none.
 */
const page = code(read("../app/dashboard/page.tsx"));
const research = code(read("../components/ResearchWorkspace.tsx"));
const banners = code(read("../components/research/ResearchBanners.tsx"));
const sweepHook = code(read("../lib/use-sweep-run.ts"));
/** Every file the Research tab renders from, page shell included. */
const RESEARCH_SOURCES = [
  page,
  research,
  banners,
  code(read("../components/research/ResearchSummary.tsx")),
  code(read("../components/research/AttributionSection.tsx")),
  code(read("../components/research/DecisionSection.tsx")),
];
const researchAll = RESEARCH_SOURCES.join("\n");
const history = code(read("../components/research/ExperimentHistory.tsx"));
const css = read("../app/globals.css");

describe("the research view keeps one sweep trigger per condition", () => {
  it("has no unreachable empty-state map with its own Run research action", () => {
    // `data` seeds from SEED_RUN and the sole setData call writes completed
    // runs, so a `!data` branch is dead code — and its primary-action was a
    // duplicate of the rail's pinned "Run now". If the seed is ever removed,
    // restore a *reported* empty state; do not resurrect the button.
    assert.doesNotMatch(researchAll, /research-empty-section/);
    assert.doesNotMatch(css, /research-empty-section/);
    assert.match(sweepHook, /useState<SweepResponse \| null>\(SEED_RUN\)/);
  });

  it("announces a stale desk context without offering a third run button", () => {
    // The stale veil's primary-action and the rail's "Run now" both fire under
    // exactly the condition this banner renders in; a button here was a third
    // trigger for the same run() at the same moment.
    const start = banners.indexOf('className="banner context-change"');
    assert.notEqual(start, -1, "the desk-context banner is gone — has it been renamed?");
    const banner = banners.slice(start);
    const block = banner.slice(0, banner.indexOf("</div>\n"));
    assert.doesNotMatch(block, /<button/);
    assert.match(banners, /Use Run now to refresh it/);
  });

  it("consolidates a run's data warnings into one banner with one exit", () => {
    // N warnings used to stack N banners, each repeating the identical
    // "Inspect data health →" button to the identical destination.
    assert.match(banners, /data\.warnings\.length > 0 &&/);
    assert.doesNotMatch(banners, /warnings\.map\(\(warning\) => \(\s*<div className="banner/);
    assert.equal((researchAll.match(/Inspect data health →/g) ?? []).length, 1);
  });

  it("hands the decision section's data hand-off to the NextStepFooter", () => {
    // The inline card was a third navigation furnishing on one section,
    // shadowed by the footer's ring fallback offering Execution at the same
    // moment. The footer's measured continuation now carries it.
    assert.doesNotMatch(researchAll, /research-data-handoff/);
    assert.doesNotMatch(css, /\.research-data-handoff/);
    const footer = read("../components/common/NextStepFooter.tsx");
    assert.match(footer, /"research\/decision": \{/);
  });
});

describe("the run history's actions match the house disclosure grammar", () => {
  it("keeps Clone inline and folds the rest into a per-row RowMenu", () => {
    // Four standalone buttons per row — one of them the two-letter riddle
    // "Py" — inside a .table-wrap whose overflow clips anything absolute:
    // the exact geometry RowMenu exists to escape.
    assert.match(history, /RowMenu label=\{`Actions for \$\{r\.id\}`\}/);
    assert.match(history, /Export Python script/);
    assert.match(history, /Remove from history/);
    assert.doesNotMatch(history, />\s*Py\s*</);
    assert.doesNotMatch(history, />\s*Drop\s*</);
  });

  it("keeps the archive's three management actions in one card-level menu", () => {
    // Export/Import lived in a permanent toolbar while Clear hid in the facts
    // row — three archive controls in two places for one log.
    assert.match(history, /RowMenu label=\{`Archive actions/);
    assert.doesNotMatch(history, /history-toolbar/);
    assert.doesNotMatch(css, /\.history-toolbar/);
    // The answer to an archive action must survive the menu closing over it.
    assert.match(history, /role="status"/);
  });
});
