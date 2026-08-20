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

  it("hands callGateway an object, never a pre-serialised string", () => {
    // callGateway owns serialisation (lib/gateway.ts). Pre-stringifying here
    // put a quoted JSON string on the wire; the gateway's Pydantic model
    // rejected it with 422, which surfaced as a permanent `gateway_rejected`
    // 502 the moment ALPHAENGINE_GATEWAY_URL started resolving. The original
    // test asserted only that callGateway was *called*, which this bug passed.
    // Scope to the callGateway invocation: the route also declares
    // `let body: unknown` for the incoming request, which a file-wide regex
    // matches first.
    const call = route.slice(route.indexOf("callGateway("));
    const body = call.slice(call.indexOf("body:")).split("\n")[0];
    assert.ok(
      !body.includes("JSON.stringify"),
      `body must be a plain object for the shared boundary to serialise, got: ${body}`,
    );
    assert.match(body, /body:\s*\{\s*query/, "expected an object literal");
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

describe("the outcome sentence carries a denominator when there is one", () => {
  const base = { state: "ok" as const, matches: [] as never[] };

  it("says how much was searched", () => {
    const out = describeSearchOutcome({ ...base, matches: [{}] as never, corpus_size: 400 });
    assert.match(out, /of 400 indexed/);
  });

  it("says nothing about the total when the count is unknown", () => {
    // The Oracle index reports none, and the Supabase count can fail. Unknown
    // is not zero, and it must not render as "of 0 indexed".
    for (const size of [undefined, null]) {
      const out = describeSearchOutcome({ ...base, matches: [{}] as never, corpus_size: size });
      assert.doesNotMatch(out, /indexed/, `corpus_size ${String(size)} invented a denominator`);
      assert.doesNotMatch(out, /\bof 0\b/);
    }
  });

  it("keeps the empty case distinguishable from the unavailable one", () => {
    const empty = describeSearchOutcome({ ...base, corpus_size: 12 });
    assert.match(empty, /nothing similar is recorded/);
    assert.match(empty, /of 12 indexed/, "an empty result still says how much was searched");
    assert.notEqual(empty, describeSearchOutcome({ state: "unavailable", matches: [] }));
  });
});
