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

import { functionBody, overview_, status_ } from "./helpers/developer-sources";
import { stripCode } from "./helpers/source-files";

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
