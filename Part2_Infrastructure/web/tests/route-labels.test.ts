/**
 * A route has a name, not a key.
 *
 * The failover graph's chips read `quote · crypto` — two lower-case tokens
 * and a separator, the cache key's spelling leaking into the UI. One helper
 * now names every route in words, and every surface that prints a route
 * (the chips, the supply-posture rows, the inspect route's lineage, the
 * aria-labels) reads from it, so the wording cannot drift three ways.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ROUTE_MATRIX } from "../lib/providers/capabilities";
import { routeLabel, routeNoun } from "../lib/providers/route-labels";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

describe("routeLabel names the nine desk routes in words", () => {
  it("every route the graph draws has a sentence-case name with no separator", () => {
    const labels = ROUTE_MATRIX.flatMap((r) => r.assets.map((a) => routeLabel(r.capability, a)));
    assert.deepEqual(labels, [
      "Crypto quotes", "Equity quotes",
      "Crypto bars", "Equity bars",
      "Crypto news", "Equity news",
      "Equity fundamentals",
      "Web search",
      "Web scrape",
    ]);
    for (const label of labels) assert.doesNotMatch(label, /[·/]/);
  });

  it("the symbol-less capabilities drop their placeholder asset", () => {
    assert.equal(routeLabel("search", "equity"), "Web search");
    assert.equal(routeLabel("scrape", "crypto"), "Web scrape");
  });

  it("routeNoun is the in-sentence form and FX keeps its capitals", () => {
    assert.equal(routeNoun("quote", "crypto"), "crypto quotes");
    assert.equal(routeNoun("bars", "fx"), "FX bars");
    assert.equal(routeLabel("bars", "fx"), "FX bars");
  });

  it("an unknown pair still reads as words rather than throwing", () => {
    assert.equal(routeLabel("orders", "equity"), "Equity orders");
  });
});

describe("the surfaces that print a route read from the helper", () => {
  it("the failover graph's chips, captions and aria-labels", () => {
    const graph = read("components/systems/FailoverGraph.tsx");
    assert.match(graph, /routeLabel\(r\.capability, r\.asset\)/);
    assert.match(graph, /aria-label=\{`Failover chain for \$\{routeNoun\(/);
    assert.doesNotMatch(graph, /console-sep/, "the separator span is gone with the key it separated");
    assert.doesNotMatch(graph, /\{r\.capability\}\s*<span/, "no hand-built capability · asset chip");
  });

  it("the supply-posture rows and the inspect route's lineage", () => {
    assert.match(read("components/data/SupplyPosture.tsx"), /label: routeLabel\(route\.capability, route\.asset\)/);
    const route = read("app/api/system/inspect/route.ts");
    assert.match(route, /ranked for \$\{routeNoun\(input\.capability, input\.asset\)\}/);
    assert.doesNotMatch(route, /\$\{input\.capability\}\/\$\{input\.asset\}/);
  });

  it("the stylesheet no longer carries the separator's rule", () => {
    assert.doesNotMatch(read("app/globals.css"), /\.console-sep\s*\{/);
  });
});
