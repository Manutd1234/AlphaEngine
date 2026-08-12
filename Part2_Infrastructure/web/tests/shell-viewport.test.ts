/**
 * The viewport lock.
 *
 * The desk used to be a document that scrolled, with a sticky header and a
 * sticky rail racing it. It is now one viewport tall with exactly one scroller
 * inside it — the active panel — and that arrangement has four parts that only
 * work together. Each of them fails silently on its own:
 *
 *  - A second scroll container above the panel gives the page two scrollbars and
 *    restores the friction the lock removes. Nothing errors; it just feels wrong
 *    and no screenshot at one size shows it.
 *  - A `100vh` without an `svh`/`dvh` twin is 60-odd pixels too tall on a phone,
 *    so the bottom of every panel sits under the URL bar.
 *  - The rail is sticky *inside* the shell now. If its offset still measured
 *    `--header-h`, it would park a full header's height down inside its own
 *    panel — a gap that looks like a design choice.
 *  - `window.scrollTo` has nothing to move once the body is locked. A tab switch
 *    that still called it would leave the new tab parked wherever the last one
 *    was read to, with no error to say so.
 *
 * Regex over CSS, for the reason theme.test.ts and layering.test.ts already
 * give: one hand-written stylesheet, and the alternative is carrying a parser to
 * assert a handful of facts.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const css = read("../app/globals.css");
const page = read("../app/dashboard/page.tsx");

/** Comment bodies blanked, newlines kept, so prose is not read as a rule. */
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "));

const lineOf = (index: number) => css.slice(0, index).split("\n").length;

/** The last declaration of a property inside a selector's rule — the one that wins. */
const ruleFor = (selector: string) => {
  const matches = [...declarations.matchAll(new RegExp(`\\n\\${selector} \\{`, "g"))];
  assert.ok(matches.length > 0, `${selector} has no rule in the stylesheet`);
  return matches.map((m) => declarations.slice(m.index, declarations.indexOf("\n}", m.index)));
};

describe("the document is locked to one viewport", () => {
  it("body is exactly a viewport tall and does not scroll", () => {
    const bodyBlocks = [...declarations.matchAll(/\nbody \{/g)]
      .map((m) => declarations.slice(m.index, declarations.indexOf("\n}", m.index)));
    const locked = bodyBlocks.find((block) => /height:\s*100svh/.test(block));
    assert.ok(locked, "no `body` rule sets a viewport height — the lock is gone");
    assert.match(locked, /overflow:\s*hidden/,
      "body must not scroll: a document scrollbar restores the friction the lock removes");
    assert.doesNotMatch(locked, /min-height:\s*100/,
      "min-height lets the document grow past the viewport, which is the old behaviour");
  });

  it("the shell is the single scroller, sized from the measured header", () => {
    const shell = ruleFor(".workspace-shell").find((block) => /overflow-y:\s*auto/.test(block));
    assert.ok(shell, ".workspace-shell no longer scrolls — nothing else is allowed to");
    // Measured, never counted: the header is 57px wide-screen and ~148px once
    // the utility row and the role tabs both wrap.
    assert.match(shell, /height:\s*calc\(100svh - var\(--header-h\)\)/);
    assert.match(shell, /height:\s*calc\(100vh - var\(--header-h\)\)/,
      "keep the vh twin so a browser without svh still gets a bounded shell");
    assert.match(shell, /overscroll-behavior:\s*contain/,
      "without this, scrolling past the end of a panel rubber-bands the whole page");
  });

  it("no ancestor of the shell scrolls with it", () => {
    // Two nested scrollers is the failure this whole arrangement exists to
    // avoid, and it presents as "the page feels like it has two scrollbars".
    for (const block of ruleFor(".workspace-header")) {
      assert.doesNotMatch(block, /overflow-y:\s*(auto|scroll)/);
    }
    const htmlBlocks = [...declarations.matchAll(/\nhtml \{/g)]
      .map((m) => declarations.slice(m.index, declarations.indexOf("\n}", m.index)));
    for (const block of htmlBlocks) {
      assert.doesNotMatch(block, /overflow-y:\s*(auto|scroll)/);
    }
  });
});

describe("viewport units keep their mobile twin", () => {
  it("no bare 100vh height without an svh or dvh alongside it", () => {
    /**
     * `100vh` on iOS includes the URL bar, so a locked shell measured in vh
     * alone hangs its last 60-odd pixels below the fold — where, with the
     * document no longer scrolling, they cannot be reached at all.
     */
    const offenders: string[] = [];
    for (const match of declarations.matchAll(/(height|max-height|min-height):[^;]*100vh[^;]*;/g)) {
      const property = match[1];
      const block = declarations.slice(
        declarations.lastIndexOf("{", match.index),
        declarations.indexOf("}", match.index),
      );
      const twin = new RegExp(`${property}:[^;]*100(svh|dvh)`);
      if (twin.test(block)) continue;
      offenders.push(`globals.css:${lineOf(match.index)} — ${match[0].trim()}`);
    }
    assert.deepEqual(offenders, [], `vh without a small-viewport twin:\n  ${offenders.join("\n  ")}`);
  });
});

describe("the rail docks inside the shell, not against the document", () => {
  it("sticks to the scrollport top rather than measuring the header again", () => {
    const rail = ruleFor(".workspace-subtabs").find((block) => /position:\s*sticky/.test(block));
    assert.ok(rail, "the rail is no longer sticky");
    assert.match(rail, /top:\s*-1px/,
      "the shell's top edge is already below the header; measuring --header-h here too "
        + "parks the rail a header's height down inside its own panel");
    assert.doesNotMatch(rail, /top:\s*calc\(var\(--header-h\)/);
    assert.match(rail, /z-index:\s*var\(--z-rail\)/);
  });

  it("the header's measurement moved into the shell rather than disappearing", () => {
    // The point of the assertion above is not that --header-h stopped mattering.
    // It is that it is read once, by the box whose size actually depends on it.
    const shell = ruleFor(".workspace-shell").find((block) => /overflow-y:\s*auto/.test(block));
    assert.match(shell!, /var\(--header-h\)/);
  });

  it("anchor offsets clear the rail, which is what still overlaps content", () => {
    const shell = ruleFor(".workspace-shell").find((block) => /overflow-y:\s*auto/.test(block));
    assert.match(shell!, /scroll-padding-top:\s*calc\(var\(--rail-h\)/,
      "the scroll root is the shell now, so the anchor offset belongs on it");
    assert.match(declarations, /scroll-margin-top:\s*calc\(var\(--rail-h\)/,
      "focused targets read scroll-margin, not the container's scroll-padding");
  });
});

describe("navigation moves the scroller that exists", () => {
  it("tab switches scroll the shell, not the window", () => {
    assert.doesNotMatch(page.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""), /window\.scrollTo/,
      "the body is locked, so window.scrollTo silently does nothing — a tab switch would "
        + "leave the new tab parked where the last one was read to");
    assert.match(page, /shellRef\.current\?\.scrollTo/);
  });

  it("the reset stays inside the view transition", () => {
    // Outside the callback it races the snapshot, and the transition captures
    // the old scroll position — the documented reason it was written this way.
    const transition = page.slice(page.indexOf("startViewTransition("));
    const body = transition.slice(0, transition.indexOf("} else {"));
    assert.match(body, /flushSync\(apply\)[\s\S]*shellRef\.current\?\.scrollTo/);
  });

  it("the shell is actually wired to the ref it is scrolled by", () => {
    assert.match(page, /id="workspace-content"\s+ref=\{shellRef\}/);
  });
});
