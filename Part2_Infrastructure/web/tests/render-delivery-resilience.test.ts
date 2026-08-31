/** Production-delivery edges that are invisible in a static panel screenshot. */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { callGateway } from "../lib/gateway";
import { gatewayRequestContext } from "../lib/gateway-request-context";
import { PollingController } from "../lib/polling";
import * as consolePrefetch from "../lib/use-console-prefetch";
import { LIVE_READS } from "../lib/coherence/routes";
import { peek, read, resetCoherenceCache } from "../lib/coherence/read-cache";
import { fakeClock } from "./helpers/fake-clock";

const originalFetch = globalThis.fetch;
const originalGatewayUrl = process.env.ALPHAENGINE_GATEWAY_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetCoherenceCache();
  if (originalGatewayUrl == null) delete process.env.ALPHAENGINE_GATEWAY_URL;
  else process.env.ALPHAENGINE_GATEWAY_URL = originalGatewayUrl;
});

describe("an inactive polling view leaves no state work behind", () => {
  it("does not publish another schedule after stop aborts its in-flight tick", async () => {
    const clock = fakeClock();
    const schedules: Array<[number, number]> = [];
    const loop = new PollingController({
      intervalMs: 1_000,
      immediate: true,
      tick: ({ signal }) => new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
        }, { once: true });
      }),
      onSchedule: (delay, failures) => schedules.push([delay, failures]),
      environment: clock.environment,
    });

    loop.start();
    await Promise.resolve();
    loop.stop();
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(schedules, [], "a stopped pane was notified about a retry it will never run");
    assert.equal(clock.pending(), 0);
  });
});

describe("browser request contexts never inherit another request's outcome", () => {
  it("does not coalesce distinct cancellation and correlation contexts", async () => {
    process.env.ALPHAENGINE_GATEWAY_URL = "https://gateway.example";
    let calls = 0;
    globalThis.fetch = ((_url: URL | RequestInfo, init?: RequestInit) => {
      calls += 1;
      const ordinal = calls;
      const signal = init?.signal;
      return new Promise<Response>((resolve, reject) => {
        const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (signal?.aborted) return abort();
        signal?.addEventListener("abort", abort, { once: true });
        if (ordinal === 2) {
          queueMicrotask(() => resolve(new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          })));
        }
      });
    }) as typeof fetch;

    const firstController = new AbortController();
    const secondController = new AbortController();
    const firstContext = gatewayRequestContext(new Request("https://desk.example/first", {
      signal: firstController.signal,
    }), "H2");
    const secondContext = gatewayRequestContext(new Request("https://desk.example/second", {
      signal: secondController.signal,
    }), "H2");

    const first = callGateway("/shared-context", { context: firstContext, timeoutMs: 5_000 });
    const second = callGateway("/shared-context", { context: secondContext, timeoutMs: 5_000 });
    await Promise.resolve();
    firstController.abort();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(calls, 2, "two browser requests were collapsed under one request id and signal");
    assert.ok(!firstResult.ok && firstResult.failure.code === "gateway_cancelled");
    assert.ok(secondResult.ok, "the live caller inherited the other caller's cancellation");
  });
});

describe("idle chunk warming respects the foreground", () => {
  it("loads cold consoles sequentially rather than starting every chunk at once", async () => {
    const helper = (consolePrefetch as {
      warmConsoleChunksSequentially?: (
        loaders: ReadonlyArray<() => Promise<unknown>>,
        signal?: AbortSignal,
      ) => Promise<void>;
    }).warmConsoleChunksSequentially;
    assert.equal(typeof helper, "function", "the prefetch queue has no testable sequential boundary");

    const started: string[] = [];
    let releaseFirst!: () => void;
    const first = () => new Promise<void>((resolve) => {
      started.push("data");
      releaseFirst = resolve;
    });
    const second = async () => { started.push("reliability"); };
    const warming = helper!([first, second]);
    await Promise.resolve();
    assert.deepEqual(started, ["data"], "idle warming competed for every console chunk in parallel");
    releaseFirst();
    await warming;
    assert.deepEqual(started, ["data", "reliability"]);
  });
});

describe("last-good data keeps its incident attribution", () => {
  it("seeds a remounted reader with the cached error as well as the cached payload", () => {
    const source = readFileSync(fileURLToPath(new URL(
      "../lib/coherence/use-coherence.ts",
      import.meta.url,
    )), "utf8");
    assert.match(
      source,
      /error:\s*cached\?\.error\s*\?\?\s*null/,
      "a remounted pane can show stale data without the cached outage beside it",
    );
  });

  it("does not cache a cancellation after every reader has left", async () => {
    const controller = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const pending = read<{ value: number }>(
      "/cancelled-pane",
      (_url, signal) => new Promise((resolve) => {
        markStarted();
        signal.addEventListener("abort", () => resolve({
          data: null,
          error: "the read was cancelled",
        }), { once: true });
      }),
      controller.signal,
    );
    await started;
    const cancelled = assert.rejects(pending, { name: "AbortError" });
    controller.abort();
    await cancelled;
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(peek("/cancelled-pane"), null,
      "view teardown became the cached incident shown to the next reader");
  });
});

interface ProxyRouteSource {
  boundary: "coherence" | "diffusion";
  name: string;
  source: string;
}

function proxyRoutes(
  boundary: ProxyRouteSource["boundary"],
  directory: string,
  prefix = "",
): ProxyRouteSource[] {
  const routes: ProxyRouteSource[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    const name = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(absolute).isDirectory()) routes.push(...proxyRoutes(boundary, absolute, name));
    else if (entry === "route.ts") routes.push({
      boundary,
      name: prefix,
      source: readFileSync(absolute, "utf8"),
    });
  }
  return routes;
}

describe("every market-engine proxy carries one end-to-end request context", () => {
  const routeRoot = fileURLToPath(new URL("../app/api/gateway/", import.meta.url));
  const routes = [
    ...proxyRoutes("coherence", join(routeRoot, "coherence")),
    ...proxyRoutes("diffusion", join(routeRoot, "diffusion")),
  ];

  it("covers the complete deployed boundary", () => {
    assert.equal(routes.length, 21, "a new engine route was added without joining this audit");
  });

  for (const route of routes) {
    it(`${route.boundary}/${route.name} propagates correlation, cancellation, and timing`, () => {
      const leaf = route.name.split("/").pop() ?? route.name;
      const expectedClass = route.boundary === "coherence" && (LIVE_READS as readonly string[]).includes(leaf)
          ? "H4"
          : "H2";
      assert.match(route.source, /gatewayRequestContext/, "the proxy has no bounded request context");
      assert.match(
        route.source,
        new RegExp(`gatewayRequestContext\\(request, "${expectedClass}"\\)`),
        `the proxy does not declare its ${expectedClass} ceiling`,
      );
      assert.match(route.source, /gatewayResponseHeaders\(context\)/, "responses carry no timing/correlation headers");
      assert.match(route.source, /\bcontext,?\s*\n?\s*\}/, "the upstream call does not receive caller cancellation");
      assert.match(route.source, /failureBody\(result\.failure, context\)/,
        "the failure body cannot be correlated with its request");
      assert.ok(
        [...route.source.matchAll(/headers: responseHeaders/g)].length >= 2,
        "success and failure do not return the same transport metadata",
      );
    });
  }
});
