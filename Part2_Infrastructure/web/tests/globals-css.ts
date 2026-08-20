/**
 * The house stylesheet, as one string, in the order the browser applies it.
 *
 * WHY THIS FILE EXISTS, AND WHY EVERY CSS-READING SUITE MUST USE IT
 * ------------------------------------------------------------------------
 * `app/globals.css` used to be 17,416 lines and thirty-two test files read it
 * directly. It is now a 122-line `@import` manifest over `app/globals/*.css`.
 *
 * A test that keeps reading the entry file still passes — it just stops
 * checking anything, because the manifest contains no rules to fail against.
 * `assert.doesNotMatch(css, /…/)` is green on an empty haystack. That failure
 * mode is silent, it is what a split does to a regex-over-source suite, and
 * here it would have hit thirty-two suites at once.
 *
 * So the concatenation lives in exactly one place. The next split cannot
 * strand the suites again: it changes this file, and every reader follows.
 *
 * The order is the manifest's order, parsed from the entry file rather than
 * hard-coded here — a hard-coded list would be a second source of truth that
 * could disagree with the cascade the browser actually sees.
 * `tests/globals-manifest.test.ts` pins the manifest itself.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** The entry file: comments and `@import` statements, nothing else. */
export const GLOBALS_ENTRY = "app/globals.css";

/** The directory the partials live in. */
export const GLOBALS_DIR = "app/globals";

/** The entry file's own text, for tests that assert on the manifest itself. */
export function readGlobalsEntry(): string {
  return readFileSync(join(root, GLOBALS_ENTRY), "utf8");
}

/**
 * The partials named by the manifest, in the order it declares them, as paths
 * relative to `web/`.
 */
export function globalsPartials(): string[] {
  const entry = readGlobalsEntry();
  const paths: string[] = [];
  for (const [, specifier] of entry.matchAll(/@import\s+"\.\/(globals\/[^"]+)"\s*;/g)) {
    paths.push(`app/${specifier}`);
  }
  if (paths.length === 0) {
    throw new Error(
      `${GLOBALS_ENTRY} declares no @import — the stylesheet cannot be read, and every ` +
      "suite reading it through this helper would silently assert against an empty string",
    );
  }
  return paths;
}

/** Every `.css` file present under `app/globals/`, sorted by name. */
export function globalsPartialsOnDisk(): string[] {
  return readdirSync(join(root, GLOBALS_DIR))
    .filter((entry) => entry.endsWith(".css"))
    .sort()
    .map((entry) => `${GLOBALS_DIR}/${entry}`);
}

/** One partial's text. */
export function readGlobalsPartial(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

const partials = globalsPartials();
const bodies = partials.map(readGlobalsPartial);

/**
 * The whole cascade: every partial concatenated in declared order.
 *
 * Byte-identical to the pre-split `app/globals.css` — SHA-256
 * 3bb8ed921b72dc31977e3fa943148eb6c951d69853155d35985534c70b17c1d5 — which is
 * how the split was proved not to have moved a rule.
 */
export const globalsCss = bodies.join("");

/** Backwards-compatible reader, for suites that prefer a call. */
export function readGlobalsCss(): string {
  return globalsCss;
}

/** Cumulative start offset of each partial inside `globalsCss`. */
const offsets: number[] = [];
{
  let at = 0;
  for (const body of bodies) {
    offsets.push(at);
    at += body.length;
  }
}

/**
 * `app/globals/07-data-operations.css:412` for a character offset into
 * `globalsCss`.
 *
 * A failure message saying `globals.css:9763` would now be a lie — the entry
 * file is 122 lines. This maps the offset back to the partial and line a
 * reader can actually open.
 */
export function locateInGlobals(index: number): string {
  let which = 0;
  while (which + 1 < offsets.length && offsets[which + 1] <= index) which += 1;
  const line = bodies[which].slice(0, index - offsets[which]).split("\n").length;
  return `${partials[which]}:${line}`;
}
