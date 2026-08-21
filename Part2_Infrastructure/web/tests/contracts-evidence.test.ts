/**
 * What a contract check leaves behind — the quarantine and the telemetry.
 *
 * A rejection nobody can inspect is indistinguishable from a bug in the
 * checker, and that is how a good check gets loosened by whoever is on call at
 * the time. So a rejected payload is kept where someone can look at it, and the
 * evidence obeys two rules that are as load-bearing as the checks themselves.
 *
 *  - It is redacted. A credential echoed in a vendor's error body must not be
 *    stored by the very thing meant to help debug it.
 *  - It is bounded. A diagnostic buffer is not a data lake, and neither the
 *    quarantine nor the telemetry window may grow without limit.
 *
 * The telemetry adds a third: a check that could not run is counted as *not
 * evaluated*, never as passed. Fold those together and the least transparent
 * vendor scores best, which inverts the whole point of measuring.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkBars,
  checkQuote,
  FRESHNESS_LIMIT_MS,
  VALIDATION_TELEMETRY_CAPACITY,
  validationTelemetry,
} from "../lib/providers/contracts";
import { quarantine, quarantinePayload } from "../lib/providers/quarantine";

import { NOW, quote } from "./helpers/contract-fixtures";

describe("suspect payloads are kept where someone can look at them", () => {
  it("stores the violations and a redacted excerpt", () => {
    quarantine.clear();
    const result = checkQuote("fmp", quote({ price: -1 }), NOW);
    const record = quarantinePayload(result, "quote:BTCUSDT:*", quote({ price: -1 }),
      (text) => text.replace(/67500/g, "[redacted]"));

    assert.equal(record.rejected, true);
    assert.equal(record.provider, "fmp");
    assert.ok(record.violations.length);
    // The redactor runs on the sample, so a credential echoed in a vendor's
    // error body cannot be stored by the thing meant to help debug it.
    assert.ok(!record.sample.includes("67500"));
  });

  it("is bounded, because a diagnostic buffer is not a data lake", () => {
    quarantine.clear();
    const result = checkQuote("fmp", quote({ price: -1 }), NOW);
    for (let i = 0; i < 120; i++) quarantinePayload(result, `key-${i}`, { i });
    assert.ok(quarantine.size <= 50);
    // Newest first, and the oldest are the ones dropped.
    assert.equal(quarantine.list(1)[0].key, "key-119");
  });

  it("counts records per provider for the console summary", () => {
    quarantine.clear();
    quarantinePayload(checkQuote("fmp", quote({ price: -1 }), NOW), "a", {});
    quarantinePayload(checkQuote("fmp", quote({ change: null }), NOW), "b", {});
    quarantinePayload(checkQuote("tiingo", quote({ price: -1 }), NOW), "c", {});

    const summary = quarantine.byProvider();
    const fmp = summary.find((s) => s.provider === "fmp")!;
    assert.equal(fmp.records, 2);
    // Only one of the two was fatal; a drift warning is not a rejection.
    assert.equal(fmp.rejected, 1);
  });
});

describe("validation evidence is explicit, scoped, and bounded", () => {
  it("counts payload outcomes separately from individual findings", () => {
    validationTelemetry.clear();
    const firstAt = NOW - 1_000;
    const lastAt = NOW;

    validationTelemetry.record(checkQuote("warning-vendor", quote({
      asOf: new Date(NOW - FRESHNESS_LIMIT_MS - 1).toISOString(),
      change: null,
    }), NOW), firstAt);
    validationTelemetry.record(checkBars("fatal-vendor", [], 100), lastAt);

    const snapshot = validationTelemetry.snapshot();
    assert.equal(snapshot.scope, "per-instance");
    assert.equal(snapshot.evaluated, 2);
    assert.equal(snapshot.passed, 1);
    assert.equal(snapshot.fatal, 1);
    assert.equal(snapshot.warn, 1);
    assert.equal(snapshot.drift, 1);
    assert.equal(snapshot.notEvaluated, 3);
    assert.equal(snapshot.windowStart, new Date(firstAt).toISOString());
    assert.equal(snapshot.lastValidationAt, new Date(lastAt).toISOString());
    assert.equal(snapshot.byCapability.quote?.evaluated, 1);
    assert.equal(snapshot.byCapability.bars?.fatal, 1);
    assert.equal(snapshot.byProvider["warning-vendor"].warn, 1);
    assert.equal(snapshot.byProvider["fatal-vendor"].passed, 0);
  });

  it("retains only the fixed observation window", () => {
    validationTelemetry.clear();
    const result = checkQuote("bounded-vendor", quote(), NOW);
    for (let i = 0; i < VALIDATION_TELEMETRY_CAPACITY + 3; i++) {
      validationTelemetry.record(result, NOW + i);
    }

    const snapshot = validationTelemetry.snapshot();
    assert.equal(snapshot.evaluated, VALIDATION_TELEMETRY_CAPACITY);
    assert.equal(snapshot.retained, VALIDATION_TELEMETRY_CAPACITY);
    assert.equal(snapshot.capacity, VALIDATION_TELEMETRY_CAPACITY);
    assert.equal(snapshot.windowStart, new Date(NOW + 3).toISOString());
  });
});
