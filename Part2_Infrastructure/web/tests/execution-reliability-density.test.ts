/**
 * Browser-visible density contracts for the two noisiest operational routes.
 *
 * Data is never truncated: the execution record is paged over the complete
 * filtered array, while Reliability keeps every telemetry metric in a native
 * disclosure on drill-down routes. The contracts deliberately test ownership
 * and slicing instead of copy edits because the core-eight static corpus is
 * signed and must stay byte-for-byte stable.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

describe("Execution activity keeps the complete audit record behind a bounded page", () => {
  const blotter = read("components/execution/OrderBlotter.tsx");
  const pager = read("components/common/BoundedPager.tsx");

  it("pages the filtered record by a named row budget", () => {
    assert.match(blotter, /const BLOTTER_PAGE_SIZE = 75;/);
    assert.match(blotter, /visible\.slice\(pageStart, pageStart \+ BLOTTER_PAGE_SIZE\)/);
    assert.match(blotter, /pagedVisible\.map\(\(row\) =>/);
    assert.doesNotMatch(blotter, /\{visible\.map\(\(row\) =>/);
  });

  it("keeps every filtered row reachable without narrowing full-result exports", () => {
    assert.match(blotter, /const pageCount = Math\.max\(1, Math\.ceil\(visible\.length \/ BLOTTER_PAGE_SIZE\)\)/);
    assert.match(blotter, /blotterToCsv\(visible\)/);
    assert.match(blotter, /JSON\.stringify\(visible, null, 2\)/);
    assert.match(blotter, /<BoundedPager/);
    assert.match(pager, /disabled=\{activePage === 0\}/);
    assert.match(pager, /disabled=\{activePage >= pageCount - 1\}/);
  });

  it("returns to the first page when a route-defining filter changes", () => {
    assert.match(blotter, /useEffect\(\(\) => \{[\s\S]*?setPageIndex\(0\);[\s\S]*?\}, \[view, focusSymbol, strategy, query, gate\]\);/);
  });

  it("keeps expansion on the explicit row button so nested controls cannot toggle it", () => {
    assert.match(blotter, /className="cockpit-blotter__row-toggle"[\s\S]*?onClick=\{\(\) => setExpanded\(/);
    assert.doesNotMatch(blotter, /<tr[\s\S]{0,300}?onClick=\{\(\) => setExpanded\(/);
  });
});

describe("Reliability drill-down routes retain one stable telemetry deck", () => {
  const chrome = read("components/systems/ConsoleChrome.tsx");
  const consoleSource = read("components/ReliabilityConsole.tsx");

  it("gives the shared chrome an opt-in native disclosure without dropping a metric", () => {
    assert.match(chrome, /deferMetrics\?: boolean/);
    assert.match(chrome, /deferMetrics \? \[\] : metrics/);
    assert.match(chrome, /deferMetrics && tiles\.length > 0/);
    assert.match(chrome, /<details className="console-metric-disclosure">/);
    assert.match(chrome, /tiles\.map\(\(tile\) =>/);
  });

  it("keeps the same header geometry on the operator control surface", () => {
    assert.doesNotMatch(consoleSource, /deferMetrics=/);
    assert.match(consoleSource, /<ConsoleChrome[\s\S]*?tiles=\{tiles\}/);
  });

  it("gives a repeated correlation only one focus id on the visible trace page", () => {
    const timeline = read("components/systems/TraceTimeline.tsx");
    assert.match(timeline, /const firstFocusKeyByCorrelation = new Map<string, string>\(\)/);
    assert.match(timeline, /firstFocusKeyByCorrelation\.get\(correlation\) === line\.key/);
    assert.match(timeline, /id=\{focusId\}/);
  });
});
