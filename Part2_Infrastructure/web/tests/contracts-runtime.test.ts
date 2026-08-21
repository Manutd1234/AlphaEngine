/**
 * A payload in flight — the body we send, and what dispatch does with what
 * comes back.
 *
 * The other contract suites test pure functions. What actually protects the
 * desk is the wiring: whether a rejected payload is treated like a provider
 * that answered nothing at all, and whether a body is allowed to leave in a
 * shape the gateway will refuse.
 *
 * Both halves earned their guard the same way — a subtle ordering bug that hid
 * for a while. `recordSuccess` deletes a provider's failure count, so
 * evaluating the contract *after* it meant a provider returning structurally
 * broken data could never trip its breaker; and double-encoding a request body
 * produced an upstream 422 that read as a gateway outage. These tests pin the
 * behaviour, not the shape.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkBars as check, validationTelemetry } from "../lib/providers/contracts";
import { quarantine } from "../lib/providers/quarantine";
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
