/**
 * The reliability event ring is bounded at 800 records, but the timeline must
 * not turn that retention guarantee into seventeen screens of nested scroll.
 * These pins keep the full ring/filter model and page only the rendered rows.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("../components/systems/TraceConsole.tsx", import.meta.url)),
  "utf8",
);
const timeline = readFileSync(
  fileURLToPath(new URL("../components/systems/TraceTimeline.tsx", import.meta.url)),
  "utf8",
);
const workstationCss = readFileSync(
  fileURLToPath(new URL("../app/globals/14zzd-protected-desk-b.css", import.meta.url)),
  "utf8",
);
const pagerCss = readFileSync(
  fileURLToPath(new URL("../app/globals/14zzf-bounded-pagers.css", import.meta.url)),
  "utf8",
);
const systemsCss = readFileSync(
  fileURLToPath(new URL("../app/globals/02-systems-console.css", import.meta.url)),
  "utf8",
);
const reliabilityCss = readFileSync(
  fileURLToPath(new URL("../app/globals/09-reliability-consolidation.css", import.meta.url)),
  "utf8",
);

describe("the trace timeline is paged without narrowing its evidence ring", () => {
  it("retains all 800 records while bounding one rendered page to 40 rows", () => {
    assert.match(source, /const MAX_LINES = 800;/);
    assert.match(source, /const TRACE_PAGE_SIZE = 40;/);
    assert.match(source, /merged\.length > MAX_LINES/);
  });

  it("filters the complete ring before slicing the rendered page", () => {
    const visibleAt = source.indexOf("const visible = useMemo");
    const pagedAt = source.indexOf("const pagedVisible = useMemo");
    assert.ok(visibleAt >= 0 && pagedAt > visibleAt, "page slicing must follow full-ring filtering");
    assert.match(source, /visible\.slice\(pageStart, pageStart \+ TRACE_PAGE_SIZE\)/);
  });

  it("renders only the active page and keeps every page keyboard reachable", () => {
    assert.match(timeline, /pagedVisible\.map\(\(line\) =>/);
    assert.doesNotMatch(`${source}\n${timeline}`, /\{visible\.map\(\(line\) =>/);
    assert.match(timeline, /className="console-trace-pagination"/);
    assert.match(source, /onPage=\{setTimelinePage\}/);
    assert.match(timeline, /onPage\(activePage - 1\)/);
    assert.match(timeline, /onPage\(activePage \+ 1\)/);
    assert.match(timeline, /<ol[\s\S]*?className="console-log"/);
    assert.doesNotMatch(timeline, /role="log"/,
      "role=log overrides the ordered-list role and orphans every rendered li");
  });

  it("cuts the worst-case rendered row stack by at least 90%", () => {
    const retained = Number(source.match(/const MAX_LINES = (\d+);/)?.[1]);
    const page = Number(source.match(/const TRACE_PAGE_SIZE = (\d+);/)?.[1]);
    assert.ok(Number.isFinite(retained) && Number.isFinite(page));
    assert.ok(1 - page / retained >= 0.9);
  });

  it("owns a responsive master-detail container without widening the page", () => {
    assert.match(workstationCss, /#reliability-subpanel-events \.console-log-card\s*\{[\s\S]*?container-type:\s*inline-size/);
    assert.match(workstationCss, /#reliability-subpanel-events \.console-trace-split\s*\{[\s\S]*?max-inline-size:\s*100%/);
    assert.match(workstationCss, /grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(min\(100%,\s*20rem\),\s*\.72fr\)/);
    assert.match(workstationCss, /@container\s*\(max-width:\s*760px\)[\s\S]*?\.console-trace-split\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  it("keeps the inspector keyboard reachable and wraps long structured values", () => {
    assert.match(timeline, /<aside[\s\S]*?className="console-trace-detail"[\s\S]*?tabIndex=\{0\}/);
    assert.match(workstationCss, /\.console-trace-detail__body[\s\S]*?min-inline-size:\s*0/);
    assert.match(workstationCss, /\.console-trace-(?:meta|fields) dd[\s\S]*?overflow-wrap:\s*anywhere/);
    assert.match(workstationCss, /\.console-trace-(?:meta|fields) dd code[\s\S]*?white-space:\s*normal/);
  });

  it("keeps the timestamp, severity and origin atomic while wrapping message detail separately", () => {
    assert.match(
      systemsCss,
      /\.console-log__ts, \.console-log__level, \.console-log__origin \{ white-space:\s*nowrap; \}/,
    );
    assert.match(
      systemsCss,
      /\.console-log__origin\s*\{[^}]*min-width:\s*36px;\s*padding:\s*2px var\(--space-2\)/s,
    );
    assert.match(
      systemsCss,
      /\.console-log__ts\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s,
      "millisecond timestamps should not shift the row columns as their digits change",
    );
    assert.match(
      reliabilityCss,
      /grid-template-columns:\s*max-content max-content minmax\(36px, max-content\) minmax\(72px, auto\) minmax\(160px, 1fr\)/,
    );
    assert.match(
      reliabilityCss,
      /\.console-trace-split \.console-log__msg,\s*\.console-trace-split \.console-log__fields\s*\{[^}]*grid-column:\s*5;[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal/s,
    );
    assert.doesNotMatch(
      reliabilityCss,
      /\.console-trace-split \.console-log__fields\s*\{[^}]*(?:text-overflow:\s*ellipsis|white-space:\s*nowrap)/s,
    );
    assert.match(
      workstationCss,
      /@container\s*\(max-width:\s*760px\)[\s\S]*?\.console-trace-split \.console-log__line\s*\{[^}]*grid-template-columns:\s*max-content max-content minmax\(36px,\s*max-content\) minmax\(0,\s*1fr\)/s,
      "the narrow trace must size atomic timestamp, severity and origin tracks from their contents",
    );
    assert.doesNotMatch(workstationCss, /grid-template-columns:\s*76px 40px 27px minmax\(0,\s*1fr\)/);
  });

  it("keeps multi-page controls on one baseline and removes redundant follow-state chrome", () => {
    assert.match(timeline, /className="console-trace-page-count"/);
    assert.match(timeline, /\{pageCount > 1 \? \(/);
    assert.doesNotMatch(timeline, /console-trace-follow-state/);
    assert.match(
      pagerCss,
      /\.console-trace-pagination\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*justify-content:\s*flex-end;[^}]*white-space:\s*nowrap/s,
    );
  });

  it("wraps only the real pager controls on a phone", () => {
    assert.match(pagerCss, /@media\s*\(max-width:\s*520px\)[\s\S]*?\.console-trace-pagination\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  });
});
