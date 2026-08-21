/**
 * A comment that names a test file must name one that exists.
 *
 * This codebase argues for its guards in prose: a component says which suite
 * pins its behaviour, a fixture says which test would fail if it drifted. That
 * is a real navigation aid and the reason the comments earn their length — but
 * it is also a reference with no compiler behind it. Rename or split a suite
 * and every pointer to it becomes a lie that reads exactly like documentation.
 *
 * It happened at scale on 2026-08-21. Splitting 25 oversized test files left
 * more than twenty comments across `components/`, `lib/`, `app/` and `scripts/`
 * naming suites that no longer existed — each one sending a reader to a file
 * that is not there, to check a guard they would then assume was missing.
 *
 * Cheap to hold, and it only fails for a real defect: either the pointer is
 * stale, or the suite it names was deleted and its guard went with it. Both are
 * worth stopping the build for.
 *
 * Scope note: this checks the NAME resolves, not that the named suite actually
 * guards what the comment claims. No test can check that. What it buys is that
 * a reader following the pointer arrives somewhere real.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Directories whose prose may point at suites. */
const SCANNED = ["app", "components", "lib", "scripts", "tests"];

function files(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.(tsx?|mjs|css)$/.test(full)) out.push(full);
  }
  return out;
}

/**
 * Every test-file name appearing anywhere in a file.
 *
 * Deliberately scans the whole text rather than only comments: a name in a
 * string literal is just as much a pointer, and `tests/file-size.test.ts`
 * legitimately holds paths as data — which is why it is excluded below rather
 * than special-cased here.
 */
const NAMED = /\b([a-z0-9][a-z0-9-]*\.test\.ts)\b/g;

/**
 * Files whose job is to hold test paths as DATA rather than as pointers.
 *
 * `file-size.test.ts` records a debt ledger keyed by path, and its own third
 * assertion already fails when an entry names a file that is gone — a stricter
 * check than this one, and the reason duplicating it here would be noise.
 */
const DATA_FILES = new Set([
  "tests/file-size.test.ts",
]);

describe("every test file named in prose exists", () => {
  const scanned = SCANNED.flatMap((dir) => files(join(root, dir)));

  it("scans a meaningful number of files, so a broken walk cannot pass silently", () => {
    // The trap this whole exercise kept finding: a scan that looked nowhere
    // reads exactly like a clean bill of health.
    assert.ok(scanned.length > 300, `only ${scanned.length} files scanned`);
  });

  it("no comment or string points at a suite that is not there", () => {
    const known = new Set(readdirSync(join(root, "tests")).filter((f) => f.endsWith(".test.ts")));
    assert.ok(known.size > 50, "the tests directory did not enumerate");

    const stale: string[] = [];
    for (const file of scanned) {
      const relative = file.slice(root.length);
      if (DATA_FILES.has(relative)) continue;
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(NAMED)) {
        const name = match[1];
        // A file may name itself; and a path spelled out in full is checked
        // against the filesystem rather than the directory listing.
        if (relative.endsWith(name)) continue;
        /*
         * Explicitly historical references are legitimate and must not be
         * "fixed". "the former `venues.test.ts` sat at 596 lines and asserted
         * nothing about staleness" is a TRUE statement about a file that was
         * split — repointing it at the successor makes it false, and says the
         * successor had the hole. A bulk repoint did exactly that on
         * 2026-08-21 and had to be undone, which is why this exception exists
         * rather than a note asking people to be careful.
         */
        const before = text.slice(Math.max(0, match.index! - 40), match.index!);
        if (/\b(former|old|previous|since split|used to be|then-)\s*`?$/i.test(before)) continue;
        if (known.has(name)) continue;
        if (existsSync(join(root, "tests", name))) continue;
        const line = text.slice(0, match.index).split("\n").length;
        stale.push(`${relative}:${line} names ${name}, which does not exist`);
      }
    }
    assert.deepEqual(stale, [],
      `these pointers lead nowhere — repoint them at the suite that took over the guard:\n    ${stale.join("\n    ")}`);
  });
});
