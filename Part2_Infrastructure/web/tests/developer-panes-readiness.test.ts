/**
 * The launch-readiness ladder, and the two states it used to merge.
 *
 * The panel reported "3/5 PASS — BLOCKED" with the gateway unreachable
 * (ECONNREFUSED) and the schema gate reading "Drift detected — the live
 * gateway OpenAPI contract differs from the committed contract". Nothing had
 * read that contract: `lib/delivery-readiness.ts` holds a comparison for five
 * minutes, so for five minutes after the port stops answering the payload
 * still carries the verdict of the last document anything read. A stale
 * "Drift detected" is a finding with no live document behind it, and the same
 * cache would have replayed "Exact match" just as happily — a promotion-grade
 * pass invented from a dead gateway, which is the worse half of the defect.
 *
 * The second half is the ladder itself. A gate that ran and failed and a gate
 * that could not run are different states, and one summary line called both
 * "blocking launch", so the reader could not tell a defect to chase from
 * evidence to restore.
 *
 * Source-level assertions, and across two files since the console was split:
 * the derivations are `DeveloperStatus`, the panel that counts them is
 * `DeveloperOverview`, and both are read from
 * `tests/helpers/developer-sources`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  payloadValidationState,
  riskParityState,
  schemaGateRows,
} from "../components/developer/DeveloperStatus";
import type { SystemHealthView } from "../lib/use-system-health";
import { functionBody, overview_, status_ } from "./helpers/developer-sources";
import { stripCode } from "./helpers/source-files";

function view(health: unknown): SystemHealthView {
  return { health } as unknown as SystemHealthView;
}

describe("configuration metadata does not impersonate an attestation", () => {
  const pipeline = stripCode(status_.slice(
    status_.indexOf("export const PIPELINE_STAGES"),
    status_.indexOf("export const SCHEMA_GATES"),
  ));
  const schemaGates = stripCode(status_.slice(
    status_.indexOf("export const SCHEMA_GATES"),
    status_.indexOf("export function StatusPill"),
  ));

  it("marks every static pipeline stage unverified while retaining its metadata", () => {
    assert.equal(pipeline.match(/tone:\s*"warn"/g)?.length, 6);
    assert.doesNotMatch(pipeline, /tone:\s*"good"/);
    assert.match(pipeline, /APP_COMMIT/);
    assert.match(pipeline, /IS_VERCEL_DEPLOYMENT/);
    assert.match(pipeline, /APP_DEPLOYMENT_ENV/);
    assert.match(pipeline, /run unverified/);
  });

  it("keeps only comparison identity in the static rows", () => {
    assert.equal(schemaGates.match(/id:\s*"/g)?.length, 5);
    assert.doesNotMatch(schemaGates, /impact:|tone:|unmeasured:|Configured; unverified/);
    assert.doesNotMatch(schemaGates, /Production schema/, "the live OpenAPI comparison was counted twice");
    assert.match(schemaGates, /Gateway payloads[\s\S]*Canonical fixtures[\s\S]*Web validators/);
  });
});

describe("schema rows report only evidence the health payload carries", () => {
  const schemaMatch = {
    kind: "gateway_openapi" as const,
    state: "match" as const,
    passed: true,
    algorithm: "sha256" as const,
    expectedDigest: "a".repeat(64),
    observedDigest: "a".repeat(64),
    detail: "The live contract matches.",
  };
  const numericsMatch = {
    kind: "mc_parity" as const,
    state: "match" as const,
    passed: true,
    algorithm: "sha256" as const,
    expectedDigest: "b".repeat(64),
    observedDigest: "b".repeat(64),
    paths: 10,
    horizonBars: 2,
    detail: "The Node result is byte-exact.",
  };
  const cleanLedger = {
    scope: "gateway-ledger" as const,
    evaluated: 7,
    passed: 7,
    fatal: 0,
    warn: 0,
    drift: 0,
    notEvaluated: 0,
    windowStart: "2026-09-01T00:00:00.000Z",
    lastValidationAt: "2026-09-01T00:01:00.000Z",
    retained: 7,
    capacity: null,
    byCapability: {},
    byProvider: {},
  };

  it("maps live evidence without lending it to configured cross-runtime comparisons", () => {
    const rows = schemaGateRows(view({
      platform: {},
      validation: cleanLedger,
      delivery: { schema: schemaMatch, numerics: numericsMatch },
    }));
    assert.deepEqual(rows.map((row) => row.id), [
      "gateway-openapi",
      "gateway-payloads",
      "runtime-payloads",
      "risk-parity",
      "mc-parity",
    ]);
    const states = Object.fromEntries(rows.map((row) => [row.id, row.state]));
    assert.equal(states["gateway-openapi"].label, "Exact match");
    assert.equal(states["gateway-openapi"].tone, "good");
    assert.equal(states["gateway-payloads"].label, "Unverified");
    assert.equal(states["gateway-payloads"].unmeasured, true);
    assert.match(states["gateway-payloads"].detail, /No live cross-runtime result/);
    assert.equal(states["runtime-payloads"].label, "Clean");
    assert.equal(states["runtime-payloads"].tone, "good");
    assert.equal(states["risk-parity"].label, "Unverified");
    assert.equal(states["risk-parity"].unmeasured, true);
    assert.equal(states["mc-parity"].label, "Byte-exact");
    assert.equal(states["mc-parity"].tone, "good");
  });

  it("propagates measured contract and parity failures instead of softening them to unverified", () => {
    const rows = schemaGateRows(view({
      platform: {},
      validation: { ...cleanLedger, passed: 6, fatal: 1 },
      delivery: {
        schema: { ...schemaMatch, state: "mismatch", passed: false, observedDigest: "c".repeat(64) },
        numerics: { ...numericsMatch, state: "mismatch", passed: false, observedDigest: "d".repeat(64) },
      },
    }));
    const states = Object.fromEntries(rows.map((row) => [row.id, row.state]));
    assert.equal(states["gateway-openapi"].tone, "bad");
    assert.equal(states["gateway-payloads"].unmeasured, true);
    assert.equal(states["runtime-payloads"].tone, "bad");
    assert.equal(states["risk-parity"].unmeasured, true);
    assert.equal(states["mc-parity"].tone, "bad");
  });

  it("does not turn an absent or empty payload ledger into a clean result", () => {
    const absent = payloadValidationState(view({}));
    assert.equal(absent.label, "Unverified");
    assert.equal(absent.unmeasured, true);

    const empty = payloadValidationState(view({ validation: { ...cleanLedger, evaluated: 0, passed: 0 } }));
    assert.equal(empty.label, "Unverified");
    assert.equal(empty.unmeasured, true);
    assert.match(empty.detail, /zero evidence is not a clean contract result/);
  });

  it("keeps non-fatal findings visible and fatal findings blocking", () => {
    const warning = payloadValidationState(view({ validation: { ...cleanLedger, warn: 2 } }));
    assert.equal(warning.label, "Warnings / drift");
    assert.equal(warning.tone, "warn");
    assert.equal(warning.unmeasured, undefined);
    assert.match(warning.detail, /2 warn/);

    const partial = payloadValidationState(view({ validation: { ...cleanLedger, notEvaluated: 3 } }));
    assert.equal(partial.label, "Partial coverage");
    assert.equal(partial.tone, "warn");

    const fatal = payloadValidationState(view({ validation: { ...cleanLedger, passed: 6, fatal: 1 } }));
    assert.equal(fatal.label, "Fatal findings");
    assert.equal(fatal.tone, "bad");
  });

  it("states why the unrelated risk-parity comparison remains unverified", () => {
    const state = riskParityState();
    assert.equal(state.unmeasured, true);
    assert.match(state.detail, /no cross-language risk-parity result/);
  });
});

describe("a readiness gate that could not run is not a gate that failed", () => {
  // The derivations are `DeveloperStatus` — the one place the ladder is
  // spelled — and the panel that counts them is `DeveloperOverview`. Two files
  // now, one claim: a state that carries no reading is `unmeasured`, and the
  // ladder reports it as neither a pass nor a failure.
  const schema = stripCode(functionBody(status_, "schemaCompatibilityState"));
  const overview = stripCode(functionBody(overview_, "DeveloperOverview"));

  it("refuses a live-contract verdict when the gateway did not answer this poll", () => {
    // `platform` is set only from a gateway snapshot this poll returned, so its
    // absence is the one fact that says no live document could have been read.
    assert.match(schema, /!view\.health\.platform && evidence\.state !== "unavailable"/);
    assert.match(schema, /Nothing read the live contract this poll/);
    // The refusal keeps the earlier reading as history rather than deleting it,
    // and marks itself unmeasured so the ladder cannot score it either way.
    assert.match(schema, /an earlier reading found \$\{earlier\}/);
    assert.match(schema, /label: "Unverified", detail, tone: "warn", unmeasured: true/);
  });

  it("still separates a verified difference from an unverifiable one", () => {
    // Drift stays a hard finding when the gateway did answer: the point is not
    // to soften the word, it is to earn it.
    assert.match(schema, /evidence\.state === "mismatch"\) return \{ label: "Drift detected"/);
    assert.match(schema, /evidence\.state === "match"\) return \{ label: "Exact match"/);
  });

  it("counts three verdicts, and calls only the failures blocking", () => {
    assert.match(overview, /const failedChecks = readinessChecks\.filter\(\(check\) => check\.state === "failed"\)/);
    assert.match(overview, /const unverifiedChecks = readinessChecks\.filter\(\(check\) => check\.state === "unverified"\)/);
    assert.doesNotMatch(overview, /blockedChecks/, "the old two-state split is back");
    assert.doesNotMatch(overview, /passed:/, "a readiness check still carries a boolean pass");
    // READY needs every gate; BLOCKED needs a failure; anything else is neither.
    assert.match(overview, /failedChecks\.length \? "BLOCKED" : "UNVERIFIED"/);
    assert.match(overview, /are"\} blocking launch/);
    assert.match(overview, /could not be checked at all/);
    assert.match(overview, /neither a pass nor a failure/);
  });

  it("tells the three states apart with marks, not with one colour", () => {
    // `.developer-cp-readiness__checks i` styles `is-good` and `is-warn` only,
    // so a failure and an unrun check share a dot; the glyph is what separates
    // them, and forced-colors strips the fill before it strips the glyph.
    assert.match(overview, /check\.state === "pass" \? "✓" : check\.state === "failed" \? "✕" : "◌"/);
    assert.doesNotMatch(overview, /\? "✓" : "!"/, "the exclamation mark is back in the status vocabulary");
    assert.match(overview, /readiness checks pass, \$\{failedChecks\.length\} failed, \$\{unverifiedChecks\.length\} could not be checked/);
  });

  it("reports a gate with nothing behind it as unmeasured, per source", () => {
    /**
     * Which states are measurements and which are absences, stated once here so
     * a later edit has to argue with it: a refused connection is a measurement
     * (the gate ran, the gateway is not healthy); an unconfigured gateway, an
     * unpinned signing key and a build that is not a deployment are absences.
     */
    const gateway = stripCode(functionBody(status_, "gatewayState"));
    const artifact = stripCode(functionBody(status_, "artifactCustodyState"));
    assert.match(gateway, /tone: off \? "off" : "warn", unmeasured: off/);
    assert.match(artifact, /"untrusted"\) return \{ label: "No trust root", detail: evidence\.detail, tone: "warn", unmeasured: true/);
    assert.match(artifact, /"invalid"\) return \{ label: "Invalid", detail: evidence\.detail, tone: "bad" \}/);
    assert.match(overview, /IS_VERCEL_DEPLOYMENT \? gateVerdict\(currentWorkspace\) : "unverified"/);
    assert.match(overview, /there is no promotion candidate to check/);
  });
});
