import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DECISION_BAD_US,
  DECISION_EXPECTED_ENGINE,
  DECISION_MIN_SAMPLES,
  DECISION_P999_MIN_SAMPLES,
  DECISION_WARN_US,
  LATENCY_BAD_MS,
  LATENCY_HISTORY_CAP,
  LATENCY_MIN_SAMPLES,
  LATENCY_WARN_MS,
  type DecisionLoopInputs,
  type LatencyHistoryPoint,
  appendLatencyHistory,
  decisionTone,
  deriveDecisionLatency,
  deriveDecisionLoop,
  downsample,
  formatDecisionChip,
  formatLatencyChip,
  formatNetworkCaveat,
  isDecisionLatency,
  killSwitchGate,
  latencyTone,
} from "../lib/overview-state";
import type { DecisionLatency, SystemHealth } from "../components/systems/types";

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

// ---------------------------------------------------------------------------
// The decision plane
// ---------------------------------------------------------------------------

function measured(overrides: Partial<DecisionLatency> = {}): DecisionLatency {
  return {
    engine: "python",
    samples: 1200,
    p50_us: 24.9,
    p99_us: 34.7,
    p999_us: 54.9,
    max_us: 65.5,
    core_p50_ns: null,
    core_p99_ns: null,
    core_max_ns: null,
    ...overrides,
  };
}

function healthWith(decision: DecisionLatency | null | undefined, gatewayState: "fresh" | "stale" = "fresh") {
  const platform = decision === undefined
    ? ({} as SystemHealth["platform"])
    : ({ decision_latency: decision } as unknown as SystemHealth["platform"]);
  return {
    platform,
    sources: {
      providers: { state: "fresh", observedAt: null, receivedAt: "", ageMs: 0, staleAfterMs: null },
      gateway: { state: gatewayState, observedAt: null, receivedAt: "", ageMs: 0, staleAfterMs: null },
    },
  } as unknown as Pick<SystemHealth, "platform" | "sources">;
}

const NETWORK = { p99: 888, n: 116, errorRate: 0.043 };

describe("decisionTone", () => {
  it("below the sample floor is muted regardless of the number", () => {
    assert.equal(decisionTone(5000, DECISION_MIN_SAMPLES - 1).tone, "muted");
    assert.equal(decisionTone(null, 500).tone, "muted");
    assert.match(decisionTone(30, 3).label, /collecting, n=3/);
  });

  it("thresholds sit exactly at the documented boundaries", () => {
    assert.equal(decisionTone(DECISION_WARN_US - 1, DECISION_MIN_SAMPLES).tone, "good");
    assert.equal(decisionTone(DECISION_WARN_US, DECISION_MIN_SAMPLES).tone, "warn");
    assert.equal(decisionTone(DECISION_BAD_US - 1, DECISION_MIN_SAMPLES).tone, "warn");
    assert.equal(decisionTone(DECISION_BAD_US, DECISION_MIN_SAMPLES).tone, "bad");
  });

  it("the band is the latency budget's band", () => {
    // LATENCY_BUDGET: "achievable 5–500 µs for the decision" — 500 is where
    // "slow" is literally true against the published budget.
    assert.equal(DECISION_BAD_US, 500);
    assert.ok(DECISION_WARN_US < DECISION_BAD_US);
    assert.equal(DECISION_MIN_SAMPLES, LATENCY_MIN_SAMPLES);
    assert.equal(DECISION_P999_MIN_SAMPLES, 1000);
  });
});

describe("deriveDecisionLatency", () => {
  it("no snapshot yet is 'checking'", () => {
    assert.equal(deriveDecisionLatency(null).kind, "checking");
  });

  it("no platform block names the gateway's state", () => {
    const source = deriveDecisionLatency({ platform: undefined, sources: healthWith(null).sources } as never);
    assert.equal(source.kind, "no-gateway");
  });

  it("an older gateway that omits the field is 'not published', not a zero", () => {
    assert.equal(deriveDecisionLatency(healthWith(undefined)).kind, "not-published");
  });

  it("a malformed block is withheld as 'not published'", () => {
    const bad = { engine: "cobol", samples: -1 } as unknown as DecisionLatency;
    assert.equal(isDecisionLatency(bad), false);
    assert.equal(deriveDecisionLatency(healthWith(bad)).kind, "not-published");
  });

  it("null and zero samples are both 'no orders yet'", () => {
    assert.equal(deriveDecisionLatency(healthWith(null)).kind, "no-orders");
    const empty = measured({ samples: 0, p50_us: null, p99_us: null, p999_us: null, max_us: null });
    assert.equal(deriveDecisionLatency(healthWith(empty)).kind, "no-orders");
  });

  it("zero orders with a self-measured core is 'no orders yet' WITH the core figure", () => {
    const selfMeasured = measured({
      engine: "native", samples: 0, p50_us: null, p99_us: null, p999_us: null, max_us: null,
      core_p50_ns: 44, core_p99_ns: 84, core_max_ns: 84, core_self_test_samples: 300,
    });
    const source = deriveDecisionLatency(healthWith(selfMeasured));
    assert.equal(source.kind, "no-orders");
    if (source.kind === "no-orders") {
      assert.ok(source.core, "the core figure rides the no-orders state");
      assert.equal(source.core?.p99Ns, 84);
      assert.equal(source.core?.selfTestSamples, 300);
      assert.equal(source.core?.engine, "native");
    }
  });

  it("zero orders on the Python engine carries no core — the state stays a plain dash", () => {
    const empty = measured({
      engine: "python", samples: 0, p50_us: null, p99_us: null, p999_us: null, max_us: null,
      core_p50_ns: null, core_p99_ns: null, core_max_ns: null, core_self_test_samples: null,
    });
    const source = deriveDecisionLatency(healthWith(empty));
    assert.equal(source.kind, "no-orders");
    if (source.kind === "no-orders") assert.equal(source.core, null);
  });

  it("a negative or fractional self-measure count fails the contract", () => {
    const bad = measured({ core_self_test_samples: -1 } as Partial<DecisionLatency>);
    assert.equal(isDecisionLatency(bad), false);
    const frac = measured({ core_self_test_samples: 1.5 } as Partial<DecisionLatency>);
    assert.equal(isDecisionLatency(frac), false);
    assert.equal(isDecisionLatency(measured({ core_self_test_samples: null } as Partial<DecisionLatency>)), true);
  });

  it("a measured block carries the gateway's freshness", () => {
    const fresh = deriveDecisionLatency(healthWith(measured()));
    assert.equal(fresh.kind, "measured");
    if (fresh.kind === "measured") assert.equal(fresh.stale, false);
    const stale = deriveDecisionLatency(healthWith(measured(), "stale"));
    if (stale.kind === "measured") assert.equal(stale.stale, true);
  });
});

describe("formatDecisionChip", () => {
  it("the dash branch carries a reason, never the network number", () => {
    const chip = formatDecisionChip(deriveDecisionLatency(healthWith(null)), NETWORK);
    assert.equal(chip.headline.kind, "dash");
    assert.equal(chip.state, "no orders yet");
    assert.match(chip.caveat, /no orders yet/);
    // The network figure is present in the CAVEAT, labelled — never promoted
    // to the headline under the decision label.
    assert.match(chip.caveat, /network, polled/);
  });

  it("no orders yet with a self-measured core shows the ns figure and names the method", () => {
    const selfMeasured = measured({
      engine: "native", samples: 0, p50_us: null, p99_us: null, p999_us: null, max_us: null,
      core_p50_ns: 44, core_p99_ns: 84, core_max_ns: 84, core_self_test_samples: 300,
    });
    const chip = formatDecisionChip(deriveDecisionLatency(healthWith(selfMeasured)), NETWORK);
    assert.equal(chip.headline.kind, "core-only");
    if (chip.headline.kind === "core-only") assert.equal(chip.headline.coreP99Ns, 84);
    // The µs plane is still honestly empty: the state word does not change.
    assert.equal(chip.state, "no orders yet");
    assert.equal(chip.tone, "muted");
    // Provenance first — the title says where the number came from before it
    // says anything else, and it says the µs plane is still waiting.
    assert.match(chip.caveat, /^core p99 84\u00A0ns from the startup self-measure/);
    assert.match(chip.caveat, /synthetic two-venue book/);
    assert.match(chip.caveat, /decision µs awaits the first order/);
    assert.match(chip.caveat, /n=300 self-measure samples/);
    assert.match(chip.caveat, /network, polled/);
    // The self-measure must never leak into the µs plane: no "p99 … µs" claim.
    assert.doesNotMatch(chip.caveat, /p99 \d[\d.]* µs/);
    assert.doesNotMatch(chip.caveat, /in-process pre-trade decision/);
    assert.match(chip.ariaLabel, /— · core 84\u00A0ns/);
  });

  it("collecting shows n over the floor", () => {
    const chip = formatDecisionChip(deriveDecisionLatency(healthWith(measured({ samples: 7 }))), NETWORK);
    assert.equal(chip.headline.kind, "collecting");
    assert.equal(chip.state, `7/${DECISION_MIN_SAMPLES}`);
  });

  it("the caveat names both planes", () => {
    const chip = formatDecisionChip(deriveDecisionLatency(healthWith(measured())), NETWORK);
    assert.equal(chip.headline.kind, "measured");
    assert.match(chip.caveat, /in-process pre-trade decision/);
    assert.match(chip.caveat, /network, polled/);
    assert.match(chip.caveat, /excludes kernel and wire/);
    assert.match(chip.caveat, /since process start/);
  });

  it("p99.9 is withheld under a thousand samples", () => {
    const thin = formatDecisionChip(deriveDecisionLatency(healthWith(measured({ samples: 400 }))), NETWORK);
    assert.match(thin.caveat, /p99\.9 — \(n<1,000\)/);
    const thick = formatDecisionChip(deriveDecisionLatency(healthWith(measured({ samples: 1200 }))), NETWORK);
    assert.match(thick.caveat, /p99\.9 54\.9/);
  });

  it("the Python fallback mark appears only when native was expected", () => {
    const chip = formatDecisionChip(deriveDecisionLatency(healthWith(measured({ engine: "python" }))), NETWORK);
    if (DECISION_EXPECTED_ENGINE === "native") assert.match(chip.caveat, /▲ Python fallback/);
    else assert.doesNotMatch(chip.caveat, /▲ Python fallback/);
  });

  it("a native core adds its nanosecond figure beside the decision, never instead of it", () => {
    const stats = measured({ engine: "native", core_p50_ns: 310, core_p99_ns: 620, core_max_ns: 2100 });
    const chip = formatDecisionChip(deriveDecisionLatency(healthWith(stats)), NETWORK);
    assert.equal(chip.headline.kind, "measured");
    if (chip.headline.kind === "measured") {
      assert.equal(chip.headline.p99Us, 34.7);
      assert.equal(chip.headline.coreP99Ns, 620);
    }
    assert.match(chip.caveat, /core p99 620 ns/);
    assert.match(chip.caveat, /C\+\+ core/);
  });
});

describe("formatNetworkCaveat", () => {
  it("says which plane it is and whether the pool is warm", () => {
    const warm = formatNetworkCaveat({ p99: 120, n: 5, errorRate: 0 });
    assert.match(warm, /network, polled/);
    assert.match(warm, /collecting n=5\/20/);
    const hot = formatNetworkCaveat({ p99: 321.4, n: 80, errorRate: 0.1 });
    assert.match(hot, /upstream p99 321 ms/);
    assert.match(hot, /15-min pool/);
    assert.match(hot, /error rate 10%/);
  });

  it("names the desk hop only when it has its own samples", () => {
    const withHop = formatNetworkCaveat({ p99: 500, n: 40, errorRate: 0 }, { p99: 24, n: 60 });
    assert.match(withHop, /desk hop p99 24\.0 ms/);
    const thinHop = formatNetworkCaveat({ p99: 500, n: 40, errorRate: 0 }, { p99: 24, n: 3 });
    assert.doesNotMatch(thinHop, /desk hop/);
  });
});
