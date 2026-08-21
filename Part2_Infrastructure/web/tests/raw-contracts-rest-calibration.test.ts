/**
 * The calibration rule: severity is earned by a committed body, not assumed.
 *
 * This is the important half of the raw-predicate work. The six keyed
 * providers have no committed fixture — every key in the deployment is
 * Sensitive in Vercel, so no machine that can run the capture can read the
 * credential — and a predicate that has never seen a real body must not be
 * able to fail a healthy response over.
 *
 * So: uncalibrated providers report `warn`, calibrated ones may report
 * `fatal`, and that is asserted rather than left to whoever writes the next
 * predicate. The membership of `RAW_CALIBRATED` is derived from the
 * filesystem rather than pinned as a literal list, so a provider promoted
 * without a capture and a capture added without the promotion both show up.
 *
 * The last describe is where the rule cashes out. `warn` is only a safe
 * default if a warn genuinely cannot fail a request, so that arithmetic is
 * pinned against `evaluateContract` itself rather than against a comment
 * claiming it.
 *
 * Siblings: `-predicates` (each predicate fires on the break it names),
 * `-fixtures` (the predicates measured against real captured bodies),
 * `-healthy-bodies` (the one-sided claim that no predicate rejects good data).
 */

import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { evaluateContract } from "../lib/providers/contract-gate";
import { checkRawBody, RAW_CHECKED } from "../lib/providers/raw-contract-check";
import { RAW_CALIBRATED, rawSeverity } from "../lib/providers/raw-contracts-rest";
import { RAW_FIXTURE_ROOT } from "./helpers/raw-fixtures";

describe("severity is earned, not assumed", () => {
  it("only providers with a committed fixture may raise fatal", () => {
    for (const provider of RAW_CHECKED) {
      const severity = rawSeverity(provider);
      if (RAW_CALIBRATED.has(provider)) continue;
      assert.equal(severity, "warn", `${provider} has no capture and must not be able to fail a response over`);
    }
  });

  it("a provider is calibrated only if a HEALTHY body is committed for it", () => {
    // Derived from the filesystem, not asserted as a literal list. A provider
    // promoted without a capture fails here, and a capture added without the
    // promotion shows up as the reverse — which is the drift a hard-coded pair
    // of names could not catch in either direction.
    //
    // A `unauthenticated.json` does NOT count. It is the vendor's refusal, and
    // calibration is the claim that the predicate has been held to a body from
    // a working call: the requirement is that it does not fire on good data.
    // The tree moved one directory further from this suite when the fixtures
    // helper was extracted, so the path is imported rather than spelled again.
    // A tree that resolved to nothing would make the comparison below a
    // comparison of two empty lists, which passes — hence the floor.
    const root = RAW_FIXTURE_ROOT;
    const providers = readdirSync(root);
    assert.ok(providers.length > 0, `no capture directories under ${root}; this check is scanning nothing`);
    const withHealthyBody = providers
      .filter((provider) => statSync(join(root, provider)).isDirectory())
      .filter((provider) => readdirSync(join(root, provider))
        .some((f) => f.endsWith(".json") && f !== "unauthenticated.json"))
      .sort();
    assert.ok(withHealthyBody.length > 0, "no provider has a healthy capture; the fixture tree read as empty");
    assert.deepEqual([...RAW_CALIBRATED].sort(), withHealthyBody);
  });
});

describe("an unknown provider is not silently passed", () => {
  it("returns null rather than an empty pass", () => {
    assert.equal(checkRawBody("nonesuch", "bars", []), null);
  });
});

describe("every checked provider has a predicate", () => {
  it("RAW_CHECKED and the dispatcher agree", () => {
    for (const provider of RAW_CHECKED) {
      assert.notEqual(
        checkRawBody(provider, "bars", {}), null,
        `${provider} is listed as checked but the dispatcher returns null`,
      );
    }
  });
});

describe("a warn cannot fail a request, and that is the gate's arithmetic", () => {
  /**
   * Asserted against the gate itself, not against a comment.
   *
   * `evaluateContract` is what decides whether a raw violation fails a
   * provider: `passed` is recomputed as the normaliser's verdict AND no fatal
   * raw violation. An uncalibrated provider's `warn` therefore travels with
   * the provenance and never trips failover — the claim the whole `warn`
   * default rests on, and the reason it is pinned here rather than assumed.
   */
  it("a warn-only raw violation leaves an otherwise passing contract passing", () => {
    const evaluated = evaluateContract(
      () => ({ provider: "tiingo", capability: "news", passed: true, violations: [], notEvaluated: [] }),
      [],
      "tiingo",
      "news",
      { violations: [{ check: "raw.tiingo.news-fields", severity: "warn", message: "m" }], body: [], seen: true },
    );
    assert.equal(evaluated?.passed, true, "a warn must not fail the contract");
    assert.equal(evaluated?.violations.length, 1, "and must still be reported");
  });

  it("a fatal raw violation fails a contract the normaliser was happy with", () => {
    const evaluated = evaluateContract(
      () => ({ provider: "binance", capability: "bars", passed: true, violations: [], notEvaluated: [] }),
      [],
      "binance",
      "bars",
      { violations: [{ check: "raw.binance.bars.is_array", severity: "fatal", message: "m" }], body: [], seen: true },
    );
    assert.equal(evaluated?.passed, false);
  });
});
