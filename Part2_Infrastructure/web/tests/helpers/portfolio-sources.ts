/**
 * The component sources every Portfolio pane suite argues against.
 *
 * `portfolio-section-panes-splits.test.ts` was split by concern on 2026-08-21 — the
 * split mechanics, the Overview panes, the Performance time base, the
 * cross-link tile — and all four successors reason about the same files on
 * disk. A second copy of these reads would let one suite's idea of "the
 * Standing pane" drift from another's, and the suite that drifted would keep
 * passing while it stopped describing the component.
 *
 * THE PATH IS WHAT CAN GO SILENTLY WRONG HERE, so it is guarded rather than
 * trusted. These reads sit one directory deeper than the suite that used to do
 * them: `new URL("..", import.meta.url)` resolved to the web root from
 * `tests/` and resolves to `tests/` from `tests/helpers/`. A source that
 * resolved to nothing would leave every `assert.doesNotMatch` in the suites
 * below matching an empty string — a scan that reads no code and reports
 * green, which is worse than a deleted test because nobody looks at it. So
 * `read` asserts it got content, and the whole suite dies at import if it did
 * not.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The web root: two levels up from `tests/helpers/`, not one. */
export const root = fileURLToPath(new URL("../..", import.meta.url));

export const read = (relative: string): string => {
  const source = readFileSync(join(root, relative), "utf8");
  assert.ok(
    source.trim().length > 0,
    `${relative} read as empty from ${root}; a suite scanning it would assert nothing and still pass`,
  );
  return source;
};

/**
 * Comments describe the traps by name, so a scan that cannot tell prose from
 * code reads the explanation as the offence.
 *
 * The JSX form is stripped FIRST and deliberately. Removing `/*…*\/` before
 * `{/*…*\/}` leaves the braces behind as a bare `{}`, which is invisible in a
 * keyword search but not to the position checks below — one of which asserts
 * that a card is preceded by a closed conditional.
 */
export const code = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

export const workspaceSource = read("components/PortfolioWorkspace.tsx");
export const workspace = code(workspaceSource);
/** The Overview frame: the summary strip, the switcher, and nothing else. */
export const overviewSection = code(read("components/portfolio/OverviewSection.tsx"));
/** Its two panes, each now a file, which is what lets a scan say "not there". */
export const standing = code(read("components/portfolio/OverviewStanding.tsx"));
export const overviewBook = code(read("components/portfolio/OverviewBook.tsx"));
export const performanceSource = read("components/portfolio/PerformanceSection.tsx");
export const performance = code(performanceSource);
export const positionsSection = code(read("components/portfolio/PositionsSection.tsx"));
export const allocationSection = code(read("components/portfolio/AllocationSection.tsx"));
/** The one place the bands and the drift prompt are written down. */
export const alertBands = read("components/portfolio/alert-bands.ts");
/**
 * The Risk tab's limits subtab. It was the body of `RiskWorkspace.tsx` until
 * that file reached the line ceiling, and the cross-link tile came out with it,
 * so this follows the tile rather than the workspace that used to hold it. A
 * read left on the workspace would scan a file the tile has left, find nothing,
 * and report green — the exact failure this helper's header opens by naming.
 */
export const limitsPanelSource = read("components/risk/LimitsPanel.tsx");
export const limitsPanel = code(limitsPanelSource);
export const bookChromeSource = read("components/portfolio/BookChrome.tsx");
export const bookChrome = code(bookChromeSource);
