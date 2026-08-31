/**
 * A custom-property reference that resolves to nothing invalidates the whole
 * declaration that contains it. Browsers do not report that failure, and the
 * affected surface simply loses a border, type step, transition or fill.
 *
 * This scan covers both authored CSS and the inline custom properties emitted
 * by React. It deliberately recognises only static names: a new runtime-owned
 * namespace has to be added to the small allow-list below rather than making
 * every unknown property silently legal.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";

const root = join(import.meta.dirname, "..");
const sourceRoots = ["app", "components", "lib"] as const;
const sourceExtension = /\.(?:css|mjs|ts|tsx)$/;

/** Values published by a library/runtime rather than authored in this tree. */
const RUNTIME_PROPERTIES = new Set([
  "--radix-dropdown-menu-content-available-height",
  "--radix-select-content-available-height",
  "--radix-select-trigger-height",
  "--radix-select-trigger-width",
  "--spacing", // Tailwind's generated spacing scale.
]);

interface SourceFile {
  path: string;
  source: string;
}

interface Reference {
  name: string;
  path: string;
  line: number;
  hasFallback: boolean;
}

function filesUnder(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else if (sourceExtension.test(entry.name)) files.push(path);
  }
  return files;
}

function displayPath(path: string): string {
  return relative(root, path).split(sep).join("/");
}

/** Blank comment bodies while retaining offsets and line numbers. */
function maskComments(source: string): string {
  const blank = (value: string) => value.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[\t ])\/\/[^\n]*/gm, blank);
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

const sources: SourceFile[] = sourceRoots
  .flatMap((directory) => filesUnder(join(root, directory)))
  .sort()
  .map((path) => ({ path: displayPath(path), source: maskComments(readFileSync(path, "utf8")) }));

const declarations = new Set<string>();
const references: Reference[] = [];

for (const file of sources) {
  const declarationPatterns = [
    // CSS declarations, @property registrations and ordinary quoted React keys.
    /(?:@property\s+|["']?)(--[a-z0-9-]+)["']?\s*:/gi,
    // Computed React keys such as ["--fill" as string]: value.
    /\[\s*["'](--[a-z0-9-]+)["'](?:\s+as\s+[a-z0-9_.]+)?\s*\]\s*:/gi,
    // Imperative publishers used for measured shell dimensions.
    /\.style\.setProperty\(\s*["'](--[a-z0-9-]+)["']/gi,
    // next/font publishes these variables in generated CSS at runtime.
    /\bvariable\s*:\s*["'](--[a-z0-9-]+)["']/gi,
  ];

  for (const pattern of declarationPatterns) {
    for (const match of file.source.matchAll(pattern)) declarations.add(match[1]);
  }

  for (const match of file.source.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/gi)) {
    references.push({
      name: match[1],
      path: file.path,
      line: lineAt(file.source, match.index),
      hasFallback: match[2] === ",",
    });
  }
}

describe("repository custom-property integrity", () => {
  it("scans a non-trivial authored cascade and its React publishers", () => {
    assert.ok(sources.length >= 100, `only ${sources.length} source files were read`);
    assert.ok(declarations.size >= 100, `only ${declarations.size} custom properties were found`);
    assert.ok(references.length >= 500, `only ${references.length} var() references were found`);
  });

  it("resolves every var() reference, supplies a fallback, or names a runtime property", () => {
    const missing = references
      .filter((reference) =>
        !reference.hasFallback
        && !declarations.has(reference.name)
        && !RUNTIME_PROPERTIES.has(reference.name))
      .map((reference) => `${reference.path}:${reference.line} ${reference.name}`);

    assert.equal(
      missing.length,
      0,
      `custom properties referenced without a declaration, fallback or runtime owner:\n${missing.join("\n")}`,
    );
  });
});

