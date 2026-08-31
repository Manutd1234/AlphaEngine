import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

describe("shared disclosure and compact-control alignment", () => {
  const css = read("app/globals/14zzj-layout-review-followup.css");

  it("gives every ordinary summary one explicit marker column", () => {
    assert.match(css, /:where\(details:not\(\.page-context-strip__provenance\):not\(\.friction-group\):not\(\.data-quality-ledger\):not\(\.next-step-footer__detail\):not\(\[data-summary-marker="source-owned"\]\)\) > summary \{/);
    assert.match(css, /display: flex;/);
    assert.match(css, /align-items: center;/);
    assert.match(css, /list-style: none;/);
    assert.match(css, /summary::-webkit-details-marker[\s\S]*display: none;/);
    assert.match(css, /summary::before[\s\S]*content: "▸";/);
    assert.match(css, /summary::before[\s\S]*transform-origin: center;/);
    assert.match(css, /\[open\]\) > summary::before[\s\S]*transform: rotate\(90deg\);/);
  });

  it("keeps the PageHead question bubble out of the triangle contract", () => {
    assert.doesNotMatch(css, /(^|\n)details > summary/m);
    assert.match(read("app/globals/14zz-quant-shell.css"),
      /\.page-context-strip__provenance > summary \{[\s\S]*place-items: center;/);
  });

  it("lets each purpose-built marker opt out without raising shared specificity", () => {
    for (const exclusion of [
      ".page-context-strip__provenance",
      ".friction-group",
      ".data-quality-ledger",
      ".next-step-footer__detail",
      '[data-summary-marker="source-owned"]',
    ]) assert.ok(css.includes(`:not(${exclusion})`), `${exclusion} lost its marker exclusion`);
    assert.match(read("components/coherence/UniversePane.tsx"), /className=\{styles\.outcomes\} data-summary-marker="source-owned"/);
  });

  it("contains native selects and centres point marks inside shared pills", () => {
    const select = css.slice(css.indexOf("select {"), css.indexOf("label:has"));
    assert.match(select, /min-inline-size: 0;/);
    assert.match(select, /max-inline-size: 100%;/);
    assert.match(select, /line-height: 1\.25;/);
    assert.match(css, /\.coh-chip__mark \{[\s\S]*place-items: center;/);
    assert.match(css, /\.coh-chip \{[\s\S]*overflow: hidden;/);
    assert.match(css, /\.coh-chip :is\(\.coh-chip__word, \.coh-chip__value\) \{[\s\S]*min-inline-size: 0;[\s\S]*text-overflow: ellipsis;/);
    assert.match(read("components/coherence/figure-chips.tsx"), /title=\{value \? `\$\{word\}: \$\{value\}` : word\}/);
    for (const token of [".pill", ".method-badge", ".verdict-pill", ".coh-chip", ".friction-badge", ".page-status"]) {
      assert.ok(css.includes(token), `${token} is outside the shared compact-control alignment`);
    }
  });

  it("aligns figure markers and note lists in Diffusion as well as Markets and Proofs", () => {
    assert.match(css, /:is\(\.coh-figure__missing, \.coh-surface__moments-note\):has/);
    assert.doesNotMatch(css, /:is\(\.markets-plane, \.proofs-plane\) :is\(\.coh-figure__missing/);
    assert.match(css, /grid-template-columns: 0\.75rem minmax\(0, 1fr\);/);
    assert.match(css, /\.coherence-plane \.coh-notes \{/);
  });

  it("gives ordinary disclosures a complete coarse-pointer tap target", () => {
    const touchCss = read("app/globals/15-navigator-and-trailing-layer.css");
    const coarse = touchCss.slice(touchCss.indexOf("@media (pointer: coarse)"));
    assert.match(coarse, /details:not\(\.page-context-strip__provenance\)[\s\S]*> summary \{[\s\S]*min-block-size: 44px;/);
  });

  it("loads after desk-specific styling and before the trailing accessibility layer", () => {
    const manifest = read("app/globals.css");
    const shared = manifest.indexOf('@import "./globals/14zzj-layout-review-followup.css";');
    assert.ok(shared > manifest.indexOf('@import "./globals/14zzi-header-alignment-followup.css";'));
    assert.ok(shared < manifest.indexOf('@import "./globals/15-navigator-and-trailing-layer.css";'));
    assert.doesNotMatch(manifest, /14zzk-disclosure-control-alignment/);
  });
});

describe("the reviewed Markets disclosures", () => {
  it("uses the shared selection surface for Universe and neutral mobile workspace pickers", () => {
    const sizes = read("components/coherence/CertificateSizes.module.css");
    assert.match(sizes, /\.metricSwitch \{[\s\S]*background: var\(--sky-1\);/);
    assert.match(sizes, /\.metricSwitch button \{[\s\S]*border: 1px solid transparent;/);
    assert.match(sizes, /button\[aria-pressed=\"true\"\][\s\S]*box-shadow: inset 3px 0 0 var\(--series-1\);/);

    const sharedSwitcher = read("components/workspace/QuantViewSwitcher.tsx");
    assert.match(sharedSwitcher, /className=\{cn\("seg quant-view-switcher"[\s\S]*size="sm"/);

    const universe = read("components/coherence/UniverseInstruments.module.css");
    assert.doesNotMatch(universe, /quant-view-switcher \[data-slot="toggle-group-item"\]\s*\{/,
      "Universe must not fork the shared analytical-tab dimensions");
    const universeFrame = universe.match(/quant-view-switcher\[data-option-count="3"\]\)\s*\{([^}]*)\}/);
    assert.ok(universeFrame, "Universe lost its full-row layout rule");
    assert.doesNotMatch(universeFrame[1], /\b(?:gap|padding|border|border-radius)\s*:/,
      "Universe must inherit the shared segmented-control frame metrics");
    assert.doesNotMatch(universe, /toggle-group-item\"\]\[data-state=\"on\"\]/);
    assert.doesNotMatch(universe, /toggle-group-item\"\]::before/);
    assert.match(universe, /coh-family__button\[aria-expanded=\"true\"\][\s\S]*box-shadow: inset 3px 0 0 var\(--series-1\);/);

    const trailing = read("app/globals/15-navigator-and-trailing-layer.css");
    const picker = trailing.slice(trailing.indexOf(".workspace-subtabs__picker {", trailing.indexOf("@media (max-width: 820px)")));
    assert.match(picker, /border: 1px solid var\(--rule-soft\);/);
    assert.match(picker, /background: var\(--surface-1\);/);
    assert.match(picker, /select:focus-visible[\s\S]*outline: 2px solid var\(--series-1\);/);
  });

  it("keeps the mobile market dropdown inside its trigger column", () => {
    const css = read("app/globals/14t-quotes-layout.css");
    const mobile = css.slice(css.indexOf("@media (max-width: 620px)"));
    assert.match(mobile, /\.coh-market__panel \{[\s\S]*right: auto;[\s\S]*left: 0;[\s\S]*width: 100%;[\s\S]*min-width: 0;[\s\S]*max-width: 100%;/);
  });

  it("aligns the ledger caption and fixes its five column tracks", () => {
    const css = read("components/coherence/BooksInstruments.module.css");
    assert.match(css, /\.ledger table \{[^}]*table-layout: fixed;/);
    assert.match(css, /\.ledger :global\(\.coh-table__caption\) \{ padding: 9px var\(--space-4\); text-align: left; \}/);
    assert.match(css, /:first-child \{ width: 16%; padding-inline-start: var\(--space-4\); \}/);
    for (const width of ["18%", "24%"]) assert.ok(css.includes(`width: ${width};`));
  });

  it("keeps every Universe disclosure title and body clear of its border", () => {
    const distribution = read("components/coherence/UniverseDistribution.module.css");
    assert.match(distribution, /\.distributionPanel > \.distributionMethod \{[\s\S]*border: 0;[\s\S]*border-block-start: 1px solid var\(--grid\);[\s\S]*border-radius: 0;[\s\S]*background: transparent;/);
    assert.match(distribution, /\.distributionMethod summary \{[\s\S]*min-height: 2\.75rem;[\s\S]*padding-block: var\(--space-3\);[\s\S]*padding-inline: var\(--space-4\);/);
    assert.match(distribution, /\.distributionMethod p \{[\s\S]*margin: 0;[\s\S]*padding-block: var\(--space-2\) var\(--space-4\);[\s\S]*padding-inline-start: calc\(var\(--space-4\) \+ 0\.75rem \+ var\(--space-2\)\);/);

    const outcomes = read("components/coherence/UniverseFamilyLayout.module.css");
    assert.match(outcomes, /\.outcomes > summary \{[\s\S]*padding-block: var\(--space-3\);[\s\S]*padding-inline: var\(--space-4\);/);
    assert.match(outcomes, /\.outcomes :global\(\.coh-table__caption\) \{[\s\S]*padding: var\(--space-3\) var\(--space-4\);/);

    const notes = read("components/coherence/UniverseInstruments.module.css");
    assert.match(notes, /\.universeScope > :global\(\.disclosure\) > summary \{[\s\S]*padding-block: var\(--space-3\);[\s\S]*padding-inline: var\(--space-4\);/);
    assert.match(notes, /\.universeScope > :global\(\.disclosure\) > :not\(summary\) \{[\s\S]*margin: 0;[\s\S]*padding-inline-end: var\(--space-4\);[\s\S]*padding-inline-start: calc\(var\(--space-4\) \+ 0\.75rem \+ var\(--space-2\)\);/);
  });
});
