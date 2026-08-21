/**
 * Reading the workspace's own source, for the suites that assert on it.
 *
 * `tests/workspace-routing-sections.test.ts` was 663 lines and became five files on
 * 2026-08-21, one per concern: `workspace-routing-nav`,
 * `workspace-routing-sections`, `workspace-routing-hook-order`,
 * `workspace-routing-shared-fetch` and `workspace-routing-page-head`. These three
 * helpers were declared once at the top of that file and are used by more than
 * one successor, so they live here rather than in copies.
 *
 * `stripNonCode` in particular must not be duplicated: every scan that uses it
 * only means what it claims if a `return` inside prose really is invisible to it,
 * and a second copy is a second definition of "code" for the same tree.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The `tests/` directory, used as the base for every relative path below.
 *
 * The callers pass paths like `"../components/WorkspaceHeader.tsx"`, written when
 * `read` lived in `tests/workspace-routing-page-head.test.ts`. Resolving them against this
 * directory rather than against this file keeps every one of those strings
 * meaning exactly what it meant before the split — without it they would climb
 * one level too few and read `tests/components/…`, which does not exist.
 */
const TESTS_DIR = new URL("../", import.meta.url);

export function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, TESTS_DIR)), "utf8");
}

/**
 * Strips comments and string literals so a `return` inside prose or a hook name
 * inside a comment cannot register as code.
 */
export function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/** Nav ids, in declaration order, from the single NAV_ITEMS literal. */
export function navIds(source: string): string[] {
  const start = source.indexOf("export const NAV_ITEMS");
  const block = source.slice(start, source.indexOf("];", start) + 2);
  return [...block.matchAll(/\{\s*id:\s*"([a-z]+)"/g)].map((match) => match[1]);
}
