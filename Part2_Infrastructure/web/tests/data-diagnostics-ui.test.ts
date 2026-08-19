/**
 * Diagnostic UI claims are part of the data contract.
 *
 * There is no DOM harness in this suite, so these checks pin the structural
 * boundaries that make the rendered evidence truthful: request identity,
 * interval propagation, and an explicit denominator for quality claims.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const crossSource = read("../components/systems/CrossSourceCheck.tsx");
const pipeline = read("../components/systems/PipelineInspector.tsx");
const quarantine = read("../components/systems/QuarantinePanel.tsx");

describe("data diagnostics preserve request identity", () => {
  it("aborts reconciliation when its symbol identity changes", () => {
    assert.match(crossSource, /new AbortController\(\)/);
    assert.match(crossSource, /signal: controller\.signal/);
    assert.match(crossSource, /sequence\.current \+= 1;[\s\S]*activeRequest\.current\?\.abort\(\)/);
  });

  it("makes the workspace interval mandatory for a bar trace", () => {
    assert.match(pipeline, /interval: string;/);
    assert.doesNotMatch(pipeline, /interval\s*=\s*"4h"/);
    assert.ok(
      pipeline.includes('if (capability === "bars") qs.set("interval", interval);'),
      "bar inspection omits the workspace interval",
    );
    assert.ok(pipeline.includes("Requested interval"), "the trace hides which interval it requested");
  });
});

describe("data diagnostics do not manufacture trust evidence", () => {
  it("uses the validation denominator and labels zero evaluations as no evidence", () => {
    assert.match(quarantine, /validation\?\.evaluated/);
    assert.ok(quarantine.includes("no evaluated denominator"));
    assert.match(quarantine, /not that\s+every payload/);
    assert.ok(!quarantine.includes("Every payload since this instance started"));
  });

  it("keeps provenance and cache identity visible without inferring a field map", () => {
    assert.ok(pipeline.includes("Answer provenance"));
    assert.ok(pipeline.includes("field-level transformation map"));
    assert.match(quarantine, /<code>\{record\.key\}<\/code>/);
  });
});

describe("the pipeline inspector separates zones instead of narrating them", () => {
  it("states the price of a trace beside the button that spends it", () => {
    // Trace is the one control on the card that costs a real provider call.
    // The house rule is that a cost stays visible next to the action; folding
    // it into a disclosure would make the expensive button the quiet one.
    assert.ok(pipeline.includes("Trace (bypass cache)"));
    // Case-insensitive: the sentence used to open "Trace skips the registry
    // cache and spends…", which was the button's own parenthesis spelled out.
    // It now opens with the price, so "Spends" is capitalised.
    assert.match(pipeline, /spends one interactive provider call/i);
  });

  it("renders the executed path as an ordered list, with the key in the verdict grid", () => {
    // The lineage is the heart of the panel and its order is its meaning — an
    // <ol> so the sequence survives styling. The cache key sits in the same
    // labelled grid as the verdict rather than in a stray sentence below it.
    assert.match(pipeline, /<ol className="console-lineage">/);
    assert.match(pipeline, /console-facts__span/);
    assert.ok(!pipeline.includes("console-key"), "the cache key regressed to sentence prose");
  });

  it("folds explainer prose into disclosures but keeps honest empty states in the open", () => {
    // Methodology can collapse; the absence of evidence cannot. A reader must
    // never open a disclosure to learn that nothing was captured.
    assert.match(pipeline, /<details className="disclosure">\s*<summary>Why raw and normalised/);
    assert.match(pipeline, /<details className="disclosure">\s*<summary>Where these frames/);
    assert.ok(pipeline.includes("None — the cache answered."));
    assert.ok(pipeline.includes("No frame received yet."));
  });
});

describe("a capability the symbol cannot answer is refused, not traced", () => {
  // Fundamentals describe an issuer. Tracing them on a crypto pair used to walk
  // the whole equity chain — four provider calls, one of them Alpha Vantage's,
  // to be told four times there is no issuer — and then re-walk it on every
  // poll. The gate lives in one table (lib/providers/capabilities.ts); the
  // route consults it before the cache and the inspector before the request.
  const route = read("../app/api/system/inspect/route.ts");

  it("the inspect route refuses before the cache is read and says nothing was sent", () => {
    assert.match(route, /if \(!isApplicable\(capability, asset\)\)/);
    assert.ok(route.indexOf("isApplicable(capability, asset)") < route.indexOf("store.ttl(cacheKey)"));
    assert.ok(route.includes('reason: "not_applicable"'));
    assert.ok(route.includes("No HTTP call was made; the registry declined before dispatch."));
    assert.match(route, /provenance: null,\s*attempts: \[\]/);
  });

  it("the inspector never sends a request the registry would refuse — first load or poll", () => {
    assert.match(pipeline, /const inapplicable = !isApplicable\(capability, asset\);/);
    const gates = pipeline.match(/if \(inapplicable\) return;/g) ?? [];
    assert.equal(gates.length, 2, "both the auto-inspect and the poll effect must be gated");
    assert.match(pipeline, /disabled=\{busy \|\| inapplicable\}/);
  });

  it("the refusal is explained in place, with a way out that changes real state", () => {
    assert.ok(pipeline.includes("Not applicable."));
    assert.ok(pipeline.includes("Trace {EQUITY_EXAMPLE} instead"));
    assert.ok(pipeline.includes("Back to quote"));
    assert.match(pipeline, /onSymbolChange\(EQUITY_EXAMPLE\)/);
  });
});
