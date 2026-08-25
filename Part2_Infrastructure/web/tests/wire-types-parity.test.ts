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

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { read, stripNonCode } from "./helpers/workspace-sources";

const WEB = fileURLToPath(new URL("..", import.meta.url));

function filesUnder(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at)) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (match.test(entry)) out.push(path);
    }
  };
  walk(join(WEB, dir));
  return out;
}

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


/**
 * Source reduced to the identifiers that could be a CALL, for counting only.
 *
 * `stripNonCode` removes comments and quoted strings and deliberately KEEPS
 * template text — that is why it costs no guard anywhere else in the suite, and
 * why an id built as `markets-subtab-${next}` is still readable. For counting
 * callers it is not enough twice over, and both holes were demonstrated rather
 * than argued (`developer-analyst-7c`, 2026-08-26):
 *
 *   a guard named in a doc block            counted as a caller
 *   a guard named inside a template literal counted as a caller
 *
 * The first is house style here — this tree names identifiers in backticks
 * inside doc blocks constantly, and the comment above this very function does
 * it. So a guard could be orphaned and laundered by the sentence explaining
 * that it was orphaned.
 *
 * So prose inside backticks goes too, and `${...}` substitutions stay, because
 * a call CAN live in one. Blanking template text is wrong globally — it breaks
 * the two rail guards that read a constructed id — and right here, where the
 * only question is whether an identifier occurs in code.
 */
function callableText(source: string): string {
  const code = stripNonCode(source);
  const frames: string[] = [];
  let out = "";
  let i = 0;
  const skipProse = () => {
    while (i < code.length) {
      if (code[i] === "\\") { i += 2; continue; }
      if (code[i] === "`") { i++; return; }
      if (code[i] === "$" && code[i + 1] === "{") { out += " ${"; i += 2; frames.push("tmpl"); return; }
      i++;
    }
  };
  while (i < code.length) {
    const c = code[i];
    if (c === "`") { i++; skipProse(); continue; }
    if (c === "{" && frames.length) { frames.push("code"); out += c; i++; continue; }
    if (c === "}" && frames.length) {
      const top = frames.pop();
      out += c; i++;
      if (top === "tmpl") skipProse();
      continue;
    }
    out += c; i++;
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


/**
 * The wire modules whose guards the proxy routes are supposed to call.
 *
 * Scoped to the wire types rather than the whole tree: an unused predicate in a
 * view module is a tidiness question, and this one is a correctness question.
 */
const GUARD_MODULES = [
  "lib/coherence/types.ts",
  "lib/coherence/types-lab.ts",
  "components/coherence/diffusion/types.ts",
];

describe("a guard that exists is a guard that is called", () => {
  it("leaves no wire guard uncalled", () => {
    // THE DEFECT THIS IS FOR, and it is not hypothetical. `isAbsorptionRead`
    // and `isEventsRead` sat in the diffusion types with no caller anywhere in
    // the tree, while the three diffusion routes carried a SECOND, WEAKER copy
    // inline — one that asked only that `state` was a string. The duplicate was
    // not the first mistake; the orphan was. A guard nobody calls is a guard
    // nobody maintains, and the next person to need one writes a worse one
    // rather than finding it. Wired up by `developer-analyst-7c` at 0ea701c;
    // this is what would have caught it a week earlier.
    const sources = [
      ...filesUnder("lib", /\.tsx?$/),
      ...filesUnder("components", /\.tsx?$/),
      ...filesUnder("app", /\.tsx?$/),
    ].map((path) => [path, callableText(readFileSync(path, "utf8"))] as const);

    const orphans: string[] = [];
    for (const module of GUARD_MODULES) {
      const declared = readFileSync(join(WEB, module), "utf8");
      const callable = callableText(declared);
      for (const match of declared.matchAll(/export function (is[A-Z]\w*)/g)) {
        const guard = match[1];
        // A guard used only by its SIBLINGS in the same module is called —
        // `isReadState` is the worked example, composed into `isAbsorptionRead`
        // and its two neighbours and exported for its own sake. So the
        // declaring file counts too, by occurrences beyond the declaration
        // itself rather than by presence.
        const own = (callable.match(new RegExp(`\\b${guard}\\b`, "g")) ?? []).length;
        const elsewhere = sources.some(([path, text]) =>
          !path.endsWith(module) && new RegExp(`\\b${guard}\\b`).test(text));
        if (own <= 1 && !elsewhere) orphans.push(`${guard} (${module})`);
      }
    }
    assert.deepEqual(orphans, [],
      `these wire guards are declared and called by nothing, so the next route to need one will write a weaker copy:\n  ${orphans.join("\n  ")}`);
  });
});

/**
 * Routes that hand-roll a validator instead of naming one, as of 2026-08-26.
 *
 * A RATCHET THAT ONLY SHRINKS, in the shape `file-size.test.ts` uses. It is not
 * a ban: for a payload with no named guard, an inline predicate is the honest
 * thing to write, and seventeen of these sit in four other sessions' areas. What
 * it forbids is a NEW one, and what it records is the debt — because the
 * diffusion three showed what an inline copy becomes once a named guard for the
 * same payload exists somewhere else.
 */
const INLINE_VALIDATORS = [
  "app/api/gateway/audit/route.ts",
  "app/api/gateway/data-quality/escalations/[id]/ack/route.ts",
  "app/api/gateway/data/jobs/route.ts",
  "app/api/gateway/data/quality/route.ts",
  "app/api/gateway/data/schedules/route.ts",
  "app/api/gateway/data/work-items/route.ts",
  "app/api/gateway/jobs/[jobId]/route.ts",
  "app/api/gateway/orders/[id]/cancel/route.ts",
  "app/api/gateway/orders/[id]/replace/route.ts",
  "app/api/gateway/orders/route.ts",
  "app/api/gateway/orders/working/route.ts",
  "app/api/gateway/portfolio/history/route.ts",
  "app/api/gateway/research/graph/[id]/route.ts",
  "app/api/gateway/research/ml/fit/route.ts",
  "app/api/gateway/research/ml/runs/[runId]/route.ts",
  "app/api/gateway/research/ml/runs/route.ts",
  "app/api/oracle/research/route.ts",
];

describe("a validated route names its guard", () => {
  it("grows no new hand-rolled validator", () => {
    const routes = filesUnder("app/api", /^route\.ts$/);
    const inline = routes
      .filter((path) => {
        const text = readFileSync(path, "utf8");
        return text.includes("callGateway") && text.includes("validate:") && !/validate: is[A-Z]/.test(text);
      })
      .map((path) => path.slice(WEB.length).replace(/^\/+/, ""))
      .sort();
    const added = inline.filter((path) => !INLINE_VALIDATORS.includes(path));
    assert.deepEqual(added, [],
      `these routes hand-roll a validator; name it, so a second copy cannot drift from the first:\n  ${added.join("\n  ")}`);
  });

  it("keeps the list honest — an entry that named its guard must leave", () => {
    // The other half of a ratchet, and the half people forget: an allow-list
    // that never shrinks stops describing the tree and starts excusing it.
    const routes = filesUnder("app/api", /^route\.ts$/).map((p) => p.slice(WEB.length).replace(/^\/+/, ""));
    const stale = INLINE_VALIDATORS.filter((entry) => {
      if (!routes.includes(entry)) return true;
      const text = readFileSync(join(WEB, entry), "utf8");
      return !text.includes("validate:") || /validate: is[A-Z]/.test(text);
    });
    assert.deepEqual(stale, [],
      `these no longer hand-roll a validator and must be removed from INLINE_VALIDATORS:\n  ${stale.join("\n  ")}`);
  });
});
