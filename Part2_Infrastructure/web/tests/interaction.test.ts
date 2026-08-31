/**
 * The interaction contract.
 *
 * Every fact pinned here was false once, and its absence was invisible in
 * review: three <a> primary actions rendered as bare text because the control
 * rule was element-qualified to `button`; bare links had no hover in a
 * fourteen-thousand-line sheet; disabled fields dressed exactly like enabled
 * ones; every card stacked a shadow on its 1px border through two competing
 * `.card` declarations; and nothing anywhere sized a control for a fingertip.
 * None of those regressions fails a build or a glance — which is the whole
 * case for pinning them.
 *
 * Regex over one hand-written stylesheet, per the justification in
 * `theme-contrast.test.ts`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { globalsCss, locateInGlobals } from "./globals-css";

/* The whole cascade. `app/globals.css` is a 122-line @import manifest since the
   split, so reading that path directly would assert against comments — see the
   header of `tests/globals-css.ts`. */
const css = globalsCss;
const subtabs = readFileSync(
  fileURLToPath(new URL("../components/WorkspaceSubtabs.tsx", import.meta.url)),
  "utf8",
);

/** Comment bodies blanked, newlines kept — declarations only, lines intact. */
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "));

// --------------------------------------------------------------------------
// 1 — links respond
// --------------------------------------------------------------------------

describe("links respond", () => {
  it("bare anchors have hover and active states", () => {
    assert.match(declarations, /a:not\(\[class\]\):hover/);
    assert.match(declarations, /a:not\(\[class\]\):active/);
  });

  it("the primary action styles anchors as well as buttons", () => {
    assert.match(
      declarations,
      /\na\.primary-action \{/,
      "anchors never pass through the button element rule — they need their own chrome",
    );
    assert.match(
      declarations,
      /button\.primary-action,\s*\na\.primary-action \{/,
      "the shared fill/border rule must name both forms",
    );
  });
});

// --------------------------------------------------------------------------
// 2 — disabled fields say so
// --------------------------------------------------------------------------

describe("disabled fields say so", () => {
  it("input, select and textarea share the button's disabled treatment", () => {
    assert.match(
      declarations,
      /input:disabled,\s*\nselect:disabled,\s*\ntextarea:disabled \{/,
    );
  });
});

// --------------------------------------------------------------------------
// 3 — elevation is reserved for what floats
// --------------------------------------------------------------------------

describe("elevation is reserved for what floats", () => {
  it("no .card rule carries a box-shadow", () => {
    // Two .card declarations coexist by design (base + density); the shadow
    // once survived in both because neither knew about the other.
    for (const match of declarations.matchAll(/\n\.card \{/g)) {
      const index = match.index ?? 0;
      const block = declarations.slice(index, declarations.indexOf("}", index));
      const at = locateInGlobals(index + 1);
      assert.doesNotMatch(
        block,
        /box-shadow/,
        `${at} — .card regained a shadow; borders carry separation`,
      );
    }
  });
});

// --------------------------------------------------------------------------
// 4 — coarse pointers get 44px
// --------------------------------------------------------------------------

describe("coarse pointers get 44px", () => {
  const blocks = [...declarations.matchAll(/@media \(pointer: coarse\)/g)];

  it("declares exactly one coarse block", () => {
    assert.equal(
      blocks.length,
      1,
      "one block keeps the touch contract auditable — a second would fork it",
    );
  });

  it("raises the control floor and the rail token together", () => {
    const body = declarations.slice(blocks[0].index ?? 0);
    assert.match(body, /min-height: 44px/);
    assert.match(
      body,
      /--chrome-rail:/,
      "the rail must grow through its token so sticky offsets stay measured",
    );
  });

  it("sizes fields at 16px so iOS never zooms on focus", () => {
    // Safari magnifies the page when a field smaller than 16px takes focus and
    // does not zoom back out. The two selects that ARE the mobile navigation
    // were 12px, so tapping the nav left the reader stranded at 1.3x. The
    // viewport export deliberately does not set maximum-scale — suppressing
    // pinch-zoom to dodge this would break WCAG 1.4.4 to fix a typo-sized bug.
    const body = declarations.slice(blocks[0].index ?? 0);
    assert.match(
      body,
      /select,\s*\n\s*textarea,\s*\n\s*input:not[^{]*\{[^}]*font-size: var\(--fs-input\)/,
      "the field rule inside the coarse block must size fields at the input rung",
    );
    // The rung itself is pinned so joining the type scale cannot quietly
    // change the one value that keeps Safari from zooming.
    assert.match(
      declarations,
      /--fs-input:\s*16px/,
      "--fs-input is the iOS focus-zoom threshold and must stay 16px",
    );
    assert.doesNotMatch(
      declarations,
      /maximum-scale|user-scalable/,
      "pinch-zoom must stay available",
    );
  });
});

// --------------------------------------------------------------------------
// 5 — sticky chrome is measured, never assumed
// --------------------------------------------------------------------------

describe("chrome offsets are measured", () => {
  it("the rail publishes its own height, and --chrome-total reads it", () => {
    // `--chrome-rail` is a 40px desk-width constant; the phone rail is a
    // picker plus an actions row and stands around 130px. Every anchor jump
    // trusted the constant, so deep links landed under the chrome.
    assert.match(
      subtabs,
      /--rail-h[\s\S]{0,400}ResizeObserver/,
      "WorkspaceSubtabs must publish --rail-h from a ResizeObserver",
    );
    assert.match(
      declarations,
      /--chrome-total: calc\(var\(--header-h\) \+ var\(--rail-h\)\)/,
      "--chrome-total must read the measured rail, not the constant",
    );
    assert.match(
      declarations,
      /--rail-h: var\(--chrome-rail\)/,
      "the constant stays as the pre-measurement fallback",
    );
  });

  it("only the visible rail publishes --rail-h", () => {
    // Visited panels persist behind `hidden` (display: none), where a rail
    // measures 0 — and a hiding rail's ResizeObserver delivers that 0 in the
    // same frame the entering rail publishes its real height. Delivery order
    // follows observer creation order, so switching back to an earlier tab
    // left --rail-h: 0px standing and every anchor jump landed under the
    // chrome. The publisher therefore gates on the same `active` visibility
    // the persistent-panel change threads into every poller.
    assert.match(
      subtabs,
      /useLayoutEffect\(\(\) => \{\s*if \(!active\) return;[\s\S]{0,600}--rail-h[\s\S]{0,400}\}, \[active\]\);/,
      "the pre-paint --rail-h effect must bail when inactive and re-run on activation",
    );
    assert.doesNotMatch(
      subtabs,
      /Exactly one rail is mounted/,
      "the single-mounted-rail premise died with persistent panels; the comment must not restate it",
    );

    const consoles = [
      "WorkspaceOverview",
      "PortfolioWorkspace",
      "RiskWorkspace",
      "DataConsole",
      "ReliabilityConsole",
      "DeveloperConsole",
    ];
    for (const name of consoles) {
      const source = readFileSync(
        fileURLToPath(new URL(`../components/${name}.tsx`, import.meta.url)),
        "utf8",
      );
      assert.match(
        source,
        /<WorkspaceSubtabs\b[\s\S]{0,600}?active=\{active\}/,
        `${name} must forward its visibility to the rail`,
      );
    }

    // The eight panels are `components/workspace/WorkspacePanels.tsx` since the
    // shell split; page.tsx no longer holds a single `active={view === …}`, so
    // a scan left on it would pass by finding nothing to check.
    const dashboard = readFileSync(
      fileURLToPath(new URL("../components/workspace/WorkspacePanels.tsx", import.meta.url)),
      "utf8",
    );
    for (const tab of ["overview", "portfolio", "risk", "data", "reliability", "developer"]) {
      assert.match(
        dashboard,
        new RegExp(`active=\\{view === "${tab}"\\}`),
        `the persistent ${tab} tab must pass its visibility down for the rail gate`,
      );
    }
  });

  it("nothing sizes layout on bare 100vh without an svh companion", () => {
    // vh resolves to the LARGE viewport on iOS, so a 100vh page is always
    // taller than the screen and every view carries phantom scroll.
    for (const match of declarations.matchAll(/(min-height|max-height|height): calc\(100vh[^;]*;/g)) {
      const index = match.index ?? 0;
      const following = declarations.slice(index, index + 260);
      const at = locateInGlobals(index);
      assert.match(
        following,
        /100svh/,
        `${at} sizes on 100vh with no svh line after it`,
      );
    }
  });
});

/**
 * The header's utility row, and the wrapper that silently unstyled it.
 *
 * Four triggers in that row render inside a `.header-anchor` span so the panel
 * they open has something to position against. The moment that wrapper landed,
 * every `.workspace-header__utility > .trigger` rule stopped matching — the
 * button became a grandchild. The Settings control lost `inline-flex`, its
 * `gap`, its `min-width` and both responsive collapses, and fell back to bare
 * `button.icon`: a gear pressed flat against the word "Settings", and a label
 * that never collapsed at laptop widths.
 *
 * `dead-css.test.ts` cannot see this class of bug. It measures classes that are
 * declared and never rendered; `header-settings` was rendered throughout. What
 * broke was reach, not existence — so it is checked here instead.
 */
describe("the header's anchored triggers stay styled", () => {
  /** Classes that are rendered inside a `.header-anchor`, not directly in the row. */
  const ANCHORED = ["header-settings", "icon"];

  it("no utility rule reaches an anchored trigger with a single child step", () => {
    for (const klass of ANCHORED) {
      // Every rule that targets this class as a DIRECT child of the row...
      const direct = new RegExp(`\\.workspace-header__utility > \\.${klass}\\b`, "g");
      for (const match of declarations.matchAll(direct)) {
        const index = match.index ?? 0;
        const at = locateInGlobals(index);
        // ...must be accompanied by the two-level form, or it reaches nothing.
        const selectorList = declarations.slice(index, declarations.indexOf("{", index));
        const rest = declarations.slice(index - 300, index + 400);
        assert.match(
          rest,
          new RegExp(`\\.workspace-header__utility > \\.header-anchor > \\.${klass}\\b`),
          `${at} — \`${selectorList.trim()}\` cannot match: `
            + `.${klass} renders inside .header-anchor, so it is a grandchild of the row`,
        );
      }
    }
  });

  it("the trigger keeps a gap between its glyph and its word", () => {
    // gapPx measured 0 in the browser when the rule below stopped matching.
    const rule = declarations.slice(
      declarations.indexOf(".workspace-header__utility > .header-anchor > .header-settings"),
    );
    const body = rule.slice(0, rule.indexOf("}"));
    assert.match(body, /display:\s*inline-flex/);
    assert.match(body, /gap:\s*\d/, "an icon and a label with no gap read as one glued token");
  });

  it("QuickSettings still renders inside the anchor the rules now expect", () => {
    // If the wrapper is ever removed, the two-level selectors become the dead
    // ones and this flips — which is the point of asserting the shape.
    const source = readFileSync(
      fileURLToPath(new URL("../components/header/QuickSettings.tsx", import.meta.url)),
      "utf8",
    );
    assert.match(source, /className="header-anchor"[\s\S]{0,400}className="icon header-settings"/);
  });
});
