/**
 * A purge takes the cache and nothing else, and a hit contacts nobody.
 *
 * The operator console's most destructive button is "purge cache", and the two
 * namespaces sitting next to the cache in the same store are the two that must
 * never go with it. Losing `breaker:*` re-exposes a provider that was being
 * held out; losing `quota:*` lets this instance re-spend a vendor's daily
 * allowance it has already spent. Neither failure is visible on the screen that
 * caused it — the purge reports success, and the damage shows up as a bill or
 * as traffic to a provider that was failing.
 *
 * Eviction is the same loss by a different route, and it is the subtler one:
 * the original policy dropped the oldest *insertion* regardless of namespace,
 * and `incr()` re-setting a key does not move it in Map order, so a window's
 * quota counter sat permanently first in line and was the first thing thrown
 * away. Enough distinct cache keys — search and scrape keys are
 * caller-supplied — and the instance forgot it had spent the day.
 *
 * The last guard is the accounting the console reads: a second identical
 * dispatch has to be declared a cache hit, and it has to actually not call the
 * provider. A hit that still made the request is a lie about the request count
 * the quota ledger is fenced by.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CACHE_PREFIXES,
  cacheKeysInScope,
} from "../lib/operator";
import { cacheKeys } from "../lib/providers/registry";
import {
  dispatch,
  MemoryStore,
} from "../lib/providers/runtime";
import { Adapter } from "../lib/providers/types";
import { EMPTY_ENV, fake, QUOTE } from "./helpers/observability-doubles";

// --------------------------------------------------------------------------
// Store extensions
// --------------------------------------------------------------------------

describe("the store can be inspected and purged without collateral damage", () => {
  it("ttl reports remaining life and null once the entry is gone", () => {
    const s = new MemoryStore();
    s.set("quote:AAPL:*", 1, 5_000);
    const ttl = s.ttl("quote:AAPL:*");
    assert.ok(ttl !== null && ttl > 4_000 && ttl <= 5_000, `implausible ttl ${ttl}`);
    assert.equal(s.ttl("quote:MSFT:*"), null, "an absent key reported a ttl");
  });

  it("keys and purge see only live entries", () => {
    const s = new MemoryStore();
    s.set("quote:A:*", 1, 5_000);
    s.set("quote:B:*", 1, -1); // already expired
    assert.deepEqual(s.keys("quote:"), ["quote:A:*"]);
    assert.equal(s.purge("quote:"), 1);
    assert.equal(s.keys().length, 0);
  });

  it("a cache purge never touches the quota ledger or the breakers", () => {
    const s = new MemoryStore();
    s.set("quote:AAPL:*", 1, 5_000);
    s.set("news:AAPL,MSFT:8:*", 1, 5_000);
    s.set("quota:fmp:2026-08-04", 42, 5_000);
    s.set("breaker:fmp", { failures: 3, openedAt: Date.now() }, 5_000);

    const doomed = cacheKeysInScope("all", s);
    assert.equal(doomed.length, 2, "purge scope reached beyond the cache namespaces");
    assert.ok(!doomed.some((k) => k.startsWith("quota:") || k.startsWith("breaker:")));
    // Losing the ledger would let this instance re-spend a vendor's allowance.
    assert.ok((CACHE_PREFIXES as string[]).every((p) => p !== "quota" && p !== "breaker"));
  });

  it("eviction never sacrifices the quota ledger to make room for a cached quote", () => {
    // The original eviction deleted the oldest *insertion* regardless of
    // namespace, and `incr()` re-setting a key does not move it in Map order —
    // so a window's counter was written once on the first spend and then sat
    // permanently first in line. Enough distinct cache keys (search/scrape keys
    // are caller-supplied) and the instance forgot it had spent the day, stopped
    // fencing background traffic, and re-spent a real allowance.
    const s = new MemoryStore(20);
    for (let i = 0; i < 6; i++) s.incr("quota:alphavantage:2026-08-04", 86_400_000);
    s.set("breaker:fmp", { failures: 3, openedAt: Date.now() }, 240_000);

    for (let i = 0; i < 60; i++) s.set(`quote:SYM${i}:*`, i, 60_000);

    assert.equal(s.get<number>("quota:alphavantage:2026-08-04"), 6, "the quota ledger was evicted");
    assert.notEqual(s.get("breaker:fmp"), undefined, "breaker state was evicted");
  });

  it("eviction reclaims dead entries before it touches a live one", () => {
    const s = new MemoryStore(10);
    for (let i = 0; i < 8; i++) s.set(`quote:DEAD${i}:*`, i, -1); // already expired
    s.set("quote:KEEP:*", "live", 60_000);
    for (let i = 0; i < 5; i++) s.set(`quote:NEW${i}:*`, i, 60_000);

    assert.equal(s.get("quote:KEEP:*"), "live", "a live entry was dropped while dead ones remained");
    assert.ok(s.keys().every((k) => !k.includes("DEAD")), "expired entries were never reclaimed");
  });

  it("a symbol-scoped purge matches a comma-joined news key", () => {
    const s = new MemoryStore();
    s.set(cacheKeys.quote("AAPL", null), 1, 5_000);
    s.set(cacheKeys.news(["MSFT", "AAPL"], 8, null), 1, 5_000);
    s.set(cacheKeys.quote("TSLA", null), 1, 5_000);
    const doomed = cacheKeysInScope("symbol:AAPL", s);
    assert.equal(doomed.length, 2, "the multi-symbol news key was missed");
    assert.ok(!doomed.some((k) => k.includes("TSLA")), "an unrelated symbol was purged");
  });
});

// --------------------------------------------------------------------------
// Cache accounting
// --------------------------------------------------------------------------

describe("cache accounting distinguishes a hit from a miss", () => {
  it("a second identical dispatch is a hit and contacts nobody", async () => {
    const s = new MemoryStore();
    let calls = 0;
    const counting: Adapter = {
      ...fake("counting"),
      quote: async () => { calls += 1; return QUOTE; },
    };

    const opts = { capability: "quote" as const, cacheKey: "hit-1", store: s, env: EMPTY_ENV };
    await dispatch([counting], (a, ctx) => a.quote!("TEST", "equity", ctx), opts);
    const second = await dispatch([counting], (a, ctx) => a.quote!("TEST", "equity", ctx), opts);

    assert.equal(calls, 1, "the cached path still called the provider");
    assert.equal(second.provenance.cached, true, "a cache hit was not declared as one");
  });
});
