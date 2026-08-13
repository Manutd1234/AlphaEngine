/**
 * `GATEWAY ONLINE`, and what it is allowed to mean.
 *
 * The kill-switch panel prints that line directly above a box that halts
 * trading, and it was derived from `gatewayBase() !== null` — a URL is
 * configured. The route's own comment on `gatewayBase` records this class of
 * bug being fixed once already, for a loopback address that "reported a
 * connected gateway while every fetch through it failed, the worst possible
 * answer for the one field operators check first". Resolving the URL more
 * carefully narrowed it; it could not close it, because a well-formed URL
 * pointing at a stopped process still resolves.
 *
 * These tests are behavioural rather than textual on purpose. The defect is not
 * a string in the source — it is that the answer did not depend on the gateway.
 * So each one moves the gateway and asserts the answer moves with it.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { GET } from "../app/api/gateway/risk/route";

const GATEWAY = "https://gateway.example.com";

let savedFetch: typeof globalThis.fetch;
let savedUrl: string | undefined;

beforeEach(() => {
  savedFetch = globalThis.fetch;
  savedUrl = process.env.ALPHAENGINE_GATEWAY_URL;
  process.env.ALPHAENGINE_GATEWAY_URL = GATEWAY;
});

afterEach(() => {
  globalThis.fetch = savedFetch;
  if (savedUrl === undefined) delete process.env.ALPHAENGINE_GATEWAY_URL;
  else process.env.ALPHAENGINE_GATEWAY_URL = savedUrl;
});

/** Stand in for the gateway, and record what was asked of it. */
function gatewayAnswers(reply: () => Promise<Response> | Response) {
  const calls: { url: string; signal: AbortSignal | null }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      signal: (init?.signal as AbortSignal | undefined) ?? null,
    });
    return reply();
  }) as typeof globalThis.fetch;
  return calls;
}

async function probe() {
  const response = await GET();
  return (await response.json()) as {
    gatewayConnected: boolean;
    gatewayReason: string | null;
  };
}

describe("the kill switch asks the gateway rather than assuming it", () => {
  it("reports connected only when the gateway actually answers", async () => {
    const calls = gatewayAnswers(() => new Response("{}", { status: 200 }));
    const info = await probe();

    assert.equal(info.gatewayConnected, true);
    assert.equal(info.gatewayReason, null);
    // It must have asked. A true that costs no request is the original bug.
    assert.equal(calls.length, 1, "the route answered without contacting the gateway");
    assert.ok(calls[0].url.startsWith(GATEWAY), `probed ${calls[0].url}`);
  });

  it("reports unreachable for a configured URL that nothing is listening on", async () => {
    // The exact production shape: a valid, non-loopback, correctly-spelled URL
    // whose process is not running. The old check called this connected.
    gatewayAnswers(() => Promise.reject(new TypeError("fetch failed")));
    const info = await probe();

    assert.equal(info.gatewayConnected, false);
    assert.match(info.gatewayReason ?? "", /could not be reached/);
  });

  it("does not call a gateway that answers with an error a health report", async () => {
    gatewayAnswers(() => new Response("nope", { status: 502 }));
    const info = await probe();

    assert.equal(info.gatewayConnected, false);
    assert.match(info.gatewayReason ?? "", /HTTP 502/);
  });

  it("gives up rather than holding the panel open on a hung gateway", async () => {
    // A gateway that accepts the connection and never replies is the failure an
    // operator can least afford to wait out, and the one an undeadlined probe
    // handles worst.
    //
    // The stub honours the abort signal because real `fetch` does, and that is
    // the whole mechanism under test: the route passes a deadline and the
    // transport ends the request. A stub that ignored the signal would hang for
    // as long as the test allowed and prove nothing about the route.
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (!signal) return; // no deadline passed — the failure this test exists to catch
        signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      })) as typeof globalThis.fetch;

    const started = Date.now();
    const info = await probe();
    const waited = Date.now() - started;

    assert.equal(info.gatewayConnected, false);
    assert.match(info.gatewayReason ?? "", /did not answer within/);
    assert.ok(waited < 5_000, `the probe blocked for ${waited}ms`);
  });

  it("says the URL is missing rather than blaming the network", async () => {
    delete process.env.ALPHAENGINE_GATEWAY_URL;
    const calls = gatewayAnswers(() => new Response("{}", { status: 200 }));
    const info = await probe();

    assert.equal(info.gatewayConnected, false);
    assert.match(info.gatewayReason ?? "", /No gateway URL is configured/);
    // Nothing to probe, so nothing was probed.
    assert.equal(calls.length, 0);
  });

  it("keeps the guard mode and the action list it always carried", async () => {
    gatewayAnswers(() => new Response("{}", { status: 200 }));
    const response = await GET();
    const body = (await response.json()) as { actions: string[]; guard: { mode: string } };

    assert.ok(body.actions.includes("halt"));
    assert.ok(body.guard.mode);
  });
});
