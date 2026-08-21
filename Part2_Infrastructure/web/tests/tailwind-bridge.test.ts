/**
 * The Tailwind bridge is only safe under three conditions, each tripwired here:
 * every token it references actually exists in globals.css (a rename there must
 * fail loudly, not silently un-style the header), preflight never loads (it
 * would restyle every control in the app), and the import order in layout.tsx
 * keeps unlayered utilities after the global stylesheet so they can win ties.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";

const root = join(import.meta.dirname, "..");
/** Comments stripped: the file's own documentation names the forbidden forms. */
const tailwind = readFileSync(join(root, "app/tailwind.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const globals = globalsCss;
const layout = readFileSync(join(root, "app/layout.tsx"), "utf8");

/** The declarations of the :root light block, same approach as theme-contrast.test.ts. */
function lightBlock(css: string): string {
  const start = css.indexOf(":root {");
  assert.ok(start >= 0, "globals.css must open with a :root block");
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

describe("tailwind token bridge", () => {
  it("every var() referenced in @theme exists in globals.css :root", () => {
    const themeStart = tailwind.indexOf("@theme");
    assert.ok(themeStart >= 0, "tailwind.css must contain an @theme block");
    const themeBlock = tailwind.slice(themeStart);
    const referenced = [...themeBlock.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
    assert.ok(referenced.length >= 15, "bridge unexpectedly small — parsing broke?");
    const light = lightBlock(globals);
    for (const token of referenced) {
      assert.ok(light.includes(`${token}:`), `${token} referenced by the bridge but not declared in globals.css :root`);
    }
  });

  it("preflight never loads and the single-import form is not used", () => {
    assert.ok(!tailwind.includes("tailwindcss/preflight"), "preflight import found");
    assert.ok(!/@import\s+["']tailwindcss["']/.test(tailwind), "bare tailwindcss import found (bundles preflight)");
  });

  it("utilities are imported unlayered and the theme import is layered", () => {
    assert.match(tailwind, /@import "tailwindcss\/utilities\.css";/);
    assert.ok(
      !/@import "tailwindcss\/utilities\.css" layer\(/.test(tailwind),
      "utilities must stay unlayered or they lose to the unlayered globals",
    );
    assert.match(tailwind, /@import "tailwindcss\/theme\.css" layer\(theme\);/);
  });

  it("@theme uses the inline keyword so utilities resolve vars per-element", () => {
    assert.match(tailwind, /@theme inline \{/);
  });

  it("the stock palette is stripped", () => {
    assert.ok(tailwind.includes("--color-*: initial"));
  });

  it("layout.tsx imports globals.css before tailwind.css", () => {
    const globalsAt = layout.indexOf('import "./globals.css"');
    const tailwindAt = layout.indexOf('import "./tailwind.css"');
    assert.ok(globalsAt >= 0 && tailwindAt >= 0, "both stylesheet imports must exist");
    assert.ok(globalsAt < tailwindAt, "tailwind.css must be imported after globals.css");
  });
});
