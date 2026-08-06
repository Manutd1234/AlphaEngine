import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(scriptDirectory, "../../tools/openapi.json");
const digestModulePath = resolve(scriptDirectory, "../lib/gateway-openapi-digest.generated.ts");

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const actual = createHash("sha256").update(canonicalJson(contract), "utf8").digest("hex");
const digestModule = readFileSync(digestModulePath, "utf8");
const declared = digestModule.match(/[0-9a-f]{64}/)?.[0];

if (declared !== actual) {
  process.stderr.write(
    `Gateway OpenAPI digest is stale. Expected ${actual}; update ${digestModulePath}.\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`Gateway OpenAPI digest verified: ${actual}\n`);
}
