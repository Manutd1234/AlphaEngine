/**
 * The Portfolio header holds still while the reader changes section.
 *
 * THE COMPLAINT, AND WHAT THE MEASUREMENT SAID
 * ---------------------------------------------------------------------------
 * The report was that the summary card holding Book source, Positions, Risk
 * model and Execution sleeve grows and shrinks as the reader moves between
 * Overview, Equity & P&L, Positions, Allocation and Performance. Driven
 * through CDP against the running desk at 1440px, sampled every frame for
 * 1.5s across each of the five switches, it does not: the header measures
 * 168.6px on the compact step, 189.3px on comfortable and 220.1px on large,
 * and it measures exactly that on all five subtabs, at every viewport from
 * 760px to 1512px. Zero variance.
 *
 * It holds still for four separate reasons, and every one of them is one
 * careless edit away from being untrue. This suite is those four reasons:
 *
 *   1. the header is rendered ABOVE the subtab panels, not inside one, so a
 *      section change cannot re-render it at all;
 *   2. its four chips come from `portfolioInsights`, which is handed no
 *      section and returns four unconditional entries, so no badge can appear
 *      on one subtab and not another;
 *   3. every chip is floored at the same token-derived height and stretched
 *      by its grid row, so a short note and a long one occupy one box;
 *   4. the label, the value and the note truncate rather than wrap, and each
 *      carries its own full text as a `title`, so nothing that is ellipsised
 *      is unrecoverable.
 *
 * Pinned against source in the house style, because the alternative is a
 * headless browser and a live gateway in the unit suite.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";
import { read } from "./helpers/cockpit-sources";

/** Comment bodies out, so prose that names the old defect is not read as it. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

describe("the Portfolio header sits outside the subtab panels' re-render scope", () => {
  const panels = code(read("components/workspace/WorkspacePanels.tsx"));
  const workspace = code(read("components/PortfolioWorkspace.tsx"));

  it("the shell renders the header before the workspace that owns the sections", () => {
    const block = panels.slice(panels.indexOf('id="panel-portfolio"'));
    const head = block.indexOf("<WorkspaceIntro");
    const tab = block.indexOf("<PortfolioTab");
    assert.ok(head > 0 && tab > 0, "the Portfolio panel lost its header or its workspace");
    assert.ok(
      head < tab,
      "the header moved below or inside <PortfolioTab>, which puts it in the section's render scope",
    );
  });

  it("the workspace that owns the sections renders no header of its own", () => {
    // The one assertion that stops this regressing. A `WorkspaceIntro` or a
    // `PageHead` mounted anywhere in this file would be re-rendered by the
    // section change, and the four chips would be rebuilt with it.
    assert.doesNotMatch(workspace, /<(WorkspaceIntro|PageHead)\b/,
      "a page header appeared inside the Portfolio workspace, so a section change now rebuilds it");
    assert.doesNotMatch(workspace, /from "@\/components\/(WorkspaceIntro|workspace\/PageHead)"/);
  });

  it("the chrome above the rail is a sibling of the panels, never a child", () => {
    const chrome = workspace.indexOf("<BookChrome");
    const rail = workspace.indexOf("<WorkspaceSubtabs");
    const first = workspace.indexOf("<WorkspaceSubtabPanel");
    assert.ok(chrome > 0 && rail > 0 && first > 0, "the Portfolio chrome or its panels went");
    assert.ok(chrome < rail && rail < first,
      "the notice strip or the section rail moved inside a subtab panel, so switching section reflows it");
  });

  it("all five sections are panels of the same component, so one floor covers them", () => {
    const opened = workspace.match(/<WorkspaceSubtabPanel workspaceId="portfolio"/g) ?? [];
    assert.equal(opened.length, 5, "a Portfolio section stopped being a WorkspaceSubtabPanel");
  });
});

describe("nothing the header says depends on which section is open", () => {
  const insights = read("lib/workspace-insights.ts");
  const portfolio = code(insights.slice(
    insights.indexOf("export function portfolioInsights"),
    insights.indexOf("export function riskInsights"),
  ));

  it("the builder is handed no section and reads none", () => {
    assert.ok(portfolio.length > 300, "portfolioInsights did not load");
    assert.doesNotMatch(portfolio, /\bsection\b/i,
      "the header's figures started reading the open section, so switching section changes them");
  });

  it("it returns the four labels the complaint named, unconditionally", () => {
    const labels = [...portfolio.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(labels, ["Book source", "Positions", "Risk model", "Execution sleeve"]);
    // A conditional entry — `...(x ? [tile] : [])` or `x && tile` inside the
    // array — is how a chip comes and goes between sections, and a row that
    // gains or loses a chip is a row that changes height. There is none, and
    // there must go on being none.
    assert.doesNotMatch(portfolio, /\.\.\.\(/, "a conditional tile entered the header's array");
    assert.doesNotMatch(portfolio, /^\s*\w[\w.?[\]]*\s*&&\s*\{/m,
      "a tile in the header's array became conditional, so the chip count can change between sections");
  });

  it("an unread figure is a named reason, never a zero standing in for one", () => {
    assert.match(portfolio, /"Measuring" : book\.risk \? "Measured" : "Pending"/);
    assert.match(portfolio, /"no assumptions substituted"/);
    assert.match(portfolio, /book\.book \? "current book" : "connecting"/);
  });
});

describe("the four chips are one height, whatever they hold", () => {
  it("the chip is floored by its own anatomy in type tokens, not by a literal", () => {
    const floor = globalsCss.match(/\.page-insight \{[\s\S]*?min-height: ([^;]+);/);
    assert.ok(floor, "the metric chip lost its floor, so a short note draws a short chip");
    assert.match(floor[1], /var\(--fs-2xs\)/);
    assert.match(floor[1], /var\(--fs-title\)/);
    assert.doesNotMatch(floor[1], /\b\d+(\.\d+)?px\s*\*/,
      "the chip floor started multiplying a literal px, which stops following the text size");
  });

  it("the row stretches every chip to the tallest of them", () => {
    const row = globalsCss.match(/\.page-heading__insights \{([\s\S]*?)\}/);
    assert.ok(row, "the chip row went");
    assert.match(row[1], /display: grid;/);
    // Grid's default `align-items: stretch` is what equalises the four boxes.
    // Opting out of it is the edit that makes a long note taller than a short
    // one, so the opt-out is what is pinned against.
    assert.doesNotMatch(row[1], /align-items: (?!stretch)/,
      "the chip row opted out of stretch, so the four cards no longer share one height");
  });

  it("a chip that happens to be a button is floored like every other chip", () => {
    const button = globalsCss.match(/button\.page-insight \{([\s\S]*?)\}/);
    assert.ok(button, "the actionable chip lost its rule");
    assert.doesNotMatch(button[1], /min-height/,
      "an actionable chip opted out of the floor, so a header of actions opens shorter than one of facts");
  });

  it("the note slot is two lines whether or not the note fills them", () => {
    const note = globalsCss.match(/\.page-insight > small \{([\s\S]*?)\}/);
    assert.ok(note, "the note slot went");
    assert.match(note[1], /min-height: calc\(1\.34em \* 2\);/,
      "the reserved second line went, so a one-line note draws a shorter chip than a two-line one");
    assert.match(globalsCss, /\.page-insight > small > span:first-child \{[\s\S]*?-webkit-line-clamp: 2;/);
  });

  it("a sparkline rides inside the reserved slot rather than under it", () => {
    assert.match(globalsCss, /\.page-insight__spark \{[\s\S]*?align-items: flex-end;/);
  });
});

describe("what is truncated is never lost", () => {
  const head = read("components/workspace/PageHead.tsx");

  it("the label and the value truncate on one line", () => {
    for (const selector of [/\.page-insight > span \{([\s\S]*?)\}/, /\.page-insight > strong \{([\s\S]*?)\}/]) {
      const rule = globalsCss.match(selector);
      assert.ok(rule, `a chip row lost its rule: ${selector}`);
      assert.match(rule[1], /white-space: nowrap;/);
      assert.match(rule[1], /overflow: hidden;/);
      assert.match(rule[1], /text-overflow: ellipsis;/);
    }
  });

  it("each truncated string carries its own full text as a title", () => {
    /*
     * A number cut in half with no way back is worse than a container that
     * moves, and the value line is the figure itself: at 768px "Moving-average
     * crossover" gives up 40px to the ellipsis. All three rows carry the
     * string, so the ellipsis is never the last word.
     */
    assert.match(head, /<span title=\{metric\.label\}>\{metric\.label\}<\/span>/);
    assert.match(head, /title=\{typeof metric\.value === "string" \|\| typeof metric\.value === "number" \? String\(metric\.value\) : undefined\}/);
    assert.match(head, /<span title=\{typeof metric\.note === "string" \? metric\.note : undefined\}>\{metric\.note\}<\/span>/);
  });

  it("an actionable chip names its label and its value to a screen reader", () => {
    assert.match(head, /aria-label=\{`\$\{metric\.actionLabel \?\? "Open details"\}\. \$\{metric\.label\}: \$\{/);
  });
});

describe("the panel floor under the sections follows the text size", () => {
  it("it is the split constant, not a number chosen at one size", () => {
    /*
     * Measured settled height of the shortest of the twelve panels this floor
     * covers — Portfolio's Positions section — is 396.8 / 406.4 / 427.2px on
     * the compact, comfortable and large steps. The floor resolves to
     * 390 / 400 / 415px against the same three, so it sits under all three
     * and shows on none. The flat 420px it replaced sat 13.6px above the
     * comfortable reading and below the large one.
     */
    assert.match(globalsCss, /min-height: calc\(330px \+ 5 \* var\(--fs-body\)\);/);
  });

  it("the header gets no floor of its own, because it never collapses", () => {
    // A rival reserve would drift from the chip arithmetic the way the chip's
    // own floor already drifted twice — 81px, then 84px, against a real
    // 89.8px. The header's height is a property of the chips inside it.
    assert.doesNotMatch(globalsCss, /\.page-heading \{[^}]*min-height: (?!0)/,
      "the page header gained a second floor, which is a rival to the chip's own arithmetic");
  });
});
