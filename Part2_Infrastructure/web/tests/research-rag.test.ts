/**
 * The research-RAG proxy and its state vocabulary.
 *
 * Source-level assertions in the house style: the property worth pinning is
 * that "unavailable" can never be flattened into "no results" anywhere between
 * the gateway and the panel.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { describeSearchOutcome, isResearchRagSearchResponse } from "../lib/research-rag";

const route = readFileSync(
  fileURLToPath(new URL("../app/api/gateway/research/rag/route.ts", import.meta.url)),
  "utf8",
);

describe("the proxy route", () => {
  it("goes through callGateway with a shape validator", () => {
    assert.match(route, /callGateway\(/);
    assert.match(route, /validate: isResearchRagSearchResponse/);
  });

  it("is read-shaped: no operator-token gate, token stays server-side", () => {
    assert.ok(!route.includes("authorise("), "reads are not operator-gated (audit precedent)");
    assert.ok(!route.includes("NEXT_PUBLIC"), "no browser-visible credential");
  });

  it("clamps rather than trusts the match count", () => {
    assert.match(route, /Math\.min\(Math\.max/);
  });
});

describe("the state vocabulary", () => {
  it("accepts exactly the three gateway states", () => {
    for (const state of ["ok", "unavailable", "embed_failed"]) {
      assert.ok(isResearchRagSearchResponse({ state, matches: [] }), state);
    }
    assert.ok(!isResearchRagSearchResponse({ state: "error", matches: [] }));
    assert.ok(!isResearchRagSearchResponse({ state: "ok", matches: "none" }));
  });

  it("never renders unavailable as found-nothing", () => {
    const unavailable = describeSearchOutcome({ state: "unavailable", matches: [] });
    const empty = describeSearchOutcome({ state: "ok", matches: [] });
    assert.notEqual(unavailable, empty);
    assert.match(unavailable, /not configured|nothing was searched/i);
    assert.match(empty, /nothing similar/i);
  });
});
