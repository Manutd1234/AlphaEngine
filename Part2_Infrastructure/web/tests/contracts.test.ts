/**
 * Data contracts — the quiet failures, which are the expensive ones.
 *
 * The adapters already handle the loud case: a quote with no price throws and
 * the registry fails over. What is pinned here is everything that *parses* and
 * is still wrong — a duplicated bar timestamp, a high below its low, a "live"
 * price stamped four days ago. Each of those renders perfectly and produces a
 * number nobody questions.
 *
 * Two behaviours matter as much as the checks themselves:
 *
 *  - A check that could not run must not be reported as passed. Otherwise the
 *    least transparent vendor scores best, which inverts the whole point.
 *  - Only internally impossible data is fatal. Stale is a fact about the world
 *    and gets labelled; inverted is a fact about the record and gets rejected.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkBars,
  checkQuote,
  FRESHNESS_LIMIT_MS,
  summariseContract,
  VALIDATION_TELEMETRY_CAPACITY,
  validationTelemetry,
} from "../lib/providers/contracts";
import { quarantine, quarantinePayload } from "../lib/providers/quarantine";
import type { OhlcvBar, Quote } from "../lib/providers/types";

const NOW = Date.UTC(2026, 7, 5, 12, 0, 0);

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: "BTCUSDT",
    price: 67_500,
    change: 420,
    changePct: 0.0063,
    open: 67_000,
    high: 68_000,
    low: 66_800,
    prevClose: 67_080,
    volume: 12_345,
    currency: "USD",
    asOf: new Date(NOW - 30_000).toISOString(),
    ...overrides,
  } as Quote;
}

function bars(count: number, stepMs = 3_600_000): OhlcvBar[] {
  return Array.from({ length: count }, (_, i) => ({
    t: NOW - (count - i) * stepMs,
    o: 100, h: 101, l: 99, c: 100.5, v: 1000,
  }));
}

// --------------------------------------------------------------------------
// Quotes
// --------------------------------------------------------------------------

describe("callGateway refuses a pre-serialised body", () => {
  // The guard exists because double-encoding produced an upstream 422 that
  // read as a gateway outage. A string body is never legitimate at this
  // boundary, so refusing it outright cannot break a valid caller.
  it("throws a TypeError naming the fix", async () => {
    const { callGateway } = await import("../lib/gateway");
    await assert.rejects(
      () => callGateway("/api/anything", { method: "POST", body: JSON.stringify({ a: 1 }) as unknown as object }),
      /pass a plain object, not a JSON string/,
    );
  });
});

describe("a quote is checked for things that parse and are still wrong", () => {
  it("passes a healthy quote with nothing to report", () => {
    const result = checkQuote("fmp", quote(), NOW);
    assert.equal(result.passed, true);
    assert.deepEqual(result.violations, []);
    assert.equal(summariseContract(result), "passed");
  });

  it("rejects a quote with no usable price", () => {
    for (const price of [0, -1, Number.NaN]) {
      const result = checkQuote("fmp", quote({ price }), NOW);
      assert.equal(result.passed, false, `price ${price} should be fatal`);
      assert.ok(result.violations.some((v) => v.check === "quote.price_positive"));
    }
  });

  it("rejects a high below its low as a broken record, not a market", () => {
    const result = checkQuote("fmp", quote({ high: 66_000, low: 68_000 }), NOW);
    assert.equal(result.passed, false);
    assert.equal(result.violations[0].check, "quote.high_ge_low");
  });

  it("labels a stale quote rather than discarding it", () => {
    const stale = quote({ asOf: new Date(NOW - FRESHNESS_LIMIT_MS - 3_600_000).toISOString() });
    const result = checkQuote("fmp", stale, NOW);
    // Still usable: a trader who can see the age can decide. Dropping it would
    // leave the panel empty and the reason invisible.
    assert.equal(result.passed, true);
    const violation = result.violations.find((v) => v.check === "quote.freshness");
    assert.ok(violation);
    assert.equal(violation.severity, "warn");
  });

  it("flags a future timestamp as a timezone bug", () => {
    const result = checkQuote("fmp", quote({ asOf: new Date(NOW + 3_600_000).toISOString() }), NOW);
    assert.ok(result.violations.some((v) => v.check === "quote.not_from_the_future"));
  });

  it("does not credit a provider for a check it never enabled", () => {
    // No timestamp at all cannot fail a freshness check — and must not pass one.
    const result = checkQuote("binance", quote({ asOf: "" }), NOW);
    assert.ok(result.notEvaluated.includes("quote.freshness"));
    assert.ok(!result.violations.some((v) => v.check === "quote.freshness"));
    assert.match(summariseContract(result), /not evaluated/);
  });

  it("reads a null secondary field as drift, not failure", () => {
    // The price is fine; what is suspect is our mapping of the vendor's schema
    // — the exact misdiagnosis "the change field is null" invites.
    const result = checkQuote("tiingo", quote({ change: null }), NOW);
    assert.equal(result.passed, true);
    const drift = result.violations.find((v) => v.check === "quote.change_derivable");
    assert.ok(drift);
    assert.equal(drift.severity, "drift");
  });

  it("does not call it drift when there is nothing to derive from", () => {
    const result = checkQuote("tiingo", quote({ change: null, prevClose: null }), NOW);
    assert.ok(!result.violations.some((v) => v.check === "quote.change_derivable"));
  });
});

// --------------------------------------------------------------------------
// Bars
// --------------------------------------------------------------------------

describe("bar series are checked for the defects a backtest cannot see", () => {
  it("passes a clean, evenly spaced series", () => {
    const result = checkBars("binance", bars(200), 200);
    assert.equal(result.passed, true);
    assert.deepEqual(result.violations, []);
  });

  it("rejects a duplicated timestamp, which double-counts a return", () => {
    const series = bars(50);
    series[20] = { ...series[20], t: series[19].t };
    const result = checkBars("binance", series, 50);
    assert.equal(result.passed, false);
    // This is the defect that makes a strategy look calmer than the market.
    assert.ok(result.violations.some((v) => v.check === "bars.unique_timestamps"));
  });

  it("rejects bars that arrive out of order", () => {
    const series = bars(50);
    [series[10], series[11]] = [series[11], series[10]];
    const result = checkBars("binance", series, 50);
    assert.equal(result.passed, false);
    assert.ok(result.violations.some((v) => v.check === "bars.monotonic"));
  });

  it("rejects an inverted bar", () => {
    const series = bars(50);
    series[5] = { ...series[5], h: 90, l: 110 };
    const result = checkBars("binance", series, 50);
    assert.equal(result.passed, false);
    assert.ok(result.violations.some((v) => v.check === "bars.high_ge_low"));
  });

  it("warns about a short window without refusing it", () => {
    // A young instrument legitimately has less history; the researcher needs to
    // know their window shrank, not to be denied the data.
    const result = checkBars("binance", bars(40), 200);
    assert.equal(result.passed, true);
    assert.ok(result.violations.some((v) => v.check === "bars.coverage"));
  });

  it("warns about missing bars a strategy would trade straight through", () => {
    const series = bars(100);
    // Drop a stretch of the middle, leaving a hole in the spacing.
    const holed = [...series.slice(0, 40), ...series.slice(55)];
    const result = checkBars("binance", holed, holed.length);
    const gap = result.violations.find((v) => v.check === "bars.no_gaps");
    assert.ok(gap, "a 15-bar hole must be reported");
    // Usable, but the researcher must know the two sides are not consecutive.
    assert.equal(result.passed, true);
    assert.equal(gap.severity, "warn");
  });

  it("does not mistake a weekend for missing data", () => {
    // Daily equity bars gap 3x every Friday-to-Monday and are complete. A rule
    // that counted gaps would fire on every well-formed equity series there is.
    const day = 86_400_000;
    const series: OhlcvBar[] = [];
    let t = Date.UTC(2026, 0, 5); // a Monday
    for (let week = 0; week < 8; week++) {
      for (let d = 0; d < 5; d++) {
        series.push({ t, o: 100, h: 101, l: 99, c: 100.5, v: 1000 });
        t += day;
      }
      t += 2 * day; // the weekend
    }
    const result = checkBars("tiingo", series, series.length);
    assert.ok(!result.violations.some((v) => v.check === "bars.no_gaps"));
  });

  it("treats an empty series as a failure with nothing evaluated", () => {
    const result = checkBars("binance", [], 100);
    assert.equal(result.passed, false);
    assert.equal(result.violations[0].check, "bars.non_empty");
    assert.ok(result.notEvaluated.length > 0);
  });
});

// --------------------------------------------------------------------------
// Quarantine
// --------------------------------------------------------------------------

describe("suspect payloads are kept where someone can look at them", () => {
  it("stores the violations and a redacted excerpt", () => {
    quarantine.clear();
    const result = checkQuote("fmp", quote({ price: -1 }), NOW);
    const record = quarantinePayload(result, "quote:BTCUSDT:*", quote({ price: -1 }),
      (text) => text.replace(/67500/g, "[redacted]"));

    assert.equal(record.rejected, true);
    assert.equal(record.provider, "fmp");
    assert.ok(record.violations.length);
    // The redactor runs on the sample, so a credential echoed in a vendor's
    // error body cannot be stored by the thing meant to help debug it.
    assert.ok(!record.sample.includes("67500"));
  });

  it("is bounded, because a diagnostic buffer is not a data lake", () => {
    quarantine.clear();
    const result = checkQuote("fmp", quote({ price: -1 }), NOW);
    for (let i = 0; i < 120; i++) quarantinePayload(result, `key-${i}`, { i });
    assert.ok(quarantine.size <= 50);
    // Newest first, and the oldest are the ones dropped.
    assert.equal(quarantine.list(1)[0].key, "key-119");
  });

  it("counts records per provider for the console summary", () => {
    quarantine.clear();
    quarantinePayload(checkQuote("fmp", quote({ price: -1 }), NOW), "a", {});
    quarantinePayload(checkQuote("fmp", quote({ change: null }), NOW), "b", {});
    quarantinePayload(checkQuote("tiingo", quote({ price: -1 }), NOW), "c", {});

    const summary = quarantine.byProvider();
    const fmp = summary.find((s) => s.provider === "fmp")!;
    assert.equal(fmp.records, 2);
    // Only one of the two was fatal; a drift warning is not a rejection.
    assert.equal(fmp.rejected, 1);
  });
});

// --------------------------------------------------------------------------
// Validation telemetry
// --------------------------------------------------------------------------

describe("validation evidence is explicit, scoped, and bounded", () => {
  it("counts payload outcomes separately from individual findings", () => {
    validationTelemetry.clear();
    const firstAt = NOW - 1_000;
    const lastAt = NOW;

    validationTelemetry.record(checkQuote("warning-vendor", quote({
      asOf: new Date(NOW - FRESHNESS_LIMIT_MS - 1).toISOString(),
      change: null,
    }), NOW), firstAt);
    validationTelemetry.record(checkBars("fatal-vendor", [], 100), lastAt);

    const snapshot = validationTelemetry.snapshot();
    assert.equal(snapshot.scope, "per-instance");
    assert.equal(snapshot.evaluated, 2);
    assert.equal(snapshot.passed, 1);
    assert.equal(snapshot.fatal, 1);
    assert.equal(snapshot.warn, 1);
    assert.equal(snapshot.drift, 1);
    assert.equal(snapshot.notEvaluated, 3);
    assert.equal(snapshot.windowStart, new Date(firstAt).toISOString());
    assert.equal(snapshot.lastValidationAt, new Date(lastAt).toISOString());
    assert.equal(snapshot.byCapability.quote?.evaluated, 1);
    assert.equal(snapshot.byCapability.bars?.fatal, 1);
    assert.equal(snapshot.byProvider["warning-vendor"].warn, 1);
    assert.equal(snapshot.byProvider["fatal-vendor"].passed, 0);
  });

  it("retains only the fixed observation window", () => {
    validationTelemetry.clear();
    const result = checkQuote("bounded-vendor", quote(), NOW);
    for (let i = 0; i < VALIDATION_TELEMETRY_CAPACITY + 3; i++) {
      validationTelemetry.record(result, NOW + i);
    }

    const snapshot = validationTelemetry.snapshot();
    assert.equal(snapshot.evaluated, VALIDATION_TELEMETRY_CAPACITY);
    assert.equal(snapshot.retained, VALIDATION_TELEMETRY_CAPACITY);
    assert.equal(snapshot.capacity, VALIDATION_TELEMETRY_CAPACITY);
    assert.equal(snapshot.windowStart, new Date(NOW + 3).toISOString());
  });
});

// --------------------------------------------------------------------------
// The runtime wiring
//
// The checks above test pure functions. What actually protects the desk is what
// `dispatch` does with the result — and that is where a subtle ordering bug hid
// for a while: `recordSuccess` deletes a provider's failure count, so evaluating
// the contract *after* it meant a provider returning structurally broken data
// could never trip its breaker. These tests pin the behaviour, not the shape.
// --------------------------------------------------------------------------

import { checkBars as check } from "../lib/providers/contracts";
import { breakerSnapshot, dispatch, MemoryStore } from "../lib/providers/runtime";
import type { Adapter, OhlcvBar as Bar } from "../lib/providers/types";

function fakeAdapter(id: string): Adapter {
  return {
    meta: {
      id,
      label: id,
      docs: "",
      capabilities: ["bars"],
      assets: ["crypto"],
      keyEnv: "",       // keyless, so `isConfigured` is always true
      quota: null,
      rank: { bars: 0 },
      signup: "",
    },
  } as unknown as Adapter;
}

/** A series with a duplicated timestamp — parses fine, fails its contract. */
function brokenBars(): Bar[] {
  return [
    { t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 },
    { t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 },
    { t: 3, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 },
  ];
}

function goodBars(): Bar[] {
  return [
    { t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 },
    { t: 2, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 },
    { t: 3, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 },
  ];
}

describe("a provider that returns broken data is failed like one that returns nothing", () => {
  it("trips its breaker after repeated contract failures", async () => {
    const store = new MemoryStore();
    const adapter = fakeAdapter("badvendor");
    quarantine.clear();

    for (let i = 0; i < 4; i++) {
      // Exhausting the chain throws, which is the correct contract — every
      // candidate was tried and none could answer.
      await assert.rejects(dispatch<Bar[]>([adapter], async () => brokenBars(), {
        capability: "bars",
        cacheKey: `bars:test:${i}`,   // unique, so nothing is served from cache
        store,
        env: { NODE_ENV: "test" } as NodeJS.ProcessEnv,
        contract: (bars) => check("badvendor", bars),
      }));
    }

    // Before the fix this stayed "closed" forever: every response cleared the
    // failure count before the contract was even evaluated, so a vendor
    // emitting duplicated timestamps was retried on every request indefinitely.
    assert.equal(breakerSnapshot("badvendor", store).state, "open");
  });

  it("does not cache a payload that failed, so failover gets a cleaner source", async () => {
    const store = new MemoryStore();
    await assert.rejects(dispatch<Bar[]>([fakeAdapter("badvendor")], async () => brokenBars(), {
      capability: "bars",
      cacheKey: "bars:nocache",
      store,
      env: { NODE_ENV: "test" } as NodeJS.ProcessEnv,
      contract: (bars) => check("badvendor", bars),
    }), "a rejected payload is not an answer");
    // The cache is the part that matters: a rejected payload served from cache
    // would deny the failover chain its shot at a cleaner source.
    assert.ok(!store.get("bars:nocache"));
  });

  it("falls over to the next provider and says why", async () => {
    quarantine.clear();
    validationTelemetry.clear();
    const store = new MemoryStore();
    const evaluatedProviders: string[] = [];
    const result = await dispatch<Bar[]>(
      [fakeAdapter("badvendor"), fakeAdapter("goodvendor")],
      async (adapter) => (adapter.meta.id === "badvendor" ? brokenBars() : goodBars()),
      {
        capability: "bars",
        cacheKey: "bars:failover",
        store,
        env: { NODE_ENV: "test" } as NodeJS.ProcessEnv,
        // Deliberately return the old generic label: dispatch must still own
        // and enforce the adapter identity used by quarantine and telemetry.
        contract: (bars, provider) => {
          evaluatedProviders.push(provider);
          return check("registry", bars);
        },
      },
    );

    assert.equal(result.provenance.provider, "goodvendor");
    assert.equal(result.provenance.contract?.passed, true);
    assert.deepEqual(result.provenance.contract?.violations, []);
    assert.deepEqual(evaluatedProviders, ["badvendor", "goodvendor"]);
    const skipped = result.attempts.find((a) => a.provider === "badvendor");
    assert.ok(skipped, "the rejected provider must appear in the attempt list");
    // The reason names the check, not just "failed" — otherwise the failover
    // graph cannot distinguish bad data from a timeout.
    assert.match(String(skipped.detail), /contract: .*unique_timestamps/);
    assert.equal(quarantine.list(1)[0].provider, "badvendor");
    const telemetry = validationTelemetry.snapshot();
    assert.equal(telemetry.byProvider.badvendor.fatal, 1);
    assert.equal(telemetry.byProvider.goodvendor.passed, 1);
    assert.equal(telemetry.byProvider.registry, undefined);
  });

  it("keeps the record of what was rejected", async () => {
    quarantine.clear();
    const store = new MemoryStore();
    await assert.rejects(dispatch<Bar[]>([fakeAdapter("badvendor")], async () => brokenBars(), {
      capability: "bars",
      cacheKey: "bars:quarantined",
      store,
      env: { NODE_ENV: "test" } as NodeJS.ProcessEnv,
      contract: (bars) => check("badvendor", bars),
    }));
    const record = quarantine.list(1)[0];
    assert.ok(record, "a rejected payload must land in quarantine");
    assert.equal(record.rejected, true);
    assert.equal(record.key, "bars:quarantined");
  });

  it("serves a warned payload rather than failing over on a warning", async () => {
    const store = new MemoryStore();
    // Fewer bars than requested is a `warn`, not a `fatal`: a young instrument
    // legitimately has less history and the researcher needs the data plus the
    // caveat, not an empty panel.
    const result = await dispatch<Bar[]>([fakeAdapter("thinvendor")], async () => goodBars(), {
      capability: "bars",
      cacheKey: "bars:thin",
      store,
      env: { NODE_ENV: "test" } as NodeJS.ProcessEnv,
      contract: (bars) => check("thinvendor", bars, 500),
    });

    assert.ok(Array.isArray(result.data), "a warned payload is still served");
    assert.equal(result.provenance.provider, "thinvendor");
    assert.equal(result.provenance.contract?.passed, true);
    assert.ok(result.provenance.contract?.violations.some((v) => v.check === "bars.coverage"));
    // And the provider keeps a clean bill of health: a warning is not a failure.
    assert.equal(breakerSnapshot("thinvendor", store).state, "closed");
  });

  it("survives a contract that throws rather than taking the request down", async () => {
    const store = new MemoryStore();
    const result = await dispatch<Bar[]>([fakeAdapter("vendor")], async () => goodBars(), {
      capability: "bars",
      cacheKey: "bars:throwing",
      store,
      env: { NODE_ENV: "test" } as NodeJS.ProcessEnv,
      contract: () => { throw new Error("contract blew up"); },
    });
    // A broken *check* must never be the reason a good answer is discarded.
    assert.ok(Array.isArray(result.data));
    assert.equal(result.provenance.provider, "vendor");
  });
});
