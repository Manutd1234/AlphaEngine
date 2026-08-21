/**
 * The decision plane: the in-process microsecond figure, and the six ways it
 * is allowed to be absent.
 *
 * This is the number the product is actually about, and it is the number most
 * easily faked. Every state below exists because a zero, a dash or a
 * neighbouring figure could stand in for it and nobody would see the
 * substitution:
 *
 *  • NOT PUBLISHED vs NO ORDERS YET vs CHECKING. A gateway too old to send the
 *    block, a gateway that sent it with `samples: 0`, and a page that has not
 *    asked yet are three different truths. Collapsing them into one dash — or
 *    worse, into `0 µs` — is the house defect in its exact shape.
 *  • A MALFORMED BLOCK IS WITHHELD. `isDecisionLatency` is the type guard, and
 *    a body that fails it must be treated as not published rather than
 *    partially believed.
 *  • THE SELF-MEASURE NEVER LEAKS INTO THE µs PLANE. A native core can report a
 *    startup self-test in nanoseconds before a single order exists. That
 *    figure rides the `no-orders` state and names its own method — it never
 *    becomes the decision p99, and the state word does not change because of
 *    it.
 *  • THE NETWORK NUMBER NEVER GETS PROMOTED. When the decision figure is a
 *    dash, the caveat still carries the polled network figure, LABELLED — it
 *    does not move up under the decision heading to fill the gap.
 *  • p99.9 IS WITHHELD UNDER A THOUSAND SAMPLES, which is the same sample-floor
 *    rule the network plane runs, applied to the tail statistic that needs it
 *    most.
 *
 * The bands are checked against the published latency budget rather than
 * against themselves: `DECISION_BAD_US` is 500 because "achievable 5–500 µs
 * for the decision" is what the budget says, so 500 is where "slow" is
 * literally true.
 *
 * Siblings, from the same module: `-decision-loop` (the five stages),
 * `-kill-switch` (the arming gate), `-network-latency` (the polled upstream
 * plane, which owns the caveat text the chip here embeds).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DECISION_BAD_US,
  DECISION_EXPECTED_ENGINE,
  DECISION_MIN_SAMPLES,
  DECISION_P999_MIN_SAMPLES,
  DECISION_WARN_US,
  LATENCY_MIN_SAMPLES,
  decisionTone,
  deriveDecisionLatency,
  formatDecisionChip,
  isDecisionLatency,
} from "../lib/overview-state";
import type { DecisionLatency, SystemHealth } from "../components/systems/types";

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
