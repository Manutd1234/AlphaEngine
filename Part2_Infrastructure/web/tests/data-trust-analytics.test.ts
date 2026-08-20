/**
 * The snapshot-backed half of Trust Summary.
 *
 * The defect these guard against is the house defect: a panel that passes,
 * renders, and reads better than the truth. Four specific ways that could
 * happen here —
 *
 *  1. A ring whose slices do not partition its own denominator. `summary`
 *     publishes `degraded`, `exhausted` and `simulated` as three independent id
 *     lists, and a provider can be in two of them, so the obvious donut sums
 *     past `total` and every share it prints is wrong.
 *  2. A quota bar that overruns its track, or that draws the reserve as free
 *     space — which would show headroom a background poll is already being
 *     refused.
 *  3. A derived rate with no denominator rendered as 0 Hz, i.e. a stopped tape
 *     invented out of a missing uptime.
 *  4. A latency row whose statistic is blank no matter how much traffic the
 *     source gets, which reads as a dead source rather than as an unpublished
 *     aggregate. That one had already shipped.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type {
  FailoverNode,
  FailoverRoute,
  GatewayMarketDataFeed,
  LatencyStats,
  ProviderRow,
  SystemHealth,
} from "../components/systems/types";
import {
  deriveFailoverDepth,
  deriveFeedThroughput,
  deriveInstanceScope,
  deriveProviderSupply,
  deriveQuotaHeadroom,
  humanDuration,
  resolveLatencySource,
} from "../lib/data-trust";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const NOW = "2026-08-13T08:00:00.000Z";

const latency = (over: Partial<LatencyStats> = {}): LatencyStats => ({
  n: 0, p50: null, p95: null, p99: null, max: null, errorRate: 0, lastAt: null, ...over,
});

function provider(over: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: "alphavantage",
    label: "Alpha Vantage",
    docs: "",
    signup: "",
    capabilities: ["quote"],
    assets: ["equity"],
    keyEnv: "ALPHAVANTAGE_API_KEY",
    configured: true,
    circuitOpen: false,
    quota: null,
    rank: {},
    breaker: { state: "closed", failures: 0, threshold: 5, openedAt: null, cooldownRemainingMs: 0 },
    latency: latency(),
    simulatedOutage: null,
    ready: true,
    statusDetail: "Configured and available for routing.",
    ...over,
  };
}

function node(over: Partial<FailoverNode> = {}): FailoverNode {
  return {
    provider: "alphavantage",
    label: "Alpha Vantage",
    rank: 1,
    state: "ready",
    detail: "",
    latency: latency(),
    active: false,
    ...over,
  };
}

function route(over: Partial<FailoverRoute> = {}): FailoverRoute {
  return { capability: "quote", asset: "equity", nodes: [node()], activeProvider: "alphavantage", cacheTtlMs: 15_000, ...over };
}

function feed(over: Partial<GatewayMarketDataFeed> = {}): GatewayMarketDataFeed {
  return {
    venue: "binance",
    status: "up",
    connected: true,
    reconnects: 0,
    uptime_seconds: 71_264,
    error_present: false,
    synthetic: false,
    symbols: [
      { symbol: "BTCUSDT", age_seconds: 0.06, updates_total: 712_195, update_rate_hz: 10, stale: false },
    ],
    ...over,
  };
}

/** Only the fields a derivation reads; the wire shape is pinned elsewhere. */
const health = (over: Record<string, unknown>): SystemHealth =>
  ({
    instance: { id: "lambda-a", startedAt: NOW, uptimeMs: 3_600_000, scope: "per-instance (in-memory fallback)" },
    providers: [],
    venues: [],
    routes: [],
    ...over,
  }) as unknown as SystemHealth;

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

describe("feed throughput keeps a missing denominator missing", () => {
  it("withholds the mean rate when there is no uptime to divide by", () => {
    // 0 Hz would report a stopped tape. There is no tape yet.
    const [row] = deriveFeedThroughput(health({
      platform: { market_data: { feeds: [feed({ uptime_seconds: 0 })] } },
    }));
    assert.equal(row.meanRateHz, null);
  });

  it("derives the mean from the venue's own counters and preserves a null age", () => {
    const [row] = deriveFeedThroughput(health({
      platform: {
        market_data: {
          feeds: [feed({
            symbols: [
              { symbol: "BTCUSDT", age_seconds: null, updates_total: 600_000, update_rate_hz: 8.5, stale: false },
              { symbol: "ETHUSDT", age_seconds: 0.2, updates_total: 112_195, update_rate_hz: 1.5, stale: true },
            ],
          })],
        },
      },
    }));
    assert.equal(row.updatesTotal, 712_195);
    assert.equal(row.meanRateHz, 712_195 / 71_264);
    assert.equal(row.books[0].ageSeconds, null, "an unreported age must not become a fresh 0.00s");
    assert.equal(row.books[1].stale, true);
  });

  it("reports no venue rather than an empty one when the gateway is absent", () => {
    assert.deepEqual(deriveFeedThroughput(health({})), []);
  });
});

describe("every latency series resolves to the source it measures", () => {
  it("names the plane probe and withholds a p95 nobody publishes", () => {
    /**
     * The shipped bug. `plane:gateway` is recorded by the health route on every
     * poll — the densest line on the tab — and the panel matched only `venue:*`
     * and provider ids, so its stat chip read "—" for ever. A statistic that is
     * blank however much traffic a source gets reads as a dead source.
     */
    const source = resolveLatencySource(health({}), "plane:gateway");
    assert.equal(source.kind, "plane");
    assert.equal(source.label, "gateway probe");
    assert.equal(source.stats, null, "no fifteen-minute aggregate exists for a plane key");
    assert.match(source.note!, /no fifteen-minute aggregate/);
  });

  it("resolves venues and providers to their published aggregates", () => {
    const snapshot = health({
      venues: [{ id: "binance", label: "Binance REST", latency: latency({ n: 12, p95: 240 }) }],
      providers: [provider({ id: "tiingo", label: "Tiingo", latency: latency({ n: 4, p95: 88 }) })],
    });
    assert.equal(resolveLatencySource(snapshot, "venue:binance").stats?.p95, 240);
    assert.equal(resolveLatencySource(snapshot, "venue:binance").label, "binance");
    assert.equal(resolveLatencySource(snapshot, "tiingo").stats?.p95, 88);
    assert.equal(resolveLatencySource(snapshot, "tiingo").label, "Tiingo");
  });

  it("does not invent statistics for a key no source owns", () => {
    const source = resolveLatencySource(health({}), "something-new");
    assert.equal(source.stats, null);
    assert.equal(source.kind, "unknown");
    assert.equal(source.label, "something-new", "an unknown key is shown as itself, not hidden");
  });
});

// --------------------------------------------------------------------------
// Structure. No DOM harness in this suite, so these pin the boundaries that
// make the rendered panes truthful.
// --------------------------------------------------------------------------

describe("Trust Summary splits without hiding or double-mounting", () => {
  const overview = read("../components/data/DataTrustOverview.tsx");
  const code = overview.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  it("offers three panes, not four", () => {
    const panes = [...code.matchAll(/\{\s*id: "(verdict|response|composition)"/g)];
    assert.equal(panes.length, 3, "a four-button seg forces abbreviated labels");
  });

  it("uses the house segmented control rather than a second tab rail", () => {
    // A nested WorkspaceSubtabs publishes `--rail-h` from a ResizeObserver and
    // asserts exactly one rail is mounted; a second fights the first over every
    // sticky offset in the app.
    assert.match(code, /className="seg" role="group"/);
    assert.match(code, /aria-pressed=\{pane === option\.id\}/);
    assert.ok(!code.includes("WorkspaceSubtabs"), "a nested rail would contend for --rail-h");
  });

  it("renders panes conditionally so a switched-away one stops observing", () => {
    for (const pane of ["verdict", "response", "composition"]) {
      assert.match(code, new RegExp(`pane === "${pane}" &&`));
    }
    assert.ok(
      !/hidden=\{!summary\}/.test(code) && !/hidden=\{!feedsView\}/.test(code),
      "a hidden pane is still mounted and still measuring",
    );
  });

  it("does not render an assessment boundary block at all", () => {
    // This asserted the block stayed OUTSIDE the pane switcher, on the grounds
    // that a boundary which disappears when the reader changes view is one they
    // can miss entirely. That was a good argument for a block that should not
    // exist: it was asked for twice, and by the time it went it had drifted —
    // still claiming escalation reached one channel and that there was no rota,
    // after both shipped.
    //
    // A hand-maintained claim block is the failure mode, not its placement.
    assert.ok(!code.includes("data-trust-boundaries"), "the boundary block is back");
    assert.ok(!code.includes("Assessment boundary"), "the boundary block is back under another class");
  });

  it("lands on the verdict, which is what the tab is for", () => {
    assert.match(code, /useState<TrustPane>\("verdict"\)/);
  });

  it("draws the analytics on the half of the payload that is populated", () => {
    // The ring-backed counters are incremented in the quote lambdas, not in the
    // health route, so charts over them are empty on a busy deployment too.
    for (const panel of ["InstanceScope", "SupplyPosture", "FeedThroughput", "QuotaHeadroom"]) {
      assert.ok(overview.includes(`<${panel} health={health} />`), `${panel} is imported but never rendered`);
    }
  });

  it("withholds an unpublished p95 instead of pattern-matching keys inline", () => {
    assert.ok(!code.includes('row.key.startsWith("venue:")'), "the key matcher that dropped plane:* is back");
    assert.match(code, /"p95 n\/a"/);
    assert.ok(!/p95 \?\? 0/.test(code), "an unmeasured p95 must never render as instant");
  });
});
