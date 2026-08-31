/**
 * Presentation-only contract for Overview, Research, Execution and Portfolio.
 *
 * These four workspaces carry protected copy. The layout layer may organise
 * that copy, but it may never make a complete sentence depend on hover,
 * clipping or an unopened control. This suite deliberately reads only the
 * scoped Wave 3A stylesheet: the older owners can retain their historical
 * rules while the final, tab-specific layer proves which declarations win.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = join(import.meta.dirname, "..");
const relative = "app/globals/14zzd-protected-desk-a.css";
const css = readFileSync(join(root, relative), "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`).exec(css);
  assert.ok(match, `missing Wave 3A rule: ${selector}`);
  return match[1];
}

describe("Wave 3A has one bounded, protected-only presentation owner", () => {
  it("stays within the source ceiling and names every owned workspace", () => {
    assert.ok(css.split("\n").length <= 400, `${relative} exceeds 400 lines`);
    for (const panel of ["overview", "research", "live", "portfolio"]) {
      assert.match(css, new RegExp(`#panel-${panel}\\b`), `${panel} has no scoped layout`);
    }
  });

  it("does not hide, clamp or ellipsise protected information", () => {
    assert.doesNotMatch(css, /display\s*:\s*none/);
    assert.doesNotMatch(css, /visibility\s*:\s*hidden/);
    assert.doesNotMatch(css, /text-overflow\s*:\s*ellipsis/);
    assert.doesNotMatch(css, /-webkit-line-clamp\s*:\s*[1-9]/);
    assert.doesNotMatch(css, /white-space\s*:\s*nowrap/);
  });
});

describe("protected copy wins over historical truncation rules", () => {
  it("keeps every Overview metric and role reading complete", () => {
    const body = rule("#panel-overview :is(.kpi-card__note, .role-card .pipeline-card__value, .role-card .pipeline-card__status, .overview-loop .truncate, .overview-loop .text-ellipsis)");
    assert.match(body, /display:\s*block/);
    assert.match(body, /overflow:\s*visible/);
    assert.match(body, /-webkit-line-clamp:\s*unset/);
  });

  it("lets Research parameter labels wrap instead of becoming hover-only", () => {
    const body = rule("#panel-research .friction-group__label");
    assert.match(body, /overflow:\s*visible/);
    assert.match(body, /white-space:\s*normal/);
    assert.match(body, /overflow-wrap:\s*anywhere/);
  });

  it("keeps Portfolio figures and their qualifiers complete", () => {
    const body = rule("#panel-portfolio .portfolio-metrics :is(strong, small)");
    assert.match(body, /display:\s*block/);
    assert.match(body, /overflow:\s*visible/);
    assert.match(body, /white-space:\s*normal/);
    assert.match(body, /-webkit-line-clamp:\s*unset/);
  });

  it("keeps the shared next-step explanation readable on narrow screens", () => {
    const body = rule(":is(#panel-overview, #panel-research, #panel-live, #panel-portfolio) .next-step-footer__hint");
    assert.match(body, /display:\s*block/);
    assert.match(body, /overflow:\s*visible/);
    assert.match(body, /-webkit-line-clamp:\s*unset/);
  });
});

describe("dense evidence remains usable at every width", () => {
  it("gives bounded evidence tables a stable scroll region", () => {
    const body = rule(":is(#panel-overview, #panel-research, #panel-live, #panel-portfolio) .table-wrap");
    assert.match(body, /scrollbar-gutter:\s*stable/);
    assert.match(body, /overscroll-behavior:\s*contain/);
  });

  it("contains wide evidence without shrinking a workspace track past zero", () => {
    const body = rule(":is(#panel-overview, #panel-research, #panel-live, #panel-portfolio) :is(.workspace-subtab-panel, .card, .table-wrap)");
    assert.match(body, /min-inline-size:\s*0/);
  });

  it("draws a keyboard-visible focus boundary around scrollable evidence", () => {
    const body = rule(":is(#panel-overview, #panel-research, #panel-live, #panel-portfolio) .table-wrap:focus-visible");
    assert.match(body, /outline:\s*2px solid var\(--series-1\)/);
    assert.match(body, /outline-offset:\s*2px/);
  });

  it("uses one mobile breakpoint to collapse paired evidence and action rows", () => {
    assert.match(css, /@media \(max-width:\s*720px\)\s*\{[\s\S]*?\.portfolio-chart-pair[\s\S]*?\.cockpit-grid[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});
