/**
 * What the desk is actually receiving: feed throughput and latency sources.
 *
 * The snapshot-backed half of Trust Summary, on the side that answers "is data
 * arriving, and how fast". Two ways this reads better than the truth, and both
 * are the same lie in different clothes — a missing measurement rendered as a
 * measured zero:
 *
 *  1. A derived rate with no denominator rendered as 0 Hz, i.e. a stopped tape
 *     invented out of a missing uptime. The same rule runs down to the symbol:
 *     an unreported `age_seconds` must not become a fresh 0.00s, which would
 *     say the book is current when nothing has said anything about it.
 *  2. A latency row whose statistic is blank no matter how much traffic the
 *     source gets, which reads as a dead source rather than as an unpublished
 *     aggregate. That one had already shipped: `plane:gateway` is the densest
 *     line on the tab and its stat chip read "—" for ever, because the resolver
 *     matched only `venue:*` and provider ids.
 *
 * The capacity side — scope, supply, failover depth and quota — is in
 * `data-trust-analytics-supply.test.ts`, and the pane structure that keeps all
 * of it on screen in `data-trust-analytics-panes.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveFeedThroughput, resolveLatencySource } from "../lib/data-trust";

import { feed, health, latency, provider } from "./helpers/system-health-fixtures";

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
