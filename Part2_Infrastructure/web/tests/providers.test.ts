/**
 * Provider layer tests — the reliability policy, not the vendors.
 *
 * Nothing here touches the network. What is worth testing is the machinery that
 * decides *whether and whom* to call: the quota ledger (does background traffic
 * actually stop at the reserve?), the breaker (does a dead provider get skipped,
 * and does it get another chance?), failover order, provenance honesty, the
 * coercion funnel, and the SSRF guard. Each of these has a specific way of being
 * wrong that would not crash — it would return a plausible answer from the wrong
 * place, which is the expensive kind of bug.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { eventCursor, eventsSince } from "../lib/observability";
import { assertPublicUrl } from "../lib/providers/firecrawl";
import { iso, num, pctChange, str } from "../lib/providers/parse";
import { classify, candidatesFor, isValidSymbol } from "../lib/providers/registry";
import {
  MemoryStore,
  breakerOpen,
  dispatch,
  quotaBlock,
  quotaState,
  recordFailure,
  recordSuccess,
  spendQuota,
  windowKey,
} from "../lib/providers/runtime";
import { Adapter, ProviderError, Quote } from "../lib/providers/types";

// --------------------------------------------------------------------------
// Test doubles
// --------------------------------------------------------------------------

const QUOTE: Quote = {
  symbol: "TEST", price: 100, change: 1, changePct: 1, open: 99, high: 101,
  low: 98, prevClose: 99, volume: 1000, currency: "USD",
  asOf: "2026-08-03T00:00:00.000Z", delayed: false,
};

function fake(
  id: string,
  behave: (calls: number) => Quote,
  quota: Adapter["meta"]["quota"] = { calls: 10, window: "day", reserve: 0.2 },
): { adapter: Adapter; calls: () => number } {
  let calls = 0;
  const adapter: Adapter = {
    meta: {
      id, label: id, docs: "", capabilities: ["quote"], assets: ["equity"],
      keyEnv: "", quota, rank: { quote: 1 }, signup: "",
    },
    quote: async () => {
      calls += 1;
      return behave(calls);
    },
  };
  return { adapter, calls: () => calls };
}

const failing = (id: string) =>
  fake(id, () => {
    throw new ProviderError(id, "boom", 500, false);
  });

// --------------------------------------------------------------------------
// Coercion funnel
// --------------------------------------------------------------------------

test("num: vendor missing-value spellings become null, never NaN or 0", () => {
  for (const v of ["None", "", "-", "N/A", "null", undefined, null, {}, []]) {
    assert.equal(num(v), null, `num(${JSON.stringify(v)})`);
  }
  assert.equal(num("1,234.5"), 1234.5); // thousands separator in vendor JSON
  assert.equal(num("1.23%"), 1.23);     // Alpha Vantage percent string
  assert.equal(num(NaN), null);
  assert.equal(num(Infinity), null);
});

test("iso: epoch seconds vs ms boundary, AV compact stamps, bare dates as UTC", () => {
  // Epoch seconds and ms for the same instant resolve identically.
  assert.equal(iso(1717200000), iso(1717200000000));
  // Alpha Vantage's 20240102T120000 — new Date() would give Invalid Date.
  assert.equal(iso("20240102T120000"), "2024-01-02T12:00:00.000Z");
  // A bare date is midnight UTC, not local — mixing shifts a series by the offset.
  assert.equal(iso("2024-01-02"), "2024-01-02T00:00:00.000Z");
  assert.equal(iso("garbage"), null);
});

test("pctChange guards the zero denominator", () => {
  assert.equal(pctChange(100, 0), null); // halted placeholder row, not −∞
  assert.ok(Math.abs((pctChange(110, 100) ?? 0) - 10) < 1e-9);
  assert.equal(pctChange(null, 100), null);
});

test("str treats sentinel strings as absent", () => {
  assert.equal(str("None"), null);
  assert.equal(str("  AAPL  "), "AAPL");
});

// --------------------------------------------------------------------------
// Symbol classification
// --------------------------------------------------------------------------

test("classify: pairs are crypto, bare bases are not", () => {
  assert.equal(classify("BTCUSDT"), "crypto");
  assert.equal(classify("ETHUSD"), "crypto");
  // BTC alone is a real NYSE listing (Bitcoin Depot) — must stay equity.
  assert.equal(classify("BTC"), "equity");
  assert.equal(classify("AAPL"), "equity");
  assert.equal(classify("EURUSD"), "fx");
  // SOLUSD is crypto (SOL is a known base), not fx.
  assert.equal(classify("SOLUSD"), "crypto");
});

test("isValidSymbol accepts class shares and rejects injection shapes", () => {
  assert.ok(isValidSymbol("BRK.B"));
  assert.ok(isValidSymbol("AAPL"));
  assert.ok(isValidSymbol("BTCUSDT"));
  assert.ok(!isValidSymbol("A;DROP"));
  assert.ok(!isValidSymbol(""));
});

test("candidatesFor orders by rank and filters by asset", () => {
  const eq = candidatesFor("bars", "equity").map((a) => a.meta.id);
  // Massive leads the equity bars chain. Its rank moved 1 -> 2 when Bybit was
  // inserted ahead of Binance for crypto and every rank below shifted by one;
  // the assertion is on the resulting ORDER rather than the literal, which is
  // what should survive that kind of renumbering.
  assert.ok(!eq.includes("binance"), "a crypto-only venue reached the equity chain");
  assert.ok(!eq.includes("bybit"), "a crypto-only venue reached the equity chain");
  assert.equal(eq[0], "massive");
  const cr = candidatesFor("quote", "crypto").map((a) => a.meta.id);
  assert.equal(cr[0], "binance"); // keyless baseline first — Bybit serves bars only
  const crBars = candidatesFor("bars", "crypto").map((a) => a.meta.id);
  assert.equal(crBars[0], "bybit"); // the nearer origin: 6.2ms vs 72.7ms
});

// --------------------------------------------------------------------------
// Quota ledger
// --------------------------------------------------------------------------

test("quota: background is fenced out of the reserve, interactive can spend it", () => {
  const s = new MemoryStore();
  const { adapter } = fake("m", () => QUOTE, { calls: 4, window: "day", reserve: 0.5 });

  // Spend down to the reserve boundary (reserve = 2 of 4).
  spendQuota(adapter, s);
  spendQuota(adapter, s);
  assert.equal(quotaBlock(adapter, "background", s), "quota_reserved");
  assert.equal(quotaBlock(adapter, "interactive", s), null);

  // Interactive spends the rest; then even interactive is blocked.
  spendQuota(adapter, s);
  spendQuota(adapter, s);
  assert.equal(quotaBlock(adapter, "interactive", s), "quota_exhausted");
});

test("quota: windows are calendar-aligned, so a month rolls the counter", () => {
  const jan = windowKey("month", Date.UTC(2026, 0, 31, 23, 59));
  const feb = windowKey("month", Date.UTC(2026, 1, 1, 0, 1));
  assert.notEqual(jan, feb);
  const d1 = windowKey("day", Date.UTC(2026, 7, 3, 23, 59));
  const d2 = windowKey("day", Date.UTC(2026, 7, 4, 0, 0));
  assert.notEqual(d1, d2);
});

test("quota: incr does not slide the window forward", () => {
  const s = new MemoryStore();
  // Two increments must share one expiry; a sliding TTL would never reset the
  // counter for a provider under constant load — permanent starvation.
  s.incr("k", 1000);
  const firstExpiry = (s as unknown as { map: Map<string, { expiresAt: number }> }).map.get("k")!.expiresAt;
  s.incr("k", 1000);
  const secondExpiry = (s as unknown as { map: Map<string, { expiresAt: number }> }).map.get("k")!.expiresAt;
  assert.equal(firstExpiry, secondExpiry);
});

// --------------------------------------------------------------------------
// Circuit breaker
// --------------------------------------------------------------------------

test("breaker: opens after 3 consecutive failures, not before", () => {
  const s = new MemoryStore();
  recordFailure("x", s);
  recordFailure("x", s);
  assert.equal(breakerOpen("x", s), false);
  recordFailure("x", s);
  assert.equal(breakerOpen("x", s), true);
});

/**
 * An automatic recovery has to be OBSERVABLE, or the remediation ledger reports
 * every self-healed circuit as still open forever.
 *
 * The dispatch order is the trap: `breakerOpen` is the gate and runs BEFORE the
 * call, so by the time `recordSuccess` runs, the gate has already retired the
 * breaker record. When that retirement was a delete, the success saw nothing to
 * close and emitted nothing — and the only `state: "closed"` line the system
 * ever produced came from an operator pressing the button. A reliability
 * surface built on that reads as a desk that never recovers on its own.
 */
test("breaker: a probe that succeeds after the cooldown emits its own closure", () => {
  const s = new MemoryStore();
  const id = `auto-recovery-${Math.random().toString(36).slice(2, 8)}`;
  const before = eventCursor().latest;

  // A circuit that tripped just over a cooldown ago.
  s.set(`breaker:${id}`, { failures: 3, openedAt: Date.now() - 61_000 }, 240_000);

  assert.equal(breakerOpen(id, s), false, "the cooldown elapsed, so the probe is allowed through");
  recordSuccess(id, s);

  const states = eventsSince(before, 200)
    .filter((e) => e.source === "Breaker" && e.fields.provider === id)
    .map((e) => e.fields.state);
  assert.deepEqual(states, ["half_open", "closed"], "the automatic recovery was silent");
});

test("breaker: a probe that fails re-counts from one and claims no recovery", () => {
  const s = new MemoryStore();
  const id = `failed-probe-${Math.random().toString(36).slice(2, 8)}`;
  const before = eventCursor().latest;

  s.set(`breaker:${id}`, { failures: 3, openedAt: Date.now() - 61_000 }, 240_000);
  breakerOpen(id, s);
  recordFailure(id, s);

  // One failure after a probe is one failure, not a re-trip: the documented
  // behaviour is that re-opening takes three fresh consecutive failures.
  assert.equal(breakerOpen(id, s), false, "a single failed probe re-opened the circuit");

  // And a success now must NOT claim to have closed anything — nothing was open.
  recordSuccess(id, s);
  const closures = eventsSince(before, 200)
    .filter((e) => e.source === "Breaker" && e.fields.provider === id && e.fields.state === "closed");
  assert.equal(closures.length, 0, "a recovery was invented from a circuit that was not open");
});

// --------------------------------------------------------------------------
// Dispatch
// --------------------------------------------------------------------------

test("dispatch: fails over in order and records why the primary was skipped", async () => {
  const s = new MemoryStore();
  const primary = failing("primary");
  const backup = fake("backup", () => ({ ...QUOTE, price: 200 }));

  const r = await dispatch(
    [primary.adapter, backup.adapter],
    (a, ctx) => a.quote!("TEST", "equity", ctx),
    { capability: "quote", cacheKey: "t1", store: s, env: {} as NodeJS.ProcessEnv },
  );

  assert.equal(r.data.price, 200);
  assert.equal(r.provenance.provider, "backup");
  // The failover is visible: the primary's failure is in the attempts list.
  assert.deepEqual(r.attempts.map((a) => [a.provider, a.reason]), [["primary", "failed"]]);
});

test("dispatch: second call is served from cache without spending quota", async () => {
  const s = new MemoryStore();
  const p = fake("only", () => QUOTE);

  await dispatch([p.adapter], (a, ctx) => a.quote!("TEST", "equity", ctx), {
    capability: "quote", cacheKey: "t2", store: s, env: {} as NodeJS.ProcessEnv,
  });
  const second = await dispatch([p.adapter], (a, ctx) => a.quote!("TEST", "equity", ctx), {
    capability: "quote", cacheKey: "t2", store: s, env: {} as NodeJS.ProcessEnv,
  });

  assert.equal(p.calls(), 1);
  assert.equal(second.provenance.cached, true);
  assert.equal(quotaState(p.adapter, s)!.used, 1); // one spend, not two
});

test("dispatch: an exhausted provider is skipped with the ledger's arithmetic attached", async () => {
  const s = new MemoryStore();
  const tiny = fake("tiny", () => QUOTE, { calls: 1, window: "day", reserve: 0 });
  const backup = fake("backup2", () => QUOTE);
  spendQuota(tiny.adapter, s); // burn the whole allowance

  const r = await dispatch(
    [tiny.adapter, backup.adapter],
    (a, ctx) => a.quote!("TEST", "equity", ctx),
    { capability: "quote", cacheKey: "t3", store: s, env: {} as NodeJS.ProcessEnv },
  );

  assert.equal(r.provenance.provider, "backup2");
  const skip = r.attempts.find((a) => a.provider === "tiny")!;
  assert.equal(skip.reason, "quota_exhausted");
  assert.match(skip.detail!, /1\/1 used this day/);
  assert.equal(tiny.calls(), 0); // never actually called
});

test("dispatch: after the breaker opens the provider is not even attempted", async () => {
  const s = new MemoryStore();
  const bad = failing("bad");
  const good = fake("good", () => QUOTE);

  // Three dispatches with distinct cache keys → three failures → breaker opens.
  for (let i = 0; i < 3; i++) {
    await dispatch([bad.adapter, good.adapter], (a, ctx) => a.quote!("T", "equity", ctx), {
      capability: "quote", cacheKey: `warm${i}`, store: s, env: {} as NodeJS.ProcessEnv,
    });
  }
  assert.equal(bad.calls(), 3);

  const r = await dispatch([bad.adapter, good.adapter], (a, ctx) => a.quote!("T", "equity", ctx), {
    capability: "quote", cacheKey: "after", store: s, env: {} as NodeJS.ProcessEnv,
  });
  assert.equal(bad.calls(), 3); // skipped, not re-timed-out
  assert.equal(r.attempts[0].reason, "circuit_open");
});

test("dispatch: when nobody can serve, the error carries the whole attempt list", async () => {
  const s = new MemoryStore();
  const a = failing("a1");
  const b = failing("b1");
  await assert.rejects(
    dispatch([a.adapter, b.adapter], (x, ctx) => x.quote!("T", "equity", ctx), {
      capability: "quote", cacheKey: "t4", store: s, env: {} as NodeJS.ProcessEnv,
    }),
    (err: ProviderError & { attempts: { provider: string }[] }) => {
      assert.equal(err.attempts.length, 2);
      return true;
    },
  );
});

test("dispatch: pin restricts the pool to one provider", async () => {
  const s = new MemoryStore();
  const first = fake("first", () => ({ ...QUOTE, price: 1 }));
  const second = fake("second", () => ({ ...QUOTE, price: 2 }));

  const r = await dispatch(
    [first.adapter, second.adapter],
    (a, ctx) => a.quote!("T", "equity", ctx),
    { capability: "quote", cacheKey: "t5", pin: "second", store: s, env: {} as NodeJS.ProcessEnv },
  );
  assert.equal(r.data.price, 2);
  assert.equal(first.calls(), 0);
});

// --------------------------------------------------------------------------
// SSRF guard
// --------------------------------------------------------------------------

test("assertPublicUrl refuses internal targets and odd schemes", () => {
  for (const bad of [
    "file:///etc/passwd",
    "ftp://example.com/x",
    "http://localhost:8000/admin",
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.16.9.9/",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata endpoint
    "http://gateway.internal/health",
    "not a url",
  ]) {
    assert.throws(() => assertPublicUrl(bad), ProviderError, bad);
  }
  // 172.32.x is OUTSIDE the RFC-1918 172.16/12 block and must be allowed —
  // an over-broad /^172\./ would block real public hosts.
  assert.ok(assertPublicUrl("http://172.32.1.1/"));
  assert.ok(assertPublicUrl("https://www.sec.gov/cgi-bin/browse-edgar"));
});
