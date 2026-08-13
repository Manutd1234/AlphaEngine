/**
 * The API catalogue lists the API that exists.
 *
 * `DeveloperApiCatalog` is the panel a reviewer opens to ask what this app's
 * surface IS. It was hand-maintained, and it had fallen nine routes behind:
 * "26 web API operations · 23 route handlers" against 32 route files, with
 * every auth surface, both Oracle backends, the research RAG proxy, favourites
 * and the Telegram connect mint missing entirely.
 *
 * The counts were not wrong about the list — the list was wrong about the app.
 * That is the harder version of a stale inventory, because the arithmetic is
 * self-consistent and nothing looks broken.
 *
 * So this test does not check the numbers. It diffs the array against the
 * filesystem in both directions, which is the only check that cannot itself go
 * stale: a new `route.ts` fails here until it is catalogued, and a catalogued
 * path that no longer exists fails too.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { API_OPERATIONS } from "../components/developer/DeveloperApiCatalog";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const apiRoot = join(webRoot, "app/api");

/** Every route handler on disk, as an `/api/...` path. */
function routeFiles(dir: string, prefix = "/api"): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...routeFiles(full, `${prefix}/${entry}`));
    } else if (entry === "route.ts") {
      found.push(prefix);
    }
  }
  return found;
}

/**
 * Next.js writes a dynamic segment as `[id]`; the catalogue displays `{id}`,
 * which is what every other API document in this repo uses. Normalised here so
 * a presentation choice is not read as drift.
 */
const normalise = (path: string) => path.replace(/\[([^\]]+)\]/g, "{$1}");

/** The catalogue's paths, with query strings stripped — they are examples. */
const catalogued = new Set(
  API_OPERATIONS.map((operation) => operation.path.split("?", 1)[0]),
);

const onDisk = new Set(routeFiles(apiRoot).map(normalise));

describe("the developer API catalogue matches the app", () => {
  it("lists every route handler that exists", () => {
    const missing = [...onDisk].filter((path) => !catalogued.has(path)).sort();
    assert.deepEqual(
      missing,
      [],
      `these routes ship but are not in the catalogue:\n  ${missing.join("\n  ")}`,
    );
  });

  it("lists no route that does not exist", () => {
    const phantom = [...catalogued].filter((path) => !onDisk.has(path)).sort();
    assert.deepEqual(
      phantom,
      [],
      `these are catalogued but have no route.ts:\n  ${phantom.join("\n  ")}`,
    );
  });

  it("declares every method each route actually exports", () => {
    // A route exporting GET and DELETE and catalogued only as GET is half an
    // entry — and `/api/auth/session` was exactly that shape.
    const shortfall: string[] = [];
    for (const path of onDisk) {
      const file = join(apiRoot, path.replace("/api/", "").replace(/\{([^}]+)\}/g, "[$1]"), "route.ts");
      let source: string;
      try {
        source = readFileSync(file, "utf8");
      } catch {
        continue; // covered by the two tests above
      }
      const exported = new Set(
        [...source.matchAll(/export async function (GET|POST|PUT|DELETE|PATCH)\b/g)].map((m) => m[1]),
      );
      const declared = new Set(
        API_OPERATIONS.filter((o) => o.path.split("?", 1)[0] === path).map((o) => o.method),
      );
      for (const method of exported) {
        if (!declared.has(method as never)) shortfall.push(`${method} ${path}`);
      }
    }
    assert.deepEqual(
      shortfall.sort(),
      [],
      `exported but not catalogued:\n  ${shortfall.join("\n  ")}`,
    );
  });

  it("counts what it lists", () => {
    // The headline reads `API_OPERATIONS.length` operations over N distinct
    // handlers. Both are derived, so this only guards the derivation.
    assert.equal(API_OPERATIONS.length, [...API_OPERATIONS].length);
    assert.ok(
      catalogued.size <= API_OPERATIONS.length,
      "more distinct paths than operations is arithmetically impossible",
    );
    assert.equal(catalogued.size, onDisk.size);
  });
});
