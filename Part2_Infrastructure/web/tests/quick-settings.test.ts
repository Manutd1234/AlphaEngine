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

import { globalsCss } from "./globals-css";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

const panel = read("../components/header/QuickSettings.tsx");
const density = read("../components/ComplexityToggle.tsx");
const header = read("../components/WorkspaceHeader.tsx");
const css = globalsCss;
/**
 * The shared header dropdown. Position, width and elevation used to be twelve
 * Tailwind utilities repeated in this panel, the account menu and the kill
 * switch; the assertions that pinned them here now read the one component and
 * the one stylesheet rule that replaced all three copies.
 */
const dropdown = read("../components/header/AnchoredPanel.tsx");

/** A single rule's body, so a property assertion cannot match some other rule. */
const rule = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `${selector} is gone from the stylesheet`);
  return css.slice(start, css.indexOf("\n}", start));
};

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

  it("styles the trigger through a selector that actually reaches it", () => {
    /**
     * This assertion used to read `> .header-settings {` and passed for as long
     * as the rule existed — including the whole time it matched nothing. The
     * trigger renders inside a `.header-anchor` span (the panel needs something
     * to position against), so it is a GRANDCHILD of the utility row and the
     * single-step selector could never reach it. The gear rendered with no gap
     * beside its label and never collapsed at laptop widths, and this test
     * stayed green throughout, because "the rule is in the file" and "the rule
     * applies to the button" are different claims and only the first was made.
     *
     * Both forms are required now: the direct one for anything that ever sits
     * straight in the row, the two-level one for the anchored triggers.
     */
    assert.match(code(panel), /className="icon header-settings"/);
    assert.match(code(panel), /className="header-anchor"/);
    assert.match(css, /\.workspace-header__utility > \.header-anchor > \.header-settings \{/);
    // Rung 2 of the header's priority ladder (901–1620px) drops the label;
    // without this the gear keeps a 96px minimum and squeezes the nav instead.
    assert.match(css, /\.workspace-header__utility > \.header-anchor > \.header-settings span,/);
  });
});

describe("the panel behaves like the house dropdown", () => {
  it("is a non-modal dialog, dismissed by Escape or a click away", () => {
    // The dialog semantics belong to the shared dropdown; the dismissal stays
    // here, because each of the three callers dismisses on its own terms.
    assert.match(code(dropdown), /role="dialog"/);
    assert.match(code(dropdown), /aria-modal="false"/);
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
    // 60 was the right number by coincidence: it equals --z-overlay, but a
    // reviewer reading `z-[60]` in a class string cannot tell which rung that
    // is, and layering.test.ts — which reads the stylesheet — could not see it
    // at all. Named, it is checked by both.
    assert.match(rule(".anchored-panel"), /z-index:\s*var\(--z-overlay\)/);
    assert.doesNotMatch(code(panel), /zIndex|z-\[\d+\]/);
  });

  it("clamps to the viewport on a narrow screen", () => {
    // The desk width is a number at the call site; the clamp is the rule's.
    assert.match(code(panel), /width=\{320\}/);
    assert.match(rule(".anchored-panel"), /width:\s*min\(var\(--panel-w[^;]*calc\(100vw - 28px\)\)/);
  });

  it("stays on screen once the utility row wraps", () => {
    /**
     * The defect the clamp above never covered. Width was bounded by the
     * viewport in all three copies of this pattern and the inline *offset* in
     * none of them, so below the wrap breakpoint a panel anchored to its
     * trigger's right edge extended left from wherever that trigger had landed
     * — off the screen, and then clipped by the row's own `overflow-x: clip`.
     * The panel was the right size in the wrong place.
     */
    const wrapped = css.slice(css.indexOf("@media (max-width: 1110px)"));
    // `static` is the whole mechanism: it hands the panel's containing block
    // from the trigger to the row, so the offset below is measured from an edge
    // that does not move when the row wraps.
    assert.match(wrapped, /\.header-anchor \{\s*position:\s*static/);
    assert.match(wrapped, /right:\s*var\(--shell-pad\)/);
    // The row's gutter, not its full width: spanning the gutters is also on
    // screen but stretches a 320px panel to 984px at 1024px.
    assert.doesNotMatch(wrapped, /\.anchored-panel \{[^}]*width:\s*auto/);
  });

  it("clamps to the viewport on a *short* screen, and scrolls rather than clipping", () => {
    // The panel is absolute inside a sticky header, so content past the bottom
    // of the viewport cannot be reached at all: the page scrolls and the header
    // does not. Measured at 844x390, the System status row and its Open
    // reliability button sat 253px below the fold with no way to get to them.
    // Only this panel needs it, so the variant is opt-in per call site.
    assert.match(code(panel), /scroll\b/);
    assert.match(rule(".anchored-panel--scroll"), /max-height:\s*calc\(100svh/);
    assert.match(rule(".anchored-panel--scroll"), /overflow-y:\s*auto/);
    // svh, not dvh — the same reasoning as the `body` min-height note: dvh
    // reflows the whole tree every time a mobile URL bar slides.
    assert.doesNotMatch(rule(".anchored-panel--scroll"), /100dvh/);
  });

  it("keeps the fallback in the height clamp", () => {
    // --header-h is published by a ResizeObserver, so it does not exist on the
    // very first frame. Without the fallback the whole calc() is invalid then,
    // which drops max-height entirely — the failure would only show on the
    // first paint of a short screen.
    assert.match(rule(".anchored-panel--scroll"), /var\(--header-h,\s*56px\)/);
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
    for (const shell of [
      "../app/dashboard/page.tsx",
      // The eight panels since the 2026-08-21 shell split — the file a
      // tier-gated tab would be written in.
      "../components/workspace/WorkspacePanels.tsx",
      "../lib/use-workspace-routing.ts",
      "../components/ResearchWorkspace.tsx",
    ]) assert.doesNotMatch(read(shell), /useComplexity|atLeast/, shell);
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

  it("the panel's mirror is itself the door, not a chip plus a second button", () => {
    // The old shape was a read-only status chip with a full-width "Open
    // reliability" button beneath it — a second door to the room the header's
    // always-visible button already opens, drawn on the same bar at the same
    // moment. Merged, the mirrored chip carries the action: the accessible
    // name states the destination, the label stays the mirror.
    assert.match(
      code(panel),
      /<button[^]*?className=\{`system-health[^`]*\$\{healthNeedsAttention \? "is-warn" : ""\}`\}/,
    );
    assert.match(code(panel), /aria-label=\{`Open reliability\. \$\{healthLabel\}`\}/);
    assert.doesNotMatch(code(panel), />\s*Open reliability\s*</);
    // Not the header's own class: .system-health-action collapses to a 44px
    // icon-only dot at narrow widths, which inside a 320px panel would hide
    // the very label the mirror exists to show.
    assert.doesNotMatch(code(panel), /system-health-action/);
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
