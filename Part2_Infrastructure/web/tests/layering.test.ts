/**
 * The stacking contract.
 *
 * Three overlays in this workspace once carried `z-index: 20`, `9999` and
 * `10000`, and all three were wrong in the same way: the number was not the
 * problem. The ⌘K palette rendered inside `.workspace-header`, whose
 * `backdrop-filter` is a stacking context AND a containing block for
 * fixed-position descendants, so its 10000 was inert and its `inset: 0` was
 * measured against the header box. The tooltip and the row menu sat inside
 * `overflow: auto` scrollers, which clip regardless of depth. No z-index value
 * fixes any of those; the browser's top layer does.
 *
 * So this file pins two rules:
 *
 *  1. **Depth is named.** Every `z-index` in the stylesheet resolves to a token
 *     on the documented ladder, or is a small local paint-order value (≤ 2)
 *     inside a sealed box. The band in between is where things fight page
 *     chrome by accident.
 *
 *  2. **Sticky offsets are measured, not counted.** The header is 57px wide and
 *     ~120px once the eight role tabs wrap, which is why `WorkspaceHeader`
 *     publishes `--header-h` from a ResizeObserver. A literal `top: 63px` —
 *     which is what `.console-statusbar` carried — docks an element behind the
 *     header on every narrow viewport, and looks perfectly reasonable in review.
 *
 * Parsing CSS with a regex is normally a bad idea; the justification is the one
 * `theme.test.ts` already gives for the same file. The input is one hand-written
 * stylesheet and the alternative is carrying a CSS parser to assert two facts.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const cssPath = fileURLToPath(new URL("../app/globals.css", import.meta.url));
const css = readFileSync(cssPath, "utf8");
const componentsDir = fileURLToPath(new URL("../components", import.meta.url));

/**
 * The stylesheet with comment bodies blanked and every newline kept, so the
 * scans below read declarations only and still report a usable line number.
 * Necessary because this file's comments discuss `z-index:` and `top:` at
 * length — the prose explaining why a rule exists would otherwise be linted as
 * the rule itself.
 */
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "));

/**
 * A component's code with comment bodies removed.
 *
 * Same justification as `declarations` above, and the same trap: this file's
 * scans look for `z-[60]` and `zIndex:`, which is exactly the vocabulary a
 * comment recording *why* a value was retired has to use. AnchoredPanel's
 * header quotes the old string it replaced, and without this the component that
 * fixed the defect would be reported as committing it.
 */
const source = (file: string) =>
  readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

/** `--name: value` pairs from the `:root` block that opens the file. */
function rootTokens(): Map<string, string> {
  const open = css.indexOf("{", css.indexOf(":root"));
  const block = css.slice(open, css.indexOf("\n}", open));
  return new Map(
    [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
  );
}

/** Line number for a character offset, for a failure message you can click. */
function lineOf(index: number): number {
  return css.slice(0, index).split("\n").length;
}

// --------------------------------------------------------------------------
// The ladder itself
// --------------------------------------------------------------------------

describe("the stacking ladder is ordered and complete", () => {
  const tokens = rootTokens();
  const ladder = [
    "--z-below", "--z-sticky-cell", "--z-popover", "--z-rail", "--z-header", "--z-overlay", "--z-skip",
  ];

  it("declares every rung", () => {
    for (const name of ladder) {
      assert.ok(tokens.has(name), `${name} is missing from :root`);
    }
  });

  it("is strictly increasing", () => {
    const values = ladder.map((name) => Number(tokens.get(name)));
    for (const [i, value] of values.entries()) {
      assert.ok(Number.isFinite(value), `${ladder[i]} is not a number: ${tokens.get(ladder[i])}`);
    }
    for (let i = 1; i < values.length; i++) {
      assert.ok(
        values[i] > values[i - 1],
        `${ladder[i]} (${values[i]}) must sit above ${ladder[i - 1]} (${values[i - 1]})`,
      );
    }
  });

  it("keeps the rail below the header", () => {
    // The one ordering with a visible consequence: the section rail docks
    // directly under the header and must never paint over it.
    assert.ok(Number(tokens.get("--z-rail")) < Number(tokens.get("--z-header")));
  });
});

// --------------------------------------------------------------------------
// 1 — depth is named
// --------------------------------------------------------------------------

describe("every z-index is named or provably local", () => {
  /**
   * Raw values this size are paint order between siblings inside one component
   * (a hero's content over its decorative ::before, a pipeline node over its
   * connector line). They are not page chrome and naming them would be noise.
   * Anything larger is claiming a position in the page's stack and must say so.
   */
  const LOCAL_MAX = 2;

  it("uses no unnamed value above the local paint-order band", () => {
    const offenders: string[] = [];
    for (const match of declarations.matchAll(/z-index:\s*([^;]+);/g)) {
      const value = match[1].trim();
      if (value.includes("var(--z-")) continue;
      const numeric = Number(value);
      if (Number.isFinite(numeric) && Math.abs(numeric) <= LOCAL_MAX) continue;
      offenders.push(`globals.css:${lineOf(match.index)} — z-index: ${value}`);
    }
    assert.deepEqual(
      offenders,
      [],
      "these claim a page-level layer with a bare number instead of a ladder token:\n  "
        + offenders.join("\n  "),
    );
  });

  it("the overlays that use the top layer declare no z-index at all", () => {
    // A z-index here would be a sign someone stopped trusting the top layer and
    // started fighting the old battle again.
    for (const selector of [".command-bar", ".row-menu__items", ".quant-tooltip"]) {
      const start = css.indexOf(`\n${selector} {`);
      assert.notEqual(start, -1, `${selector} is gone from the stylesheet`);
      const block = declarations.slice(start, css.indexOf("\n}", start));
      assert.doesNotMatch(
        block,
        /z-index/,
        `${selector} renders in the top layer; a z-index there is either dead weight or a `
          + "sign it stopped being a dialog/popover",
      );
    }
  });

  it("no popover sets display outside :popover-open", () => {
    /**
     * The UA stylesheet hides a closed popover with `[popover] { display: none }`.
     * Author styles beat the UA origin regardless of specificity, so a bare
     * `display: flex` on a popover's class defeats that rule and the element is
     * permanently visible — which is exactly what happened to `.row-menu__items`:
     * every row's menu rendered at once, stacked over the table, while
     * `:popover-open` still reported false. Nothing in the markup looks wrong.
     */
    const popoverClasses = [".row-menu__items", ".quant-tooltip"];
    for (const selector of popoverClasses) {
      const start = declarations.indexOf(`\n${selector} {`);
      assert.notEqual(start, -1, `${selector} is gone`);
      const block = declarations.slice(start, declarations.indexOf("\n}", start));
      assert.doesNotMatch(
        block,
        /\n\s*display:/,
        `${selector} is a popover: setting display here overrides the UA rule that hides it `
          + "when closed. Put it in a `:popover-open` rule instead.",
      );
    }
  });

  it("no component sets a numeric zIndex inline", () => {
    // This is the regression that produced all three trapped overlays: the
    // number is invisible to the stylesheet and to every reviewer reading it.
    const offenders: string[] = [];
    for (const file of tsxFiles(componentsDir)) {
      for (const match of source(file).matchAll(/zIndex:\s*("?\d+"?)/g)) {
        offenders.push(`${file.slice(componentsDir.length + 1)} — zIndex: ${match[1]}`);
      }
    }
    assert.deepEqual(offenders, [], `inline stacking:\n  ${offenders.join("\n  ")}`);
  });

  it("no component claims a layer through a Tailwind arbitrary value", () => {
    /**
     * The blind spot that let three header panels ship on `z-[60]`.
     *
     * The scan above looks for the `zIndex:` style prop and the ladder scan
     * looks in globals.css, so a utility class carrying the same number was
     * invisible to both — and 60 is `--z-overlay`, meaning all three panels
     * were on the ladder by coincidence rather than by reference. A reviewer
     * reading the class string cannot tell which rung that is.
     *
     * The same LOCAL_MAX band as the stylesheet scan above, for the same
     * reason: `z-[1]` on a pipeline node over its connector and `z-[2]` on the
     * KPI deck over its decorative backdrop are paint order between siblings
     * inside one component, not a claim on the page's stack.
     */
    const offenders: string[] = [];
    for (const file of tsxFiles(componentsDir)) {
      for (const match of source(file).matchAll(/\bz-\[(\d+)\]/g)) {
        if (Number(match[1]) <= LOCAL_MAX) continue;
        offenders.push(`${file.slice(componentsDir.length + 1)} — z-[${match[1]}]`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "a bare number in a class string is not on the ladder even when it happens to equal a "
        + `rung. Use a stylesheet rule with var(--z-*):\n  ${offenders.join("\n  ")}`,
    );
  });
});

// --------------------------------------------------------------------------
// 2 — sticky offsets are measured
// --------------------------------------------------------------------------

describe("sticky offsets come from the measured chrome, not a literal", () => {
  /**
   * Under this, a literal is a nudge inside a component — a sub-header docked
   * below a bar it can see. Above it, the element is trying to clear page
   * chrome, whose height is not knowable at authoring time.
   */
  const NUDGE_MAX = 48;

  it("nothing docks itself with a hand-counted page offset", () => {
    const offenders: string[] = [];
    // Each `position: sticky` and the declarations that follow it in its block.
    for (const match of declarations.matchAll(/position:\s*sticky;/g)) {
      const block = declarations.slice(match.index, css.indexOf("\n}", match.index));
      const top = /\n\s*top:\s*([^;]+);/.exec(block);
      if (!top) continue;
      const value = top[1].trim();
      if (value.includes("var(--")) continue;
      const px = /^(-?\d+(?:\.\d+)?)px$/.exec(value);
      if (!px || Math.abs(Number(px[1])) <= NUDGE_MAX) continue;
      offenders.push(`globals.css:${lineOf(match.index)} — top: ${value}`);
    }
    assert.deepEqual(
      offenders,
      [],
      "sticky offsets that clear page chrome must read --header-h / --chrome-*, which "
        + "WorkspaceHeader measures, because the header is 57px wide-screen and ~120px once "
        + `the role tabs wrap:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("the header still publishes its measured height", () => {
    const header = readFileSync(
      fileURLToPath(new URL("../components/WorkspaceHeader.tsx", import.meta.url)),
      "utf8",
    );
    assert.match(header, /new ResizeObserver/, "the header no longer measures itself");
    assert.match(header, /setProperty\(\s*\n?\s*"--header-h"/, "--header-h is no longer published");
  });

  it("the rail docks against that measurement", () => {
    /**
     * The measurement moved rather than went away. The shell is the page's
     * scroller now and its own height is `calc(100svh - var(--header-h))`, so
     * the rail — sticky *inside* that shell — must not read `--header-h` a
     * second time: its scrollport already begins below the header, and
     * measuring it again would park the rail a full header's height down inside
     * its own panel. shell-viewport.test.ts owns that pairing; what belongs
     * here is that the rail still sits on the ladder and still docks against a
     * measured box rather than a hand-counted page offset.
     */
    const blocks = [...declarations.matchAll(/\n\.workspace-subtabs \{/g)]
      .map((match) => declarations.slice(match.index, css.indexOf("\n}", match.index)));
    const sticky = blocks.find((block) => /position:\s*sticky/.test(block));
    assert.ok(sticky, "no .workspace-subtabs rule makes the rail sticky any more");
    assert.match(sticky, /z-index:\s*var\(--z-rail\)/);

    const shell = [...declarations.matchAll(/\n\.workspace-shell \{/g)]
      .map((match) => declarations.slice(match.index, css.indexOf("\n}", match.index)))
      .find((block) => /overflow-y:\s*auto/.test(block));
    assert.ok(shell, "the shell no longer scrolls, so nothing measures the header");
    assert.match(shell, /calc\(100svh - var\(--header-h\)\)/);
  });
});

// --------------------------------------------------------------------------
// The two scrollers whose internal ladders must stay sealed
// --------------------------------------------------------------------------

describe("scroll containers with sticky children are isolated", () => {
  // `overflow: auto` clips but does NOT create a stacking context, so without
  // `isolation: isolate` these tables' internal tiers are competing with page
  // chrome — they sit below it today by arithmetic accident, not by design.
  for (const selector of [".reliability-service-panel .table-wrap", ".codebase-filelist"]) {
    it(`${selector} seals its own stack`, () => {
      const start = css.indexOf(`\n${selector} {`);
      assert.notEqual(start, -1, `${selector} is gone`);
      const block = declarations.slice(start, css.indexOf("\n}", start));
      assert.match(block, /isolation:\s*isolate/);
    });
  }
});

// --------------------------------------------------------------------------
// Layout follows the box, not the window
// --------------------------------------------------------------------------

describe("panels measure the container they are in", () => {
  it("declares containers on wrappers, never on a chart's own box", () => {
    assert.match(
      declarations,
      /container-type:\s*inline-size/,
      "no container query context is declared — every panel is back to sizing itself "
        + "against the viewport, which is the wrong number for anything in a column",
    );
    // `container-type` brings inline-size containment: the element's width stops
    // depending on its contents. Correct for a column, wrong for a chart, which
    // is why only wrapper selectors may carry it.
    const start = declarations.indexOf("container-type: inline-size");
    const ruleStart = declarations.lastIndexOf("\n\n", start);
    const selectors = declarations.slice(ruleStart, declarations.indexOf("{", ruleStart));
    for (const banned of ["svg", "canvas", ".chart", ".sparkline"]) {
      assert.ok(
        !selectors.includes(banned),
        `${banned} must not be a container: inline-size containment would stop it `
          + "measuring itself",
      );
    }
  });

  it("scroll targets clear the measured chrome", () => {
    /**
     * `--rail-h`, not `--chrome-total`, since the lock: the shell is the scroll
     * container and y=0 inside it already sits below the header, so the rail is
     * the only chrome still painted over arriving content. Both halves stay —
     * `scroll-padding` on the container covers linked targets, `scroll-margin`
     * on the targets covers anything merely focused, which is the case
     * `openReliabilitySection` in page.tsx depends on.
     */
    assert.match(
      declarations,
      /scroll-padding-top:\s*calc\(var\(--rail-h\)/,
      "the scroll root no longer offsets for the sticky rail, so every anchor jump and "
        + "programmatic focus lands underneath it",
    );
    assert.match(declarations, /scroll-margin-top:\s*calc\(var\(--rail-h\)/);
  });

  it("every content-visibility target carries a size hint", () => {
    // Without `contain-intrinsic-size` the skipped content measures 0: the
    // scrollbar jumps as you scroll into it and anchors land in the wrong place.
    for (const match of declarations.matchAll(/content-visibility:\s*auto;/g)) {
      const block = declarations.slice(
        declarations.lastIndexOf("{", match.index),
        declarations.indexOf("}", match.index),
      );
      assert.match(
        block,
        /contain-intrinsic-size:/,
        `content-visibility at globals.css:${lineOf(match.index)} has no size hint`,
      );
    }
  });
});

// --------------------------------------------------------------------------
// The dead sticky bars stay dead
// --------------------------------------------------------------------------

describe("the retired sticky chrome is not resurrected", () => {
  for (const selector of [".console-statusbar", ".topbar"]) {
    it(`${selector} has no rules`, () => {
      assert.doesNotMatch(
        declarations,
        new RegExp(`\\n\\${selector}\\s*[{,]`),
        `${selector} is back. It was a second sticky bar with a hand-counted offset; if a `
          + "surface needs one, it goes through PageHead and the ladder.",
      );
    });
  }
});
