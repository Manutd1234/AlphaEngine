/** One bounded, correlated request from browser to gateway and back. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { callGateway, failureBody, gatewayBase, gatewayHeaders } from "../lib/gateway";
import {
  GATEWAY_BUDGET_CLASS_HEADER,
  GATEWAY_BUDGET_MS_HEADER,
  GATEWAY_REMAINING_BUDGET_HEADER,
  GATEWAY_REQUEST_ID_HEADER,
  gatewayRequestContext,
  gatewayRequestHeaders,
  gatewayResponseHeaders,
} from "../lib/gateway-request-context";
import { blackHoleFetch, jsonFetch, transportFailureFetch } from "./helpers/gateway-faults";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.ALPHAENGINE_GATEWAY_URL;
const originalPublicUrl = process.env.ALPHAENGINE_GATEWAY_PUBLIC_URL;
const originalToken = process.env.ALPHAENGINE_GATEWAY_TOKEN;
const originalRecoveryToken = process.env.ALPHAENGINE_GATEWAY_RECOVERY_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl == null) delete process.env.ALPHAENGINE_GATEWAY_URL;
  else process.env.ALPHAENGINE_GATEWAY_URL = originalUrl;
  if (originalPublicUrl == null) delete process.env.ALPHAENGINE_GATEWAY_PUBLIC_URL;
  else process.env.ALPHAENGINE_GATEWAY_PUBLIC_URL = originalPublicUrl;
  if (originalToken == null) delete process.env.ALPHAENGINE_GATEWAY_TOKEN;
  else process.env.ALPHAENGINE_GATEWAY_TOKEN = originalToken;
  if (originalRecoveryToken == null) delete process.env.ALPHAENGINE_GATEWAY_RECOVERY_TOKEN;
  else process.env.ALPHAENGINE_GATEWAY_RECOVERY_TOKEN = originalRecoveryToken;
});

function request(headers: HeadersInit = {}, signal?: AbortSignal): Request {
  return new Request("https://desk.example/api/gateway/coherence/status", { headers, signal });
}

describe("the browser can choose only a signed endpoint budget class", () => {
  it("caps an attempted expansion at the route's H1 ceiling", () => {
    const context = gatewayRequestContext(request({
      [GATEWAY_REQUEST_ID_HEADER]: "desk-request-1234",
      [GATEWAY_BUDGET_CLASS_HEADER]: "H4",
      [GATEWAY_REMAINING_BUDGET_HEADER]: "600000",
    }), "H1", 1_000);

    assert.equal(context.requestId, "desk-request-1234");
    assert.equal(context.budgetClass, "H1");
    assert.equal(context.totalBudgetMs, 3_000);
    assert.equal(context.deadlineAtMs, 4_000);
  });

  it("honours a narrower recognised class but never an arbitrary duration", () => {
    const context = gatewayRequestContext(request({
      [GATEWAY_BUDGET_CLASS_HEADER]: "H1",
      [GATEWAY_REMAINING_BUDGET_HEADER]: "1",
    }), "H3", 2_000);
    assert.equal(context.budgetClass, "H1");
    assert.equal(context.totalBudgetMs, 3_000);
    assert.equal(context.deadlineAtMs, 5_000);
  });
});

describe("correlation and the remaining budget cross the server boundary", () => {
  it("forwards a safe identifier and a decreasing integer allowance", () => {
    const context = gatewayRequestContext(request({
      [GATEWAY_REQUEST_ID_HEADER]: "trace.alpha-1234",
    }), "H2", 10_000);
    const headers = gatewayRequestHeaders(context, 10_750);
    assert.equal(headers[GATEWAY_REQUEST_ID_HEADER], "trace.alpha-1234");
    assert.equal(headers[GATEWAY_BUDGET_CLASS_HEADER], "H2");
    assert.equal(headers[GATEWAY_REMAINING_BUDGET_HEADER], "7250");
  });

  it("replaces an unsafe identifier rather than reflecting it", () => {
    const unsafe = "bad\r\nx-leaked: token";
    const context = gatewayRequestContext(request(), "H1", 1_000, unsafe);
    assert.notEqual(context.requestId, unsafe);
    assert.match(context.requestId, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
  });

  it("returns correlation and standard timing on success and failure", () => {
    const context = gatewayRequestContext(request({
      [GATEWAY_REQUEST_ID_HEADER]: "desk-request-5678",
    }), "H1", 1_000);
    const headers = gatewayResponseHeaders(context, 1_125);
    assert.equal(headers[GATEWAY_REQUEST_ID_HEADER], "desk-request-5678");
    assert.equal(headers[GATEWAY_BUDGET_CLASS_HEADER], "H1");
    assert.equal(headers[GATEWAY_BUDGET_MS_HEADER], "3000");
    assert.match(headers["Server-Timing"], /gateway;dur=125/);
    assert.match(headers["Server-Timing"], /budget;desc="H1 3000ms ceiling"/);

    const body = failureBody({ code: "gateway_timeout", error: "late", status: 504 }, context);
    assert.equal(body.requestId, "desk-request-5678");
    assert.equal(body.endpointClass, "H1");
  });

  it("sends the same identifier and bounded remaining budget upstream", async () => {
    const captured: Array<{ url: string; headers: Headers }> = [];
    globalThis.fetch = jsonFetch({ ready: true }, captured);
    process.env.ALPHAENGINE_GATEWAY_URL = "https://gateway.example";
    const context = gatewayRequestContext(request({
      [GATEWAY_REQUEST_ID_HEADER]: "desk-request-9012",
    }), "H1");

    const result = await callGateway("/api/coherence/status", { context });

    assert.ok(result.ok);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].headers.get(GATEWAY_REQUEST_ID_HEADER), "desk-request-9012");
    assert.equal(captured[0].headers.get(GATEWAY_BUDGET_CLASS_HEADER), "H1");
    const remaining = Number(captured[0].headers.get(GATEWAY_REMAINING_BUDGET_HEADER));
    assert.ok(remaining > 0 && remaining <= 3_000, `unbounded remaining budget ${remaining}`);
  });

  it("propagates the tighter call allowance instead of the wider class ceiling", async () => {
    const captured: Array<{ url: string; headers: Headers }> = [];
    globalThis.fetch = jsonFetch({ ready: true }, captured);
    process.env.ALPHAENGINE_GATEWAY_URL = "https://gateway.example";
    const context = gatewayRequestContext(request(), "H1");
    await callGateway("/api/coherence/status", { context, timeoutMs: 40 });
    const remaining = Number(captured[0].headers.get(GATEWAY_REMAINING_BUDGET_HEADER));
    assert.ok(remaining > 0 && remaining <= 40, `upstream received ${remaining}ms for a 40ms call`);
  });

  it("does not dispatch work after the endpoint budget is spent", async () => {
    const captured: Array<{ url: string; headers: Headers }> = [];
    globalThis.fetch = jsonFetch({ ready: true }, captured);
    process.env.ALPHAENGINE_GATEWAY_URL = "https://gateway.example";
    const context = gatewayRequestContext(request(), "H1", Date.now() - 4_000);
    const result = await callGateway("/must-not-start", { context });
    assert.ok(!result.ok && result.failure.code === "gateway_timeout");
    assert.equal(captured.length, 0, "an already-expired request reached the gateway");
  });
});

describe("deadline and transport faults remain different typed outcomes", () => {
  it("refuses redirects before a credential can cross to another origin", async () => {
    let redirect: RequestRedirect | undefined;
    process.env.ALPHAENGINE_GATEWAY_URL = "https://gateway.example";
    process.env.ALPHAENGINE_GATEWAY_TOKEN = "server-secret";
    globalThis.fetch = async (_input, init) => {
      redirect = init?.redirect;
      return Response.json({ ready: true });
    };

    const result = await callGateway<{ ready: boolean }>("/health", { timeoutMs: 100 });

    assert.ok(result.ok && result.data.ready);
    assert.equal(redirect, "error");
  });

  it("pairs a selected recovery ingress only with its separately scoped token", () => {
    process.env.ALPHAENGINE_GATEWAY_URL = "not-a-url";
    process.env.ALPHAENGINE_GATEWAY_PUBLIC_URL = "https://gateway.public.example";
    process.env.ALPHAENGINE_GATEWAY_TOKEN = "canonical-secret";
    process.env.ALPHAENGINE_GATEWAY_RECOVERY_TOKEN = "recovery-secret";

    assert.equal(gatewayHeaders()["X-AlphaEngine-Token"], "recovery-secret");
    assert.equal(gatewayBase(), null, "legacy URL/header callers must fail closed on recovery-only routing");
  });

  it("fails an idempotent read over to the same gateway's public ingress", async () => {
    const visited: Array<{ url: string; token: string | null }> = [];
    process.env.ALPHAENGINE_GATEWAY_URL = "https://gateway.internal.example";
    process.env.ALPHAENGINE_GATEWAY_PUBLIC_URL = "https://gateway.public.example";
    process.env.ALPHAENGINE_GATEWAY_TOKEN = "canonical-secret";
    process.env.ALPHAENGINE_GATEWAY_RECOVERY_TOKEN = "recovery-secret";
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      visited.push({
        url,
        token: new Headers(init?.headers).get("X-AlphaEngine-Token"),
      });
      if (url.startsWith("https://gateway.internal.example")) {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
      }
      return Response.json({ ready: true });
    };

    const result = await callGateway<{ ready: boolean }>("/health", { timeoutMs: 100 });

    assert.ok(result.ok && result.data.ready);
    assert.deepEqual(visited, [
      { url: "https://gateway.internal.example/health", token: "canonical-secret" },
      { url: "https://gateway.public.example/health", token: "recovery-secret" },
    ]);
  });

  it("never sends the canonical token to an unrelated recovery origin", async () => {
    const captured: Array<{ url: string; token: string | null }> = [];
    process.env.ALPHAENGINE_GATEWAY_URL = "not-a-url";
    process.env.ALPHAENGINE_GATEWAY_PUBLIC_URL = "https://unrelated.example";
    process.env.ALPHAENGINE_GATEWAY_TOKEN = "must-not-leak";
    delete process.env.ALPHAENGINE_GATEWAY_RECOVERY_TOKEN;
    globalThis.fetch = async (input, init) => {
      captured.push({
        url: String(input),
        token: new Headers(init?.headers).get("X-AlphaEngine-Token"),
      });
      return Response.json({ ready: true });
    };

    const result = await callGateway<{ ready: boolean }>("/health", { timeoutMs: 100 });

    assert.ok(result.ok && result.data.ready);
    assert.deepEqual(captured, [
      { url: "https://unrelated.example/health", token: null },
    ]);
  });

  it("never replays POST or PATCH through the recovery ingress", async () => {
    const visited: string[] = [];
    process.env.ALPHAENGINE_GATEWAY_URL = "https://gateway.internal.example";
    process.env.ALPHAENGINE_GATEWAY_PUBLIC_URL = "https://gateway.public.example";
    globalThis.fetch = async (input) => {
      visited.push(String(input));
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    };

    for (const method of ["POST", "PATCH"] as const) {
      const result = await callGateway("/api/orders", {
        method,
        body: { ticker: "TEST" },
        timeoutMs: 100,
      });
      assert.ok(!result.ok && result.failure.code === "gateway_unreachable");
    }
    assert.deepEqual(visited, [
      "https://gateway.internal.example/api/orders",
      "https://gateway.internal.example/api/orders",
    ]);
  });

  it("bounds a black-hole response and classifies only its own deadline as timeout", async () => {
    globalThis.fetch = blackHoleFetch();
    process.env.ALPHAENGINE_GATEWAY_URL = "https://gateway.example";
    const context = gatewayRequestContext(request(), "H1");
    const started = Date.now();

    const result = await callGateway("/hang", { context, timeoutMs: 30 });

    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.failure.code, "gateway_timeout");
      assert.equal(result.failure.status, 504);
    }
    assert.ok(Date.now() - started < 500, "the deterministic black hole escaped its deadline");
  });

  it("keeps an operating-system ETIMEDOUT in the unreachable class", async () => {
    globalThis.fetch = transportFailureFetch("ETIMEDOUT");
    process.env.ALPHAENGINE_GATEWAY_URL = "https://gateway.example";
    const result = await callGateway("/connect", { timeoutMs: 100 });
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.failure.code, "gateway_unreachable");
      assert.equal(result.failure.status, 503);
      assert.match(result.failure.error, /ETIMEDOUT/);
    }
  });

  it("cancels upstream work when the browser request is abandoned", async () => {
    globalThis.fetch = blackHoleFetch();
    process.env.ALPHAENGINE_GATEWAY_URL = "https://gateway.example";
    const controller = new AbortController();
    const context = gatewayRequestContext(request({}, controller.signal), "H1");
    const pending = callGateway("/cancel", { context, timeoutMs: 1_000 });
    controller.abort();
    const result = await pending;
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.failure.code, "gateway_cancelled");
      assert.equal(result.failure.status, 499);
    }
  });
});

describe("the coherence status proxy adopts the transport contract", () => {
  const source = readFileSync(fileURLToPath(new URL(
    "../app/api/gateway/coherence/status/route.ts",
    import.meta.url,
  )), "utf8");

  it("leaves recovery room with H2 and returns timing and correlation on both branches", () => {
    assert.match(source, /gatewayRequestContext\(request, "H2"\)/);
    assert.match(source, /gatewayResponseHeaders\(context\)/);
    assert.match(source, /failureBody\(result\.failure, context\)/);
    assert.match(source, /headers: responseHeaders/g);
  });
});
