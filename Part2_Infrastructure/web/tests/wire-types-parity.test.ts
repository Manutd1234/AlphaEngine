/**
 * The desk's hand-written wire types, against the contract the gateway publishes.
 *
 * THE CHAIN IS ALREADY MACHINE-CHECKED EXCEPT FOR ONE LINK, and this is that
 * link. `tools/openapi.json` is generated from the Pydantic models and gated by
 * a sha in `lib/gateway-openapi-digest.generated.ts`;
 * `lib/gateway-contract.generated.ts` is generated from that snapshot and
 * `gateway-contract.test.ts` pins it to regenerate byte-for-byte. So Pydantic →
 * OpenAPI → generated TypeScript cannot drift quietly.
 *
 * `lib/coherence/types.ts` and `types-lab.ts` can. They are hand-mirrored from
 * the same models, they are what every panel on the two engine tabs actually
 * reads, and nothing compared them to anything. 46 of their 47 interfaces have a
 * generated counterpart sitting in the same repository, and until this file
 * nothing looked at the two together.
 *
 * WHY THE RUNTIME GUARDS ARE NOT THIS CHECK. Measured 2026-08-26: 40 of the 43
 * `callGateway` routes carry a `validate`, and every one is ONE LEVEL DEEP —
 * `isCoherenceUniverse` asks that `state` is a string and `events` is an array,
 * and nothing at all about what is inside an event. A field renamed inside a
 * market passes the guard, passes the proxy, and paints a dash. A guard also
 * fires in production, after the panel is already blank; this fires in CI.
 *
 * NAMES ONLY, AND THE OMISSION IS THE DESIGN. A first pass compared
 * nullability too and produced 139 disagreements, every one of them noise: the
 * OpenAPI generator marks a field with a DEFAULT as optional, and the hand file
 * declares the same field required-but-nullable. Those are different claims —
 * "the server may omit this" versus "this may be null" — and comparing them is
 * a category error that would have buried the three real findings under 139
 * false ones. If nullability is ever worth pinning it needs the two vocabularies
 * reconciled first, deliberately, not as a side effect of a name check.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read } from "./helpers/workspace-sources";

/** Field names per `export interface`, with comments and nested braces handled. */
function interfaces(source: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const match of source.matchAll(/export interface (\w+)\s*\{/g)) {
    let depth = 1;
    let i = match.index! + match[0].length;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
      i++;
    }
    const body = source.slice(match.index! + match[0].length, i - 1)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const fields = new Set<string>();
    for (const field of body.matchAll(/^\s*(\w+)\??\s*:/gm)) fields.add(field[1]);
    out.set(match[1], fields);
  }
  return out;
}

const generated = interfaces(read("../lib/gateway-contract.generated.ts"));
const hand = interfaces(read("../lib/coherence/types.ts") + read("../lib/coherence/types-lab.ts"));

/**
 * Interfaces the desk declares that the gateway does not, with the reason.
 *
 * `CoherenceLoad` is the read as the PANES consume it — payload, error and the
 * moment it landed — which is a fact about the browser's own polling and not
 * about the wire. It has no counterpart because it should not have one.
 */
const DESK_ONLY = new Set(["CoherenceLoad"]);

describe("the sources these assertions read were actually loaded", () => {
  it("both sides parsed into interfaces", () => {
    // A scan of "" satisfies every assertion below and reads like a clean bill
    // of health; that trap has been found twice in this tree.
    assert.ok(generated.size > 100, `the generated contract parsed to ${generated.size} interfaces`);
    assert.ok(hand.size > 40, `the hand-written types parsed to ${hand.size} interfaces`);
  });
});

describe("every hand-written wire type answers to the published contract", () => {
  it("declares no interface the gateway does not publish, except the desk's own", () => {
    const orphans = [...hand.keys()].filter((name) => !generated.has(name) && !DESK_ONLY.has(name));
    assert.deepEqual(orphans, [],
      `these are hand-written as wire types but the gateway publishes no such model:\n  ${orphans.join("\n  ")}`);
  });

  it("carries every field the gateway sends", () => {
    // The rename case and the new-field case land here together, which is the
    // point: a field renamed on the gateway reads as one missing here, and a
    // field ADDED there reads the same way. Both are "the desk cannot see
    // something the venue is sending", which is the defect this file exists for.
    const missing: string[] = [];
    for (const [name, fields] of hand) {
      const published = generated.get(name);
      if (!published) continue;
      for (const field of published) if (!fields.has(field)) missing.push(`${name}.${field}`);
    }
    assert.deepEqual(missing, [],
      `the gateway publishes these and the desk's types do not declare them, so no panel can read them:\n  ${missing.join("\n  ")}`);
  });

  it("invents no field the gateway does not send", () => {
    // The other direction, and the one that produces a dash rather than a gap:
    // a panel reading a field nobody sends renders "we do not know" forever and
    // looks exactly like a market that is genuinely unquoted.
    const invented: string[] = [];
    for (const [name, fields] of hand) {
      const published = generated.get(name);
      if (!published) continue;
      for (const field of fields) if (!published.has(field)) invented.push(`${name}.${field}`);
    }
    assert.deepEqual(invented, [],
      `the desk's types declare these and the gateway sends no such field:\n  ${invented.join("\n  ")}`);
  });
});
