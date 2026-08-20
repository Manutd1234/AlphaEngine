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
  // `app/dashboard/page.tsx` left this list on 2026-08-21 at 304 lines, down
  // from 685. The eight `<section role="tabpanel">` elements became
  // `components/workspace/WorkspacePanels.tsx` (370), the panel wrappers
  // `components/workspace/lazy-panels.tsx` (44), the four-tile briefs
  // `lib/workspace-insights.ts` (119) and the two global keystrokes
  // `lib/use-workspace-shortcuts.ts` (60) — every successor under the ceiling,
  // so none takes its place here.
  // Four more entries left on 2026-08-21, and none of them left by
  // shrinking in place: LiveMarket (902 → 339) shed the routing probe, the
  // depth book, the route estimate and the watchlist into
  // `components/execution/`, DataTrustOverview (783 → 278) and
  // ExecutionCockpit (574 → 341) split the same way, and ProfileScreen
  // (730 → 224) followed. The debt moved rather than evaporated, so it was
  // re-measured where it landed: the longest file any of those splits
  // produced is `components/execution/RoutingProbe.tsx` at 302 lines, which
  // is why no successor takes their place here.
  // `lib/use-book.ts` came down to 383 on 2026-08-21, from 659: the per-symbol
  // OHLCV fetch became `lib/book-bars.ts` (127), the equity backfill's parsing
  // `lib/book-history.ts` (72), the eleven derived risk memos
  // `lib/use-book-risk.ts` (167) and the shared `BookView` contract
  // `lib/book-view.ts` (105). Every successor is under the ceiling.
  // `components/auth/LoginScreen.tsx` left on 2026-08-21 at 374, from 614: the
  // card's markup became `components/auth/LoginCard.tsx` (205), the four modes'
  // wording `components/auth/login-copy.ts` (57), and what "submit" means in
  // each of them `lib/auth-submit.ts` (126). The guest fetch and its deadline
  // stayed put, which is where `deadlines.test.ts` reads them.
  // `components/execution/OrderTicket.tsx` left on 2026-08-21 at 333, from 561.
  // The controls became `components/execution/OrderTicketForm.tsx` (230), the
  // gateway's answer `components/execution/OrderVerdict.tsx` (91), and the
  // shapes and gate presets `components/execution/ticket-model.ts` (49). The
  // POST and its longer-than-a-read deadline stayed put — `no-dead-ends.test.ts`
  // exempts this path by file, and the exemption did not have to move.
  // `scripts/desk-sweep.mjs` left on 2026-08-21 at 292, from 558, split at the
  // banners it already carried: `scripts/desk-sweep-plan.mjs` (123) holds what
  // is swept — the rail, `EXPECTED_SECTIONS` beside it, the fault profiles and
  // the dead-end vocabulary — and `scripts/desk-sweep-cdp.mjs` (184) holds the
  // browser plumbing. The count moved with the list it counts.
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

  // ---- stylesheets -------------------------------------------------------
  // Seeded on 2026-08-21 at what the partials actually measure, when `.css`
  // entered the scan above. `app/globals.css` was 17,416 lines; it is now a
  // 122-line @import manifest over the sixteen partials below, split on the
  // file's own section banners. The concatenation is byte-identical to the
  // file it came from (SHA-256
  // 3bb8ed921b72dc31977e3fa943148eb6c951d69853155d35985534c70b17c1d5), which
  // is the only way a split of this file is safe: CSS resolves ties by source
  // order and this sheet depends on that in eleven documented places.
  //
  // A partial over 400 lines is EXPECTED and is not a debt to be paid by
  // cutting one in half. Each is one coherent section, and chopping a section
  // to reach a number would put the cascade at risk for nothing. These
  // numbers ratchet the same way every other entry does — they may fall as a
  // section genuinely shrinks or moves, and they may not rise.
  "app/globals/01-workspace-shell.css": 2209,
  "app/globals/12-workspace-standardisation.css": 2159,
  "app/globals/00-tokens-and-base.css": 1933,
  "app/globals/15-navigator-and-trailing-layer.css": 1481,
  "app/globals/06-execution-and-desk-panels.css": 1316,
  "app/globals/07-data-operations.css": 1247,
  "app/globals/02-systems-console.css": 1123,
  "app/globals/08-developer-engineering.css": 1084,
  "app/globals/13-warm-bright-pass.css": 1067,
  "app/globals/14-symbol-combobox.css": 934,
  "app/globals/10-developer-control-plane.css": 881,
  "app/globals/04-portfolio-command-centre.css": 653,
  "app/globals/03-research-lab.css": 608,
  "app/globals/09-reliability-consolidation.css": 589,
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
    // Generated files are excluded, not exempted. `gateway-contract.generated.ts`
    // is written by scripts/generate-gateway-client.ts from tools/openapi.json:
    // its length is a function of the gateway's route count, splitting it would
    // be undone by the next regeneration, and a ratchet entry for it would
    // record a debt no one can pay. The ceiling is a rule about code somebody
    // writes.
    // `.css` joined this scan on 2026-08-21. It had never been in it, which is
    // the whole reason `app/globals.css` reached 17,416 lines — 68% of all
    // over-ceiling frontend code — while a 401-line component failed the
    // build. The `.ts`/`.tsx`/`.mjs` behaviour above and below is unchanged:
    // the same ceiling, the same one-way ratchet, the same generated-file
    // exclusion.
    else if (/\.(tsx?|mjs|css)$/.test(entry) && !/\.generated\.(tsx?|mjs|css)$/.test(entry)) out.push(full);
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
