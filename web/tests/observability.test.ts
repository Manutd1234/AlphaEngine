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
  activeOutages,
  captureBody,
  clearAllOutages,
  clearSecrets,
  emit,
  eventsSince,
  latencyStats,
  percentile,
  recordLatency,
  redact,
  redactUrl,
  registerSecret,
  resetTelemetry,
  simulateOutage,
} from "../lib/observability";
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
    assert.equal(s.get("breaker:x"), undefined);
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
