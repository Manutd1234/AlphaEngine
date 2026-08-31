/**
 * PageHead is shared by all eleven workspaces. These tests guard its semantic
 * and responsive contract without pinning protected copy to a visual card.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";

const root = join(import.meta.dirname, "..");
const pageHead = readFileSync(join(root, "components/workspace/PageHead.tsx"), "utf8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...globalsCss.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{`, "g"))];
  assert.ok(matches.length > 0, `no rule found for ${selector}`);
  return matches.map((match) => {
    const start = globalsCss.indexOf("{", match.index);
    const end = globalsCss.indexOf("}", start);
    return globalsCss.slice(start + 1, end);
  }).join("\n");
}

describe("the decision context is stable without clipping its copy", () => {
  it("uses a responsive grid and a token-derived item floor", () => {
    const row = ruleBody(".page-heading__insights");
    assert.match(row, /display:\s*grid/);
    assert.match(row, /repeat\(auto-fit,\s*minmax\(min\(14rem, 100%\), 1fr\)\)/);

    const item = ruleBody(".page-insight");
    const floor = /min-height:\s*calc\(([^;]+)\)/.exec(item)?.[1];
    assert.ok(floor, "context cells need a text-scale-aware minimum height");
    assert.match(floor!, /var\(--fs-2xs\)/);
    assert.match(floor!, /var\(--fs-title\)/);
  });

  it("uses dt/dd relationships and never relies on hover-only recovery", () => {
    assert.match(pageHead, /<dl\s+[\s\S]*?className="page-heading__insights page-context-strip"/);
    assert.match(pageHead, /<dt className="page-context-strip__label">/);
    assert.match(pageHead, /<dd className="page-context-strip__value">/);
    assert.match(pageHead, /<dd className="page-context-strip__note">/);
    assert.doesNotMatch(pageHead, /title=\{/);
    assert.doesNotMatch(ruleBody(".page-context-strip__note"), /line-clamp|overflow:\s*hidden/);
  });

  it("keeps a sparkline in the provenance row", () => {
    const spark = ruleBody(".page-insight__spark");
    assert.match(spark, /flex-shrink:\s*0/);
    assert.match(spark, /align-items:\s*flex-end/);
  });

  it("uses a valid overlay action instead of wrapping definition terms in a button", () => {
    assert.match(pageHead, /<button[\s\S]*?className="page-context-strip__action"/);
    assert.doesNotMatch(pageHead, /<button[\s\S]*?<dt className=/);
    const action = ruleBody(".page-context-strip__action");
    assert.match(action, /position:\s*absolute/);
    assert.match(action, /inset:\s*0/);
  });
});

describe("the header's status pill has a rule for every tone it declares", () => {
  it("styles every PageStatus tone", () => {
    const declaration = /tone:\s*"good"\s*\|\s*"warn"\s*\|\s*"critical"\s*\|\s*"neutral"/.exec(pageHead);
    assert.ok(declaration, "PageStatus tone union changed or could not be parsed");
    for (const tone of ["good", "warn", "critical", "neutral"]) {
      assert.ok(globalsCss.includes(`.page-status.is-${tone}`), `missing PageStatus rule for ${tone}`);
    }
  });
});
