import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const outputPath = resolve(scriptDirectory, "../lib/repository-manifest.generated.json");
const outputRelativePath = relative(repositoryRoot, outputPath).split(sep).join("/");
const checkMode = process.argv.includes("--check");

let trackedAndNewFiles;
try {
  trackedAndNewFiles = execFileSync(
    "git",
    ["-C", repositoryRoot, "ls-files", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8" },
  )
    .split("\n")
    .map((path) => path.trim())
    .filter(Boolean);
} catch (error) {
  if (checkMode) {
    // A tarball build has no git and nothing to compare against; the gate
    // holds where drift can actually happen — CI and working checkouts.
    process.stdout.write("Repository manifest check skipped: git is unavailable here.\n");
    process.exit(0);
  }
  throw error;
}

const files = [...new Set([...trackedAndNewFiles, outputRelativePath])].sort((left, right) =>
  left.localeCompare(right),
);

if (checkMode) {
  // Compare ONLY the file list — generatedAt/commit change with every commit
  // by design, and gating on them would fail every push.
  const committed = JSON.parse(readFileSync(outputPath, "utf8"));
  const committedFiles = new Set(committed.files ?? []);
  const currentFiles = new Set(files);
  const added = files.filter((path) => !committedFiles.has(path));
  const removed = (committed.files ?? []).filter((path) => !currentFiles.has(path));
  if (added.length || removed.length) {
    for (const path of added) process.stderr.write(`  + ${path}\n`);
    for (const path of removed) process.stderr.write(`  - ${path}\n`);
    process.stderr.write(
      `Repository manifest is stale (${added.length} added, ${removed.length} removed) — run npm run catalog:refresh\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`Repository manifest matches the tree (${files.length} paths).\n`);
  process.exit(0);
}

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
