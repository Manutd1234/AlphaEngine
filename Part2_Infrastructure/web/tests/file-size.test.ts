/**
 * A ceiling on file length, ratcheting down.
 *
 * There is no ESLint in this project — no dependency, no config, no lint
 * script — and ruff has no file-length rule either, so a 300-400 line
 * convention had nothing holding it. Files grew back, which is how
 * `app/dashboard/page.tsx` reached 2,205 lines with a single 2,000-line
 * function inside it.
 *
 * Same shape as `dead-css.test.ts`, and for the same reason: an allow-list
 * that may shrink and must not grow is honest about a codebase that cannot be
 * split in one sitting, where a flat `assert every file < 400` would be a test
 * that is red on the day it is written and therefore ignored.
 *
 * Two rules. A file already on the list may not get LONGER — that is the
 * ratchet, and it is what stops "I will split it later" from becoming "it grew
 * while I waited". A file not on the list may not cross the ceiling at all.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** The line count a file must stay under unless it is on the list below. */
const CEILING = 400;

/**
 * Files over the ceiling today, with the length they are at.
 *
 * Every entry is a debt, not an exemption. The number may go DOWN freely — the
 * test recomputes and only compares — and it may not go up. Delete an entry
 * when the file drops under the ceiling; that is the ratchet closing.
 */
const OVER_CEILING: Record<string, number> = {
  "app/dashboard/page.tsx": 2206,
  "lib/engine.ts": 1653,
  "components/PortfolioWorkspace.tsx": 1106,
  "lib/providers/runtime.ts": 1105,
  "lib/blotter.ts": 1007,
  "lib/venues.ts": 954,
  "lib/gateway-contract.generated.ts": 953,
  "components/DeveloperConsole.tsx": 943,
  "components/LiveMarket.tsx": 902,
  "lib/types.ts": 794,
  "lib/data-trust.ts": 788,
  "components/data/DataTrustOverview.tsx": 783,
  "components/systems/ReliabilityOverview.tsx": 761,
  "lib/providers/contracts.ts": 745,
  "components/profile/ProfileScreen.tsx": 730,
  "lib/use-book.ts": 659,
  "lib/livebook.ts": 645,
  "components/systems/PipelineInspector.tsx": 644,
  "lib/portfolio.ts": 642,
  "lib/providers/registry.ts": 636,
  "components/systems/types.ts": 619,
  "lib/operator.ts": 616,
  "components/auth/LoginScreen.tsx": 614,
  "components/DataConsole.tsx": 605,
  "lib/overview-state.ts": 589,
  "components/systems/OperatorPanel.tsx": 585,
  "components/execution/ExecutionCockpit.tsx": 574,
  "components/execution/OrderTicket.tsx": 561,
  "scripts/desk-sweep.mjs": 558,
  "lib/strategy-docs.ts": 537,
  "components/data/DataWorkBoard.tsx": 526,
  "components/Controls.tsx": 522,
  "lib/use-system-health.ts": 483,
  "components/portfolio/StressTest.tsx": 430,
  "lib/experiments.ts": 429,
  "components/ReliabilityConsole.tsx": 408,
  "components/portfolio/WorkingOrders.tsx": 408,
  "components/research/ExperimentHistory.tsx": 408,
  "lib/data-work-queue.ts": 404,
  "lib/delivery-readiness.ts": 404,
};

function sources(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(tsx?|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every source file under the scanned roots, with its line count. */
function measureAll(): [string, number][] {
  return ["app", "components", "lib", "scripts"]
    .flatMap((dir) => sources(join(root, dir)))
    .map((file) => [
      file.slice(root.length),
      readFileSync(file, "utf8").split("\n").length,
    ] as [string, number])
    .sort((a, b) => b[1] - a[1]);
}

describe("no file grows past the ceiling", () => {
  const measured = measureAll();

  it("a file not already over the ceiling stays under it", () => {
    const crossed = measured
      .filter(([path, lines]) => lines > CEILING && !(path in OVER_CEILING))
      .map(([path, lines]) => `${path} (${lines})`);
    assert.deepEqual(
      crossed, [],
      `these crossed ${CEILING} lines. Split them, or add them to OVER_CEILING with a reason:\n  ${crossed.join("\n  ")}`,
    );
  });

  it("a file already over the ceiling does not get longer", () => {
    const grown = measured
      .filter(([path, lines]) => path in OVER_CEILING && lines > OVER_CEILING[path])
      .map(([path, lines]) => `${path}: ${OVER_CEILING[path]} → ${lines}`);
    assert.deepEqual(
      grown, [],
      `these are already over ${CEILING} and grew. The ratchet only turns one way:\n  ${grown.join("\n  ")}`,
    );
  });

  it("the list holds no file that is already under the ceiling", () => {
    // A stale entry is a ceiling that is not being enforced on a file which
    // has earned it. Removing them is how the list empties.
    const byPath = new Map(measured);
    const stale = Object.keys(OVER_CEILING)
      .filter((path) => (byPath.get(path) ?? 0) <= CEILING)
      .map((path) => `${path} (${byPath.get(path) ?? "gone"})`);
    assert.deepEqual(stale, [], `remove these from OVER_CEILING — they are under the ceiling now:\n  ${stale.join("\n  ")}`);
  });
});
