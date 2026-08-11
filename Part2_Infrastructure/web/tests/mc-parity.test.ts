/**
 * Cross-engine Monte Carlo parity, pinned.
 *
 * The Developer console claims three runtimes reproduce one simulation byte
 * for byte: the committed reference, the server's Node runtime, and the
 * visitor's browser worker. Node stands in for the browser here by executing
 * the *worker program itself* — the same stringified source a Blob URL serves
 * — so the suite fails if either leg drifts from the committed bytes, and the
 * committed bytes fail if the algorithm changes without regeneration.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { canonicalJson } from "../lib/canonical-json";
import { mcParityEvidence } from "../lib/delivery-readiness";
import { mcWorkerSource, type McDistributionResult } from "../lib/mc-distribution";
import { computeMcParityJson, mcParityFixture } from "../lib/mc-parity";
import {
  MC_PARITY_REFERENCE_JSON,
  MC_PARITY_REFERENCE_SHA256,
} from "../lib/mc-parity-reference.generated";

describe("the committed reference is genuine", () => {
  it("is the canonical serialisation of a result-shaped object", () => {
    const parsed = JSON.parse(MC_PARITY_REFERENCE_JSON) as McDistributionResult;
    assert.equal(canonicalJson(parsed), MC_PARITY_REFERENCE_JSON, "reference must be canonical");
    assert.equal(parsed.paths, 2_000);
    assert.ok(parsed.histogram && parsed.histogram.edges.length === parsed.histogram.counts.length + 1);
  });

  it("carries its own digest", () => {
    const digest = createHash("sha256").update(MC_PARITY_REFERENCE_JSON, "utf8").digest("hex");
    assert.equal(digest, MC_PARITY_REFERENCE_SHA256, "digest and JSON were committed together");
  });
});

describe("engine leg 1 — this Node runtime", () => {
  it("reproduces the committed reference byte for byte", () => {
    assert.equal(
      computeMcParityJson(),
      MC_PARITY_REFERENCE_JSON,
      "the simulation drifted from the committed reference — if the change is intentional, "
        + "run `node --import tsx scripts/generate-mc-parity.ts` and review the diff",
    );
  });

  it("is what the delivery evidence reports", () => {
    const evidence = mcParityEvidence();
    assert.equal(evidence.state, "match");
    assert.equal(evidence.passed, true);
    assert.equal(evidence.observedDigest, MC_PARITY_REFERENCE_SHA256);
  });
});

describe("engine leg 2 — the worker program the browser executes", () => {
  it("reproduces the committed reference byte for byte", () => {
    // Execute the exact program text a Blob URL serves to the browser worker.
    const messages: unknown[] = [];
    const workerSelf = {
      onmessage: null as null | ((event: { data: unknown }) => void),
      postMessage: (message: unknown) => messages.push(message),
    };
    new Function("self", mcWorkerSource())(workerSelf);
    assert.ok(workerSelf.onmessage, "worker program must install onmessage");
    workerSelf.onmessage({ data: mcParityFixture() });

    const done = messages.find(
      (m): m is { type: "result"; result: McDistributionResult } =>
        typeof m === "object" && m !== null && (m as { type?: string }).type === "result",
    );
    assert.ok(done, "worker must post a result message");
    assert.equal(canonicalJson(done.result), MC_PARITY_REFERENCE_JSON);
  });
});
