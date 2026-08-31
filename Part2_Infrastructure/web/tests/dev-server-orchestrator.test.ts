import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { waitForReadiness } from "../scripts/dev-readiness.mjs";

const source = readFileSync(join(import.meta.dirname, "../scripts/start-dev-all.mjs"), "utf8");
const packageJson = JSON.parse(
  readFileSync(join(import.meta.dirname, "../package.json"), "utf8"),
) as { scripts: Record<string, string> };

describe("the local two-service supervisor", () => {
  it("is the default dev path while retaining an explicit frontend-only command", () => {
    assert.equal(packageJson.scripts.dev, "node scripts/start-dev-all.mjs");
    assert.equal(packageJson.scripts["dev:all"], "node scripts/start-dev-all.mjs");
    assert.equal(packageJson.scripts["dev:web"], "next dev");
    assert.match(source, /start\("npm", \["run", "dev:web"\], webDir, workspaceEnv\)/);
    assert.doesNotMatch(source, /start\("npm", \["run", "dev"\], webDir, workspaceEnv\)/,
      "the supervisor recursively invokes the default supervisor");
  });

  it("owns each reloader's process group so shutdown reaches descendants", () => {
    assert.match(source, /detached:\s*ownsProcessGroups/);
    assert.match(source, /process\.kill\(-child\.pid, nextSignal\)/);
    assert.match(source, /SIGTERM/);
    assert.match(source, /SIGKILL/);
  });

  it("coordinates service failure instead of leaving the peer alive", () => {
    assert.match(source, /child\.once\("error"/);
    assert.match(source, /child\.once\("exit"/);
    assert.match(source, /void shutdown\(/);
    assert.match(source, /Promise\.allSettled/);
    assert.doesNotMatch(source, /process\.exit\(0\)/);
  });

  it("keeps startup logs operational and free of decorative emoji", () => {
    assert.doesNotMatch(source, /[🚀🧹]/u);
    assert.match(source, /console\.log\(`Gateway:\s+\$\{localGatewayUrl\}`\)/);
    assert.match(source, /Workspace:\s+http:\/\/localhost:/);
  });

  it("pins the workspace proxy to the gateway this supervisor starts", () => {
    assert.match(source, /localGatewayUrl\s*=\s*"http:\/\/127\.0\.0\.1:8000"/);
    assert.match(source, /ALPHAENGINE_GATEWAY_URL:\s*localGatewayUrl/);
    assert.match(source, /start\("npm", \["run", "dev:web"\], webDir, workspaceEnv\)/);
  });

  it("does not equate a listening process with an application-ready workspace", () => {
    assert.match(source, /waitForReadiness/);
    assert.match(source, /\/login/);
    assert.match(source, /AlphaEngine/);
    assert.match(source, /\/health/);
    assert.match(source, /readiness failure/);
  });
});

describe("the HTTP and DOM readiness gate", () => {
  it("rejects an unrelated body on the expected port, then accepts the AlphaEngine DOM", async () => {
    const bodies = ["<html>another app</html>", "<html><title>AlphaEngine</title></html>"];
    let clock = 0;
    const result = await waitForReadiness({
      name: "workspace",
      url: "http://127.0.0.1:3000/login",
      deadlineMs: 1_000,
      requestTimeoutMs: 50,
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
      fetchImpl: async () => new Response(bodies.shift(), { status: 200 }),
      accept: ({ response, body }) => response.ok && body.includes("AlphaEngine"),
    });

    assert.equal(result.attempts, 2);
    assert.equal(result.status, 200);
  });

  it("fails in bounded time with the last HTTP evidence", async () => {
    let clock = 0;
    await assert.rejects(
      waitForReadiness({
        name: "workspace",
        url: "http://127.0.0.1:3000/login",
        deadlineMs: 500,
        intervalMs: 250,
        requestTimeoutMs: 50,
        now: () => clock,
        sleep: async (milliseconds) => { clock += milliseconds; },
        fetchImpl: async () => new Response("still compiling", { status: 503 }),
        accept: ({ response }) => response.ok,
      }),
      /workspace was not ready after 500ms.*HTTP 503/,
    );
  });
});
