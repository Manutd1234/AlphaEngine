/**
 * The Text size preference: one step multiplied into every content rung,
 * never into the header.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_TEXT_SIZE,
  TEXT_SIZE_STORAGE_KEY,
  TEXT_SIZES,
  isTextSize,
  resolveTextSize,
} from "../lib/text-size";

import { globalsCss } from "./globals-css";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");
const css = globalsCss;
const layout = read("app/layout.tsx");
const store = read("lib/text-size.ts");
const toggle = read("components/TextSizeToggle.tsx");
const panel = read("components/header/QuickSettings.tsx");

describe("the resolvers", () => {
  it("three sizes, comfortable the default, anything else the default", () => {
    assert.deepEqual([...TEXT_SIZES], ["compact", "comfortable", "large"]);
    assert.equal(DEFAULT_TEXT_SIZE, "comfortable");
    assert.equal(resolveTextSize("large"), "large");
    assert.equal(resolveTextSize("huge"), "comfortable");
    assert.equal(resolveTextSize(null), "comfortable");
    assert.equal(isTextSize("compact"), true);
    assert.equal(isTextSize("Compact"), false);
    assert.equal(TEXT_SIZE_STORAGE_KEY, "alphaengine-text-size");
  });
});

describe("the document contract", () => {
  it("comfortable deletes the attribute; compact and large stamp it", () => {
    assert.match(store, /if \(size === DEFAULT_TEXT_SIZE\) delete root\.dataset\.textSize;/);
    assert.match(store, /else root\.dataset\.textSize = size;/);
    assert.match(store, /emitPrefChange\(TEXT_SIZE_STORAGE_KEY\)/);
    assert.doesNotMatch(store, /dataset\.textSize = "comfortable"/);
  });

  it("the pre-paint bootstrap stamps only compact and large, and leaves the theme line intact", () => {
    assert.match(layout, /var savedTextSize = localStorage\.getItem\('alphaengine-text-size'\);/);
    assert.match(layout, /if \(savedTextSize === 'compact' \|\| savedTextSize === 'large'\)/);
    assert.match(layout, /if \(savedTheme === 'light' \|\| savedTheme === 'dark'\)/);
  });

  it("the stylesheet: --type-step defaults to 1 in :root, and the two overrides sit outside that block", () => {
    const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("\n}\n", css.indexOf(":root {")));
    assert.match(rootBlock, /--type-step: 1;/);
    assert.doesNotMatch(rootBlock, /data-text-size/);
    // 2026-08-22: the two steps became 6/7 and 17/14, so --fs-body resolves to
    // exactly 12 / 14 / 17px. The old pair (0.9375, 1.125) put compact 0.88px
    // from comfortable, which is not a difference a reader can see. Each block
    // now opens with a comment stating its fraction, so the match runs to the
    // declaration rather than straight to the closing brace.
    // tests/type-ladder-presets.test.ts does the arithmetic these two numbers
    // exist for; this assertion only keeps them where the bootstrap expects.
    assert.match(css, /:root\[data-text-size="compact"\] \{[^}]*\n  --type-step: 0\.857142857;\n\}/);
    assert.match(css, /:root\[data-text-size="large"\] \{[^}]*\n  --type-step: 1\.214285714;\n\}/);
    assert.match(css, /\nhtml \{\n  font-size: 100%;/);
  });

  it("every content rung multiplies by the step and no chrome rung does", () => {
    const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("\n}\n", css.indexOf(":root {")));
    for (const token of ["--fs-2xs", "--fs-sm", "--fs-body", "--fs-md", "--fs-title", "--fs-h2", "--fs-h1", "--fs-figure", "--fs-display", "--fs-hero"]) {
      assert.match(rootBlock, new RegExp(`${token}:[^;]*\\* var\\(--type-step\\)`), `${token} must step`);
    }
    for (const token of ["--fs-chrome-tab", "--fs-chrome-chip", "--fs-chrome-caption", "--fs-chrome-brand", "--fs-input", "--fs-tick"]) {
      assert.doesNotMatch(rootBlock, new RegExp(`${token}:[^;]*--type-step`), `${token} must not step`);
    }
  });
});

describe("the control", () => {
  it("is in Quick Settings, reads on mount and on the bus, never writes on mount", () => {
    assert.match(panel, /<TextSizeToggle \/>/);
    assert.match(panel, /All five are about this browser/);
    assert.match(toggle, /const sync = \(\) => setSize\(resolveDocumentTextSize\(\)\);/);
    assert.match(toggle, /onPrefChange\(\(key\) => \{\s*if \(key === TEXT_SIZE_STORAGE_KEY\) sync\(\);/);
    assert.doesNotMatch(toggle, /useEffect\([\s\S]{0,200}applyDocumentTextSize/);
    assert.match(toggle, /TEXT_SIZES\.map/);
    assert.match(toggle, /aria-pressed=\{size === candidate\}/);
  });

  it("tells the reader the header keeps one size on purpose", () => {
    assert.match(toggle, /the header and the bottom bar keep one size so their controls always fit/);
  });
});
