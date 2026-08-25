/**
 * Every coherence route, against the contract its two ends share.
 *
 * "perform tdd testing such that all gateways and integrations is 100%."
 *
 * `coherence-routes.test.ts` asks whether a URL is spelt in one place and
 * whether a section warms what it opens. Both are about the DESK's side. This
 * asks the other side: that each of the eighteen route files declares the same
 * boundary, and — the part that had drifted — that what the BROWSER is willing
 * to wait for agrees with what the ROUTE is budgeted to take.
 *
 * THE DRIFT THIS EXISTS FOR. Nine routes carry `timeoutMs: 25_000` because they
 * read the live exchange. `use-coherence.ts` chose the browser's deadline with
 * `/\/(universe|certify)/` — right when it was written, wrong the moment a
 * third route was budgeted in seconds. Seven of the nine were being abandoned
 * at 9s while their routes were still working, and `combos` is the one a reader
 * met: the failure that reached the screen came from the NEXT poll joining the
 * abandoned request's still-open promise, so it named 25000ms in a request that
 * had waited five. Two ends of one contract, drifting apart with nothing
 * comparing them.
 *
 * DERIVED, NEVER OBSERVED (CLAUDE.md, fact 6). This reads the route sources and
 * the shared list. Whether the gateway ANSWERS inside its budget is a live
 * question and `scripts/coherence-probe.mjs` is what asks it.
 */

import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { LIVE_READS, isLiveRead } from "../lib/coherence/routes";
import { read, stripNonCode } from "./helpers/workspace-sources";

const ROUTES_DIR = fileURLToPath(new URL("../app/api/gateway/coherence", import.meta.url));

/** Every route file under the coherence boundary, as `name` → repo-relative path. */
function routeFiles(dir = ROUTES_DIR, prefix = ""): Array<{ name: string; at: string }> {
  const found: Array<{ name: string; at: string }> = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...routeFiles(path, prefix ? `${prefix}/${entry}` : entry));
    } else if (entry === "route.ts") {
      found.push({ name: prefix, at: `../app/api/gateway/coherence/${prefix}/route.ts` });
    }
  }
  return found;
}

const ROUTES = routeFiles();

/**
 * Comments blanked, STRINGS KEPT — three of the declarations below ARE strings.
 *
 * `stripNonCode` blanks string bodies, which is right for "is this a hook call"
 * and wrong for "does this route declare `runtime = \"nodejs\"`". Asked through
 * it, every one of the eighteen failed on a line it plainly carries. Comments
 * still go, so a route explaining why it does not cache cannot satisfy a check
 * that it does.
 */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
/** The last path segment, which is what a URL ends with and what the list names. */
const leafOf = (name: string) => name.split("/").pop() ?? name;

describe("the coherence boundary is one contract, eighteen times", () => {
  it("finds every route, so none is guarded by omission", () => {
    // A count rather than a spot check: a nineteenth route added without a line
    // here would otherwise be covered by nothing in this file.
    assert.equal(ROUTES.length, 18, "the route count moved; every assertion below iterates it");
    assert.ok(ROUTES.some((route) => route.name === "combos"), "the parlays route is not being read");
    assert.ok(ROUTES.some((route) => route.name === "calibration/history"), "a nested route was missed");
  });

  for (const route of ROUTES) {
    describe(route.name, () => {
      const source = read(route.at);
      const declared = withoutComments(source);
      const code = stripNonCode(source);

      it("runs on Node, never caches, and says so", () => {
        // A cached answer here is a price from some other minute wearing this
        // minute's timestamp — the one failure this whole tab is built against.
        assert.match(declared, /runtime = "nodejs"/, "the boundary would run on the edge, where the token is not");
        assert.match(declared, /dynamic = "force-dynamic"/, "the route may be statically rendered");
        assert.match(declared, /"Cache-Control": "no-store"/, "a live read is being handed to a cache");
      });

      it("validates what the gateway sent before handing it on", () => {
        // The desk's types are a claim about the wire. Without a guard the
        // claim is unchecked and a shape change reaches a figure as `undefined`.
        assert.match(code, /validate:/, "this route trusts the gateway's shape without checking it");
      });

      it("names its subject, so a failure says what could not be read", () => {
        assert.match(code, /subject:/, "a failure from here reads as a path rather than as a question");
      });

      it("agrees with the browser about how long it may take", () => {
        // THE ASSERTION THIS FILE EXISTS FOR. Both directions, so neither a
        // route that quietly takes the live budget nor a name left off the list
        // can pass.
        const live = code.includes("timeoutMs: 25_000");
        const listed = (LIVE_READS as readonly string[]).includes(leafOf(route.name));
        assert.equal(live, listed,
          live
            ? `${route.name} takes the live-read budget but is not in LIVE_READS, so the browser gives up on it at 9s`
            : `${route.name} is in LIVE_READS but takes the default budget, so the browser waits 28s for a route that quits at 8`);
      });
    });
  }

  it("every name in the list is a route that exists", () => {
    // The other direction of the same claim: a stale entry would widen the
    // browser's patience for a URL nothing serves.
    const leaves = new Set(ROUTES.map((route) => leafOf(route.name)));
    for (const name of LIVE_READS) {
      assert.ok(leaves.has(name), `LIVE_READS names ${name}, which is not a route under this boundary`);
    }
  });

  it("recognises a live read from the URL a builder produces", () => {
    // `isLiveRead` takes a desk URL with its query string, not a route name.
    assert.equal(isLiveRead("/api/gateway/coherence/combos?limit=6"), true);
    assert.equal(isLiveRead("/api/gateway/coherence/universe?max_events=2"), true);
    // The nested history routes read the tape and must NOT be widened: they end
    // in `/history`, and a naive `includes` would match their parent's name.
    assert.equal(isLiveRead("/api/gateway/coherence/calibration/history?limit=2000"), false);
    assert.equal(isLiveRead("/api/gateway/coherence/books/history?ticker=X"), false);
    assert.equal(isLiveRead("/api/gateway/coherence/index?limit=2000"), false);
  });
});
