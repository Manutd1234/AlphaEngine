import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { cn } from "../lib/utils";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const UI = join(WEB, "components", "ui");
const PRIMITIVES = [
  "alert",
  "badge",
  "button",
  "card",
  "checkbox",
  "collapsible",
  "dialog",
  "dropdown-menu",
  "input",
  "label",
  "popover",
  "scroll-area",
  "select",
  "separator",
  "sheet",
  "skeleton",
  "table",
  "tabs",
  "toggle-group",
  "toggle",
  "tooltip",
] as const;

const sources = new Map(
  PRIMITIVES.map((name) => [name, readFileSync(join(UI, `${name}.tsx`), "utf8")]),
);
const allSources = [...sources.values()].join("\n");

describe("the source-owned shadcn foundation", () => {
  it("keeps the reviewed primitive inventory source-owned and small", () => {
    assert.equal(sources.size, 21);
    for (const [name, source] of sources) {
      assert.ok(source.includes('data-slot="'), `${name} has no stable slot seam`);
      assert.ok(source.split("\n").length <= 400, `${name} crossed the source-file ceiling`);
    }
  });

  it("uses only the unified reviewed Radix package", () => {
    assert.doesNotMatch(allSources, /@radix-ui\/react-/);
    for (const name of [
      "badge", "button", "checkbox", "collapsible", "dialog", "dropdown-menu",
      "label", "popover", "scroll-area", "select", "separator", "sheet", "toggle-group",
      "tabs", "toggle", "tooltip",
    ] as const) {
      assert.match(sources.get(name) ?? "", /from "radix-ui"/);
    }
  });

  it("reads the AlphaEngine colour, type, line, and motion contracts", () => {
    assert.match(allSources, /bg-surface-[012]/);
    assert.match(allSources, /text-fs-(?:xs|sm|body|title)/);
    assert.match(allSources, /border-border/);
    assert.match(allSources, /duration-\(--dur-fast\)/);
    assert.match(allSources, /outline-\[var\(--series-1\)\]/);

    assert.doesNotMatch(allSources, /\bdark:/, "theme state comes from semantic tokens, not media state");
    assert.doesNotMatch(
      allSources,
      /(?<![\w-])(?:bg|text|border|ring)-(?:background|foreground|card|popover|primary|secondary|muted|accent|input|ring|destructive)(?:\b|\/)/,
      "stock shadcn palette roles must not create a second token system",
    );
    assert.doesNotMatch(
      allSources,
      /\btext-(?:xs|sm|base|lg|xl|2xl)\b/,
      "type must read the house ladder",
    );
    assert.doesNotMatch(
      allSources,
      /\b(?:duration-\d+|animate-(?:in|out|pulse)|fade-(?:in|out)|zoom-(?:in|out)|slide-(?:in|out))\b/,
      "motion must use the house ladder and work without tw-animate-css",
    );
  });

  it("preserves the semantic and keyboard substrate", () => {
    assert.match(sources.get("alert") ?? "", /role="alert"/);
    assert.match(sources.get("table") ?? "", /ComponentProps<"table">/);
    assert.match(sources.get("checkbox") ?? "", /CheckboxPrimitive\.Indicator/);
    assert.match(sources.get("dialog") ?? "", /DialogPrimitive\.Portal/);
    assert.match(sources.get("sheet") ?? "", /SheetPrimitive\.Content/);
    assert.match(sources.get("select") ?? "", /SelectPrimitive\.Item/);
    assert.match(sources.get("tabs") ?? "", /TabsPrimitive\.List/);
    assert.match(sources.get("tabs") ?? "", /TabsPrimitive\.Content/);
  });
});

describe("cn", () => {
  it("keeps conditional classes and resolves the last Tailwind conflict", () => {
    assert.equal(cn("px-2", false && "px-3", "px-4"), "px-4");
  });
});
