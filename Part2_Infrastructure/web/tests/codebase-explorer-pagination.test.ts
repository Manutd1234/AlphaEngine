/**
 * The complete repository manifest remains filterable and selectable without
 * mounting a six-figure-pixel file list in one scrollport.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("../components/developer/CodebaseExplorer.tsx", import.meta.url)),
  "utf8",
);
const engineeringCss = readFileSync(
  fileURLToPath(new URL("../app/globals/08-developer-engineering.css", import.meta.url)),
  "utf8",
);

describe("the repository explorer pages its complete filtered manifest", () => {
  it("bounds one mounted page at fifty files", () => {
    assert.match(source, /const CODEBASE_PAGE_SIZE = 50;/);
    assert.match(source, /orderedFiles\.slice\(pageStart, pageStart \+ CODEBASE_PAGE_SIZE\)/);
  });

  it("orders every filtered area before slicing, so no path is dropped", () => {
    const grouping = source.indexOf("const groupedFiles = useMemo");
    const ordering = source.indexOf("const orderedFiles = useMemo");
    const paging = source.indexOf("const pagedFiles = useMemo");
    assert.ok(grouping >= 0 && ordering > grouping && paging > ordering);
    assert.match(source, /groupedFiles\.flatMap\(\(group\) => group\.files\)/);
  });

  it("renders only page groups while keeping full-filter totals in the summary", () => {
    assert.match(source, /pagedGroups\.map\(\(group\) =>/);
    assert.doesNotMatch(source, /groupedFiles\.map\(\(group\) => \(/);
    assert.match(source, /\{visibleFiles\.length\} of \{REPOSITORY_FILES\.length\} paths/);
    assert.match(source, /\{groupedFiles\.length\} code areas/);
  });

  it("offers direct and adjacent keyboard-reachable page navigation", () => {
    assert.match(source, /className="codebase-filelist__pagination"/);
    assert.match(source, /setRepositoryPage\(activePage - 1\)/);
    assert.match(source, /setRepositoryPage\(activePage \+ 1\)/);
    assert.match(source, /onChange=\{\(event\) => setRepositoryPage\(Number\(event\.target\.value\)\)\}/);

    const summaryPaint = /\.codebase-filelist__summary\s*\{([^}]*)\}/
      .exec(engineeringCss)?.[1] ?? "";
    assert.match(summaryPaint, /border-start-start-radius:\s*calc\(var\(--radius-md\) - 1px\);/);
    assert.match(summaryPaint, /border-start-end-radius:\s*calc\(var\(--radius-md\) - 1px\);/);
    assert.match(summaryPaint, /background:\s*var\(--surface-1\);/);
    assert.match(summaryPaint, /backdrop-filter:\s*none;/);
  });

  it("cuts worst-case mounted file rows by more than ninety-five percent", () => {
    const page = Number(source.match(/const CODEBASE_PAGE_SIZE = (\d+);/)?.[1]);
    const manifestFloor = 1_000;
    assert.ok(Number.isFinite(page));
    assert.ok(1 - page / manifestFloor >= 0.95);
  });
});
