/**
 * The files the Developer tab renders from, and the reader that pulls one
 * function's body out of them.
 *
 * The console is no longer one file. `DeveloperConsole.tsx` passed the length
 * ceiling and each section moved to `components/developer/` along the seams the
 * section rail already drew — `DeveloperOverview` (topology and readiness),
 * `DeveloperPipelines` (CI / CD), `DeveloperInterfaces` (API & Schema) and the
 * shared vocabulary in `DeveloperStatus`. That split is why this module exists:
 * an assertion about ONE component reads that component's file, and an
 * assertion about what the whole TAB mounts reads `tab`, the group of files
 * that make it. Both readings are shared by the `developer-panes-*` suites, so
 * neither may be re-derived in a successor file with a list that has drifted.
 */

import assert from "node:assert/strict";

import { readSource } from "./source-files";

export const console_ = readSource("components/DeveloperConsole.tsx");
export const overview_ = readSource("components/developer/DeveloperOverview.tsx");
export const pipelines_ = readSource("components/developer/DeveloperPipelines.tsx");
export const interfaces_ = readSource("components/developer/DeveloperInterfaces.tsx");
export const status_ = readSource("components/developer/DeveloperStatus.tsx");
export const explorer = readSource("components/developer/CodebaseExplorer.tsx");
export const queue = readSource("components/developer/DeveloperWorkQueue.tsx");
export const catalog = readSource("components/developer/DeveloperApiCatalog.tsx");
export const health = readSource("lib/use-system-health.ts");

/**
 * Every file the Developer tab renders from, as one string.
 *
 * Only for the claims that are about the TAB rather than about a component:
 * how many rails it mounts, how many times one card appears on it, whether it
 * offers a refresh anywhere. Those used to be a scan of the single console
 * file; reading the group is what keeps them meaning the same thing after the
 * split, and keeps a second rail from arriving inside a section file unseen.
 */
export const tab = [console_, overview_, pipelines_, interfaces_, status_, explorer, queue, catalog].join("\n");

/** The body of a top-level function, up to the next one. */
export function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} is no longer declared in the file this test reads it from`);
  const next = source.indexOf("\nfunction ", start + 1);
  const exported = source.indexOf("\nexport ", start + 1);
  const ends = [next, exported].filter((index) => index > start);
  return source.slice(start, ends.length ? Math.min(...ends) : source.length);
}
