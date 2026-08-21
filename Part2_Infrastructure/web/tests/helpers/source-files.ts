/**
 * Reading a source file from a test, in the one way that cannot go quiet.
 *
 * WHY THIS IS A HELPER AND NOT FOUR COPIES OF `readFileSync`
 * ------------------------------------------------------------------------
 * Every suite that asserts over source text opens with the same three lines,
 * and each copy encodes its own depth: `new URL("../components/…")` is correct
 * from `tests/` and silently wrong from anywhere else. When a suite is split
 * the copies travel with it, and the first one to land at a different depth
 * throws — which is the good case — or, if the read is wrapped in a `try`,
 * hands its assertions an empty string. `assert.doesNotMatch("", /…/)` is
 * green. So is a `.includes` guard on nothing. A guard that scans an empty
 * haystack passes for ever, and it is indistinguishable from a guard that is
 * working: the same failure `tests/globals-css.ts` exists to prevent for the
 * stylesheet, in the file tree instead.
 *
 * So paths are stated relative to `web/`, resolved from THIS file's location
 * rather than the caller's, and every read is checked for content before it is
 * handed back. A moved file throws; an emptied file throws; neither can turn
 * into a suite that agrees with itself.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** `Part2_Infrastructure/web/`, anchored on this file, not on the caller's. */
const webRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * One source file's text, addressed from `web/` — `"components/data/X.tsx"`,
 * never `"../components/data/X.tsx"`.
 *
 * Throws on a missing file (ENOENT) and on an empty one. Both are the same
 * defect from a suite's point of view: nothing to assert against.
 */
export function readSource(relativeToWeb: string): string {
  const text = readFileSync(join(webRoot, relativeToWeb), "utf8");
  assert.ok(
    text.trim().length > 0,
    `${relativeToWeb} read as empty — every assertion over it would pass by scanning nothing`,
  );
  return text;
}

/** Several files as one haystack, for assertions that forbid something anywhere. */
export function readSources(...relativeToWeb: string[]): string {
  return relativeToWeb.map(readSource).join("\n");
}

/**
 * Comments in these files name the constructs they exist to explain the absence
 * of — "the row-level repeat", "Manage in Providers", "Explain p99". A scan that
 * cannot tell prose from code reads the explanation as the offence, which has
 * bitten this suite twice.
 */
export const stripCode = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/.*$/gm, "");
