/**
 * The decision loop: five stages, and the rule that a failure never wears the
 * costume of a first load.
 *
 * `deriveDecisionLoop` is the only thing standing between a reader and the
 * oldest defect on this page — a stage that reads "checking…" forever because
 * the poll it is waiting for died on the first attempt and nothing distinguishes
 * "no answer yet" from "no answer ever". `idle` is a claim about time, not
 * about ignorance, so it is only allowed while nothing has failed. Once a probe
 * has returned an error the stage must say what failed, by name.
 *
 * The rest is precedence. A stage has one state and several inputs that could
 * each set it, so the order they are resolved in IS the behaviour: running
 * beats stale beats verdict; a full halt is `halted` and a symbol-scoped one is
 * only `attention`; a sandbox book is labelled rather than alarmed; a failed
 * poll flags its own stage without poisoning the four beside it.
 *
 * These are behavioural — the module is pure, so every claim below is the
 * function's own output rather than a scan of the component that renders it.
 *
 * Siblings, from the same module: `-kill-switch` (the arming gate),
 * `-network-latency` (the polled upstream plane), `-decision-plane` (the
 * in-process microsecond plane).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type DecisionLoopInputs,
  deriveDecisionLoop,
} from "../lib/overview-state";

const CLEAR: DecisionLoopInputs = {
  healthPresent: true,
  healthError: false,
  degradedCount: 0,
  capabilitiesDown: 0,
  quarantineSize: 0,
  providersReady: 7,
  providersTotal: 8,
  running: false,
  researchStale: false,
  verdictLevel: "pass",
  bookPresent: true,
  bookSandbox: false,
  bookStale: false,
  bookConnection: "live",
  bookErrorCode: null,
  riskUtilisation: 0.2,
  bindingConstraint: "gross_exposure",
  varZone: "green",
  tradingHalted: false,
  haltedSymbolCount: 0,
  fillRate: null,
};

const stage = (inputs: DecisionLoopInputs, id: string) => {
  const found = deriveDecisionLoop(inputs).find((s) => s.id === id);
  assert.ok(found, `stage ${id} missing`);
  return found!;
};

describe("failure is distinguishable from loading", () => {
  it("a health poll that never succeeded reads unreachable, not checking", () => {
    const s = stage({ ...CLEAR, healthPresent: false, healthError: true }, "data");
    assert.equal(s.state, "attention");
    assert.match(s.detail, /unreachable/);
  });

  it("the very first health fetch still reads as checking", () => {
    const s = stage({ ...CLEAR, healthPresent: false, healthError: false }, "data");
    assert.equal(s.state, "idle");
  });

  it("a failing gateway probe names its failure on risk and execution", () => {
    const failing = {
      ...CLEAR,
      bookPresent: false,
      bookConnection: "error" as const,
      bookErrorCode: "gateway_misconfigured",
    };
    assert.match(stage(failing, "risk").detail, /misconfigured/);
    assert.equal(stage(failing, "risk").state, "attention");
    assert.match(
      stage({ ...failing, bookErrorCode: null }, "execution").detail,
      /unreachable/,
    );
  });

  it("the first gateway probe, with no verdict yet, still reads connecting", () => {
    const probing = { ...CLEAR, bookPresent: false, bookConnection: null, bookErrorCode: null };
    assert.equal(stage(probing, "risk").state, "idle");
    assert.equal(stage(probing, "execution").state, "idle");
  });
});

describe("deriveDecisionLoop", () => {
  it("all-clear inputs derive ok across the loop", () => {
    for (const s of deriveDecisionLoop(CLEAR)) {
      assert.equal(s.state, "ok", `${s.id} was ${s.state}: ${s.detail}`);
    }
  });

  it("a full halt puts execution in halted and risk in attention", () => {
    const inputs = { ...CLEAR, tradingHalted: true, fillRate: 0.99 };
    assert.equal(stage(inputs, "execution").state, "halted");
    assert.equal(stage(inputs, "risk").state, "attention");
  });

  it("a symbol-scoped halt is attention, not halted", () => {
    const inputs = { ...CLEAR, haltedSymbolCount: 2 };
    const exec = stage(inputs, "execution");
    assert.equal(exec.state, "attention");
    assert.ok(exec.detail.includes("2 symbols"));
  });

  it("research: running beats stale beats verdict; no run is idle, not attention", () => {
    assert.equal(stage({ ...CLEAR, running: true, researchStale: true }, "research").state, "active");
    assert.equal(stage({ ...CLEAR, researchStale: true }, "research").state, "attention");
    assert.equal(stage({ ...CLEAR, verdictLevel: "marginal" }, "research").state, "attention");
    assert.equal(stage({ ...CLEAR, verdictLevel: "fail" }, "research").state, "attention");
    assert.equal(stage({ ...CLEAR, verdictLevel: null }, "research").state, "idle");
  });

  it("data: quarantine, capability loss and degradation each raise attention", () => {
    assert.equal(stage({ ...CLEAR, quarantineSize: 3 }, "data").state, "attention");
    assert.equal(stage({ ...CLEAR, capabilitiesDown: 1 }, "data").state, "attention");
    assert.equal(stage({ ...CLEAR, degradedCount: 2 }, "data").state, "attention");
    assert.equal(stage({ ...CLEAR, healthPresent: false }, "data").state, "idle");
  });

  it("a failed poll with a retained snapshot flags data but keeps deriving the rest", () => {
    const inputs = { ...CLEAR, healthError: true };
    assert.equal(stage(inputs, "data").state, "attention");
    assert.equal(stage(inputs, "research").state, "ok");
  });

  it("risk utilisation bands match the workspace thresholds", () => {
    assert.equal(stage({ ...CLEAR, riskUtilisation: 0.69 }, "risk").state, "ok");
    assert.equal(stage({ ...CLEAR, riskUtilisation: 0.7 }, "risk").state, "attention");
    assert.equal(stage({ ...CLEAR, riskUtilisation: 0.9 }, "risk").state, "attention");
    assert.equal(stage({ ...CLEAR, varZone: "red", riskUtilisation: 0.1 }, "risk").state, "attention");
    assert.equal(stage({ ...CLEAR, varZone: "yellow", riskUtilisation: 0.1 }, "risk").state, "attention");
  });

  it("a sandbox book is labelled, never halted", () => {
    const inputs = { ...CLEAR, bookSandbox: true };
    const risk = stage(inputs, "risk");
    const exec = stage(inputs, "execution");
    assert.equal(risk.state, "ok");
    assert.ok(risk.detail.includes("sandbox"));
    assert.equal(exec.state, "ok");
    assert.ok(exec.detail.includes("sandbox"));
  });

  it("a stale book disables risk confidence", () => {
    assert.equal(stage({ ...CLEAR, bookStale: true }, "risk").state, "attention");
    assert.equal(stage({ ...CLEAR, bookPresent: false }, "risk").state, "idle");
  });
});
