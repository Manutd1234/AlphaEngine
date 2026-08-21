/**
 * Two planes, reported separately, because they fail separately.
 *
 * A deployment can be routing orders perfectly while every research provider is
 * exhausted, and it can be reading market data flawlessly while the risk
 * gateway is unreachable. One word for both is a word that is wrong about one
 * of them, so `deriveReliabilityPosture` keeps trading and research apart and
 * the overall verdict is the worst of what it finds.
 *
 * The two failures worth naming are at the ends of the scale. Calling a
 * provider-only deployment "nominal" claims a trading path that was never
 * configured; painting a stale snapshot green claims a trading path that was
 * configured and has stopped answering. Both read as good news, which is why
 * neither is allowed: unknown is a state this surface is willing to report.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveReliabilityPosture } from "../lib/reliability";
import { NOW, health, platform, source } from "./helpers/reliability-fixtures";

describe("reliability posture keeps the trading and research planes separate", () => {
  it("reports nominal only when both current paths are nominal", () => {
    const posture = deriveReliabilityPosture(health(), NOW);
    assert.equal(posture.overall, "nominal");
    assert.equal(posture.paths.trading.status, "nominal");
    assert.equal(posture.paths.research.status, "nominal");
  });

  it("treats a configured unreachable gateway as critical", () => {
    const input = health({
      platform: undefined,
      sources: { providers: source("fresh"), gateway: source("unreachable") },
    });
    const posture = deriveReliabilityPosture(input, NOW);
    assert.equal(posture.overall, "critical");
    assert.equal(posture.paths.trading.status, "critical");
    assert.equal(posture.paths.research.status, "nominal");
  });

  it("never paints stale monitoring green", () => {
    const old = new Date(NOW - 60_000).toISOString();
    const input = health({
      platform: platform({ observed_at: old }),
      sources: { providers: source("fresh"), gateway: source("stale", old) },
    });
    assert.equal(deriveReliabilityPosture(input, NOW).overall, "unknown");
  });

  it("reports an authoritative trading halt", () => {
    const halted = platform({
      status: "halted",
      risk: { ...platform().risk, status: "halted", kill_switch_active: true },
    });
    const posture = deriveReliabilityPosture(health({ platform: halted }), NOW);
    assert.equal(posture.overall, "halted");
    assert.equal(posture.paths.trading.status, "halted");
  });

  it("degrades a provider-only deployment instead of calling it nominal", () => {
    const input = health({
      platform: undefined,
      sources: { providers: source("fresh"), gateway: source("not_configured") },
    });
    const posture = deriveReliabilityPosture(input, NOW);
    assert.equal(posture.overall, "degraded");
    assert.equal(posture.paths.trading.status, "unknown");
    assert.equal(posture.paths.research.status, "nominal");
  });

  it("does not turn a research-only outage into a trading outage", () => {
    const base = health();
    const posture = deriveReliabilityPosture(health({
      summary: { ...base.summary, ready: 0 },
    }), NOW);
    assert.equal(posture.overall, "degraded");
    assert.equal(posture.paths.trading.status, "nominal");
    assert.equal(posture.paths.research.status, "critical");
  });
});
