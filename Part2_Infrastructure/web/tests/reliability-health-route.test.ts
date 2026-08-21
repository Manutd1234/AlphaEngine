/**
 * The route that diagnoses a failure must not fail with it.
 *
 * `/api/system/health` is what the desk reads to find out what is wrong, so it
 * fails open: an absent gateway, an unreachable one, and one answering with
 * rubbish all still return 200 with the provider matrix intact and a source
 * signal saying which of the three it was. A diagnostic that 500s when its
 * subject is down tells the reader nothing except that something is down.
 *
 * Two budgets are pinned alongside, because both are ways this route could
 * become the outage it reports. `OPS_SNAPSHOT_TIMEOUT_MS` bounds how long it
 * waits on the dependency it is diagnosing, and the OpenAPI evidence fetch is
 * cached and size-capped so a gateway serving an endless body cannot be read
 * into this process.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NextRequest } from "next/server";

import committedGatewayOpenApi from "../../tools/openapi.json";
import { GET } from "../app/api/system/health/route";
import type { SystemHealth } from "../components/systems/types";
import { deriveReliabilityPosture, OPS_SNAPSHOT_TIMEOUT_MS } from "../lib/reliability";
import { resetGatewayOpenApiEvidenceCache } from "../lib/delivery-readiness";
import { platform, withEnvironment } from "./helpers/reliability-fixtures";

describe("the aggregate health route fails open for local observability", () => {
  it("returns provider health when no gateway is configured", async () => {
    resetGatewayOpenApiEvidenceCache();
    await withEnvironment({
      NODE_ENV: "test",
      ALPHAENGINE_GATEWAY_URL: undefined,
      OPENBB_API_URL: undefined,
    }, async () => {
      const response = await GET(new NextRequest("http://local.test/api/system/health?priority=background"));
      const body = await response.json() as SystemHealth;
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(body.schemaVersion, 2);
      assert.ok(body.providers.length > 0, "provider matrix was lost with the gateway");
      assert.equal(body.platform, undefined);
      assert.equal(body.sources?.gateway.state, "not_configured");
      assert.equal(body.validation?.scope, "per-instance");
      assert.equal(body.validation?.evaluated, 0);
      assert.equal(body.validation?.windowStart, null);
      assert.equal(body.delivery?.schema.state, "unavailable");
      assert.equal(body.delivery?.artifact?.state, "unverified");
    });
  });

  it("returns provider health and a critical source signal when the configured gateway is down", async () => {
    resetGatewayOpenApiEvidenceCache();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new TypeError("offline"); };
    try {
      await withEnvironment({
        NODE_ENV: "test",
        ALPHAENGINE_GATEWAY_URL: "https://gateway.invalid",
        OPENBB_API_URL: undefined,
      }, async () => {
        const response = await GET(new NextRequest("http://local.test/api/system/health"));
        const body = await response.json() as SystemHealth;
        assert.equal(response.status, 200);
        assert.ok(body.providers.length > 0);
        assert.equal(body.platform, undefined);
        assert.equal(body.sources?.gateway.state, "unreachable");
        assert.equal(deriveReliabilityPosture(body, Date.parse(body.fetchedAt)).paths.trading.status, "critical");
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("attaches a validated gateway snapshot without extending the timeout budget", async () => {
    resetGatewayOpenApiEvidenceCache();
    const current = platform({ observed_at: new Date().toISOString() });
    const originalFetch = globalThis.fetch;
    let openApiCalls = 0;
    globalThis.fetch = async (input) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === "/openapi.json") {
        openApiCalls += 1;
        return new Response(JSON.stringify(committedGatewayOpenApi), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(current), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    try {
      await withEnvironment({
        NODE_ENV: "test",
        ALPHAENGINE_GATEWAY_URL: "https://gateway.example.test",
        OPENBB_API_URL: undefined,
      }, async () => {
        const response = await GET(new NextRequest("http://local.test/api/system/health"));
        const body = await response.json() as SystemHealth;
        assert.equal(body.platform?.schema_version, 1);
        assert.equal(body.sources?.gateway.state, "fresh");
        assert.equal(body.delivery?.schema.state, "match");
        assert.equal(body.delivery?.schema.passed, true);
        const repeated = await GET(new NextRequest("http://local.test/api/system/health"));
        assert.equal(repeated.status, 200);
        assert.equal(openApiCalls, 1, "the static contract was fetched again during its cache window");
        assert.ok(OPS_SNAPSHOT_TIMEOUT_MS <= 2_000, "health waits too long on the failed dependency it diagnoses");
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps gateway health fresh when its OpenAPI response is malformed", async () => {
    resetGatewayOpenApiEvidenceCache();
    const current = platform({ observed_at: new Date().toISOString() });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return url.pathname === "/openapi.json"
        ? new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify(current), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    try {
      await withEnvironment({
        NODE_ENV: "test",
        ALPHAENGINE_GATEWAY_URL: "https://gateway-malformed.example.test",
        OPENBB_API_URL: undefined,
      }, async () => {
        const response = await GET(new NextRequest("http://local.test/api/system/health"));
        const body = await response.json() as SystemHealth;
        assert.equal(body.sources?.gateway.state, "fresh");
        assert.equal(body.platform?.schema_version, 1);
        assert.equal(body.delivery?.schema.state, "unavailable");
        assert.equal(body.delivery?.schema.passed, false);
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("stops an oversized chunked OpenAPI body before parsing it", async () => {
    resetGatewayOpenApiEvidenceCache();
    const current = platform({ observed_at: new Date().toISOString() });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname !== "/openapi.json") {
        return new Response(JSON.stringify(current), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      const chunk = new Uint8Array(300 * 1024).fill(97);
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.close();
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    try {
      await withEnvironment({
        NODE_ENV: "test",
        ALPHAENGINE_GATEWAY_URL: "https://gateway-oversized.example.test",
        OPENBB_API_URL: undefined,
      }, async () => {
        const response = await GET(new NextRequest("http://local.test/api/system/health"));
        const body = await response.json() as SystemHealth;
        assert.equal(body.sources?.gateway.state, "fresh");
        assert.equal(body.delivery?.schema.state, "unavailable");
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
