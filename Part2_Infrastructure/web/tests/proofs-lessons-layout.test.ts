import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { COHERENCE_LESSONS } from "../lib/coherence/lessons";
import { read } from "./helpers/workspace-sources";

const pane = read("../components/coherence/LessonsPane.tsx");
const groupPins = read("../components/coherence/GroupPins.tsx");
const lessonFigures = read("../components/coherence/lesson-figures/index.tsx");
const lessonsCss = readFileSync(join(import.meta.dirname, "../app/globals/14zzba-proofs-lessons.css"), "utf8");
const pinsCss = readFileSync(join(import.meta.dirname, "../components/coherence/LessonPins.module.css"), "utf8");
const sharedSwitcherCss = readFileSync(join(import.meta.dirname, "../app/globals/14z-engine-evidence.css"), "utf8");
const retiredOwner = readFileSync(join(import.meta.dirname, "../app/globals/14u-proofs-layout.css"), "utf8");

function declarationFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = lessonsCss.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `missing CSS contract for ${selector}`);
  return match[1];
}

describe("Proofs Lessons keeps one bounded catalogue", () => {
  it("preserves all fourteen lessons and the existing Sheet detail", () => {
    assert.equal(COHERENCE_LESSONS.length, 14);
    assert.match(pane, /<Sheet/);
    assert.match(pane, /<LessonDetail lesson=\{selectedLesson\}/);
    assert.match(pane, /data-lessons-grid/);
    assert.match(pane, /data-lesson-formula/);
    assert.match(pane, /data-lesson-action/);
  });

  it("renders each lesson as one bordered semantic table row", () => {
    assert.doesNotMatch(
      retiredOwner,
      /\.coherence-plane\.proofs-plane \.coh-lessons__grid\s*\{/,
      "14u still competes with the Lessons-only catalogue owner",
    );
    assert.match(pane, /<table className="coh-table coh-lessons__table">/);
    assert.match(pane, /<th scope="col">Lesson<\/th>/);
    assert.match(pane, /<th scope="row">/);
    assert.match(pane, /role="region"[\s\S]*tabIndex=\{0\}/);
    assert.match(lessonsCss, /\.proofs-plane \.coh-lessons__table\s*\{[^}]*min-width:\s*64rem;[^}]*table-layout:\s*fixed;/s);
    assert.match(lessonsCss, /\.proofs-plane \.coh-lessons__table :is\(th, td\)\s*\{[^}]*border:\s*1px solid/s);
  });

  it("contains the wide semantic table in its labelled local scrollport", () => {
    assert.match(pane, /<section className="coh-lessons__catalogue" aria-labelledby=/);

    const catalogue = declarationFor(".proofs-plane .coh-lessons__catalogue");
    assert.match(catalogue, /min-inline-size:\s*0/);
    assert.match(catalogue, /max-inline-size:\s*100%/);

    const grid = declarationFor(".proofs-plane .coh-lessons__grid");
    assert.match(grid, /min-width:\s*0/);
    assert.match(grid, /max-width:\s*100%/);
    assert.match(grid, /overflow-x:\s*auto/);
    assert.match(pane, /className="table-wrap coh-lessons__grid"[\s\S]*role="region"[\s\S]*aria-label=/);
  });

  it("does not silently ellipsise a lesson equation", () => {
    const formula = declarationFor(".proofs-plane .coh-lesson-index-card .coh-lesson__formula");
    assert.match(formula, /overflow-wrap:\s*anywhere/);
    assert.match(formula, /white-space:\s*normal/);
    assert.doesNotMatch(formula, /overflow:\s*hidden|text-overflow:\s*ellipsis/);
  });

  it("makes the technical comparison a semantic table with every lesson title in full", () => {
    assert.match(groupPins, /<table className=\{`coh-table \$\{styles\.coverageTable\}`\}>/);
    assert.match(groupPins, /<th scope="col">Lesson<\/th>/);
    assert.match(groupPins, /<th scope="col" className="num">Guarded modules<\/th>/);
    assert.match(groupPins, /<th scope="col" className="num">Pinning suites<\/th>/);
    assert.match(groupPins, /<th scope="col">Suite coverage<\/th>/);
    assert.match(groupPins, /<th scope="row">/);
    assert.match(groupPins, /cell\.lesson\.title/);
    assert.match(groupPins, /coverageLabel\(cell\)/);
    assert.match(groupPins, /onInspect\(cell\.lesson\)/);
    assert.match(groupPins, />\s*Inspect\s*<\/Button>/);
    assert.match(pane, /<GroupPins lessons=\{inView\} onInspect=/);
    assert.doesNotMatch(groupPins, /truncateMiddle|text-overflow|useState|aria-pressed/);
    assert.match(pinsCss, /\.tableWrap\s*\{[^}]*overflow-x:\s*auto;/s);
    assert.match(pinsCss, /\.coverageTable\s*\{[^}]*min-width:\s*58rem;[^}]*table-layout:\s*fixed;/s);
    assert.match(pinsCss, /\.lessonIdentity > span:last-child\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);
    assert.doesNotMatch(pinsCss, /text-overflow:\s*ellipsis/);
    assert.match(pinsCss, /\.coverageTable tbody th\[scope="row"\]\s*\{[^}]*position:\s*sticky[^}]*left:\s*0/s);
    assert.match(groupPins, /aria-label=\{`Inspect \$\{cell\.lesson\.title\}`\}/);
  });

  it("segregates the Sheet into four visibly numbered sections", () => {
    for (const [number, title] of [
      ["01", "Claim"], ["02", "Technical model"], ["03", "Proof conditions"],
      ["04", "Code and test evidence"],
    ] as const) {
      assert.match(pane, new RegExp(`<LessonDetailSection number="${number}" title="${title}"`));
    }
    assert.match(pane, /className="coh-lesson-detail__section" aria-labelledby=\{id\}/);
    assert.match(pane, /<span className="sr-only">Section \{number\}: <\/span>/);
    assert.match(pane, /Lesson \{String\(ordinal\)\.padStart\(2, "0"\)\} of \{COHERENCE_LESSONS\.length\}/);
    assert.match(lessonsCss, /\.coh-lesson-detail__section\s*\{[^}]*border:\s*1px solid/s);
    assert.match(lessonsCss, /\.coh-lesson-detail__section-head\s*\{[^}]*grid-template-columns:/s);
  });

  it("keeps the Lessons contrast warm stone and white instead of blue and white", () => {
    const catalogueHover = declarationFor(".proofs-plane .coh-lesson-index-card:is(:hover, :focus-within)");
    assert.match(catalogueHover, /var\(--surface-2\) 35%, var\(--surface-1\)/);
    assert.doesNotMatch(catalogueHover, /var\(--series-1\)/);

    const sectionNumber = declarationFor(".proofs-plane .coh-lesson-detail__section-number");
    assert.match(sectionNumber, /color:\s*var\(--axis\)/);
    assert.match(
      lessonsCss,
      /\.proofs-plane\.coh-lesson-sheet \.coh-lessonfig__readout\s*\{[^}]*border-inline-start-color:\s*var\(--axis\);[^}]*var\(--surface-2\) 35%, var\(--surface-1\)/s,
    );
    assert.match(
      pinsCss,
      /\.coverageTable tbody tr:is\(:hover, :focus-within\)\s*\{[^}]*var\(--surface-2\) 35%, var\(--surface-1\)/s,
    );
    assert.doesNotMatch(pinsCss, /color-mix\([^)]*var\(--series-1\)/);
    assert.doesNotMatch(`${lessonsCss}\n${pinsCss}`, /#[0-9a-f]{3,8}\b/i);
  });

  it("removes the requested catalogue sentence but keeps an accessible caption", () => {
    assert.doesNotMatch(pane, /Every claim in this section/);
    assert.match(pane, /<caption className="coh-table__caption sr-only">\{group\.label\} lesson catalogue<\/caption>/);
  });

  it("keeps the coverage atlas exact, bounded, and keyboard-activatable", () => {
    const coverage = read("../components/coherence/LessonCoverage.tsx");
    assert.match(pane, /<LessonCoverage onOpenSection=\{onOpenSection\}/);
    assert.match(coverage, /minWidth=\{plotFloor\}/);
    assert.match(coverage, /scrollLabel="Lesson coverage by engine section"/);
    assert.match(coverage, /onSelect=\{onOpenSection/);
    assert.match(coverage, /onOpenSection\(tabForSection\(column\.id\), column\.id\)/);
    assert.match(coverage, /column\.lessons\.map\(\(lesson\) => lesson\.title\)\.join/);
  });

  it("contains every row, action and detail figure inside bordered surfaces", () => {
    const row = declarationFor(".proofs-plane .coh-lesson-index-card");
    assert.match(row, /min-width:\s*0/);
    assert.match(row, /overflow:\s*hidden/);

    const action = declarationFor(".proofs-plane .coh-lesson-index-card [data-lesson-action]");
    assert.match(action, /width:\s*100%/);
    assert.match(action, /max-inline-size:\s*100%/);
    const figureRegion = declarationFor(".proofs-plane .coh-lesson-detail__section-body > .coh-lessonfig");
    assert.match(figureRegion, /overflow-x:\s*auto/);
    assert.match(lessonFigures, /className="coh-lessonfig"[\s\S]*role="region"[\s\S]*tabIndex=\{0\}/);

    const figureFrame = declarationFor(".proofs-plane .coh-lesson-detail__body .coh-lessonfig__frame");
    assert.match(figureFrame, /min-inline-size:\s*calc\(320px/);
    assert.match(figureFrame, /overflow:\s*visible/);

    const figureSvg = declarationFor(".proofs-plane .coh-lesson-detail__body .coh-lessonfig__frame svg");
    assert.match(figureSvg, /min-inline-size:\s*320px/);
    assert.match(figureSvg, /max-width:\s*32rem/);
    assert.match(figureSvg, /overflow:\s*visible/);
    assert.match(lessonsCss, /\.coh-lesson__criteria-wrap\s*\{[^}]*margin:\s*0;/s);
  });

  it("keeps all six named views visible in bounded, wrapping tracks", () => {
    assert.match(pane, /label="Lessons view"/);

    const bar = declarationFor(".proofs-plane .coh-lessons > .coh-bar");
    assert.match(bar, /min-width:\s*0/);
    assert.match(bar, /max-width:\s*100%/);

    const switcher = declarationFor(".proofs-plane .coh-lessons .quant-view-switcher");
    assert.match(switcher, /width:\s*100%/);
    assert.match(switcher, /max-width:\s*100%/);
    assert.match(switcher, /min-width:\s*0/);
    assert.match(switcher, /overflow:\s*visible/);
    assert.doesNotMatch(switcher, /overflow-x:\s*auto/);
    assert.doesNotMatch(switcher, /min-width:\s*max-content/);

    assert.match(
      sharedSwitcherCss,
      /\.quant-view-switcher\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*[^)]+\),\s*1fr\)\);[\s\S]*?overflow:\s*visible;/,
    );
    assert.match(
      sharedSwitcherCss,
      /\.quant-view-switcher \[data-slot="toggle-group-item"\]\s*\{[\s\S]*?min-inline-size:\s*0;[\s\S]*?white-space:\s*normal;[\s\S]*?overflow-wrap:\s*anywhere;/,
    );
    assert.doesNotMatch(
      sharedSwitcherCss,
      /\.quant-view-switcher\s*\{[^}]*overflow-x:\s*auto/,
    );
  });

  it("reveals the catalogue without translating its card beyond the subtab owner", () => {
    const catalogue = declarationFor(".proofs-plane .workspace-subtab-panel > .coh-lessons");
    assert.match(catalogue, /animation-name:\s*proofs-lessons-fade-in/);
    assert.doesNotMatch(catalogue, /transform|translate/);
    assert.match(
      lessonsCss,
      /@keyframes proofs-lessons-fade-in\s*\{\s*from\s*\{\s*opacity:\s*0;\s*\}\s*to\s*\{\s*opacity:\s*1;\s*\}\s*\}/,
    );
  });
});
