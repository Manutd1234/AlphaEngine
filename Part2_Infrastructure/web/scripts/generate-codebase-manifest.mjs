import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const outputPath = resolve(scriptDirectory, "../lib/repository-manifest.generated.json");
const outputRelativePath = relative(repositoryRoot, outputPath).split(sep).join("/");

const trackedAndNewFiles = execFileSync(
  "git",
  ["-C", repositoryRoot, "ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split("\n")
  .map((path) => path.trim())
  .filter(Boolean);

const files = [...new Set([...trackedAndNewFiles, outputRelativePath])].sort((left, right) =>
  left.localeCompare(right),
);

// Provenance travels with the manifest so the UI can say WHEN the count it
// shows was measured, not just what it was. Same graceful-degradation shape
// as next.config.mjs's commitSha(): a tarball without git still generates.
function shortHead() {
  try {
    return execFileSync("git", ["-C", repositoryRoot, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

const generatedAt = new Date().toISOString().slice(0, 10);
const commit = shortHead();

writeFileSync(
  outputPath,
  `${JSON.stringify({ version: 2, generatedAt, commit, files }, null, 2)}\n`,
  "utf8",
);
process.stdout.write(
  `Wrote ${files.length} repository paths to ${outputRelativePath} (as of ${generatedAt} at ${commit})\n`,
);
