/**
 * The deployment surfaces on disk, and the one thing that must never go wrong
 * about reading them.
 *
 * WHY THE PATHS LIVE HERE
 * ------------------------------------------------------------------------
 * These files sit OUTSIDE the web project — `.vercelignore`,
 * `docker-compose.yml`, `.github/workflows/*.yml` and `supabase/migrations/*`
 * are at the repository root, four directories up from this file. Every suite
 * that reads them therefore hard-codes its own depth, and the depth is a
 * function of where the suite file happens to sit. Move or split such a suite
 * and the count is wrong.
 *
 * That is not a loud failure. `readFileSync` throws on a missing path, which
 * would be fine — but the assertions these feed are overwhelmingly of the form
 * `assert.doesNotMatch(workflow, /…/)` and `assert.ok(!script.includes(…))`,
 * and those pass on an empty string. Any read that can quietly yield nothing
 * turns a guard over the deploy pipeline into a test that is green for ever
 * while checking nothing at all — strictly worse than deleting it, because a
 * deleted test leaves a gap somebody can see.
 *
 * So: one anchor, checked at import time against files that must exist, and
 * every read verified to have content before it is returned.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The repository root: `web/tests/helpers/` → `web/tests/` → `web/` → `Part2_Infrastructure/` → root. */
export const repoRoot = new URL("../../../../", import.meta.url);

/** The same, as a path — `git` needs a `cwd`, not a URL. */
export const repoRootPath = fileURLToPath(repoRoot);

/** `Part2_Infrastructure/web/`. */
const webRoot = new URL("../../", import.meta.url);

/**
 * Three files that have to be at the repository root for the anchor above to
 * be pointing at the repository root. Checked when this module loads, so a
 * miscounted `..` fails every suite that imports it immediately and by name,
 * rather than one assertion at a time and only where the regex happened to
 * care.
 */
for (const anchor of [".vercelignore", "docker-compose.yml", ".github/workflows/ci.yml"]) {
  if (!existsSync(fileURLToPath(new URL(anchor, repoRoot)))) {
    throw new Error(
      `tests/helpers/deployment-files.ts resolved the repository root to ${repoRootPath}, `
        + `where ${anchor} does not exist. Every deployment suite reading through this helper `
        + "would otherwise assert against nothing.",
    );
  }
}

/** One file at the repository root, by its path from there. */
export function readRepoFile(relative: string): string {
  const text = readFileSync(fileURLToPath(new URL(relative, repoRoot)), "utf8");
  assert.ok(
    text.trim().length > 0,
    `${relative} read as empty — a doesNotMatch over it would pass by scanning nothing`,
  );
  return text;
}

/** One file inside the web project, by its path from `Part2_Infrastructure/web/`. */
export function readWebFile(relative: string): string {
  const text = readFileSync(fileURLToPath(new URL(relative, webRoot)), "utf8");
  assert.ok(
    text.trim().length > 0,
    `Part2_Infrastructure/web/${relative} read as empty — every assertion over it would pass by scanning nothing`,
  );
  return text;
}
