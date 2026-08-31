import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import manifest from "../app/manifest";
import { globalsCss } from "./globals-css";
import { blockAfter, tokensIn } from "./helpers/css-tokens";

const light = tokensIn(blockAfter(globalsCss, ":root {"));
const dark = tokensIn(blockAfter(globalsCss, ':root[data-theme="dark"]'));
const overview = readFileSync(
  fileURLToPath(new URL("../components/WorkspaceOverview.tsx", import.meta.url)),
  "utf8",
);
const tailwindBridge = readFileSync(
  fileURLToPath(new URL("../app/tailwind.css", import.meta.url)),
  "utf8",
);
const interactivePrimitives = [
  "button.tsx",
  "checkbox.tsx",
  "dropdown-menu.tsx",
  "input.tsx",
  "label.tsx",
  "select.tsx",
  "tabs.tsx",
  "toggle.tsx",
].map((name) => readFileSync(
  fileURLToPath(new URL(`../components/ui/${name}`, import.meta.url)),
  "utf8",
)).join("\n");
const declarations = globalsCss.replace(/\/\*[\s\S]*?\*\//g, "");

function rgb(value: string | undefined): [number, number, number] {
  assert.match(value ?? "", /^#[0-9a-f]{6}$/i, `expected a six-digit colour, received ${value}`);
  return [1, 3, 5].map((offset) => Number.parseInt(value!.slice(offset, offset + 2), 16)) as [number, number, number];
}

function luminance(value: string): number {
  const channels = rgb(value).map((channel) => channel / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("the Quant OS palette is warm-light, neutral-graphite-dark and contrast-first", () => {
  it("uses a low-chroma warm canvas, true-white cards and quiet inset planes", () => {
    assert.deepEqual(
      ["--surface-0", "--surface-1", "--surface-2", "--surface-3", "--border"]
        .map((name) => light.get(name)),
      ["#f5efe9", "#ffffff", "#f2ebe5", "#e4d6ca", "#a38f82"],
    );
  });

  it("uses a neutral graphite elevation ladder in dark mode", () => {
    assert.deepEqual(
      ["--surface-0", "--surface-1", "--surface-2", "--surface-3", "--border"]
        .map((name) => dark.get(name)),
      ["#0b0e12", "#151a21", "#202832", "#2d3845", "#56616f"],
    );
  });

  it("separates both elevation ladders instead of washing adjacent planes together", () => {
    for (const [name, palette, floors] of [
      ["light", light, [1.1, 1.15, 1.15]],
      ["dark", dark, [1.08, 1.15, 1.2]],
    ] as const) {
      const surfaces = ["--surface-0", "--surface-1", "--surface-2", "--surface-3"] as const;
      for (let index = 0; index < surfaces.length - 1; index += 1) {
        const ratio = contrast(palette.get(surfaces[index])!, palette.get(surfaces[index + 1])!);
        assert.ok(ratio >= floors[index], `${name} elevation ${index} is only ${ratio.toFixed(2)}:1`);
      }
      for (const surface of ["--surface-1", "--surface-2", "--surface-3"] as const) {
        assert.ok(contrast(palette.get("--border")!, palette.get(surface)!) >= 1.75, `${name} ${surface} quiet boundary`);
        assert.ok(contrast(palette.get("--axis")!, palette.get(surface)!) >= 3, `${name} ${surface} strong boundary`);
      }
      for (const surface of ["--surface-1", "--surface-2", "--surface-3"] as const) {
        assert.ok(contrast(palette.get("--grid")!, palette.get(surface)!) >= 1.25, `${name} ${surface} soft rule`);
      }
      for (const [role, floor, reachable] of [
        ["--text-primary", 5.8, surfaces],
        ["--text-secondary", 4.5, surfaces],
        ["--text-muted", 4.5, surfaces],
      ] as const) {
        for (const surface of reachable) {
          const ratio = contrast(palette.get(role)!, palette.get(surface)!);
          assert.ok(ratio >= floor, `${name} ${role} on ${surface} is ${ratio.toFixed(2)}:1`);
        }
      }
    }
  });

  it("uses blue analytical accents in both palettes, both AA-safe as text", () => {
    const lightAccent = light.get("--series-1")!;
    const darkAccent = dark.get("--series-1")!;
    const [lightRed, lightGreen, lightBlue] = rgb(lightAccent);
    const [darkRed, darkGreen, darkBlue] = rgb(darkAccent);
    assert.ok(lightBlue > lightGreen && lightGreen > lightRed, `${lightAccent} is not blue`);
    assert.ok(darkBlue > darkGreen && darkGreen > darkRed, `${darkAccent} is not blue`);
    for (const [palette, accent] of [[light, lightAccent], [dark, darkAccent]] as const) {
      for (const surface of ["--surface-1", "--surface-2", "--surface-3"]) {
        assert.ok(contrast(accent, palette.get(surface)!) >= 4.5);
      }
    }
  });

  it("lets the product mark follow the light cognac and dark blue palettes", () => {
    assert.match(globalsCss, /linear-gradient\(145deg, var\(--brand-mark-start\) 0%, var\(--brand-mark-mid\) 55%, var\(--brand-mark-end\) 100%\)/);
    assert.equal(light.get("--brand-mark-start"), "#a96128");
    assert.equal(dark.get("--brand-mark-start"), "#68b0ff");
  });

  it("defines the shared focus and filled-control foreground roles", () => {
    assert.equal(light.get("--focus-ring"), "#075985");
    assert.equal(dark.get("--focus-ring"), "#6db2ff");
    assert.equal(light.get("--on-accent"), "#ffffff");
    assert.equal(dark.get("--on-accent"), "#07131f");
    assert.equal(light.get("--border-strong"), "var(--axis)");
    assert.equal(dark.get("--border-strong"), "var(--axis)");
    assert.equal(light.get("--nav-hover-bg"), "var(--surface-2)");
    assert.equal(light.get("--nav-selected-bg"), "var(--state-info-bg)");
    assert.equal(dark.get("--nav-hover-bg"), "var(--surface-2)");
    assert.equal(dark.get("--nav-selected-bg"), "var(--state-info-bg)");
    assert.equal(light.get("--table-header-bg"), "var(--surface-2)");
    assert.equal(dark.get("--table-header-bg"), "var(--surface-3)");
    assert.doesNotMatch(globalsCss, /var\(--text-tertiary\)/, "undefined fourth ink role returned");
    assert.doesNotMatch(globalsCss, /(?:button|input|select|textarea)(?::disabled|\[disabled\])[^}]*opacity\s*:/s);
    assert.match(interactivePrimitives, /disabled:opacity-50/, "the signed shadcn base unexpectedly drifted");
    assert.match(
      tailwindBridge,
      /\[data-slot="button"\]:disabled,[\s\S]*?\[data-slot="toggle"\]:disabled\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?background:\s*var\(--disabled-bg\);[\s\S]*?color:\s*var\(--disabled-text\);/,
      "the late bridge no longer neutralises whole-control disabled opacity",
    );
  });

  it("removes the pink canvas, yellowed card and muted coffee drift", () => {
    for (const drift of ["#f5eff6", "#fefef6", "#6f4f37", "#d49a6a", "#eae0d6", "#60483c"]) {
      assert.ok(![...light.values(), ...dark.values()].includes(drift), `${drift} survived in the palette`);
    }
  });

  it("keeps the Overview command centre on the active warm surface ladder", () => {
    assert.doesNotMatch(overview, /data-plane=["']inverted["']/);

    const hero = [...declarations.matchAll(/\.overview-hero\s*\{([^}]*)\}/g)]
      .map((match) => match[1])
      .find((body) => body.includes("background:"));
    assert.ok(hero, "the Overview hero surface rule is missing");
    assert.match(hero, /background:\s*var\(--surface-1\)/);
    assert.match(hero, /color:\s*var\(--text-primary\)/);
    assert.match(hero, /--plane-accent:\s*var\(--series-1\)/);
    assert.doesNotMatch(hero, /#[0-9a-f]{3,8}\b/i);

    const overviewRules = declarations.slice(
      declarations.indexOf(".overview-hero {"),
      declarations.indexOf(".overview-loop {"),
    );
    assert.doesNotMatch(overviewRules, /#(?:101014|fff(?:fff)?|9ec9fb|86adf5)\b/i);
  });

  it("uses the neutral dark canvas for the installed-app splash", () => {
    const metadata = manifest();
    assert.equal(metadata.background_color, dark.get("--surface-0"));
    assert.equal(metadata.theme_color, dark.get("--surface-0"));
  });
});
