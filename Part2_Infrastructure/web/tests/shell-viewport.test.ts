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

import { globalsCss, locateInGlobals } from "./globals-css";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const css = globalsCss;
const page = read("../app/dashboard/page.tsx");
/**
 * `navigate` — and with it the only scroll the desk performs — moved to
 * `lib/use-workspace-routing.ts`. The shell still owns the element being
 * scrolled, so `#workspace-content`'s ref stays asserted on page.tsx and the
 * scrolling itself is asserted where it happens. Both are checked for the
 * absence of `window.scrollTo`: either file reintroducing it is the same bug.
 */
const routingHook = read("../lib/use-workspace-routing.ts");
/**
 * The eight panels moved to `components/workspace/WorkspacePanels.tsx` on
 * 2026-08-21. Nothing asserted below lives there today, and that is exactly why
 * it is scanned: a `window.scrollTo` or a `flushSync` reintroduced inside a
 * panel is the same bug, and a two-file scan would not see it.
 */
const panels = read("../components/workspace/WorkspacePanels.tsx");
const shellSources = [page, panels, routingHook].join("\n");

/** Comment bodies blanked, newlines kept, so prose is not read as a rule. */
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "));


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

/**
 * The routes that are not the desk.
 *
 * The lock above is written for `/dashboard`, where `.workspace-shell` owns the
 * only scroller. `/login` and `/profile` are siblings of that route rather than
 * tabs inside it, so they inherit a document exactly one viewport tall that does
 * not scroll — and everything past the fold is silently unreachable.
 *
 * That is not a hypothetical: the Security centre rendered its Credentials card
 * off the bottom of a locked body, with correct data and no error anywhere. The
 * page looked finished. This is the check that would have caught it, and it is
 * the shape of defect this repository keeps rediscovering — a surface that is
 * wrong while everything reports green.
 */
describe("standalone routes carry their own scroller", () => {
  const frame = ruleFor(".standalone-scroll").find((block) => /overflow-y:\s*auto/.test(block));

  it("declares a bounded, scrollable frame", () => {
    assert.ok(frame, ".standalone-scroll no longer scrolls — /profile and /login would clip");
    assert.match(frame, /height:\s*100svh/,
      "an unbounded frame inside a locked body clips instead of scrolling");
    assert.match(frame, /height:\s*100vh/,
      "keep the vh twin so a browser without svh still gets a bounded frame");
    assert.match(frame, /overscroll-behavior:\s*contain/);
  });

  it("every route outside the workspace shell uses it", () => {
    // Both files render their own top-level <main>; neither sits inside
    // .workspace-shell, so neither inherits a scroller from anywhere.
    for (const file of ["../components/auth/LoginScreen.tsx", "../components/profile/ProfileScreen.tsx"]) {
      assert.match(read(file), /className="[^"]*\bstandalone-scroll\b/,
        `${file} renders a top-level frame that the body lock will clip`);
    }
  });

  it("centres the sign-in column without clipping its top", () => {
    /**
     * `justify-content: center` on an overflowing flex column pushes the first
     * child above the scrollable area, so the top of the form cannot be reached
     * by scrolling — the failure looks exactly like the clip this suite exists
     * to prevent. Auto margins centre the same way with spare room and collapse
     * to nothing without it.
     */
    const shell = ruleFor(".auth-shell")[0];
    assert.doesNotMatch(shell, /justify-content:\s*center/,
      "flex centring clips the top of an overflowing column — use auto margins");
    assert.match(declarations, /\.auth-shell > :first-child \{\s*margin-block-start:\s*auto/);
    assert.match(declarations, /\.auth-shell > :last-child \{\s*margin-block-end:\s*auto/);
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
      offenders.push(`${locateInGlobals(match.index)} — ${match[0].trim()}`);
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
    assert.doesNotMatch(shellSources.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""), /window\.scrollTo/,
      "the body is locked, so window.scrollTo silently does nothing — a tab switch would "
        + "leave the new tab parked where the last one was read to");
    assert.match(routingHook, /shellRef\.current\?\.scrollTo/);
  });

  it("the switch is transition-free, concurrent, and the reset is instant", () => {
    /**
     * `document.startViewTransition(() => flushSync(apply))` was the measured
     * tab stutter: painting froze for the snapshot while React synchronously
     * rendered the whole incoming workspace, then a crossfade played over the
     * result. The switch now goes through React's `startTransition`, which
     * keeps the click responsive and renders the panel concurrently, and the
     * scroll reset is `auto` — a tab change is a cut, not a camera move.
     * Comments stripped first, so prose about the old behaviour cannot
     * satisfy (or trip) any of these.
     */
    const stripped = shellSources.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    assert.doesNotMatch(stripped, /startViewTransition\(/, "the paint-freezing snapshot transition is back");
    assert.doesNotMatch(stripped, /flushSync\(/, "a synchronous whole-page render on switch is back");
    assert.match(stripped, /startTransition\(\(\) => \{\s*setView\(next\);/);
    assert.match(stripped, /shellRef\.current\?\.scrollTo\(\{ top: 0, behavior: "auto" \}\)/);
    assert.doesNotMatch(stripped, /behavior: reduced \? "auto" : "smooth"/, "the post-switch smooth scroll is back");
  });

  it("the shell is actually wired to the ref it is scrolled by", () => {
    assert.match(page, /id="workspace-content"\s+ref=\{shellRef\}/);
  });
});

/**
 * How many ways between workspaces are on screen at once.
 *
 * Three surfaces exist and they are meant to hand over to each other: the tab
 * row above 900px, a full-width `<select>` from 900 down, and the thumb bar
 * from 620 down. The first two do hand over. The last two did not — below 620px
 * a phone rendered the select inside a two-row header AND a fixed bar at the
 * bottom, which is two navigations and one screen.
 *
 * The fix is three lines, and the interesting part is where they go. The bottom
 * bar's own block sits near the top of the sheet; the select's 900px rule sits
 * some fourteen thousand lines later. At equal specificity the later rule wins,
 * so an override written beside the bar would have lost silently and looked
 * correct in the diff. It is asserted here by ORDER, not merely by presence.
 */
describe("one navigation surface per viewport", () => {
  const at620 = (() => {
    const marker = "@media (max-width: 620px)";
    const blocks = [...declarations.matchAll(/@media \(max-width: 620px\) \{/g)]
      .map((m) => ({ index: m.index as number, body: declarations.slice(m.index as number, (m.index as number) + 4000) }));
    assert.ok(blocks.length > 0, `${marker} has no block`);
    return blocks;
  })();

  it("hides the workspace select where the thumb bar takes over", () => {
    const hiding = at620.find((block) => /\.workspace-switcher \{\s*display: none/.test(block.body));
    assert.ok(hiding, "below 620px the select and the thumb bar both render");
  });

  it("hides it AFTER the 900px rule that shows it, or the override is inert", () => {
    const shows = declarations.indexOf(".workspace-switcher {\n    order: 3;");
    assert.ok(shows > 0, "the 900px rule that lays the select out has moved");
    const hiding = at620.find((block) => /\.workspace-switcher \{\s*display: none/.test(block.body));
    assert.ok(
      (hiding?.index ?? -1) > shows,
      "the 620px override sits before the 900px rule it must beat, so it does nothing",
    );
  });

  it("keeps the select between 620 and 900, where it is the only navigation", () => {
    // The tab row is hidden from 900 down and the bar does not arrive until
    // 620. Hiding the select unconditionally would strand that band.
    const hiding = at620.find((block) => /\.workspace-switcher \{\s*display: none/.test(block.body));
    assert.doesNotMatch(
      hiding?.body.slice(0, hiding.body.indexOf("\n}\n")) ?? "",
      /max-width: 900px/,
      "the select was hidden in the band where nothing else navigates",
    );
  });

  it("the tab row no longer ships markup that has never been visible", () => {
    // `<small className="workspace-tabs__role">` was hidden by a BASE rule, so
    // it had never rendered at any width, and a second rule hid it again.
    const header = read("../components/WorkspaceHeader.tsx");
    assert.doesNotMatch(header, /workspace-tabs__role/);
    assert.doesNotMatch(declarations, /\.workspace-tabs button small \{/);
    // The role still reaches the reader by the two routes that always carried it.
    assert.match(header, /title=\{item\.role\}/);
    assert.match(header, /\{item\.label\} — \{item\.role\}/);
  });
});

/**
 * A subtab rail has to look like a subtab rail.
 *
 * Flattening the tray removed real chrome — a bordered, tinted, twice-shadowed
 * box around a row of eight words — but took the strip's identity with it. What
 * was left was a rounded, tinted 34px block adrift in a 42px row, carrying an
 * underline that met nothing, on eight tabs. Nothing said "this row is a set of
 * tabs, and there are more of them than the one you are reading".
 *
 * The fix is a hairline baseline plus bottom-aligned children, so the active
 * tab's 2px rule lands ON the line instead of hovering above it. That geometry
 * is the whole effect, and it is what these assertions hold: a centred row, or
 * a taller strip than its buttons, silently detaches the rule again and the
 * screenshot looks almost right.
 *
 * Measured in a browser across all eight tabs and both themes when written:
 * button bottom to baseline, 0px everywhere.
 */
describe("the subtab strip reads as a strip", () => {
  const strip = ruleFor(".workspace-subtabs").at(-1) ?? "";
  const railButton = declarations.slice(
    declarations.indexOf('.workspace-subtabs__rail[data-scroll-affordance="horizontal"] > button {'),
  ).split("\n}")[0];

  it("draws a baseline under the whole strip", () => {
    assert.match(
      strip,
      /border-bottom:\s*1px solid var\(--border\)/,
      "the rail lost the hairline that says a tab strip is a tab strip",
    );
  });

  it("aligns its children to that baseline", () => {
    // `center` is what left the active tab floating: the strip is taller than
    // its buttons, so a bottom-anchored rule stops short of the line.
    assert.match(strip, /align-items:\s*end/);
    assert.doesNotMatch(strip, /align-items:\s*center/);
  });

  it("shapes the tabs as tabs, not as pills", () => {
    // Top corners only. A fully rounded tint reads as a highlighted pill that
    // happens to sit near a line, which is what the screenshots showed.
    assert.match(railButton, /border-radius:\s*6px 6px 0 0/);
  });

  it("marks the active tab with a rule that meets the baseline", () => {
    // `ruleFor` escapes only a leading dot, so an attribute selector's brackets
    // would be read as a character class. Sliced directly instead.
    const start = declarations.lastIndexOf('.workspace-subtabs button[aria-selected="true"] {');
    assert.ok(start > 0, "the active subtab has no rule in the stylesheet");
    const active = declarations.slice(start).split("\n}")[0];
    assert.match(active, /box-shadow:\s*inset 0 -2px 0 var\(--series-1\)/);
    // And the rule is not the only signal — contrast and the tint carry it too,
    // which is the no-colour-only rule applied to navigation.
    assert.match(active, /color:\s*var\(--text-primary\)/);
  });

  it("keeps the strip no taller than a tab plus its baseline", () => {
    // 40px against a 34px button leaves room for the hairline and nothing else.
    // A larger figure reintroduces the gap this whole block exists to close.
    const height = Number(strip.match(/min-height:\s*(\d+)px/)?.[1] ?? 0);
    assert.ok(height > 0 && height <= 40, `strip min-height is ${height}px`);
  });
});
