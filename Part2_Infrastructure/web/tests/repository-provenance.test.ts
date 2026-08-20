/**
 * Committed figures carry their measurement date.
 *
 * Hand-copied counts drifted three times in one afternoon before the
 * generated files existed; a generated figure with no visible date is the
 * same defect one step removed — the number is right until it silently is
 * not, and the reader cannot tell how old "right" is. So the manifest and
 * the test counts both stamp their provenance, and the stamps must actually
 * be rendered, not just exported.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import manifest from "../lib/repository-manifest.generated.json";
import { TEST_COUNTS } from "../lib/test-counts.generated";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

/**
 * Comments stripped. Both surfaces below explain in prose which stamp they
 * carry and why, and a scan that cannot tell the explanation from the render
 * would count the paragraph as one of the two renderings it is asking for.
 */
const code = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the manifest states when it was generated", () => {
  it("carries version 2 provenance fields", () => {
    assert.equal(manifest.version, 2);
    assert.match(manifest.generatedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(manifest.commit, /^([0-9a-f]{7,40}|unknown)$/);
  });

  it("the explorer renders the stamp beside the figures it dates", () => {
    const explorer = read("components/developer/CodebaseExplorer.tsx");
    assert.match(explorer, /REPOSITORY_MANIFEST_PROVENANCE\.generatedAt/);
    assert.match(explorer, /REPOSITORY_MANIFEST_PROVENANCE\.commit/);
  });

  it("the shared-context facts strip titles its file count with the stamp", () => {
    // The facts strip left `DeveloperConsole` with the rest of the topology
    // section when the console passed the length ceiling; it renders from
    // `components/developer/DeveloperOverview.tsx` now.
    const overview = read("components/developer/DeveloperOverview.tsx");
    assert.match(overview, /Manifest generated \$\{REPOSITORY_MANIFEST_PROVENANCE\.generatedAt\}/);
  });
});

describe("the test counts state when they were measured", () => {
  it("generatedOn exists and is a date", () => {
    assert.match(TEST_COUNTS.generatedOn, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("the CI/CD surface renders the date, twice", () => {
    // Once on the hero pill, once on the verification matrix heading — the
    // two places a reader takes the totals from. Both moved out of
    // `DeveloperConsole` into `components/developer/DeveloperPipelines.tsx`,
    // which is the CI / CD section now; comments are stripped so the file's
    // own paragraph about the stamp cannot stand in for a rendering of it.
    const pipelines = code(read("components/developer/DeveloperPipelines.tsx"));
    const stamps = pipelines.match(/TEST_COUNTS\.generatedOn/g) ?? [];
    assert.ok(
      stamps.length >= 2,
      `the generatedOn stamp appears ${stamps.length} time(s); the pill and the matrix heading both need it`,
    );
  });
});
