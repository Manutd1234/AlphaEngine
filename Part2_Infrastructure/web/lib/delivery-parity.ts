import { createHash } from "node:crypto";

import { isAbsorptionRead, isEventsRead, isFindingsRead } from "@/components/coherence/diffusion/types";
import { canonicalJson } from "@/lib/canonical-json";
import { isCoherenceEpisodes, isCoherenceStatus, isCoherenceUniverse } from "@/lib/coherence/types";
import { isCoherenceRfqPanel, isCoherenceShell } from "@/lib/coherence/types-lab";
import {
  ALLOCATION_METHODS,
  applyScenario,
  buildCovariance,
  proposeAllocation,
  rollingVarBacktest,
  type ReturnsBySymbol,
  type RiskPosition,
} from "@/lib/portfolio-risk";
import riskFixtureJson from "@/tests/fixtures/risk-parity.json";

export interface GatewayPayloadParityEvidence {
  kind: "gateway_payload_parity";
  state: "match" | "mismatch";
  passed: boolean;
  expectedDigest: string;
  observedDigest: string;
  checks: number;
  detail: string;
}

let gatewayPayloadParityCache: GatewayPayloadParityEvidence | null = null;

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/** Run every major desk payload family through the same guards used by routes. */
export function gatewayPayloadParityEvidence(): GatewayPayloadParityEvidence {
  if (gatewayPayloadParityCache) return gatewayPayloadParityCache;
  const fixtures: ReadonlyArray<{ name: string; payload: unknown; accepts: (value: unknown) => boolean }> = [
    { name: "coherence-status", payload: { state: "ok", recorder: {}, budget: {} }, accepts: isCoherenceStatus },
    { name: "coherence-universe", payload: { state: "ok", events: [] }, accepts: isCoherenceUniverse },
    { name: "coherence-episodes", payload: { state: "empty", episodes: [] }, accepts: isCoherenceEpisodes },
    {
      name: "coherence-shell",
      payload: { state: "available", path: "/shards", command: "ls", exists: true, entries: [], body: "", detail: "fixture" },
      accepts: isCoherenceShell,
    },
    {
      name: "coherence-rfq",
      payload: { state: "empty", dispersions: [], open_quotes: 0, signing_environment: "demo" },
      accepts: isCoherenceRfqPanel,
    },
    { name: "diffusion-events", payload: { state: "ok", events: [] }, accepts: isEventsRead },
    { name: "diffusion-absorption", payload: { state: "ok", runs: [] }, accepts: isAbsorptionRead },
    { name: "diffusion-findings", payload: { state: "ok", findings: [] }, accepts: isFindingsRead },
  ];
  const expected = fixtures.map(({ name }) => ({ name, accepted: true }));
  const observed = fixtures.map(({ name, payload, accepts }) => ({ name, accepted: accepts(payload) }));
  const expectedDigest = digest(expected);
  const observedDigest = digest(observed);
  const failed = observed.filter((row) => !row.accepted).map((row) => row.name);
  const passed = expectedDigest === observedDigest;
  gatewayPayloadParityCache = {
    kind: "gateway_payload_parity",
    state: passed ? "match" : "mismatch",
    passed,
    expectedDigest,
    observedDigest,
    checks: fixtures.length,
    detail: passed
      ? `All ${fixtures.length} canonical Markets, Proofs and Diffusion payload families passed their production Web validators.`
      : `Canonical payload validation drifted for: ${failed.join(", ")}.`,
  };
  return gatewayPayloadParityCache;
}

interface ExpectedRiskProposal {
  method: string;
  grossBefore: number;
  grossAfter: number;
  clipped: boolean;
  targets: Array<{ symbol: string; targetWeight: number; targetNotional: number; clippedBy: string | null }>;
}

interface RiskParityFixture {
  window: number;
  history: ReturnsBySymbol;
  positions: RiskPosition[];
  expected: {
    varBacktest: {
      observations: number;
      exceptions: number;
      expectedExceptions: number;
      kupiecStatistic: number;
      zone: string;
    };
    allocation: {
      history: ReturnsBySymbol;
      positions: RiskPosition[];
      methods: Record<string, ExpectedRiskProposal>;
    };
    scenario: {
      totalPnl: number;
      usedBeta: boolean;
      legs: Array<{ symbol: string; appliedMove: number; pnl: number; viaBeta: boolean }>;
    };
  };
}

export interface RiskParityEvidence {
  kind: "risk_parity";
  state: "match" | "mismatch";
  passed: boolean;
  checks: number;
  detail: string;
}

const riskFixture = riskFixtureJson as unknown as RiskParityFixture;
let riskParityCache: RiskParityEvidence | null = null;

/** Reproduce the promotion-critical Python fixture with the browser's risk engine. */
export function riskParityEvidence(): RiskParityEvidence {
  if (riskParityCache) return riskParityCache;
  let checks = 0;
  const failed: string[] = [];
  const check = (name: string, condition: boolean) => {
    checks += 1;
    if (!condition) failed.push(name);
  };
  const close = (actual: number, expected: number, tolerance: number) => Math.abs(actual - expected) < tolerance;

  const backtest = rollingVarBacktest(riskFixture.positions, riskFixture.history, riskFixture.window);
  check("VaR result", backtest !== null);
  if (backtest) {
    check("VaR observations", backtest.observations === riskFixture.expected.varBacktest.observations);
    check("VaR exceptions", backtest.exceptions === riskFixture.expected.varBacktest.exceptions);
    check("VaR expected exceptions", backtest.expectedExceptions === riskFixture.expected.varBacktest.expectedExceptions);
    check("VaR Kupiec statistic", close(backtest.kupiecStatistic, riskFixture.expected.varBacktest.kupiecStatistic, 1e-3));
    check("VaR zone", backtest.zone === riskFixture.expected.varBacktest.zone);
  }

  const scenario = applyScenario(
    riskFixture.positions,
    1_000_000,
    [{ symbol: "BTCUSDT", move: -0.2 }],
    riskFixture.history,
    "BTCUSDT",
  );
  check("scenario total", close(scenario.totalPnl, riskFixture.expected.scenario.totalPnl, 1e-6));
  check("scenario beta", scenario.usedBeta === riskFixture.expected.scenario.usedBeta);
  for (const expected of riskFixture.expected.scenario.legs) {
    const actual = scenario.perPosition.find((leg) => leg.symbol === expected.symbol);
    check(`${expected.symbol} scenario leg`, Boolean(actual));
    if (actual) {
      check(`${expected.symbol} scenario move`, close(actual.appliedMove, expected.appliedMove, 1e-6));
      check(`${expected.symbol} scenario pnl`, close(actual.pnl, expected.pnl, 1e-6));
      check(`${expected.symbol} scenario beta path`, actual.viaBeta === expected.viaBeta);
    }
  }

  const allocation = riskFixture.expected.allocation;
  const covariance = buildCovariance(Object.keys(allocation.history), allocation.history);
  check("allocation covariance", covariance !== null);
  if (covariance) {
    for (const method of ALLOCATION_METHODS) {
      const expected = allocation.methods[method];
      const actual = proposeAllocation(allocation.positions, covariance, method);
      check(`${method} proposal`, Boolean(expected && actual));
      if (!expected || !actual) continue;
      check(`${method} identity`, actual.method === expected.method);
      check(`${method} target count`, actual.targets.length === expected.targets.length);
      check(`${method} gross before`, close(actual.grossBefore, expected.grossBefore, 1e-6));
      check(`${method} gross after`, close(actual.grossAfter, expected.grossAfter, 0.01));
      check(`${method} clipped`, actual.clipped === expected.clipped);
      for (const wanted of expected.targets) {
        const target = actual.targets.find((row) => row.symbol === wanted.symbol);
        check(`${method}/${wanted.symbol} target`, Boolean(target));
        if (target) {
          check(`${method}/${wanted.symbol} weight`, close(target.targetWeight, wanted.targetWeight, 1e-4));
          check(`${method}/${wanted.symbol} notional`, close(target.targetNotional, wanted.targetNotional, 0.01));
          check(`${method}/${wanted.symbol} cap`, target.clippedBy === wanted.clippedBy);
        }
      }
    }
  }

  riskParityCache = {
    kind: "risk_parity",
    state: failed.length ? "mismatch" : "match",
    passed: failed.length === 0,
    checks,
    detail: failed.length
      ? `The TypeScript risk consumer drifted from the Python fixture at: ${failed.join(", ")}.`
      : `This Node instance reproduced all ${checks} Python-to-TypeScript risk assertions.`,
  };
  return riskParityCache;
}
