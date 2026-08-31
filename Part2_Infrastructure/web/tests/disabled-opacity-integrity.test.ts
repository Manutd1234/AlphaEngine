/**
 * Whole-control opacity blends both the ink and its background into the parent
 * plane. A text/background pair that clears AA before that blend can therefore
 * fail once disabled, even though both semantic colours are individually safe.
 * Disabled controls use --disabled-* at full opacity; decorative descendants
 * may still fade independently.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";

const root = join(import.meta.dirname, "..");

function filesUnder(directory: string, extension: RegExp): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path, extension));
    else if (extension.test(entry.name)) files.push(path);
  }
  return files;
}

function displayPath(path: string): string {
  return relative(root, path).split(sep).join("/");
}

function maskComments(source: string): string {
  const blank = (value: string) => value.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[\t ])\/\/[^\n]*/gm, blank);
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function key(path: string, selector: string): string {
  return `${path} :: ${selector.replace(/\s+/g, " ").trim()}`;
}

/**
 * Icon-only clear affordance: the disabled glyph is intentionally invisible
 * while its grid column stays reserved, and a native disabled button cannot be
 * focused. This is not a text-state treatment shared by any other control.
 */
const NON_TEXT_DISABLED_EXCEPTIONS = new Map([
  ["app/globals/04-portfolio-command-centre.css :: .shock-row__clear:disabled", 0],
]);

describe("disabled text-bearing parents stay full-opacity", () => {
  it("uses semantic disabled colours instead of CSS opacity", () => {
    const offenders: string[] = [];
    const observedExceptions = new Set<string>();

    for (const file of [
      ...filesUnder(join(root, "app"), /\.css$/),
      ...filesUnder(join(root, "components"), /\.css$/),
    ].sort()) {
      const path = displayPath(file);
      const source = maskComments(readFileSync(file, "utf8"));
      for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = rule[1].replace(/\s+/g, " ").trim();
        if (!/(?:^|[-:\[])disabled(?:\b|\])/.test(selector)) continue;

        for (const declaration of rule[2].matchAll(/(?:^|[;\s])opacity\s*:\s*([^;}]+)/g)) {
          const authored = declaration[1].replace(/!important\s*$/i, "").trim();
          const opacity = Number(authored);
          if (opacity === 1) continue;

          const selectorKey = key(path, selector);
          if (NON_TEXT_DISABLED_EXCEPTIONS.get(selectorKey) === opacity) {
            observedExceptions.add(selectorKey);
            continue;
          }

          const at = rule.index + rule[0].indexOf("{") + 1 + declaration.index;
          offenders.push(`${path}:${lineAt(source, at)} ${selector} sets opacity: ${authored}`);
        }
      }
    }

    assert.deepEqual(
      [...observedExceptions].sort(),
      [...NON_TEXT_DISABLED_EXCEPTIONS.keys()].sort(),
      "the icon-only disabled exception is stale or stopped matching",
    );
    assert.equal(
      offenders.length,
      0,
      `disabled parents fade their text and background together:\n${offenders.join("\n")}`,
    );
  });

  it("puts no opacity utility on a concrete disabled JSX control", () => {
    const offenders: string[] = [];
    const files = [
      ...filesUnder(join(root, "app"), /\.tsx?$/),
      ...filesUnder(join(root, "components"), /\.tsx?$/),
    ].sort();

    for (const file of files) {
      const path = displayPath(file);
      const source = maskComments(readFileSync(file, "utf8"));
      for (const tag of source.matchAll(/<(?:button|Button|input|select|textarea)\b[\s\S]*?>/g)) {
        if (!/\bdisabled(?:\s|=|\/?>)/.test(tag[0])) continue;
        const opacityUtilities = [...tag[0].matchAll(/\bopacity-(\[[^\]]+\]|\d{1,3})/g)]
          .map((match) => match[1])
          .filter((value) => value !== "100" && !/^\[1(?:\.0+)?\]$/.test(value));
        if (opacityUtilities.length > 0) {
          offenders.push(
            `${path}:${lineAt(source, tag.index)} disabled control uses ${opacityUtilities.map((value) => `opacity-${value}`).join(", ")}`,
          );
        }
      }
    }

    assert.equal(
      offenders.length,
      0,
      `concrete disabled controls bypass the semantic disabled palette:\n${offenders.join("\n")}`,
    );
  });

  it("contains the signed shadcn opacity utility to the two primitives the late bridge neutralises", () => {
    const claimants = new Set<string>();
    for (const file of filesUnder(join(root, "components"), /\.tsx?$/)) {
      const source = maskComments(readFileSync(file, "utf8"));
      if (/\bdisabled:opacity-(?:\[[^\]]+\]|\d{1,3})/.test(source)) claimants.add(displayPath(file));
    }
    assert.deepEqual(
      [...claimants].sort(),
      ["components/ui/button.tsx", "components/ui/toggle.tsx"],
      "a new primitive dims the whole disabled control without a reviewed full-opacity override",
    );

    const bridge = maskComments(readFileSync(join(root, "app/tailwind.css"), "utf8"));
    assert.match(
      bridge,
      /\[data-slot="button"\]:disabled,[\s\S]*?\[data-slot="toggle"\]:disabled\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?background:\s*var\(--disabled-bg\);[\s\S]*?color:\s*var\(--disabled-text\);/,
      "the late Tailwind bridge no longer neutralises the signed primitive opacity",
    );
  });
});

