/**
 * Fail CI when the committed test counts drift from what the suite measured.
 *
 * The web total cannot be asserted from inside the suite — a test checking
 * the count changes the count (the refresh script's header names this). A CI
 * step OUTSIDE the suite has no such problem: the Tests step tees its output
 * to a log, and this compares the runner's own summary line against the
 * committed figure the Developer console displays.
 *
 *   node scripts/check-test-counts.mjs web "$RUNNER_TEMP/web-tests.log"
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [suite, logPath] = process.argv.slice(2);
if (suite !== "web" || !logPath) {
  process.stderr.write("usage: node scripts/check-test-counts.mjs web <logfile>\n");
  process.exit(2);
}

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Same tolerant summary regex as refresh-test-counts.mjs `nodeTestCount`. */
const log = readFileSync(logPath, "utf8");
const measured = Number(log.match(/^\s*.\s*tests\s+(\d+)/m)?.[1] ?? 0);
if (!measured) {
  process.stderr.write(`no node:test summary found in ${logPath}\n`);
  process.exit(2);
}

/** Regex the committed literal, as check-gateway-openapi-digest.mjs does. */
const generated = readFileSync(join(webRoot, "lib/test-counts.generated.ts"), "utf8");
const committed = Number(generated.match(/web: \{ total: (\d+),/)?.[1] ?? 0);
if (!committed) {
  process.stderr.write("no committed web total found in lib/test-counts.generated.ts\n");
  process.exit(2);
}

if (committed !== measured) {
  process.stderr.write(
    `Committed test counts drifted (committed ${committed}, measured ${measured}) — `
    + "run npm run counts:refresh -- --suite=web\n",
  );
  process.exit(1);
}

process.stdout.write(`Committed web test count matches the suite (${measured}).\n`);
