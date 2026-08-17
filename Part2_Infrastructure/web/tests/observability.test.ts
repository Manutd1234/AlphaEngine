/**
 * The telemetry kernel and the operator write path.
 *
 * Nothing here touches the network. What is worth pinning is the machinery a
 * console *believes*: a cursor that silently drops a line, a percentile computed
 * over four samples and presented as a p99, a redactor that misses the one
 * vendor putting its key in the query string, a purge that takes the quota
 * ledger with it, or a status endpoint that half-opens a circuit breaker merely
 * by being polled. Each of those returns HTTP 200 and a plausible screen — which
 * is the failure mode an observability surface exists to prevent, so it is the
 * failure mode its tests have to cover.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EventRing,
  SHARED_STALE_MS,
  type SharedOpsViewWire,
  activeOutages,
  applySharedOpsState,
  captureBody,
  clearAllOutages,
  clearOutage,
  clearSecrets,
  emit,
  eventsSince,
  latencyByClass,
  latencyStats,
  outageFor,
  percentile,
  queueContractFinding,
  recordLatency,
  recordQuotaReset,
  recordQuotaSpend,
  redact,
  redactUrl,
  registerSecret,
  resetTelemetry,
  restorePendingOps,
  sharedDataQuality,
  sharedOpsStatus,
  simulateOutage,
  takePendingOps,
} from "../lib/observability";
import { isSharedOpsView } from "../lib/ops-sync";
import {
  CACHE_PREFIXES,
  authorise,
  cacheKeysInScope,
  guardMode,
  parseAction,
} from "../lib/operator";
import { cacheKeys, failoverRoute, providerStatus } from "../lib/providers/registry";
import {
  BREAKER_COOLDOWN_MS,
  MemoryStore,
  breakerOpen,
  breakerSnapshot,
  dispatch,
  hydrateQuotaLedger,
  markUnlicensed,
  recordFailure,
  resetBreaker,
} from "../lib/providers/runtime";
import { Adapter, Quote } from "../lib/providers/types";

// --------------------------------------------------------------------------
// Test doubles
// --------------------------------------------------------------------------

const QUOTE: Quote = {
  symbol: "TEST", price: 100, change: 1, changePct: 1, open: 99, high: 101,
  low: 98, prevClose: 99, volume: 1000, currency: "USD",
  asOf: "2026-08-03T00:00:00.000Z", delayed: false,
};

function fake(id: string): Adapter {
  return {
    meta: {
      id, label: id, docs: "", capabilities: ["quote"], assets: ["equity"],
      keyEnv: "", quota: null, rank: { quote: 1 }, signup: "",
    },
    quote: async () => QUOTE,
  };
}

const EMPTY_ENV = {} as NodeJS.ProcessEnv;

// --------------------------------------------------------------------------
// Event ring
// --------------------------------------------------------------------------

describe("the event cursor never silently loses a line", () => {
  const line = (n: number) => ({
    ts: n, level: "info" as const, source: "T", message: `m${n}`,
    fields: {}, origin: "server" as const,
  });

  it("returns only what the caller has not seen", () => {
    const ring = new EventRing(10);
    for (let i = 0; i < 5; i++) ring.push(line(i));
    const first = ring.since(0);
    assert.equal(first.length, 5);
    assert.equal(ring.since(first[first.length - 1].seq).length, 0, "a caught-up cursor re-read lines");
  });

  it("sequences are monotonic, so two events in one millisecond both survive", () => {
    const ring = new EventRing(10);
    const a = ring.push(line(1_000));
    const b = ring.push(line(1_000));
    assert.notEqual(a.seq, b.seq, "same-millisecond events collided");
    assert.equal(ring.since(a.seq).length, 1);
  });

  it("evicts the oldest and reports it, so a lagging client can detect the gap", () => {
    const ring = new EventRing(3);
    for (let i = 0; i < 6; i++) ring.push(line(i));
    assert.equal(ring.size(), 3);
    assert.equal(ring.oldestSeq(), 4, "oldest retained sequence is wrong");
    // A client sitting on seq 1 has lost 2 and 3; oldest > since + 1 is the test
    // the route performs to say so.
    assert.ok(ring.oldestSeq() > 1 + 1, "the drop would not have been detected");
  });

  it("keeps the NEWEST lines when a limit truncates, not the oldest", () => {
    const ring = new EventRing(50);
    for (let i = 0; i < 20; i++) ring.push(line(i));
    const page = ring.since(0, 5);
    assert.equal(page.length, 5);
    assert.equal(page[page.length - 1].seq, 20, "a lagging client was served a stale page");
  });
});

// --------------------------------------------------------------------------
// Percentiles
// --------------------------------------------------------------------------

describe("percentiles report a latency some request actually experienced", () => {
  it("uses nearest rank, never an interpolated value nobody paid", () => {
    const sorted = [10, 20, 30, 40];
    assert.equal(percentile(sorted, 50), 20);
    assert.equal(percentile(sorted, 95), 40);
    assert.equal(percentile(sorted, 99), 40);
    // Interpolation would answer 25 here, which is not in the sample.
    assert.ok(sorted.includes(percentile(sorted, 50)!), "p50 is not an observed value");
  });

  it("an empty window is null, not zero", () => {
    assert.equal(percentile([], 50), null);
    const stats = latencyStats("never-called-provider");
    assert.equal(stats.n, 0);
    assert.equal(stats.p50, null, "an unmeasured provider reported 0ms");
  });

  it("counts a failed call's latency but reports the error rate separately", () => {
    resetTelemetry({ latency: true });
    recordLatency("px", 10, true);
    recordLatency("px", 20, true);
    recordLatency("px", 8_000, false);
    const stats = latencyStats("px");
    assert.equal(stats.n, 3, "a timeout was excluded from the latency it cost");
    assert.equal(stats.max, 8_000);
    assert.ok(Math.abs(stats.errorRate - 1 / 3) < 1e-9, "error rate is not reported alongside");
    resetTelemetry({ latency: true });
  });

  it("drops samples outside the window so an old outage stops being reported", () => {
    resetTelemetry({ latency: true });
    recordLatency("py", 5_000, false);
    // 16 minutes later the 15-minute window no longer holds it.
    assert.equal(latencyStats("py", Date.now() + 16 * 60_000).n, 0);
    resetTelemetry({ latency: true });
  });

  it("splits the pool so the poll's own gateway hop cannot dominate the vendor tail", () => {
    resetTelemetry({ latency: true });
    // The hop, sampled twice per poll, is fast; one vendor call is slow. The
    // blended p99 would report the vendor as fast; the split must not.
    for (let i = 0; i < 40; i++) recordLatency("plane:gateway", 11, true);
    recordLatency("fmp", 900, true);
    const { gatewayHop, upstream } = latencyByClass();
    assert.equal(gatewayHop.p99, 11, "the hop pool holds only plane:* samples");
    assert.equal(upstream.p99, 900, "the upstream pool holds only vendor/venue samples");
    // A plane sample must not move the upstream figure, and vice versa.
    assert.ok(upstream.n === 1 && gatewayHop.n === 40);
    resetTelemetry({ latency: true });
  });
});

// --------------------------------------------------------------------------
// Redaction
// --------------------------------------------------------------------------

describe("no credential reaches a screen", () => {
  it("blanks a key carried in the query string", () => {
    clearSecrets();
    const url = redactUrl("https://financialmodelingprep.com/stable/quote?symbol=AAPL&apikey=sk-live-abcdef123456");
    assert.ok(!url.includes("sk-live-abcdef123456"), `key survived redaction: ${url}`);
    assert.match(url, /symbol=AAPL/, "the useful part of the URL was destroyed too");
  });

  it("blanks a registered secret wherever it appears, even under an unexpected parameter name", () => {
    clearSecrets();
    registerSecret("supersecretvalue123");
    const url = redactUrl("https://vendor.example/v1/quote?token_v2=supersecretvalue123&sym=X");
    assert.ok(!url.includes("supersecretvalue123"), `unnamed-parameter key survived: ${url}`);
    clearSecrets();
  });

  it("ignores short values, which would otherwise blank unrelated text", () => {
    clearSecrets();
    registerSecret("abc");
    assert.equal(redact("abc appears inside abcdef"), "abc appears inside abcdef");
    clearSecrets();
  });

  it("scrubs credentials from the authority component", () => {
    clearSecrets();
    const url = redactUrl("https://user:hunter2pass@openbb.internal/api/research/openbb/quote?symbol=AAPL");
    assert.ok(!url.includes("hunter2pass"), `userinfo password survived: ${url}`);
  });

  it("redacts a string that is not a URL rather than returning it untouched", () => {
    clearSecrets();
    registerSecret("leakedkey12345");
    assert.ok(!redactUrl("not a url leakedkey12345").includes("leakedkey12345"));
    clearSecrets();
  });

  it("leaves a service URL intact — OPENBB_API_URL is a base URL, not a secret", () => {
    clearSecrets();
    const url = redactUrl("https://openbb.example.app/api/research/openbb/quote?symbol=AAPL&asset=equity");
    assert.equal(url, "https://openbb.example.app/api/research/openbb/quote?symbol=AAPL&asset=equity");
  });
});

// --------------------------------------------------------------------------
// Payload capture
// --------------------------------------------------------------------------

describe("captured bodies stay bounded and stay parseable", () => {
  it("keeps a small body verbatim", () => {
    clearSecrets();
    const body = captureBody({ price: 1, symbol: "AAPL" });
    assert.equal(body.truncated, false);
    assert.deepEqual(body.value, { price: 1, symbol: "AAPL" });
  });

  it("samples a huge array instead of truncating it, so the shape survives", () => {
    clearSecrets();
    // Massive's aggregates endpoint can return 50,000 of these.
    const rows = Array.from({ length: 5_000 }, (_, i) => ({ t: i, o: 1, h: 2, l: 0, c: 1, v: 10 }));
    const body = captureBody(rows, 2_000);
    assert.equal(body.truncated, true);
    assert.ok(body.bytes > 2_000, "original size was not reported");
    assert.ok(Array.isArray(body.value), "the array shape was lost");
    const sample = body.value as unknown[];
    assert.deepEqual(sample[0], { t: 0, o: 1, h: 2, l: 0, c: 1, v: 10 }, "the first row is unreadable");
    assert.match(String(sample[sample.length - 1]), /more elements/, "the drop was not declared");
  });

  it("the result is always valid JSON — a half-closed object would break the viewer", () => {
    clearSecrets();
    const body = captureBody({ blob: "x".repeat(50_000) }, 500);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(body.value)));
  });

  it("redacts inside a captured body, not only in the URL", () => {
    clearSecrets();
    registerSecret("insidebodysecret1");
    const body = captureBody({ echo: "your key insidebodysecret1 was rejected" });
    assert.ok(!JSON.stringify(body.value).includes("insidebodysecret1"), "a body leaked a credential");
    clearSecrets();
  });
});

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
// Breaker introspection
// --------------------------------------------------------------------------

describe("reading breaker state does not change it", () => {
  it("breakerSnapshot leaves an elapsed breaker open for the next real caller to probe", () => {
    const s = new MemoryStore();
    s.set("breaker:x", { failures: 3, openedAt: Date.now() - BREAKER_COOLDOWN_MS - 1 }, 60_000);

    const snap = breakerSnapshot("x", s);
    assert.equal(snap.state, "half_open");
    assert.notEqual(s.get("breaker:x"), undefined, "polling status retired the breaker");

    // breakerOpen is the dispatch path and *is* allowed to retire it.
    assert.equal(breakerOpen("x", s), false);

    /**
     * Retired means "no longer holding the provider out", not "erased".
     *
     * This used to assert the record was deleted outright. That delete was the
     * bug: `breakerOpen` runs BEFORE the call, so by the time the probe
     * succeeded there was nothing left to say a circuit had been open, and
     * `recordSuccess` emitted no closing transition. Every automatically
     * recovered circuit then read as still open forever in the remediation
     * ledger. The failure count is still zeroed — a failed probe re-counts from
     * one, exactly as documented — but the record survives to carry that fact.
     */
    assert.equal(breakerSnapshot("x", s).state, "closed", "the breaker still holds the provider out");
    assert.equal(breakerSnapshot("x", s).failures, 0, "the failure count did not reset");
    assert.equal(breakerOpen("x", s), false, "a retired breaker still skips the provider");
  });

  it("carries the failure count toward the trip while still closed", () => {
    const s = new MemoryStore();
    recordFailure("y", s);
    const snap = breakerSnapshot("y", s);
    assert.equal(snap.state, "closed");
    assert.equal(snap.failures, 1);
    assert.equal(snap.threshold, 3);
  });

  it("reset reports whether a circuit was actually holding the provider out", () => {
    const s = new MemoryStore();
    recordFailure("z", s);
    assert.equal(resetBreaker("z", s), false, "a single failure was reported as an open circuit");
    for (let i = 0; i < 3; i++) recordFailure("z", s);
    assert.equal(resetBreaker("z", s), true);
  });
});

// --------------------------------------------------------------------------
// Simulated outages
// --------------------------------------------------------------------------

describe("a simulated outage is visibly deliberate and cannot outlive the operator", () => {
  it("dispatch skips the provider with its own reason, not a borrowed one", async () => {
    clearAllOutages();
    const s = new MemoryStore();
    simulateOutage("primary", 60_000);

    const result = await dispatch(
      [fake("primary"), fake("secondary")],
      (a, ctx) => a.quote!("TEST", "equity", ctx),
      { capability: "quote", cacheKey: "sim-1", store: s, env: EMPTY_ENV },
    );

    assert.equal(result.provenance.provider, "secondary", "failover did not happen");
    assert.equal(result.attempts[0].provider, "primary");
    assert.equal(
      result.attempts[0].reason,
      "simulated_outage",
      "an operator-caused skip was labelled as something else",
    );
    clearAllOutages();
  });

  it("expires on its own", () => {
    clearAllOutages();
    // Below the 10s floor, so the clamp is what is being checked too.
    const record = simulateOutage("primary", 1_000);
    assert.ok(record.expiresAt - Date.now() >= 10_000, "the ttl floor did not apply");
    assert.equal(activeOutages().length, 1);
    clearAllOutages();
    assert.equal(activeOutages().length, 0);
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

// --------------------------------------------------------------------------
// Failover graph
// --------------------------------------------------------------------------

describe("the failover graph agrees with the code it describes", () => {
  it("marks exactly one active node and it is the first routable one", () => {
    const s = new MemoryStore();
    const route = failoverRoute("quote", "crypto", EMPTY_ENV, s);
    assert.ok(route.nodes.length > 1, "expected a ranked chain");

    const active = route.nodes.filter((n) => n.active);
    assert.equal(active.length, 1, "more than one node claimed to be serving");
    assert.equal(active[0].provider, route.activeProvider);
    // With no keys configured only the keyless provider can route.
    assert.equal(route.activeProvider, "binance");
    assert.ok(
      route.nodes.filter((n) => n.provider !== "binance").every((n) => n.state === "not_configured"),
      "an unconfigured provider was reported as routable",
    );
  });

  it("reports no active provider rather than inventing one when the chain is dark", () => {
    const s = new MemoryStore();
    // Fundamentals has no keyless provider, so an empty env leaves it unroutable.
    const route = failoverRoute("fundamentals", "equity", EMPTY_ENV, s);
    assert.equal(route.activeProvider, null);
    assert.ok(route.nodes.every((n) => !n.active));
  });

  it("a learned licence refusal shows on the route node and the provider row", () => {
    const s = new MemoryStore();
    const env = { ...EMPTY_ENV, TIINGO_API_KEY: "k" } as NodeJS.ProcessEnv;
    markUnlicensed("tiingo", "news", 403, "You do not have permission to access the News API", s);
    const news = failoverRoute("news", "equity", env, s);
    const tiingo = news.nodes.find((n) => n.provider === "tiingo")!;
    assert.equal(tiingo.state, "unlicensed");
    assert.match(tiingo.detail, /HTTP 403 on news; learned on this instance, re-probes in \d+ h/);
    assert.equal(tiingo.active, false, "an unlicensed node must not be the one serving");
    // Scoped to the capability: the same key still routes quotes.
    const quote = failoverRoute("quote", "equity", env, s);
    assert.equal(quote.nodes.find((n) => n.provider === "tiingo")!.state, "ready");
    // And the provider row lists what the key was refused.
    const row = providerStatus(env, s).find((r) => r.id === "tiingo")!;
    assert.deepEqual(row.licence.map((b) => [b.capability, b.status]), [["news", 403]]);
    assert.ok(row.licence[0].expiresAt > Date.now());
  });

  it("providerStatus exposes the breaker shape and does not mutate it", () => {
    const s = new MemoryStore();
    for (let i = 0; i < 3; i++) recordFailure("fmp", s);
    const rows = providerStatus(EMPTY_ENV, s);
    const fmp = rows.find((r) => r.id === "fmp")!;
    assert.equal(fmp.breaker.state, "open");
    assert.equal(fmp.circuitOpen, true);
    assert.ok(fmp.breaker.cooldownRemainingMs > 0);
    assert.notEqual(s.get("breaker:fmp"), undefined, "reading status cleared the breaker");
  });
});

// --------------------------------------------------------------------------
// Operator guard
// --------------------------------------------------------------------------

describe("mutating actions are closed by default where it matters", () => {
  it("production with no token refuses outright", () => {
    const env = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
    assert.equal(guardMode(env), "locked");
    const rejection = authorise(null, env)!;
    assert.equal(rejection.status, 503);
    assert.equal(rejection.code, "operator_actions_disabled");
    assert.match(rejection.hint!, /ALPHAENGINE_OPERATOR_TOKEN/);
  });

  it("a non-production build is open, so the console is usable locally", () => {
    const env = { NODE_ENV: "development" } as NodeJS.ProcessEnv;
    assert.equal(guardMode(env), "open-dev");
    assert.equal(authorise(null, env), null);
  });

  it("a configured token is required and compared whole", () => {
    const env = {
      NODE_ENV: "production",
      ALPHAENGINE_OPERATOR_TOKEN: "correct-horse-battery-staple",
    } as NodeJS.ProcessEnv;
    assert.equal(guardMode(env), "token");
    assert.equal(authorise("Bearer correct-horse-battery-staple", env), null);
    // A prefix must not pass — timingSafeEqual throws on unequal lengths, so the
    // length check has to come first or this is a 500 and a length oracle.
    assert.equal(authorise("Bearer correct-horse", env)!.status, 401);
    assert.equal(authorise(null, env)!.status, 401);
  });

  it("never echoes the presented credential", () => {
    const env = { NODE_ENV: "production", ALPHAENGINE_OPERATOR_TOKEN: "realtoken123" } as NodeJS.ProcessEnv;
    const rejection = authorise("Bearer guessed-token-value", env)!;
    assert.ok(!JSON.stringify(rejection).includes("guessed-token-value"));
  });
});

// --------------------------------------------------------------------------
// Operator action parsing
// --------------------------------------------------------------------------

describe("an operator action is rejected, never coerced", () => {
  it("an unknown action is refused rather than defaulted", () => {
    const parsed = parseAction({ action: "delete_everything" });
    assert.equal(parsed.ok, false);
    assert.match((parsed as { error: string }).error, /unknown action/);
  });

  it("an unknown provider is refused — a typo must not reset a different one", () => {
    const parsed = parseAction({ action: "reset_breaker", provider: "fpm" });
    assert.equal(parsed.ok, false);
    assert.match((parsed as { error: string }).error, /unknown provider/);
  });

  it("\"all\" is accepted only where it is meaningful", () => {
    assert.equal(parseAction({ action: "reset_breaker", provider: "all" }).ok, true);
    const parsed = parseAction({ action: "simulate_outage", provider: "all" });
    assert.equal(parsed.ok, false, "an outage on every provider at once was permitted");
  });

  it("an action that requires a provider does not silently apply to none", () => {
    assert.equal(parseAction({ action: "probe_provider" }).ok, false);
  });

  it("a purge scope must name something the purge can reach", () => {
    assert.equal(parseAction({ action: "purge_cache", scope: "quota" }).ok, false);
    assert.equal(parseAction({ action: "purge_cache", scope: "symbol:BTC USDT" }).ok, false);
    const ok = parseAction({ action: "purge_cache", scope: "symbol:btcusdt" });
    assert.equal(ok.ok, true);
    assert.equal((ok as { action: { scope?: string } }).action.scope, "symbol:BTCUSDT");
  });

  it("an absent scope means the documented default, not a rejection", () => {
    const parsed = parseAction({ action: "purge_cache" });
    assert.equal(parsed.ok, true);
    assert.equal((parsed as { action: { scope?: string } }).action.scope, "all");
  });

  it("a non-numeric ttl is refused rather than clamped to the floor", () => {
    // Number("abc") is NaN and NaN survives Math.min/Math.max — the same trap
    // lib/params documents, and here it would silently mean "10 seconds".
    assert.equal(parseAction({ action: "simulate_outage", provider: "fmp", ttlMs: "abc" }).ok, false);
    const parsed = parseAction({ action: "simulate_outage", provider: "fmp", ttlMs: 99_999_999 });
    assert.equal(parsed.ok, true);
    assert.ok((parsed as { action: { ttlMs?: number } }).action.ttlMs! <= 15 * 60_000, "ttl was not clamped");
  });

  it("a body that is not an object is refused", () => {
    assert.equal(parseAction(null).ok, false);
    assert.equal(parseAction([{ action: "purge_cache" }]).ok, false);
    assert.equal(parseAction("purge_cache").ok, false);
  });
});

// --------------------------------------------------------------------------
// Emission
// --------------------------------------------------------------------------

describe("events carry the origin they were produced at", () => {
  it("browser and server lines are tagged, never conflated", () => {
    resetTelemetry({ events: true });
    emit({ source: "Console", message: "local" }, "browser");
    emit({ source: "Dispatch", message: "remote" });
    const lines = eventsSince(0);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].origin, "browser");
    assert.equal(lines[1].origin, "server");
    resetTelemetry({ events: true });
  });

  it("an undefined field is dropped rather than serialised as null", () => {
    resetTelemetry({ events: true });
    emit({ source: "T", message: "m", fields: { present: 1, absent: undefined } });
    const [line] = eventsSince(0);
    assert.deepEqual(Object.keys(line.fields), ["present"], "absent and null were collapsed");
    resetTelemetry({ events: true });
  });
});

describe("the shared ledger sync: queues, overlay, and honest fallback", () => {
  const emptyLedger = (): SharedOpsViewWire["data_quality"] => ({
    backend: "sqlite",
    retention_days: 7,
    window_minutes: 1440,
    observed_at: new Date().toISOString(),
    first_observed_at: null,
    last_observed_at: null,
    instances: 0,
    total: { evaluated: 0, passed: 0, fatal: 0, warn: 0, drift: 0, not_evaluated: 0 },
    by_provider: [],
    by_capability: [],
    recent: [],
    escalations: [],
  });
  const view = (overrides: Partial<SharedOpsViewWire> = {}): SharedOpsViewWire => ({
    schema_version: 1,
    observed_at: new Date().toISOString(),
    window_seconds: 900,
    instances: ["remote-1", "remote-2"],
    latency: [],
    outages: [],
    quota: [],
    data_quality: emptyLedger(),
    ...overrides,
  });

  it("drains recorded samples into the sync body and clears the queue", () => {
    resetTelemetry({ latency: true, shared: true });
    recordLatency("shared-key", 100, true);
    recordLatency("shared-key", 200, false);
    const body = takePendingOps();
    const batch = body.latency.find((b) => b.key === "shared-key");
    assert.equal(batch?.samples.length, 2);
    assert.deepEqual(takePendingOps().latency, [], "a second drain must be empty");
    resetTelemetry({ latency: true, shared: true });
  });

  it("a failed push restores the drained body without losing newer deltas", () => {
    resetTelemetry({ latency: true, shared: true });
    recordLatency("k", 10, true);
    const body = takePendingOps();
    recordLatency("k", 20, true); // recorded while the push was in flight
    restorePendingOps(body);
    const retry = takePendingOps();
    const samples = retry.latency.find((b) => b.key === "k")?.samples ?? [];
    assert.deepEqual(samples.map((s) => s.ms), [10, 20], "restored samples come back oldest-first");
    resetTelemetry({ latency: true, shared: true });
  });

  it("a fresh overlay becomes the read model, supplemented by post-drain samples", () => {
    resetTelemetry({ latency: true, shared: true });
    const drainedAt = Date.now() - 1_000;
    applySharedOpsState(
      view({
        latency: [{ key: "merged", samples: [
          { ts: drainedAt - 5_000, ms: 50, ok: true },
          { ts: drainedAt - 4_000, ms: 60, ok: true },
        ] }],
      }),
      drainedAt,
    );
    recordLatency("merged", 70, true); // after the drain — not yet pushed
    const stats = latencyStats("merged");
    assert.equal(stats.n, 3, "two merged samples plus one local supplement");
    assert.equal(stats.max, 70);
    resetTelemetry({ latency: true, shared: true });
  });

  it("a stale overlay is not believed: reads fall back to the local bucket", () => {
    resetTelemetry({ latency: true, shared: true });
    applySharedOpsState(
      view({ latency: [{ key: "old", samples: [{ ts: Date.now(), ms: 999, ok: true }] }] }),
      Date.now(),
    );
    const later = Date.now() + SHARED_STALE_MS + 1_000;
    assert.equal(latencyStats("old", later).n, 0, "the overlay aged out and nothing local exists");
    assert.equal(sharedOpsStatus(later).backed, false);
    resetTelemetry({ latency: true, shared: true });
  });

  it("an outage set by another instance blocks routing here", () => {
    resetTelemetry({ shared: true, outages: true });
    applySharedOpsState(
      view({ outages: [{ provider: "remote-outage", expires_at: Date.now() + 60_000, note: "drill" }] }),
      Date.now(),
    );
    assert.equal(outageFor("remote-outage")?.note, "drill");
    assert.ok(activeOutages().some((o) => o.provider === "remote-outage"));
    resetTelemetry({ shared: true, outages: true });
  });

  it("clearing locally also clears the overlay and queues the command — no resurrection", () => {
    resetTelemetry({ shared: true, outages: true });
    applySharedOpsState(
      view({ outages: [{ provider: "p", expires_at: Date.now() + 60_000, note: "n" }] }),
      Date.now(),
    );
    assert.ok(outageFor("p"));
    assert.equal(clearOutage("p"), true, "an overlay-only outage is still a known outage");
    assert.equal(outageFor("p"), null, "cleared, not waiting for the next sync to disagree");
    const body = takePendingOps();
    assert.deepEqual(body.outages_cleared, ["p"]);
    resetTelemetry({ shared: true, outages: true });
  });

  it("set-after-clear in one batch keeps the set", () => {
    resetTelemetry({ shared: true, outages: true });
    simulateOutage("flip", 30_000);
    clearOutage("flip");
    simulateOutage("flip", 30_000);
    const body = takePendingOps();
    assert.equal(body.outages_set.length, 1);
    assert.deepEqual(body.outages_cleared, [], "the newer set must not ride with a stale clear");
    clearAllOutages();
    resetTelemetry({ shared: true, outages: true });
  });

  it("quota deltas accumulate per window and a reset supersedes them", () => {
    resetTelemetry({ shared: true });
    recordQuotaSpend("fmp", "2026-08-11");
    recordQuotaSpend("fmp", "2026-08-11");
    recordQuotaReset("fmp", "2026-08-11");
    const body = takePendingOps();
    assert.deepEqual(body.quota, [], "spend before a reset is meaningless to push");
    assert.deepEqual(body.quota_reset, [{ provider: "fmp", window: "2026-08-11" }]);
    resetTelemetry({ shared: true });
  });

  it("hydration replaces local counters and an explicit zero deletes one", () => {
    const s = new MemoryStore();
    s.incr("quota:fmp:2026-08-11", 86_400_000);
    hydrateQuotaLedger(
      [
        { provider: "fmp", window: "2026-08-11", spent: 7 },
        { provider: "tiingo", window: "2026-08-11", spent: 0 },
      ],
      s,
    );
    assert.equal(s.get("quota:fmp:2026-08-11"), 7, "shared total replaces the local count");
    assert.equal(s.get("quota:tiingo:2026-08-11"), undefined, "zero means a propagated reset");
  });

  it("the sync response validator refuses shapes the overlay cannot hold", () => {
    assert.equal(isSharedOpsView(view()), true);
    assert.equal(isSharedOpsView({ ...view(), schema_version: 2 }), false);
    assert.equal(isSharedOpsView({ ...view(), observed_at: "not-a-date" }), false);
    assert.equal(isSharedOpsView({ ...view(), latency: "nope" }), false);
    assert.equal(isSharedOpsView(null), false);
  });

  it("contract findings drain into the sync body with a per-instance seq, and a restore never doubles one", () => {
    resetTelemetry({ shared: true });
    queueContractFinding({
      capability: "quote", provider: "fmp", symbol: "AAPL", key: "quote:AAPL:*", passed: false,
      violations: [{ check: "quote.price_positive", severity: "fatal", message: "no positive price" }],
      notEvaluated: 1,
    });
    queueContractFinding({
      capability: "bars", provider: "massive", symbol: null, key: "bars:AAPL:1d:120:*", passed: true,
      violations: [], notEvaluated: 0,
    });
    const body = takePendingOps();
    assert.equal(body.findings.length, 2);
    assert.deepEqual(body.findings.map((f) => f.seq), [1, 2], "the seq is monotonic from this instance");
    assert.equal(body.findings[0].fatal, 1);
    assert.equal(body.findings[0].passed, false);
    assert.equal(body.findings[1].symbol, null);
    assert.deepEqual(takePendingOps().findings, [], "a drain empties the queue");
    // A push that failed after the drain: the body comes back, but a finding
    // queued meanwhile keeps its own seq, and re-restoring cannot double any.
    queueContractFinding({ capability: "quote", provider: "fmp", symbol: "MSFT", key: "k", passed: true, violations: [], notEvaluated: 0 });
    restorePendingOps(body);
    restorePendingOps(body);
    const again = takePendingOps();
    assert.deepEqual(again.findings.map((f) => f.seq), [1, 2, 3]);
    resetTelemetry({ shared: true });
  });

  it("a finding's message is redacted before it is queued", () => {
    resetTelemetry({ shared: true });
    registerSecret("hunter2hunter2hunter2");
    queueContractFinding({
      capability: "quote", provider: "alphavantage", symbol: "AAPL", key: "k", passed: true,
      violations: [{ check: "quote.freshness", severity: "warn", message: "stale — https://v.test/q?apikey=hunter2hunter2hunter2" }],
      notEvaluated: 0,
    });
    const [finding] = takePendingOps().findings;
    assert.doesNotMatch(finding.checks[0].message, /hunter2hunter2hunter2/);
    clearSecrets();
    resetTelemetry({ shared: true });
  });

  it("the merged quality ledger is read only while the overlay is fresh, and a missing block is null", () => {
    resetTelemetry({ shared: true });
    const now = Date.now();
    applySharedOpsState(view(), now, now);
    const ledger = sharedDataQuality(now);
    assert.ok(ledger, "a fresh sync carries the ledger");
    assert.equal(ledger!.backend, "sqlite");
    assert.equal(sharedDataQuality(now + SHARED_STALE_MS + 1), null, "a stale overlay is not believed");
    // An older gateway omits the block: guarded, not trusted.
    applySharedOpsState({ ...view(), data_quality: undefined as unknown as SharedOpsViewWire["data_quality"] }, now, now);
    assert.equal(sharedDataQuality(now), null);
    resetTelemetry({ shared: true });
  });
});
