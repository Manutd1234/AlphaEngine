/**
 * The stylesheet does not accumulate rules nothing renders.
 *
 * `globals.css` is 13k lines and carried a comment claiming six page headers had
 * been retired and that their rules "survive above only because deleting rules
 * that nothing renders is not worth the risk of missing a caller." Measuring it
 * showed the claim was wrong in both directions: four of the six were still
 * being rendered, and separately there were retired console and utility blocks
 * the comment never mentioned. Prose about what is dead drifts. This measures.
 *
 * Two rules:
 *
 *  1. A named set of retired selectors stays gone. These were deleted for a
 *     reason — `.console-statusbar` hard-coded `top: 63px` against a header that
 *     is measured precisely because its height is not knowable at authoring
 *     time — and re-adding one should be a deliberate act, not a paste.
 *
 *  2. The unreferenced-class count does not grow. A baseline rather than zero,
 *     because driving it to zero in one pass means deleting ~600 lines across
 *     surfaces that cannot all be hand-verified in one sitting. The number can
 *     go down freely; it cannot go up without someone editing this file and
 *     saying why.
 *
 * The R19 hazard this has to handle: a class built by template literal
 * (`className={`console-${tone}`}`) defeats a literal search, so anything whose
 * prefix appears before a `${` in a template literal is treated as live.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(join(root, "app/globals.css"), "utf8");

/** Selector text only — comments in this file name classes they are describing. */
const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "");

function sourceFiles(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(sourceFiles(full));
    else if (/\.(tsx?|mjs|json)$/.test(entry)) out.push(full);
  }
  return out;
}

const sources = ["components", "app", "lib"]
  .flatMap((dir) => sourceFiles(join(root, dir)))
  .filter((file) => !file.endsWith("globals.css"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

/** Class-name stems that appear immediately before a `${…}` interpolation. */
const dynamicPrefixes = new Set<string>();
for (const [, literal] of sources.matchAll(/`([^`]*\$\{[^`]*)`/g)) {
  for (const [, stem] of literal.matchAll(/([a-zA-Z][\w-]*)-?\$\{/g)) {
    dynamicPrefixes.add(stem);
  }
}

const declared = new Set([...selectors.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const unreferenced = [...declared]
  .filter((name) => !sources.includes(name))
  .filter((name) => ![...dynamicPrefixes].some((prefix) => name.startsWith(prefix)))
  .sort();

// --------------------------------------------------------------------------

describe("retired rules stay retired", () => {
  /**
   * Each of these was deleted with a reason recorded at the deletion site.
   * `.console-statusbar` and `.developer-cp-bar` were bespoke page headers
   * replaced by `PageHead`; `.topbar` was the pre-workspace sticky bar, which sat
   * at the same depth as the section rail; the rest were unused utilities.
   */
  const retired = [
    "console-statusbar",
    "developer-cp-bar",
    "topbar",
    "console-layout",
    "console-column",
    "scroll-container-sm",
    "scroll-container-md",
    "scroll-container-lg",
  ];

  for (const name of retired) {
    it(`.${name} has no rule`, () => {
      assert.doesNotMatch(
        selectors,
        new RegExp(`\\.${name}\\b`),
        `.${name} is back in globals.css. It was removed deliberately — check the deletion `
          + "note at its old location before re-adding it.",
      );
    });
  }

  it("no component renders one either", () => {
    for (const name of retired) {
      assert.ok(
        !sources.includes(`"${name}`) && !sources.includes(` ${name}"`),
        `.${name} is being rendered but has no styles`,
      );
    }
  });
});

describe("the stylesheet does not grow more dead rules", () => {
  /**
   * Measured, not aspirational. Lower this whenever you delete a block; raising
   * it means someone added CSS for markup that does not exist, which is how this
   * file reached 13k lines in the first place.
   *
   * 54 -> 29 by deleting 152 rule blocks (672 lines) whose EVERY selector class
   * was unreferenced. The 29 that remain are not survivors of an oversight:
   * each appears only in a selector it SHARES with a class that is still
   * rendered — `.decision-metrics span, .system-summary-grid span` is one rule
   * and deleting the dead half means rewriting the live one. That is a
   * different, riskier edit than removing a whole block, and it is worth doing
   * deliberately rather than in a sweep.
   *
   * So this number is now close to a floor rather than a backlog, which is why
   * the staleness guard below is tighter than the twelve it started with.
   */
  const BASELINE = 29;

  it(`has at most ${BASELINE} unreferenced classes`, () => {
    assert.ok(
      unreferenced.length <= BASELINE,
      `${unreferenced.length} unreferenced classes, baseline ${BASELINE}. New ones are `
        + `likely among:\n  ${unreferenced.join("\n  ")}`,
    );
  });

  it("the baseline is not stale by more than a block's worth", () => {
    // A baseline far above reality stops being a ratchet. If a deletion pass has
    // brought this well under, tighten the number in the same commit.
    assert.ok(
      unreferenced.length >= BASELINE - 6,
      `only ${unreferenced.length} unreferenced classes remain — lower BASELINE to `
        + `${unreferenced.length} so it keeps ratcheting.`,
    );
  });

  it("the dynamic-classname guard is actually finding template literals", () => {
    // If this ever emptied, every conditionally-built class would be reported as
    // dead and the baseline would be measuring the wrong thing entirely.
    assert.ok(
      dynamicPrefixes.size > 5,
      "no template-literal class stems found — the R19 guard has stopped working and the "
        + "unreferenced list cannot be trusted",
    );
  });
});
