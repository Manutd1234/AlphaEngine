import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { waitForReadiness } from "./dev-readiness.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "../..");
const webDir = resolve(scriptDir, "..");
const pythonBinary = resolve(rootDir, "venv/bin/python");
const ownsProcessGroups = process.platform !== "win32";
const workspacePort = process.env.PORT ?? "3000";
const gracefulShutdownMs = 4_000;
const localGatewayUrl = "http://127.0.0.1:8000";
const workspaceUrl = `http://localhost:${workspacePort}`;
const workspaceReadinessUrl = `http://127.0.0.1:${workspacePort}`;
const readinessTimeoutMs = Number(process.env.ALPHAENGINE_DEV_READY_TIMEOUT_MS ?? 45_000);
const workspaceEnv = {
  ...process.env,
  // `dev:all` owns the gateway below. Process env must outrank a stale
  // `.env.local` pointing at another developer port, otherwise the two green
  // child processes still cannot speak to each other.
  ALPHAENGINE_GATEWAY_URL: localGatewayUrl,
};

console.log("Starting AlphaEngine local services");
console.log(`Gateway:   ${localGatewayUrl}`);
console.log(`Workspace: http://localhost:${workspacePort}`);

function start(command, args, cwd, env = process.env) {
  return spawn(command, args, {
    cwd,
    stdio: "inherit",
    env,
    // Both uvicorn --reload and npm/Next create descendants. Their own process
    // groups let one signal reach the complete tree rather than only the shim.
    detached: ownsProcessGroups,
  });
}

const services = [
  {
    name: "FastAPI gateway",
    child: start(
      pythonBinary,
      ["-m", "uvicorn", "main:app", "--reload", "--port", "8000"],
      rootDir,
    ),
  },
  {
    name: "Next.js workspace",
    // `npm run dev` is this supervisor. The explicit frontend-only command is
    // the child boundary; calling `dev` here would recursively start supervisors.
    child: start("npm", ["run", "dev:web"], webDir, workspaceEnv),
  },
];

let stopping = false;

function isRunning(child) {
  return child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}

function signal(child, nextSignal) {
  if (!isRunning(child)) return;
  try {
    if (ownsProcessGroups) process.kill(-child.pid, nextSignal);
    else child.kill(nextSignal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function waitForExit(child) {
  if (!isRunning(child)) return Promise.resolve();
  return new Promise((resolveExit) => child.once("exit", resolveExit));
}

function deadline(milliseconds) {
  return new Promise((resolveDeadline) => {
    const timer = setTimeout(resolveDeadline, milliseconds);
    timer.unref();
  });
}

async function shutdown(reason, exitCode) {
  if (stopping) return;
  stopping = true;
  console.log(`Stopping AlphaEngine local services (${reason})`);

  for (const { child } of services) signal(child, "SIGTERM");
  const exits = Promise.allSettled(services.map(({ child }) => waitForExit(child)));
  await Promise.race([exits, deadline(gracefulShutdownMs)]);

  // Reloaders occasionally retain a worker after their parent handles TERM.
  // The bounded fallback is why a second dev:all starts with clean ports.
  for (const { child } of services) signal(child, "SIGKILL");
  await Promise.allSettled(services.map(({ child }) => waitForExit(child)));
  process.exitCode = exitCode;
}

function monitor(name, child) {
  child.once("error", (error) => {
    console.error(`${name} failed to start: ${error.message}`);
    void shutdown(`${name} start failure`, 1);
  });
  child.once("exit", (code, exitSignal) => {
    if (stopping) return;
    const detail = exitSignal ? `signal ${exitSignal}` : `code ${code ?? "unknown"}`;
    void shutdown(`${name} stopped with ${detail}`, 1);
  });
}

for (const { name, child } of services) monitor(name, child);

async function verifyReadiness() {
  const readiness = await Promise.all([
    waitForReadiness({
      name: "FastAPI gateway",
      url: `${localGatewayUrl}/health`,
      deadlineMs: readinessTimeoutMs,
    }),
    waitForReadiness({
      name: "Next.js workspace",
      url: `${workspaceReadinessUrl}/login`,
      deadlineMs: readinessTimeoutMs,
      // A stale process can answer on the expected port. The product marker is
      // the evidence that this supervisor reached AlphaEngine's rendered DOM.
      accept: ({ response, body }) => response.ok && body.includes("AlphaEngine"),
    }),
  ]);
  if (stopping) return;
  const [gateway, workspace] = readiness;
  console.log(
    `AlphaEngine local services ready `
    + `(gateway ${gateway.elapsedMs}ms; workspace ${workspace.elapsedMs}ms)`,
  );
}

void verifyReadiness().catch((error) => {
  if (stopping) return;
  console.error(`AlphaEngine readiness failure: ${error.message}`);
  void shutdown("readiness failure", 1);
});

process.once("SIGINT", () => { void shutdown("SIGINT", 0); });
process.once("SIGTERM", () => { void shutdown("SIGTERM", 0); });
