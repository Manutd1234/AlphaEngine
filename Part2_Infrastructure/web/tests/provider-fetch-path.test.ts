/**
 * The four properties of the provider fetch path that break silently.
 * ===================================================================
 *
 * `lib/providers/runtime.ts` was one 1,104-line file and is now seven, and
 * every one of the invariants below survives a move by luck rather than by
 * type. None of them throws when broken; each one keeps working, keeps
 * reporting, and reports the wrong thing:
 *
 *   1. The RAW vendor body exists only inside `httpJson`. Check it anywhere
 *      later and you are checking the normalised object — green against a
 *      shape no vendor ever sent, with a sanitised quarantine sample to match.
 *   2. The breaker's writer sites emit `fields.state` as `"open"`/`"closed"`,
 *      which `lib/remediation.ts` filters on. (Pinned in
 *      `tests/breaker-machine.test.ts`, next to the diagram it feeds.)
 *   3. No error built in the fetch path carries the API key or the host.
 *   4. Only a provider with a committed healthy capture may raise `fatal`, and
 *      `RAW_CALIBRATED` has exactly one home. This said "exactly
 *      {binance, bybit}" — a membership list in prose, which was already wrong
 *      by two when Alpha Vantage and Firecrawl were captured and is wrong by
 *      three now OpenBB has been. The rule is what the test below asserts; the
 *      membership is derived from the fixture directory in
 *      `tests/raw-contracts-rest.test.ts`, where it cannot go stale.
 *
 * These are behavioural wherever a behaviour can express them, because a
 * source scan that follows a moved file is still a scan that agrees with
 * itself. The two structural assertions are marked as such and each carries an
 * anti-vacuity guard.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { registerSecret } from "../lib/observability";
import { httpJson } from "../lib/providers/http-json";
import { quarantine } from "../lib/providers/quarantine";
import { RAW_CALIBRATED } from "../lib/providers/raw-contracts-rest";
import { dispatch, MemoryStore } from "../lib/providers/runtime";
import type { ContractResult } from "../lib/providers/contracts";
import type { Adapter } from "../lib/providers/types";
import { ProviderError } from "../lib/providers/types";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

const ENV = { NODE_ENV: "test" } as NodeJS.ProcessEnv;

function adapter(id: string): Adapter {
  return {
    meta: {
      id,
      label: id,
      docs: "",
      capabilities: ["quote"],
      assets: ["crypto"],
      keyEnv: "",       // keyless, so `isConfigured` is always true
      quota: null,
      rank: { quote: 0 },
      signup: "",
    },
  } as unknown as Adapter;
}

/** A contract the normaliser is perfectly happy with. */
const contentedContract = (): ContractResult => ({
  capability: "quote",
  provider: "binance",
  passed: true,
  violations: [],
  notEvaluated: [],
});

// --------------------------------------------------------------------------
// 1. The raw body, and the only place it exists
// --------------------------------------------------------------------------

describe("the raw vendor body is what gets checked and quarantined", () => {
  it("fails a payload the normaliser cleaned up, on evidence only the raw body carries", async () => {
    /**
     * The whole defect in one test. Binance sends every decimal as a *string*;
     * a number there means the response is not the shape the adapter believes
     * it is parsing. By the time `dispatch` holds a `Quote`, `lastPrice` has
     * become a `number` either way and the difference is unrecoverable — so a
     * check run after normalisation cannot fail this, and the contract the
     * façade supplied deliberately passes to prove the raw check is what
     * rejected it.
     */
    const store = new MemoryStore();
    quarantine.clear();
    const rawBody = {
      symbol: "BTCUSDT",
      lastPrice: 65000,          // a number, not a decimal string
      highPrice: "65100.00",
      lowPrice: "64000.00",
      volume: "1200.5",
      priceChangePercent: "1.5",
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(rawBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const outcome = await dispatch<{ normalisedOnly: true; price: number }>(
      [adapter("binance")],
      async (_a, ctx) => {
        await ctx.json("https://api.example.invalid/ticker?symbol=BTCUSDT");
        return { normalisedOnly: true, price: 65000 };
      },
      {
        capability: "quote",
        cacheKey: "quote:raw-body-reaches-the-check",
        store,
        env: ENV,
        contract: contentedContract,
      },
    ).then(() => null, (err: unknown) => err);

    assert.ok(outcome instanceof ProviderError, "a fatal raw violation must fail the provider over");

    const record = quarantine.list()[0];
    assert.ok(record, "a rejected payload with no quarantine record is an invisible failure");
    assert.deepEqual(record.violations.map((v) => v.check), ["raw.binance.quote.decimal_strings"]);
    assert.match(record.sample, /lastPrice/, "the quarantine sample is not the raw body");
    assert.doesNotMatch(
      record.sample,
      /normalisedOnly/,
      "the quarantine sample is the normalised object — the exact defect a previous round fixed",
    );
  });

  it("records the raw body from inside httpJson and from nowhere else", () => {
    /**
     * Structural, and deliberately so: the behavioural test above proves the
     * body arrives, but not that a second call site could not start feeding
     * the sink a normalised object from further down the path. Anti-vacuity
     * guard first — the scan must be reading a file that still defines
     * `httpJson`.
     */
    const http = read("../lib/providers/http-json.ts");
    assert.match(http, /export async function httpJson\(/, "the scan is reading the wrong file");

    const body = http.slice(http.indexOf("export async function httpJson("));
    const parse = body.indexOf("parsed = JSON.parse(text);");
    const record = body.indexOf("recordRawBody(provider, parsed);");
    const returned = body.indexOf("return parsed;");
    assert.ok(parse > 0 && record > parse && returned > record,
      "recordRawBody must sit between the parse and the return, inside httpJson");

    for (const file of ["dispatch.ts", "contract-gate.ts", "runtime.ts", "registry.ts"]) {
      assert.doesNotMatch(
        read(`../lib/providers/${file}`),
        /recordRawBody\(/,
        `${file} records a raw body, but the raw body does not exist there`,
      );
    }
  });
});

// --------------------------------------------------------------------------
// 3. Errors carry no credential and no host
// --------------------------------------------------------------------------

describe("nothing thrown by the fetch path names the key or the host", () => {
  it("masks a credential the vendor echoed back in its error page", async () => {
    // Alpha Vantage and FMP put the key in the query string and answer an auth
    // failure with an HTML page that quotes the request URL back. Without the
    // redaction at the dispatch site, a 401 puts a live credential into the
    // attempts list of a public API response.
    const key = "AV-DEMO-KEY-0123456789";
    registerSecret(key);
    globalThis.fetch = (async () =>
      new Response(`<html>Invalid apikey=${key}</html>`, { status: 401 })) as typeof fetch;

    const err = await dispatch(
      [adapter("fmp")],
      async (_a, ctx) => ctx.json(`https://vendor.example.invalid/quote?apikey=${key}`),
      { capability: "quote", cacheKey: "quote:key-never-leaks", store: new MemoryStore(), env: ENV },
    ).then(() => null, (e: unknown) => e as ProviderError & { attempts: unknown[] });

    assert.ok(err, "the dispatch must fail");
    const rendered = JSON.stringify(err.attempts);
    assert.ok(!rendered.includes(key), "a live credential reached the attempts list");
    assert.match(rendered, /«redacted»/, "the echo was dropped rather than masked — check redact() still runs");
  });

  it("reports a timeout by its deadline, never by the URL it was calling", async () => {
    globalThis.fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      })) as unknown as typeof fetch;

    // `openbb` takes exactly one attempt, so this costs one deadline.
    const err = await httpJson("openbb", "https://gateway.example.invalid/quote?token=SECRET", {}, 20)
      .then(() => null, (e: unknown) => e as Error);

    assert.ok(err instanceof ProviderError);
    assert.equal(err.message, "timed out after 20ms");
    assert.ok(!err.message.includes("example.invalid"), "the host is in the error message");
  });

  it("builds no error in the fetch path out of the URL", () => {
    // Structural: the behavioural tests above cover the two paths that run,
    // this one covers the ones that only run against a live vendor.
    const http = read("../lib/providers/http-json.ts");
    assert.match(http, /new ProviderError\(/, "the scan is reading the wrong file");
    for (const construction of http.match(/new ProviderError\([\s\S]*?\);/g) ?? []) {
      assert.doesNotMatch(construction, /\burl\b/, `an error is built from the URL: ${construction}`);
    }
  });
});

// --------------------------------------------------------------------------
// 4. Only a calibrated provider may raise fatal
// --------------------------------------------------------------------------

describe("RAW_CALIBRATED is not widened by a refactor", () => {
  it("stays defined in one file, which no part of the fetch path may extend", () => {
    /**
     * Deliberately NOT a literal membership list. `tests/raw-contracts-rest.ts`
     * already derives the set from which providers have a committed healthy
     * capture under `tests/fixtures/raw/`, and that derivation is the honest
     * guard: a second copy of the list here would either duplicate it or, worse,
     * contradict it the day a real capture lands and turn a correct widening
     * into a red suite.
     *
     * What belongs here is the property a *refactor* can break. The severity
     * decision has exactly one home; a file in the fetch path that grew its own
     * membership test would silently promote an uncalibrated predicate to
     * `fatal` and start failing healthy vendors over.
     */
    assert.ok(RAW_CALIBRATED.has("binance") && RAW_CALIBRATED.has("bybit"),
      "the keyless captured providers must keep their fatal severity");

    const owner = read("../lib/providers/raw-contracts-rest.ts");
    assert.match(owner, /export const RAW_CALIBRATED/, "the scan is reading the wrong file");
    for (const file of [
      "runtime.ts", "dispatch.ts", "contract-gate.ts", "http-json.ts",
      "raw-sink.ts", "raw-contract-check.ts", "breaker.ts", "licence.ts",
      "quota.ts", "store.ts",
    ]) {
      assert.doesNotMatch(
        read(`../lib/providers/${file}`),
        /RAW_CALIBRATED/,
        `${file} decides raw severity for itself, which is how an uncalibrated predicate reaches fatal`,
      );
    }
  });
});
