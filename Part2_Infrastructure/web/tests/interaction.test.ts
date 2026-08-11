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
 * `theme.test.ts`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const cssPath = fileURLToPath(new URL("../app/globals.css", import.meta.url));
const css = readFileSync(cssPath, "utf8");
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
      const line = declarations.slice(0, index).split("\n").length + 1;
      assert.doesNotMatch(
        block,
        /box-shadow/,
        `globals.css:${line} — .card regained a shadow; borders carry separation`,
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
      /select,\s*\n\s*textarea,\s*\n\s*input:not[^{]*\{[^}]*font-size: 16px/,
      "the field rule inside the coarse block must set font-size: 16px",
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

  it("nothing sizes layout on bare 100vh without an svh companion", () => {
    // vh resolves to the LARGE viewport on iOS, so a 100vh page is always
    // taller than the screen and every view carries phantom scroll.
    for (const match of declarations.matchAll(/(min-height|max-height|height): calc\(100vh[^;]*;/g)) {
      const index = match.index ?? 0;
      const following = declarations.slice(index, index + 260);
      const line = declarations.slice(0, index).split("\n").length;
      assert.match(
        following,
        /100svh/,
        `globals.css:${line} sizes on 100vh with no svh line after it`,
      );
    }
  });
});
