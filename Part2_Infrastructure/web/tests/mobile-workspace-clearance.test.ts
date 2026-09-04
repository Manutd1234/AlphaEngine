/**
 * Phone geometry that can look correct until the workspace reaches max scroll.
 *
 * The thumb navigator is fixed outside `.workspace-shell`, which is the only
 * scrolling owner. Clearance on a document footer therefore cannot protect the
 * last in-panel action; the inset has to belong to the scroll owner itself.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";

const css = globalsCss.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
  comment.replace(/[^\n]/g, " "),
);

function mediaBodies(condition: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  while (from < css.length) {
    const opening = css.indexOf(condition, from);
    if (opening < 0) break;
    let depth = 0;
    let started = false;
    for (let index = css.indexOf("{", opening); index < css.length; index += 1) {
      if (css[index] === "{") { depth += 1; started = true; }
      else if (css[index] === "}") depth -= 1;
      if (started && depth === 0) {
        bodies.push(css.slice(opening, index + 1));
        from = index + 1;
        break;
      }
    }
  }
  assert.ok(bodies.length > 0, `${condition} is absent`);
  return bodies;
}

describe("the fixed phone navigator never covers the scroll tail", () => {
  const phone = mediaBodies("@media (max-width: 620px)").join("\n");

  it("reserves the thumb-bar clearance on the actual scrolling owner", () => {
    assert.match(
      phone,
      /main\.workspace-shell\s*\{[^}]*padding-bottom:\s*calc\(var\(--mobile-nav-clearance\) \+ env\(safe-area-inset-bottom\)\);/s,
    );
    assert.match(
      css,
      /--mobile-nav-clearance:\s*62px;/,
      "the tested thumb-bar clearance must be one named token, not a drifting literal",
    );
    assert.match(css, /--mobile-nav-height:\s*53px;/);
    assert.match(
      phone,
      /main\.workspace-shell\s*\{[^}]*height:\s*calc\(100svh - var\(--header-h\) - var\(--mobile-nav-height\) - env\(safe-area-inset-bottom\)\);/s,
      "the scrolling viewport must end where the fixed navigator begins",
    );
  });

  it("does not solve an in-panel obstruction by moving or hiding the page footer", () => {
    const shellRule = phone.match(/main\.workspace-shell\s*\{([^}]*)\}/s)?.[1] ?? "";
    assert.doesNotMatch(shellRule, /display:\s*none|visibility:\s*hidden/);
    assert.doesNotMatch(shellRule, /position:\s*(fixed|absolute)/);
  });
});

describe("dense lead metrics remain readable at 390px", () => {
  const phone = mediaBodies("@media (max-width: 620px)").join("\n");
  const compactPhone = mediaBodies("@media (max-width: 350px)").join("\n");

  it("gives dense context strips enough columns at standard and compact phone widths", () => {
    assert.match(
      phone,
      /\.data-control-plane \.page-heading__insights\[data-count\],\s*\.developer-control-plane \.page-heading__insights\[data-count\]\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s,
    );
    assert.match(
      phone,
      /#panel-risk \.page-heading__insights\[data-count="4"\]\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s,
      "Risk's long labels need two columns or the section picker falls under the thumb bar",
    );
    assert.match(
      compactPhone,
      /\.page-heading__insights\[data-count="3"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
      "three-metric headers need one track at 320px so labels do not collide with provenance controls",
    );
    assert.match(
      compactPhone,
      /\.page-heading__insights\[data-count="3"\] \.page-insight \+ \.page-insight\s*\{[^}]*border-block-start:\s*1px solid var\(--border\);[^}]*border-inline-start:\s*0;/s,
      "stacked metrics need horizontal rules without stale vertical dividers",
    );
  });

  it("keeps the override scoped away from the shorter Portfolio, Research, and Execution briefs", () => {
    assert.doesNotMatch(
      phone,
      /#panel-(?:portfolio|research|execution)\s+\.page-heading__insights\[data-count/,
    );
  });

  it("contains Overview values and gives provenance the full local cell width", () => {
    assert.match(
      phone,
      /\.overview-hero \.page-context-strip__value > strong\s*\{[^}]*font-size:\s*var\(--fs-title\);/s,
    );
    assert.match(
      phone,
      /\.overview-hero \.page-context-strip__value \.number-ticker\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow-wrap:\s*anywhere;/s,
    );
    assert.match(
      phone,
      /\.overview-hero \.page-context-strip__note\s*\{[^}]*flex-direction:\s*column;/s,
    );
  });
});
