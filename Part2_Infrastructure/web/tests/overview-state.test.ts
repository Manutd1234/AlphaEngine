import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LATENCY_BAD_MS,
  LATENCY_HISTORY_CAP,
  LATENCY_MIN_SAMPLES,
  LATENCY_WARN_MS,
  type DecisionLoopInputs,
  type LatencyHistoryPoint,
  appendLatencyHistory,
  deriveDecisionLoop,
  downsample,
  formatLatencyChip,
  killSwitchGate,
  latencyTone,
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

describe("latencyTone", () => {
  it("small samples are muted regardless of the number", () => {
    assert.equal(latencyTone(5000, LATENCY_MIN_SAMPLES - 1).tone, "muted");
    assert.equal(latencyTone(null, 500).tone, "muted");
    assert.equal(latencyTone(50, 0).tone, "muted");
  });

  it("thresholds sit exactly at the documented boundaries", () => {
    assert.equal(latencyTone(LATENCY_WARN_MS - 1, LATENCY_MIN_SAMPLES).tone, "good");
    assert.equal(latencyTone(LATENCY_WARN_MS, LATENCY_MIN_SAMPLES).tone, "warn");
    assert.equal(latencyTone(LATENCY_BAD_MS - 1, LATENCY_MIN_SAMPLES).tone, "warn");
    assert.equal(latencyTone(LATENCY_BAD_MS, LATENCY_MIN_SAMPLES).tone, "bad");
  });

  it("error rate escalates the tone independently of speed", () => {
    assert.equal(latencyTone(100, 50, 0.06).tone, "warn");
    assert.equal(latencyTone(100, 50, 0.25).tone, "bad");
  });

  it("chip copy carries the honesty caveat", () => {
    const warm = formatLatencyChip({ p99: 120, n: 5, errorRate: 0 });
    assert.equal(warm.value, "p99 —");
    assert.ok(warm.caveat.includes("n=5"));
    const hot = formatLatencyChip({ p99: 321.4, n: 80, errorRate: 0.1 });
    assert.equal(hot.value, "p99 321ms");
    assert.ok(hot.caveat.includes("15-minute window"));
    assert.ok(hot.caveat.includes("n=80"));
  });
});

describe("killSwitchGate", () => {
  const base = {
    typed: "",
    halted: false,
    guard: "open-dev" as const,
    token: "",
    gatewayConnected: true,
    busy: false,
  };

  it("the typed word is the arm, with the route's normalisation", () => {
    assert.equal(killSwitchGate({ ...base, typed: " halt " }).armed, true);
    assert.equal(killSwitchGate({ ...base, typed: "HALT" }).canFire, true);
    assert.equal(killSwitchGate({ ...base, typed: "RESUME" }).armed, false);
    assert.ok(killSwitchGate(base).blockedReason?.includes("HALT"));
  });

  it("the word flips to RESUME when already halted", () => {
    const gate = killSwitchGate({ ...base, halted: true, typed: "RESUME" });
    assert.equal(gate.action, "resume");
    assert.equal(gate.confirmWord, "RESUME");
    assert.equal(gate.canFire, true);
    assert.equal(killSwitchGate({ ...base, halted: true, typed: "HALT" }).armed, false);
  });

  it("blocked reasons are ordered: gateway, locked, token, arm", () => {
    assert.ok(killSwitchGate({ ...base, gatewayConnected: false, typed: "HALT" }).blockedReason?.includes("gateway"));
    assert.ok(killSwitchGate({ ...base, guard: "locked", typed: "HALT" }).blockedReason?.includes("disabled"));
    assert.ok(killSwitchGate({ ...base, guard: "token", typed: "HALT" }).blockedReason?.includes("token"));
    assert.equal(killSwitchGate({ ...base, guard: "token", token: "s3cret", typed: "HALT" }).canFire, true);
  });

  it("busy blocks firing without inventing a reason", () => {
    const gate = killSwitchGate({ ...base, typed: "HALT", busy: true });
    assert.equal(gate.armed, true);
    assert.equal(gate.canFire, false);
    assert.equal(gate.blockedReason, null);
  });

  it("an unprobed gateway (null) does not block on connectivity", () => {
    assert.equal(killSwitchGate({ ...base, gatewayConnected: null, typed: "HALT" }).canFire, true);
  });
});

describe("appendLatencyHistory", () => {
  const point = (t: number, lastAt: number | null, n = 40): LatencyHistoryPoint => ({
    t,
    p99: 100 + t,
    errorRate: 0,
    n,
    lastAt,
  });

  it("appends fresh observations and caps at the ring size", () => {
    let history: LatencyHistoryPoint[] = [];
    for (let k = 0; k < LATENCY_HISTORY_CAP + 10; k++) {
      history = appendLatencyHistory(history, point(k, k));
    }
    assert.equal(history.length, LATENCY_HISTORY_CAP);
    assert.equal(history[history.length - 1].t, LATENCY_HISTORY_CAP + 9);
    assert.equal(history[0].t, 10, "oldest entries dropped first");
  });

  it("skips empty windows and unchanged lastAt", () => {
    const seeded = appendLatencyHistory([], point(1, 1000));
    assert.equal(appendLatencyHistory(seeded, point(2, 1000)).length, 1, "same lastAt must not append");
    assert.equal(appendLatencyHistory(seeded, point(2, 2000, 0)).length, 1, "n=0 must not append");
    assert.equal(appendLatencyHistory(seeded, point(2, 2000)).length, 2);
  });

  it("never mutates its input", () => {
    const original = [point(1, 1000)];
    const copy = [...original];
    appendLatencyHistory(original, point(2, 2000));
    assert.deepEqual(original, copy);
  });
});

describe("downsample", () => {
  it("preserves first and last and bounds the length", () => {
    const values = Array.from({ length: 500 }, (_, k) => k);
    const out = downsample(values, 64);
    assert.equal(out.length, 64);
    assert.equal(out[0], 0);
    assert.equal(out[out.length - 1], 499);
  });

  it("is the identity for short inputs", () => {
    assert.deepEqual(downsample([1, 2, 3], 64), [1, 2, 3]);
    assert.deepEqual(downsample([], 64), []);
  });
});
