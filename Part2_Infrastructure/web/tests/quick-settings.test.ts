/**
 * The header's viewing preferences, and what consolidating them must not cost.
 *
 * Three things could regress quietly here. The density tiers could stop being
 * reachable, or start implying that a tier hides capability. The theme control
 * could drift out of sync with the ⌘K verb that also toggles it. And the
 * always-visible provider-health signal could get swallowed by the gear, which
 * would turn a degraded data plane into something you have to go looking for.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { COMPLEXITY_TIERS, DEFAULT_COMPLEXITY } from "../lib/complexity";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

const panel = read("../components/header/QuickSettings.tsx");
const density = read("../components/ComplexityToggle.tsx");
const header = read("../components/WorkspaceHeader.tsx");
const css = read("../app/globals.css");

describe("the gear replaces the two loose buttons", () => {
  it("is rendered once, from the header", () => {
    assert.equal((header.match(/<QuickSettings/g) ?? []).length, 1);
    // A single header instance is what makes "consistent across every view"
    // structural rather than something to re-check per tab.
    assert.equal((header.match(/<WorkspaceHeader/g) ?? []).length, 0);
  });

  it("the header no longer renders the settings buttons directly", () => {
    assert.doesNotMatch(code(header), /<ThemeToggle \/>|<ComplexityToggle \/>/);
  });

  it("both controls moved into the panel rather than being rebuilt", () => {
    // Re-implementing the theme button would fork its MutationObserver sync
    // with the command palette's own toggle verb.
    assert.match(code(panel), /<ThemeToggle \/>/);
    assert.match(code(panel), /<ComplexityToggle \/>/);
  });

  it("keeps the header's measured height publishing intact", () => {
    // Every sticky offset in the workspace is expressed against --header-h.
    assert.match(code(header), /new ResizeObserver/);
    assert.match(code(header), /setProperty\(\s*"--header-h"/);
  });

  it("styles the trigger through the class the CSS now targets", () => {
    assert.match(code(panel), /className="icon header-settings"/);
    assert.match(css, /\.workspace-header__utility > \.header-settings \{/);
    // The collapse band between 901 and 1380px drops the label; without this
    // the gear keeps a 96px minimum and squeezes the nav instead.
    assert.match(css, /\.workspace-header__utility > \.header-settings span,/);
  });
});

describe("the panel behaves like the house dropdown", () => {
  it("is a non-modal dialog, dismissed by Escape or a click away", () => {
    assert.match(code(panel), /role="dialog"/);
    assert.match(code(panel), /aria-modal="false"/);
    assert.match(code(panel), /event\.key === "Escape"/);
    assert.match(code(panel), /pointerdown/);
  });

  it("returns focus to the trigger on Escape, but not on a click away", () => {
    // Pulling focus back when the pointer has already moved elsewhere steals
    // it from whatever the click landed on.
    assert.match(code(panel), /close\(true\)/);
    assert.match(code(panel), /close\(false\)/);
  });

  it("announces itself as opening a dialog", () => {
    assert.match(code(panel), /aria-haspopup="dialog"/);
    assert.match(code(panel), /aria-expanded=\{open\}/);
    assert.match(code(panel), /aria-controls="quick-settings-panel"/);
  });

  it("layers through the ladder, never an inline z-index", () => {
    assert.match(code(panel), /z-\[60\]/);
    assert.doesNotMatch(code(panel), /zIndex/);
  });

  it("clamps to the viewport on a narrow screen", () => {
    assert.match(code(panel), /w-\[min\(320px,calc\(100vw-28px\)\)\]/);
  });
});

describe("density stays a preference, never a capability", () => {
  it("offers every tier as its own segment", () => {
    for (const tier of COMPLEXITY_TIERS) {
      assert.match(density, new RegExp(`COMPLEXITY_LABELS\\[candidate\\]|${tier}`));
    }
    assert.match(code(density), /COMPLEXITY_TIERS\.map/);
    assert.match(code(density), /aria-pressed=\{tier === candidate\}/);
  });

  it("says so where a reader can see it, not only in an aria-label", () => {
    // This sentence is the whole reason the tier system is safe to ship: a
    // control implying a tab is unavailable when it is one click away is the
    // misunderstanding the design exists to prevent.
    assert.match(density, /available at every level/i);
    // Comments stripped: the header states the rule by quoting the words it
    // forbids, so a raw scan reports the doctrine as the violation.
    assert.doesNotMatch(code(density), /\bhidden\b|\bunavailable\b/i);
  });

  it("writes through the shared store rather than its own state", () => {
    assert.match(code(density), /setComplexity\(candidate\)/);
    assert.match(code(density), /useComplexity\(\)/);
    assert.equal(DEFAULT_COMPLEXITY, "standard");
  });

  it("the workspace shell still never branches on the tier", () => {
    // A panel may ask; the router may not. A tier that changes which sections
    // exist is a navigation fork.
    assert.doesNotMatch(read("../app/page.tsx"), /useComplexity|atLeast/);
  });
});

describe("a degraded data plane stays visible without opening anything", () => {
  it("keeps the standalone health button in the header", () => {
    assert.match(code(header), /className=\{`system-health system-health-action/);
  });

  it("mirrors the same label into the panel rather than inventing one", () => {
    assert.match(code(panel), /healthLabel/);
    assert.match(code(panel), /healthNeedsAttention \? "is-warn" : ""/);
    assert.match(code(header), /healthLabel=\{healthLabel\}/);
  });

  it("routes the panel's link through the header's existing handler", () => {
    assert.match(code(header), /onOpenReliability=\{onOpenProviderHealth\}/);
  });
});

describe("the formatting row does not pretend", () => {
  it("is disabled rather than a selector that changes nothing", () => {
    // lib/format.ts hardwires the locales through dozens of memoised call
    // sites; a persisted preference would remember a choice it cannot act on.
    const row = code(panel).slice(code(panel).indexOf("Formatting"));
    assert.match(row, /disabled/);
    assert.match(row, /English \(US\)/);
  });

  it("explains why, in the accessibility tree as well as on screen", () => {
    assert.match(code(panel), /aria-describedby="quick-settings-locale-note"/);
    assert.match(panel, /not\s+implemented yet/);
  });
});
