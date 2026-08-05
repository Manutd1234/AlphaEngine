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

writeFileSync(outputPath, `${JSON.stringify({ version: 1, files }, null, 2)}\n`, "utf8");
process.stdout.write(`Wrote ${files.length} repository paths to ${outputRelativePath}\n`);
