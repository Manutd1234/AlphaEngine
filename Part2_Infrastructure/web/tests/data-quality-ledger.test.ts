/**
 * The gateway ledger, projected: shape guard and the validation block.
 *
 * The Data tab renders one `validation` block whichever scope fed it, so the
 * projection must keep the meanings straight — a retention window is not a
 * ring buffer (capacity null), a provider with nothing evaluated has no fail
 * rate (null, never 0), and the scope word says whose numbers these are.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { isDataQualityView, ledgerValidation, type DataQualityViewWire } from "../lib/data-quality-ledger";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

const wire = (over: Partial<DataQualityViewWire> = {}): DataQualityViewWire => ({
  backend: "sqlite",
  retention_days: 7,
  window_minutes: 1440,
  observed_at: "2026-08-17T10:00:00.000Z",
  first_observed_at: "2026-08-17T08:00:00.000Z",
  last_observed_at: "2026-08-17T09:59:00.000Z",
  instances: 3,
  total: { evaluated: 10, passed: 8, fatal: 2, warn: 3, drift: 1, not_evaluated: 4 },
  by_provider: [
    { provider: "fmp", evaluated: 6, passed: 4, fatal: 2, warn: 1, drift: 0, not_evaluated: 2, fail_rate: 1 / 3 },
    { provider: "openbb", evaluated: 4, passed: 4, fatal: 0, warn: 2, drift: 1, not_evaluated: 2, fail_rate: 0 },
  ],
  by_capability: [{ capability: "quote", evaluated: 10, passed: 8, fatal: 2, warn: 3, drift: 1, not_evaluated: 4 }],
  recent: [],
  escalations: [],
  ...over,
});

describe("isDataQualityView", () => {
  it("accepts the gateway's shape and refuses anything else", () => {
    assert.equal(isDataQualityView(wire()), true);
    assert.equal(isDataQualityView(undefined), false, "an older gateway omits the block");
    assert.equal(isDataQualityView({ ...wire(), backend: "postgres" }), false);
    assert.equal(isDataQualityView({ ...wire(), total: { evaluated: "10" } }), false);
    assert.equal(isDataQualityView({ ...wire(), escalations: null }), false);
  });
});

describe("ledgerValidation", () => {
  it("projects the ledger into the validation block with the ledger scope", () => {
    const v = ledgerValidation(wire());
    assert.equal(v.scope, "gateway-ledger");
    assert.equal(v.evaluated, 10);
    assert.equal(v.notEvaluated, 4);
    assert.equal(v.retained, 10);
    assert.equal(v.capacity, null, "a retention window is not a ring buffer");
    assert.equal(v.windowStart, "2026-08-17T08:00:00.000Z");
    assert.equal(v.byProvider.fmp.fatal, 2);
    assert.equal(v.byCapability.quote?.evaluated, 10);
    assert.equal(v.ledger?.retentionDays, 7);
    assert.equal(v.ledger?.instances, 3);
  });

  it("keeps a null fail rate null — never coerced to zero", () => {
    const v = ledgerValidation(wire({
      by_provider: [{ provider: "tiingo", evaluated: 0, passed: 0, fatal: 0, warn: 0, drift: 0, not_evaluated: 0, fail_rate: null }],
    }));
    assert.equal(v.ledger?.byProviderFailRate.tiingo, null);
  });
});

describe("the health snapshot and the panels say whose numbers these are", () => {
  it("the snapshot prefers the fresh ledger and falls back to the instance window", () => {
    const snapshot = read("lib/system-health-snapshot.ts");
    assert.match(snapshot, /const sharedLedger = sharedDataQuality\(\);/);
    assert.match(snapshot, /validation: sharedLedger \? ledgerValidation\(sharedLedger\) : validationTelemetry\.snapshot\(\)/);
  });

  it("dispatch queues the same finding it records locally", () => {
    const runtime = read("lib/providers/runtime.ts");
    assert.match(runtime, /validationTelemetry\.record\(contract\);\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*queueContractFinding\(/);
  });

  it("the ledger panel renders its own absence and says what it does not prove", () => {
    const panel = read("components/data/DataQualityLedger.tsx");
    assert.ok(panel.includes("The gateway did not return its quality ledger on the last sync"));
    assert.ok(panel.includes("says nothing about what other instances or earlier hours recorded"));
    assert.ok(panel.includes("not that every payload was clean"));
    assert.match(panel, /probeGateway</, "older findings are read with the gateway deadline");
    assert.doesNotMatch(panel, /return null;/, "the panel never disappears");
  });

  it("the quarantine copy is keyed on the scope word", () => {
    const quarantine = read("components/systems/QuarantinePanel.tsx");
    assert.match(quarantine, /validation\?\.scope === "gateway-ledger"/);
    assert.ok(quarantine.includes("ledger persisted on the gateway"));
  });
});
