/**
 * What the desk can still call: scope, supply, failover depth and quota.
 *
 * The snapshot-backed half of Trust Summary, on the side that answers "how much
 * capacity is left". The defect these guard against is the house defect: a
 * panel that passes, renders, and reads better than the truth. Three specific
 * ways that could happen on this side —
 *
 *  1. A ring whose slices do not partition its own denominator. `summary`
 *     publishes `degraded`, `exhausted` and `simulated` as three independent id
 *     lists, and a provider can be in two of them, so the obvious donut sums
 *     past `total` and every share it prints is wrong. Failover depth is the
 *     same arithmetic one level down: a state breakdown that does not sum back
 *     to the chain length has lost a node between the route and the bar.
 *  2. A quota bar that overruns its track, or that draws the reserve as free
 *     space — which would show headroom a background poll is already being
 *     refused. Its sibling failure is drawing a budget at all for a provider
 *     with no key: a full green bar of headroom against a missing credential is
 *     the most flattering possible way to render something that cannot be
 *     called.
 *  3. A measurement whose scope is assumed rather than reported. "0 instances"
 *     reads as an outage when the fact is an unobserved fleet, and a
 *     twelve-second window reads as healthy when it is simply too thin to say.
 *
 * The receiving side — feed throughput and latency sources — is in
 * `data-trust-analytics-throughput.test.ts`, and the pane structure that keeps
 * all of it on screen in `data-trust-analytics-panes.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveFailoverDepth,
  deriveInstanceScope,
  deriveProviderSupply,
  deriveQuotaHeadroom,
  humanDuration,
} from "../lib/data-trust";

import { health, node, NOW, provider, route } from "./helpers/system-health-fixtures";

// --------------------------------------------------------------------------

describe("measurement scope is reported, never assumed", () => {
  it("does not render an unmerged ledger as a fleet of none", () => {
    // "0 instances" reads as an outage. The sync being down is an unobserved
    // fleet, which is a different fact and the one that explains the zeros.
    const facts = deriveInstanceScope(health({}));
    const merged = facts.find((fact) => fact.id === "instances")!;
    assert.equal(merged.value, "n/a");
    assert.equal(merged.tone, "unknown");
    assert.match(merged.detail, /measured by this lambda alone/);

    const scope = facts.find((fact) => fact.id === "scope")!;
    assert.equal(scope.value, "Per-instance");
    assert.equal(scope.tone, "warn", "a per-instance ledger is a caveat, not a clean reading");
  });

  it("reports the merged fleet when the gateway ledger is backing it", () => {
    const facts = deriveInstanceScope(health({
      instance: {
        id: "lambda-a",
        startedAt: NOW,
        uptimeMs: 3_600_000,
        scope: "gateway-shared ledger (3 instances reporting in the last 15m)",
        shared: { backed: true, instances: ["a", "b", "c"], observedAt: NOW, ageMs: 4_000, windowSeconds: 900 },
      },
    }));
    assert.equal(facts.find((fact) => fact.id === "scope")!.value, "Gateway-shared");
    assert.equal(facts.find((fact) => fact.id === "instances")!.value, "3");
    assert.equal(facts.find((fact) => fact.id === "observed")!.value, "4s ago");
  });

  it("flags a young instance rather than presenting a thin window as healthy", () => {
    const facts = deriveInstanceScope(health({
      instance: { id: "lambda-a", startedAt: NOW, uptimeMs: 12_000, scope: "per-instance" },
    }));
    const uptime = facts.find((fact) => fact.id === "uptime")!;
    assert.equal(uptime.value, "12s");
    assert.equal(uptime.tone, "warn");
  });

  it("invents nothing when no snapshot has arrived", () => {
    const facts = deriveInstanceScope(null);
    assert.deepEqual(facts.map((fact) => fact.tone), ["unknown", "unknown", "unknown", "unknown"]);
    assert.equal(facts.find((fact) => fact.id === "uptime")!.value, "n/a");
  });

  it("keeps an absent duration absent instead of zeroing it", () => {
    assert.equal(humanDuration(null), "n/a");
    assert.equal(humanDuration(undefined), "n/a");
    assert.equal(humanDuration(0), "0s", "a measured zero is still a measurement");
  });
});

describe("the supply ring partitions its own denominator", () => {
  it("counts a provider that is both circuit-open and out of quota exactly once", () => {
    /**
     * The trap: `summary.degraded` and `summary.exhausted` are independent id
     * lists and this provider is in both. A ring built from those two plus
     * `ready` would total 4 out of 3 providers and every printed share would be
     * wrong.
     */
    const supply = deriveProviderSupply(health({
      providers: [
        provider({ id: "a" }),
        provider({
          id: "b",
          circuitOpen: true,
          breaker: { state: "open", failures: 5, threshold: 5, openedAt: 1, cooldownRemainingMs: 1_000 },
          quota: { used: 25, limit: 25, remaining: 0, reserve: 10, window: "day" },
          ready: false,
        }),
        provider({ id: "c", configured: false, ready: false }),
      ],
    }));
    assert.equal(supply.total, 3);
    const parts = supply.ready + supply.circuitOpen + supply.quotaExhausted
      + supply.simulatedOutage + supply.notConfigured + supply.blocked;
    assert.equal(parts, supply.total, "the slices must sum to the denominator they are drawn against");
    assert.equal(supply.circuitOpen, 1);
    assert.equal(supply.quotaExhausted, 0, "a provider already counted as circuit-open cannot be counted again");
  });

  it("classifies a configured but unroutable provider as blocked, not as ready", () => {
    // OpenBB configured and unreachable is exactly this: routable on paper,
    // failing its readiness probe, and in none of the three summary lists.
    const supply = deriveProviderSupply(health({
      providers: [provider({ id: "openbb", ready: false, statusDetail: "probe failed" })],
    }));
    assert.equal(supply.ready, 0);
    assert.equal(supply.blocked, 1);
  });
});

describe("failover depth counts every node in the chain", () => {
  it("sums the state breakdown back to the chain length and sorts the thinnest first", () => {
    const rows = deriveFailoverDepth(health({
      routes: [
        route({ capability: "bars", asset: "crypto", nodes: [node(), node({ state: "ready" }), node({ state: "not_configured" })] }),
        route({ capability: "news", asset: "equity", nodes: [node({ state: "circuit_open" })] }),
        route({ capability: "quote", asset: "equity", nodes: [node(), node({ state: "quota_reserved" })] }),
      ],
    }));
    assert.deepEqual(rows.map((row) => row.capability), ["news", "quote", "bars"]);
    for (const row of rows) {
      const counted = Object.values(row.byState).reduce((sum, value) => sum + value, 0);
      assert.equal(counted, row.total, `${row.capability} lost a node between the chain and the bar`);
    }
    assert.equal(rows.find((row) => row.capability === "news")!.ready, 0);
  });
});

describe("quota headroom is a share of its own window", () => {
  it("keeps the three bands summing to exactly 100", () => {
    // Awkward on purpose: a third rounding pass here overruns the track it is
    // drawn in, and 33.3 × 3 does not make a whole bar.
    const rows = deriveQuotaHeadroom(health({
      providers: [provider({ quota: { used: 1, limit: 3, remaining: 2, reserve: 1, window: "day" } })],
    }));
    const row = rows[0];
    assert.equal(Math.round((row.spentPct + row.freePct + row.reservedPct) * 10) / 10, 100);
  });

  it("carves the reserve out of what remains rather than adding it on top", () => {
    const [row] = deriveQuotaHeadroom(health({
      providers: [provider({ quota: { used: 20, limit: 25, remaining: 5, reserve: 10, window: "day" } })],
    }));
    // Reserve (10) exceeds what is left (5): the band is what is actually
    // fenced, or the bar would claim 120% of a spent window.
    assert.equal(row.spentPct, 80);
    assert.equal(row.reservedPct, 20);
    assert.equal(row.freePct, 0);
    assert.equal(row.tone, "warn", "at or below the reserve, background refresh is already fenced out");
  });

  it("leaves out a budget that cannot be spent", () => {
    /**
     * The registry reports a quota window for providers with no key. Drawing
     * them would put a full green bar of headroom against a missing credential
     * — the most flattering possible way to render a provider that cannot be
     * called at all.
     */
    const rows = deriveQuotaHeadroom(health({
      providers: [
        provider({ id: "unkeyed", configured: false, quota: { used: 0, limit: 250, remaining: 250, reserve: 50, window: "day" } }),
        provider({ id: "unmetered", quota: null }),
        provider({ id: "zero-limit", quota: { used: 0, limit: 0, remaining: 0, reserve: 0, window: "day" } }),
      ],
    }));
    assert.deepEqual(rows, []);
  });

  it("sorts the tightest headroom first and marks an exhausted window bad", () => {
    const rows = deriveQuotaHeadroom(health({
      providers: [
        provider({ id: "roomy", label: "Roomy", quota: { used: 10, limit: 1_000, remaining: 990, reserve: 150, window: "day" } }),
        provider({ id: "spent", label: "Spent", quota: { used: 5, limit: 5, remaining: 0, reserve: 1, window: "minute" } }),
      ],
    }));
    assert.deepEqual(rows.map((row) => row.id), ["spent", "roomy"]);
    assert.equal(rows[0].tone, "bad");
    assert.equal(rows[1].tone, "good");
  });
});
