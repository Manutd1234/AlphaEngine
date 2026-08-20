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
    /**
     * Re-anchored when `lib/providers/runtime.ts` was split: the pair moved to
     * `contract-gate.ts` and this scan would otherwise have gone on reading a
     * re-export barrel, matching nothing and proving nothing. The second
     * assertion is the anti-vacuity guard — the pair is worthless if the
     * dispatch loop stopped calling it.
     */
    const gate = read("lib/providers/contract-gate.ts");
    assert.match(gate, /export function recordContractFinding\(/, "the scan is reading the wrong file");
    assert.match(gate, /validationTelemetry\.record\(contract\);\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*queueContractFinding\(/);
    assert.match(read("lib/providers/dispatch.ts"), /recordContractFinding\(contract, \{/,
      "the local record and the queued finding are only paired if dispatch calls them");
  });

  it("the ledger panel renders its own absence and says what it does not prove", () => {
    const panel = read("components/data/DataQualityLedger.tsx");
    // Both halves of the claim, after a copy-reduction pass folded them into one
    // sentence: the ledger is missing, and the fallback counts are this
    // instance's window rather than the fleet's history.
    assert.ok(panel.includes("The gateway did not return its quality ledger"));
    assert.ok(panel.includes("say nothing about other instances or earlier hours"));
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

/**
 * E2.7's gate, which landed one layer down from where it was asked for.
 *
 * The Take button rendered on `!resolved_at && !acknowledged_at && !taken[id]`
 * and never asked whether this tab could act, so a reader with no credential
 * was shown a live control and learned it was refused only after clicking. The
 * gate belongs beside the button as well as in the route — and it gates on
 * `operatorReady`, not on the token, because an open demo deployment accepts
 * the acknowledgement with no header and a button withheld there would be
 * refusing an action that works.
 */
describe("taking an escalation is offered only where it would be accepted", () => {
  const panel = read("components/data/DataQualityLedger.tsx");
  const console_ = read("components/DataConsole.tsx");

  it("the panel takes the same two gate props every other gated control takes", () => {
    assert.match(panel, /guard: GuardMode;/);
    assert.match(panel, /operatorReady: boolean;/);
    assert.match(panel, /const locked = guard === "locked" \|\| !operatorReady;/);
  });

  it("the Data console hands it the guard and the readiness, not just the token", () => {
    assert.match(
      console_,
      /<DataQualityLedger[^>]*guard=\{guard\}[^>]*operatorReady=\{operatorReady\}/,
      "the gate cannot be decided from the token alone — open-demo accepts an unheaded ack",
    );
  });

  it("the button is disabled rather than dropped, and carries the reason", () => {
    assert.match(panel, /disabled=\{locked \|\| acking === e\.id\}/);
    assert.match(panel, /title=\{lockNote\}/);
    assert.doesNotMatch(
      panel,
      /\{!e\.resolved_at && !e\.acknowledged_at && !taken\[e\.id\] && operatorReady/,
      "the row still says a Take exists; only its availability changes",
    );
  });

  it("the refusal is on screen, not only in a tooltip, and names both causes", () => {
    assert.match(panel, /<p className="console-note">\{lockNote\}<\/p>/);
    assert.ok(panel.includes("operator actions are switched off on this deployment"));
    assert.ok(panel.includes("Enter the operator token in Reliability"));
    // Shortened from "acknowledge from Telegram with /ack" in a copy-reduction
    // pass; the escape hatch it names is what this assertion is about.
    assert.ok(
      panel.includes("/ack from Telegram"),
      "an unavailable action says what still works",
    );
  });

  it("shows the note only where a Take button would have been", () => {
    assert.match(panel, /const takeable = ledger\?\.escalations\.filter\(/);
    assert.match(panel, /\{lockNote && takeable\.length > 0 && \(/);
  });
});

