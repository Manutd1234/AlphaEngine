/**
 * The serverless coherence data plane: public origin resolution and live-only
 * analytical payloads.
 *
 * A transport failure may retain a genuine last-good response for the same
 * URL. It must never manufacture a market, quote, proof, or diagram payload.
 * Deterministic examples live under tests/helpers and cannot be imported by
 * application code.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  GATEWAY_PUBLIC_URL_ENV,
  gatewayCandidates,
  gatewayState,
} from "../lib/gateway";
import {
  peek,
  read as readCached,
  resetCoherenceCache,
} from "../lib/coherence/read-cache";
import { read as source } from "./helpers/workspace-sources";

afterEach(resetCoherenceCache);

describe("serverless gateway origin resolution", () => {
  it("uses a public server-only secondary origin when the uploaded primary is loopback", () => {
    const state = gatewayState({
      NODE_ENV: "production",
      VERCEL: "1",
      ALPHAENGINE_GATEWAY_URL: "http://127.0.0.1:8000",
      ALPHAENGINE_GATEWAY_PUBLIC_URL: "https://gateway.alpha.example/v1/ignored",
    } as NodeJS.ProcessEnv);

    assert.equal(state.kind, "url");
    assert.equal(state.kind === "url" ? state.url.href : null, "https://gateway.alpha.example/");
  });

  it("keeps the secondary origin server-only and rejects a second private address", () => {
    assert.equal(GATEWAY_PUBLIC_URL_ENV, "ALPHAENGINE_GATEWAY_PUBLIC_URL");
    assert.doesNotMatch(GATEWAY_PUBLIC_URL_ENV, /^NEXT_PUBLIC_/);
    const state = gatewayState({
      NODE_ENV: "production",
      VERCEL: "1",
      ALPHAENGINE_GATEWAY_URL: "http://localhost:8000",
      ALPHAENGINE_GATEWAY_PUBLIC_URL: "http://192.168.1.7:8000",
    } as NodeJS.ProcessEnv);
    assert.equal(state.kind, "loopback");
  });

  it("does not demote a valid canonical origin behind the secondary", () => {
    const env = {
      NODE_ENV: "production",
      ALPHAENGINE_GATEWAY_URL: "https://primary.alpha.example",
      ALPHAENGINE_GATEWAY_PUBLIC_URL: "https://secondary.alpha.example",
    } as NodeJS.ProcessEnv;
    const state = gatewayState(env);
    assert.equal(state.kind === "url" ? state.url.href : null, "https://primary.alpha.example/");
    assert.deepEqual(
      gatewayCandidates(env).map((candidate) => candidate.href),
      ["https://primary.alpha.example/", "https://secondary.alpha.example/"],
      "read-only calls lost the same-gateway recovery ingress",
    );
  });

  it("deduplicates one ingress named twice", () => {
    assert.deepEqual(
      gatewayCandidates({
        NODE_ENV: "production",
        ALPHAENGINE_GATEWAY_URL: "https://gateway.alpha.example/path",
        ALPHAENGINE_GATEWAY_PUBLIC_URL: "https://gateway.alpha.example/other",
      } as NodeJS.ProcessEnv).map((candidate) => candidate.href),
      ["https://gateway.alpha.example/"],
    );
  });

  it("keeps a local gateway usable under next start", () => {
    const state = gatewayState({
      NODE_ENV: "production",
      ALPHAENGINE_GATEWAY_URL: "http://127.0.0.1:8000",
    } as NodeJS.ProcessEnv);

    assert.equal(state.kind, "url");
    assert.equal(state.kind === "url" ? state.url.href : null, "http://127.0.0.1:8000/");
  });

  it("requires HTTPS on Vercel while retaining HTTP for local development", () => {
    const deployedEnv = {
      NODE_ENV: "production",
      VERCEL: "1",
      ALPHAENGINE_GATEWAY_URL: "http://gateway.alpha.example",
    } as NodeJS.ProcessEnv;
    assert.equal(gatewayState(deployedEnv).kind, "insecure");
    assert.deepEqual(gatewayCandidates(deployedEnv), []);

    const local = gatewayState({
      NODE_ENV: "development",
      ALPHAENGINE_GATEWAY_URL: "http://gateway.alpha.example",
    } as NodeJS.ProcessEnv);
    assert.equal(local.kind === "url" ? local.url.href : null, "http://gateway.alpha.example/");
  });
});

describe("coherence diagrams never hydrate fixed runtime data", () => {
  it("has no fallback dataset in the application data path", () => {
    const hook = source("../lib/coherence/use-coherence.ts");
    assert.doesNotMatch(hook, /withCoherenceFallback|coherenceFallbackFor|fallback-(?:market|diffusion|data)/);
    for (const file of [
      "fallback-data.ts",
      "fallback-market-base.ts",
      "fallback-market-evidence.ts",
      "fallback-market-models.ts",
      "fallback-diffusion.ts",
    ]) {
      assert.equal(
        existsSync(join(import.meta.dirname, "..", "lib", "coherence", file)),
        false,
        `${file} is runtime-addressable instead of test-only`,
      );
    }
  });

  it("keeps a failed first read unavailable with its exact incident", async () => {
    const route = "/api/gateway/coherence/index?limit=2000";
    const failed = await readCached(route, async () => ({
      data: null,
      error: "gateway unreachable",
      transport: {
        requestId: "req-first-failure",
        endpointClass: "H2",
        status: 503,
        code: "gateway_unreachable",
        hint: "Set a public gateway origin.",
        deadlineMs: 9_000,
      },
    }));

    assert.equal(failed.data, null, "a failed first read acquired invented analytics");
    assert.equal(peek(route)?.data, null);
    assert.equal(peek(route)?.error, "gateway unreachable");
    assert.equal(peek(route)?.transport?.requestId, "req-first-failure");
  });

  it("retains only a genuine last-good payload after a later failure", async () => {
    const route = "/api/gateway/coherence/index?limit=2000";
    const live = { state: "live", points: [{ value: 42 }] };
    await readCached(route, async () => ({ data: live, error: null }));
    const incident = await readCached(route, async () => ({
      data: null,
      error: "gateway unreachable",
    }));

    assert.equal(incident.data, live);
    assert.equal(incident.error, "gateway unreachable");
    assert.equal(peek(route)?.data, live);
    assert.equal(peek(route)?.error, "gateway unreachable");
  });
});
