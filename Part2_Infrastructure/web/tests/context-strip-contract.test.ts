import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";

const root = join(import.meta.dirname, "..");
const pageHead = readFileSync(join(root, "components/workspace/PageHead.tsx"), "utf8");
const dataConsole = readFileSync(join(root, "components/DataConsole.tsx"), "utf8");
const dataMetrics = readFileSync(join(root, "components/data/data-console-metrics.tsx"), "utf8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...globalsCss.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{`, "g"))];
  assert.ok(matches.length > 0, `no CSS rule found for ${selector}`);
  const start = globalsCss.indexOf("{", matches.at(-1)!.index);
  const end = globalsCss.indexOf("}", start);
  return globalsCss.slice(start + 1, end);
}

describe("PageHead decision context", () => {
  it("is one semantic definition list rather than a row of independent cards", () => {
    assert.match(pageHead, /<dl\s+className="page-heading__insights page-context-strip"/);
    assert.match(pageHead, /<dt className="page-context-strip__label">/);
    assert.match(pageHead, /<dd className="page-context-strip__value">/);
    assert.match(pageHead, /<dd className="page-context-strip__note">/);

    const strip = ruleBody(".page-context-strip");
    assert.match(strip, /border:\s*1px solid var\(--border\)/);
    const cell = ruleBody(".page-insight");
    assert.doesNotMatch(cell, /box-shadow:/, "context cells must not look like separate cards");
    assert.doesNotMatch(cell, /border-radius:/, "only the context strip owns the enclosing shape");
  });

  it("keeps complete labels, values and provenance in the document", () => {
    assert.doesNotMatch(pageHead, /title=\{/,
      "decision context must not rely on hover to recover clipped text");
    const label = ruleBody(".page-context-strip__label");
    const value = ruleBody(".page-context-strip__value");
    const note = ruleBody(".page-context-strip__note");
    for (const body of [label, value, note]) {
      assert.doesNotMatch(body, /text-overflow:\s*ellipsis/);
      assert.doesNotMatch(body, /-webkit-line-clamp/);
    }
    assert.match(note, /overflow-wrap:\s*anywhere/);
  });

  it("retains a named keyboard action without changing the metric text", () => {
    assert.match(pageHead, /<dd className="page-context-strip__interaction">/,
      "the definition-list group may contain only dt/dd children");
    assert.match(pageHead, /className="page-context-strip__action"/);
    assert.match(pageHead, /aria-label=\{`\$\{metric\.actionLabel \?\? "Open details"\}\. \$\{metric\.label\}: \$\{/);
  });

  it("pins every metric's provenance control to its top-right corner", () => {
    assert.match(pageHead, /\{metric\.note \? \(\s*<details className="page-context-strip__provenance">/);
    const provenance = ruleBody(".page-context-strip__provenance");
    assert.match(provenance, /position:\s*absolute/);
    assert.match(provenance, /inset-block-start:\s*8px/);
    assert.match(provenance, /inset-inline-end:\s*8px/);
    const open = ruleBody(".page-context-strip__provenance[open]");
    assert.match(open, /background:\s*var\(--surface-1\)/);
    assert.match(open, /box-shadow:\s*var\(--shadow-sm\)/);
  });

  it("keeps an open provenance note visible beyond the metric row", () => {
    const strip = ruleBody(".page-context-strip");
    assert.match(strip, /overflow:\s*visible/);
    assert.doesNotMatch(strip, /overflow:\s*(?:hidden|clip)/,
      "the enclosing strip clips the expanded provenance words");

    const raised = ruleBody(".page-context-strip:has(.page-context-strip__provenance[open])");
    assert.match(raised, /position:\s*relative/);
    assert.match(raised, /z-index:\s*var\(--z-popover\)/,
      "the open note can be painted under the analytical surface below it");
  });
});

describe("Data PageHead row stability", () => {
  it("reserves two feed tracks for the freshness label and keeps it on one line", () => {
    assert.match(dataConsole, /data-data-section=\{section\}/);
    assert.match(dataConsole, /wide: metric\.wide/);
    assert.match(dataMetrics, /deriveTrustSlis\(health\)\.map\(\(sli, index\)/);
    assert.match(dataMetrics, /wide: index === 0/);
    assert.match(globalsCss, /\.data-control-plane\[data-data-section="feeds"\] \.page-heading__insights \{[^}]*repeat\(7, minmax\(0, 1fr\)\)/);
    assert.match(globalsCss, /\.data-control-plane\[data-data-section="feeds"\] \.page-insight\.is-wide \{[^}]*grid-column: span 2/);
    assert.match(globalsCss, /\.page-insight\.is-wide \.page-context-strip__label \{[^}]*overflow-wrap: normal;[^}]*white-space: nowrap/);
  });

  it("uses one desktop metric height and releases it at the stacked breakpoint", () => {
    assert.match(globalsCss, /\.data-control-plane \.page-insight \{[^}]*block-size: 78px;[^}]*min-height: 78px/);
    assert.match(globalsCss, /@media \(max-width: 1120px\) \{[\s\S]*?\.data-control-plane \.page-insight \{[^}]*block-size: auto;/);
  });
});
