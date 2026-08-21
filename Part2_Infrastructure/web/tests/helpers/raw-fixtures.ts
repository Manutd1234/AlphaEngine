/**
 * The committed vendor captures, and the one place their path is written down.
 *
 * `raw-contracts-rest-predicates.test.ts` was split by concern on 2026-08-21 — the
 * calibration rule, the per-provider predicates, these captures, and the
 * one-sided healthy-body table — and two of the successors read the same
 * captured bodies. `-fixtures` measures the predicates against them;
 * `-healthy-bodies` uses the OpenBB capture as the one row in its table that
 * is evidence rather than a written-down shape. One reader would have been a
 * duplicated path; two would be two paths that can disagree.
 *
 * TWO WAYS THIS COULD PASS WHILE READING NOTHING, both closed here:
 *
 *  1. THE PATH. These fixtures sit at `tests/fixtures/raw`, which is one level
 *     up from this helper and was in the same directory as the suite that used
 *     to read them — so the URL is `../fixtures/raw`, not `./fixtures/raw`.
 *     A wrong path throws from `readFileSync`, which is loud; an empty file
 *     would not be.
 *
 *  2. THE ENVELOPE. Each capture is `{ meta, body }` and only `body` is the
 *     vendor's. `JSON.parse(…).body` on a file that lost its envelope yields
 *     `undefined`, every predicate declines to fire on `undefined`, and the
 *     suite reports green on a body it never saw. So the body is asserted to
 *     exist before it is handed to anything.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The capture tree, from `tests/helpers/` — one level up, then in. */
export const RAW_FIXTURE_ROOT = fileURLToPath(new URL("../fixtures/raw", import.meta.url));

/** A committed vendor body, by `provider/name`. */
export const fixture = (name: string): unknown => {
  const raw = readFileSync(join(RAW_FIXTURE_ROOT, `${name}.json`), "utf8");
  assert.ok(raw.trim().length > 0, `${name}.json is empty; the capture it holds cannot be measured against`);
  const { body } = JSON.parse(raw) as { body?: unknown };
  assert.ok(
    body !== undefined,
    `${name}.json has no captured body; every predicate declines on undefined, so the check would pass on nothing`,
  );
  return body;
};
