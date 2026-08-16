/**
 * Regenerate the test counts the developer console reports.
 *
 * WHY THIS EXISTS. Those counts were three hand-copied integers in
 * `DeveloperConsole.tsx`. They drifted three separate times: 342/680/13 against
 * a real 667/1976/13, then 667/1976 against 691/2013, then 2013 against 2169 —
 * the last one inside a single afternoon, committed by the same person who had
 * just written a comment in that file explaining why it keeps happening.
 *
 * A number nobody can reproduce is exactly the defect this console exists to
 * catch, so it should not be the console making the claim from memory. This
 * runs the three suites and writes what they print.
 *
 * ONE FIGURE CANNOT BE ASSERTED FROM INSIDE THE SUITE, and it is worth naming:
 * the web total counts the tests that would do the asserting, so a test
 * checking it changes it. That is why the constant is GENERATED rather than
 * pinned by a test the way the OpenAPI digest is. Run this after adding tests;
 * the value is a measurement with a date, not a contract.
 *
 *   node scripts/refresh-test-counts.mjs        # or: npm run counts:refresh
 *   node scripts/refresh-test-counts.mjs --suite=web   # web only; keeps the
 *                                                      # committed Python figures
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const infraRoot = join(webRoot, "..");
const python = join(infraRoot, "venv/bin/python");
const webOnly = process.argv.includes("--suite=web");

const run = (file, args, cwd) => {
  try {
    return execFileSync(file, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    // pytest exits non-zero on failure but still prints its summary, and a
    // failing suite is a real count worth recording rather than a crash here.
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
};

/**
 * `691 passed, 1 skipped` → 692: what the runner ran, not what it liked.
 *
 * Invoked WITHOUT `-q`. This pytest suppresses the summary line under quiet
 * mode, so the count silently vanishes and the script throws — which is the
 * right failure, but only obvious once.
 */
function pytestCount(output) {
  const passed = Number(output.match(/(\d+) passed/)?.[1] ?? 0);
  const skipped = Number(output.match(/(\d+) skipped/)?.[1] ?? 0);
  const failed = Number(output.match(/(\d+) failed/)?.[1] ?? 0);
  if (!passed && !failed) throw new Error(`no pytest summary found in:\n${output.slice(-400)}`);
  return { total: passed + skipped + failed, passed, skipped, failed };
}

/** node:test prints `ℹ tests 2169` and `ℹ suites 547`. */
function nodeTestCount(output) {
  const total = Number(output.match(/^\s*.\s*tests\s+(\d+)/m)?.[1] ?? 0);
  const suites = Number(output.match(/^\s*.\s*suites\s+(\d+)/m)?.[1] ?? 0);
  const failed = Number(output.match(/^\s*.\s*fail\s+(\d+)/m)?.[1] ?? 0);
  if (!total) throw new Error(`no node:test summary found in:\n${output.slice(-400)}`);
  return { total, suites, failed };
}

/**
 * --suite=web re-measures only the suite that actually changed, so a
 * test-adding web PR does not pay for two Python runs. The Python figures
 * are carried over from the committed file — still measurements with a date,
 * just not today's.
 */
function committedCounts() {
  const source = readFileSync(join(webRoot, "lib/test-counts.generated.ts"), "utf8");
  const gateway = source.match(/gateway: \{ total: (\d+), passed: (\d+), skipped: (\d+) \}/);
  const service = source.match(/service: \{ total: (\d+) \}/);
  if (!gateway || !service) throw new Error("could not read committed Python counts");
  return {
    gateway: { total: Number(gateway[1]), passed: Number(gateway[2]), skipped: Number(gateway[3]), failed: 0 },
    service: { total: Number(service[1]), passed: Number(service[1]), skipped: 0, failed: 0 },
  };
}

let gateway;
let service;
if (webOnly) {
  ({ gateway, service } = committedCounts());
  console.log(`keeping committed Python counts (gateway ${gateway.total}, service ${service.total})`);
} else {
  console.log("running the gateway suite…");
  gateway = pytestCount(run(python, ["-m", "pytest"], infraRoot));
  console.log(`  ${gateway.total} (${gateway.passed} passed, ${gateway.skipped} skipped)`);

  console.log("running the OpenBB service suite…");
  service = pytestCount(run(python, ["-m", "pytest"], join(infraRoot, "OpenBB_Service")));
  console.log(`  ${service.total}`);
}

console.log("running the web suite…");
const web = nodeTestCount(run("npm", ["test"], webRoot));
console.log(`  ${web.total} across ${web.suites} suites`);

for (const [name, result] of [["gateway", gateway], ["service", service], ["web", web]]) {
  if (result.failed) console.warn(`  ! ${name} has ${result.failed} failing test(s) — recording anyway`);
}

const stamp = new Date().toISOString().slice(0, 10);
const body = `/**
 * Generated by \`scripts/refresh-test-counts.mjs\`. Do not edit by hand — that
 * is precisely what went wrong three times before this file existed.
 *
 * Each figure is what its runner printed on ${stamp}. Re-run the script after
 * adding tests; nothing regenerates these automatically, because running three
 * suites inside \`next build\` would make every deploy pay for them.
 */

export const TEST_COUNTS = {
  generatedOn: "${stamp}",
  gateway: { total: ${gateway.total}, passed: ${gateway.passed}, skipped: ${gateway.skipped} },
  web: { total: ${web.total}, suites: ${web.suites} },
  service: { total: ${service.total} },
} as const;
`;

const out = join(webRoot, "lib/test-counts.generated.ts");
writeFileSync(out, body, "utf8");
console.log(`wrote ${out}`);
