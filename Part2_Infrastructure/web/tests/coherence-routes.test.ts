/**
 * One source for the Kalshi engine's URLs, and a warm plan that cannot drift
 * from it.
 *
 * A section on this tab can now be READ before anyone opens it — the rail warms
 * it on hover and the console sweeps the rest on idle — which is the fix for
 * seconds of "Reading the exchange…" on every first visit. It also creates a
 * failure mode nothing else here would catch: the URL exists in two places, the
 * pane that asks for it and the plan that warms it, and the first time a query
 * string diverges the warm fills a cache nobody reads. The lag comes back, and
 * every assertion in this repository still passes.
 *
 * So the URLs are built in `lib/coherence/routes.ts` and nowhere else, and this
 * file holds both halves of that: no pane may spell a gateway path itself, and
 * every section of both rails must have an entry in its console's plan.
 *
 * Source-level assertions, like the rest of the routing suites. There is no DOM
 * here and the property worth pinning is structural.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { COHERENCE_SECTION_IDS, MARKETS_SECTION_IDS } from "../lib/sections";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

/** Every `.tsx` under components/coherence, at any depth. */
function paneFiles(relative = "components/coherence"): string[] {
  return readdirSync(join(root, relative), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? paneFiles(join(relative, entry.name))
      : entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")
        ? [join(relative, entry.name)]
        : [],
  );
}

const routes = read("lib/coherence/routes.ts");
const consoles = ["components/MarketsConsole.tsx", "components/CoherenceConsole.tsx"];

describe("the engine's gateway URLs are built in one place", () => {
  it("no pane spells a gateway path of its own", () => {
    const offenders: string[] = [];
    for (const file of [...paneFiles(), ...consoles]) {
      const source = read(file);
      for (const match of source.matchAll(/["'`]\/api\/gateway\/(coherence|diffusion)\//g)) {
        offenders.push(`${file} builds ${match[0].slice(1)}…`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "a URL spelt in a pane is a URL the warm plan cannot warm — build it in lib/coherence/routes.ts",
    );
  });

  it("the routes module is the only file that does", () => {
    assert.match(routes, /\/api\/gateway\/coherence/);
    assert.match(routes, /\/api\/gateway\/diffusion/);
  });

  it("every route it exports is called by something", () => {
    const exported = [...routes.matchAll(/export const (\w+Route)\b/g)].map((match) => match[1]);
    assert.ok(exported.length >= 15, `only ${exported.length} routes are exported — the scan is measuring nothing`);
    const callers = [...paneFiles(), ...consoles, "lib/coherence/use-coherence.ts"]
      .map((file) => read(file))
      .join("\n");
    const unused = exported.filter((name) => !new RegExp(`\\b${name}\\(`).test(callers));
    assert.deepEqual(unused, [], "a route builder nothing calls is a URL that has quietly moved back into a pane");
  });
});

describe("every section can be warmed before it is opened", () => {
  /** The `SECTION_READS` literal of one console, as `{ id: [url count] }`. */
  function planOf(file: string): Record<string, number> {
    const source = read(file);
    const start = source.indexOf("const SECTION_READS");
    assert.notEqual(start, -1, `${file} no longer declares SECTION_READS`);
    const block = source.slice(start, source.indexOf("\n};", start));
    return Object.fromEntries(
      [...block.matchAll(/^ {2}(\w+): \[([^\]]*)\]/gm)]
        .map(([, id, body]) => [id, body.trim() ? body.split("),").length : 0]),
    );
  }

  it("Markets plans a read for each of its sections", () => {
    const plan = planOf("components/MarketsConsole.tsx");
    assert.deepEqual(Object.keys(plan).sort(), [...MARKETS_SECTION_IDS].sort());
    // Every Markets section reads something. None of them is a static page.
    for (const [id, count] of Object.entries(plan)) {
      assert.ok(count > 0, `markets/${id} plans no read, but every section here opens one`);
    }
  });

  it("Coherence plans a read for each of its sections, and says why Lessons has none", () => {
    const plan = planOf("components/CoherenceConsole.tsx");
    assert.deepEqual(Object.keys(plan).sort(), [...COHERENCE_SECTION_IDS].sort());
    assert.equal(plan.lessons, 0, "the curriculum is rendered from a module and asks the gateway for nothing");
    for (const [id, count] of Object.entries(plan)) {
      if (id === "lessons") continue;
      assert.ok(count > 0, `coherence/${id} plans no read, so it will still open cold`);
    }
  });

  it("both consoles sweep their rail and warm on intent", () => {
    for (const file of consoles) {
      const source = read(file);
      assert.match(source, /useSectionWarming\(SECTION_READS, active\)/, `${file} does not sweep its rail`);
      assert.match(source, /onIntent=\{warmSection\}/, `${file} does not warm the section a pointer is crossing`);
    }
  });
});
