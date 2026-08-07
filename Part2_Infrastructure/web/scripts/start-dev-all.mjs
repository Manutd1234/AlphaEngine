import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "../..");
const webDir = resolve(scriptDir, "..");

console.log("🚀 Starting FastAPI Gateway (port 8000) and Next.js Dev Server...");

const pythonBinary = resolve(rootDir, "venv/bin/python");
const gatewayProc = spawn(pythonBinary, ["-m", "uvicorn", "main:app", "--reload", "--port", "8000"], {
  cwd: rootDir,
  stdio: "inherit",
  env: process.env,
});

const nextProc = spawn("npm", ["run", "dev"], {
  cwd: webDir,
  stdio: "inherit",
  env: process.env,
});

function cleanup() {
  console.log("\n🧹 Stopping services...");
  gatewayProc.kill();
  nextProc.kill();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
