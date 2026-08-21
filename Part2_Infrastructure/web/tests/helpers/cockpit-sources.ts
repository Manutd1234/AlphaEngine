/**
 * How the cockpit suites read the files they pin.
 *
 * Several of the `tests/cockpit-*.test.ts` suites assert against source text
 * rather than behaviour. The route modules read `process.env` at call time and
 * would need a live gateway to exercise, and the wiring assertions are about
 * which file owns a piece of state — so what is asserted is the contract a
 * future edit would have to break deliberately, the same approach
 * `risk-actions.test.ts` takes.
 *
 * Paths are given from the web root rather than from the test file, so a suite
 * that moves does not silently start reading nothing.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../..", import.meta.url);

export const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, root)), "utf8");
