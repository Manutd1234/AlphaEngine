/**
 * The one way a reader can reintroduce an ownerless store in a single line.
 *
 * `lib/` held eight classes across 32,000 lines, three of which were typed
 * errors, while the genuinely stateful parts of it were bare `let`s and `Map`s
 * at file scope. That is not an argument for classes everywhere — the React
 * components below `components/` are function components and should stay that
 * way — but it is an argument for the handful of places where mutable state
 * existed with no owner and was written from a module that did not declare it.
 *
 * This file carries the structural half of that argument, and it guards a
 * hazard that has already cost this repository a build:
 *
 *   **An exported `let` assigned from another module is a compile error the
 *   moment the file is split.** `Cannot assign to 'x' because it is an
 *   import`. `lib/observability/ledger.ts` carries the scar in a comment: a
 *   reset that lived in `capture.ts` and wrote `shared = null` was legal
 *   inside one 1,133-line file and illegal the day the file became two.
 *
 * The behavioural half — that a store which bounds itself, hands out copies
 * and resets in place cannot express the singleton-swap hazard either — lives
 * in `module-state-owners-observability` and `module-state-owners-transport`.
 * A grep is the right shape for this one because the defect is textual: the
 * code compiles fine today and stops compiling on a split that has not
 * happened yet, so nothing behavioural can reach it.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry) && !entry.includes("generated")) out.push(full);
  }
  return out;
}

describe("no module exports a mutable binding", () => {
  it("lib/ declares no `export let`", () => {
    const offenders: string[] = [];
    for (const file of sources(join(root, "lib"))) {
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        if (/^export let /.test(line)) {
          offenders.push(`${file.slice(root.length)}:${index + 1} — ${line.trim().slice(0, 70)}`);
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      "an exported `let` is assignable only from the module that declares it; "
        + "the moment a second module needs to write it, the split fails to compile. "
        + "Give the value an owner and export a method",
    );
  });
});
