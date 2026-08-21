/**
 * How the execution-control suites read their subjects.
 *
 * `tests/execution-controls-*.test.ts` are source-level suites: there is no DOM
 * here, and what is worth pinning about a control is structural. They all need
 * the same base and the same comment stripper, so both live here once — two
 * copies of the stripper below would be two things to keep in step, and the
 * whole point of the stripper is that a scan which drifts goes quiet.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The base the sources are read from.
 *
 * Overridable so these files can be run against a tree holding the PRE-change
 * components, which is how each assertion in them was checked to fail before it
 * was trusted. Unset — every normal run — it is the web root.
 */
export const base = process.env.EXECUTION_CONTROLS_BASE
  ? new URL(`file://${process.env.EXECUTION_CONTROLS_BASE}/`)
  : new URL("../..", import.meta.url);

export const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, base)), "utf8");

/**
 * Comments name the traps they are explaining — `view === "all"`, `hidden`,
 * `.seg`. A scan that cannot tell prose from code reads every explanation as
 * the offence it describes. This has bitten twice in this suite already.
 */
export const code = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
