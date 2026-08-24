/**
 * THE ROLE-TO-RUNG MAP. One rung per structural role, for the whole desk.
 *
 * "make sure the font size is standardized for headers, subheaders, body,
 *  diagrams, dropdowns, tabs, subtabs, main page, top bar"
 * "standardize the format and the font sizes pls so that the frontend is not
 *  all over the place"
 *
 * WHY A MAP AND NOT ANOTHER SWEEP
 * ------------------------------------------------------------------------
 * The desk has 617 `font-size` declarations over 26 partials and thirteen
 * content rungs. Nothing anywhere said which rung a ROLE gets, so the rung was
 * chosen per rule, by whoever last edited that rule, and the only feedback was
 * somebody's eye on a screenshot. That is why every pass re-tuned what the last
 * pass tuned, and it is the mechanism behind "why is everything changing so
 * much" — not one bad size, but no statement of what any size means.
 *
 * `type-scale.test.ts` pins the LADDER and `type-ladder-presets.test.ts` the
 * ARITHMETIC; neither says a card title is --fs-h2. This file is that missing
 * statement, and it is the one to edit first: map, then sheet.
 *
 * HOW IT IS SCOPED SO IT SURVIVES
 * ------------------------------------------------------------------------
 * Not a per-selector map over all 617 declarations, and not an inferred role
 * either. A regex for "KPI figure" (`kpi|stat-tile|__figure|__value|strong`)
 * returns 102 rules over 15 rungs, most of that spread being the heuristic
 * conflating a `<strong>` in prose with a figure in a tile. A role cannot be
 * detected from a selector, and a map of every selector would break on every
 * legitimate edit and be deleted inside a fortnight.
 *
 * So: ANCHORS. Each role names the two or three selectors that are the whole of
 * that role's contract on this desk, and they must agree. A new rule that
 * reaches for a listed rung costs nothing. A new rule that invents a size for an
 * anchored role has to change an anchor, and that is visible in review.
 *
 * WHAT NO TEST HERE CAN DO, stated because a green suite is not a look at the
 * screen: `npm test` is plain Node with no jsdom and no browser, and no new
 * dependency may be added, so nothing in this repository has ever seen a pixel.
 * Every number below is DERIVED — read out of the sheet and multiplied — never
 * observed. Whether 20.5px is the right size for a card title, whether a title
 * and its subtitle read as a hierarchy, and where a label ellipsises are all
 * outside what a string comparison can reach.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { globalsCss, locateInGlobals } from "./globals-css";
import { cssRules, declaredRung, selectorList } from "./globals-rules";

/** Comment bodies blanked, newlines kept, so prose is never read as a rule. */
const declarations = globalsCss.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "));

const rules = cssRules(declarations, locateInGlobals);

/** The winning `font-size` for a selector: the LAST context-free rule naming it. */
function shipped(selector: string): { rung: string; where: string } | null {
  let found: { rung: string; where: string } | null = null;
  for (const rule of rules) {
    if (rule.context.length > 0) continue;
    if (!selectorList(rule.selector).includes(selector)) continue;
    const rung = declaredRung(rule.body);
    if (rung !== null) found = { rung, where: rule.where };
  }
  return found;
}

interface Role {
  /** The token every anchor must name. */
  readonly rung: string;
  /** Why this rung and not the one above or below it. */
  readonly why: string;
  /** The selectors that ARE this role on this desk. */
  readonly anchors: readonly string[];
}

/**
 * THE MAP. Nine surfaces the reader named, as sixteen structural roles.
 *
 * The count said "twelve" from the day it was written until 2026-08-23 and
 * there were fifteen entries under it. Nobody was counting, which is the point
 * of writing it down: a number in a banner that no test reads goes stale the
 * first time somebody adds a role and does not scroll up. `every role is
 * counted in the banner` below now reads it, so it cannot drift again.
 *
 * Diagrams are deliberately absent from this ladder and have one of their own
 * in `type-diagram-ladder.test.ts`, split out of the foot of this file on
 * 2026-08-23 when the ceiling left no room for the two roles the third
 * navigation level needed: SVG text is drawn in user units and does not step
 * with the Text-size preference, so it cannot share a rung with prose without
 * meaning something different at each preset.
 */
const ROLES: Record<string, Role> = {
  "page title": {
    rung: "--fs-hero-line",
    why: "The tab's own h1, the largest thing on the page and the only rung that "
      + "still varies with viewport width. Its clamp was 22 to 26px until 2026-08-23, "
      + "and the bottom of that span sat under --fs-h1, so a section head inside the "
      + "page out-shouted the page title on any desk under about 1520px.",
    anchors: [".page-heading h1"],
  },
  "page title, overview": {
    rung: "--fs-hero",
    why: "One tab opens on a hero band rather than a page head. It is a different "
      + "surface, not a louder page title, and it is the only place this rung is read.",
    anchors: [".overview-hero .page-heading h1"],
  },
  /* "section head" (--fs-h1) RETIRED 2026-08-23, on a FIFTH report of one symptom. It
     held "a head that owns a GRID of cards, and is the only card in its panel" — Data's
     work board, the Developer explorer, queue and hero. Sound structurally, and not
     what a reader meets: those four render where every other tab shows a card title,
     so changing subtab moved the first thing under the rail by 4px (Portfolio 20.5
     throughout; Data's Work Queue and Developer's CI/CD, API & Schema, Code & Diffs
     and Task Queue 24.5). Four earlier passes examined the subtab BUTTON. REJECTED:
     levelling the other five tabs UP instead — equal claim to "don't change size",
     louder for the minority, against a reference chosen for being calm. Anchors moved
     to "card title"; equality pinned in the reader's terms by panel-heading-rung. */
  "card title": {
    rung: "--fs-h2",
    why: "The loudest defect on the desk before 2026-08-23 and the reason the front "
      + "end read as unstandardised. One object, three grammars, three sizes: "
      + ".section-heading.compact at --fs-title 17px on 69 cards over Reliability, "
      + "Research, Execution and Data; .portfolio-card-heading at --fs-h2 19px on 51 "
      + "cards over Portfolio, Risk, Data and Systems; .card > h2 at --fs-title again. "
      + "Which one a reader got was decided by which wrapper the component reached "
      + "for, and Data used both. All three name this rung now, and a fourth found on "
      + "2026-08-23 by measuring rather than grepping: Research's `.codex-family__head "
      + "h2` computed 14.57 / 17 / 20.64px at the three presets, one rung under every "
      + "other card title, on a container that declares the whole card treatment.",
    anchors: [
      ".section-heading :is(h2, h3)",
      ".card > h2",
      ".portfolio-card-heading h2",
      ".codex-family__head h2",
      // Retired from "section head" on 2026-08-23 — see the note above. These
      // four own a grid of cards, which is why they carried --fs-h1; they also
      // sit where every other tab shows a card title, which is why they no
      // longer do.
      ".data-workboard__heading h2",
      ".codebase-explorer__heading h2",
      ".developer-work__heading h2",
      ".developer-cp-section-hero h2",
    ],
  },
  "card subtitle": {
    rung: "--fs-md",
    why: "The supporting line under a card title. One rung under reading prose so the "
      + "pair reads as a title and its caption rather than as two sentences.",
    anchors: [".card > .sub"],
  },
  "subheading": {
    rung: "--fs-sm",
    why: "A head INSIDE a card, above a group of rows. Uppercase and tracked, so it "
      + "carries rank by voice rather than by size and does not compete with the card "
      + "title above it. All 18 uses are a <p>; the element is not the point.",
    anchors: [".console-subhead"],
  },
  "body prose": {
    rung: "--fs-title",
    why: "A KNOWN DIVERGENCE, recorded rather than fixed, and the largest single line "
      + "in the sheet. `body` reads --fs-title (17px), the CARD-TITLE rung, and not "
      + "--fs-body (14px) which is named for exactly this job and has 56 other "
      + "consumers. There is no `p { font-size }` anywhere and `.muted` sets colour "
      + "only, so 189 `.muted` elements and 45 bare paragraphs inherit a heading's "
      + "size. It was NOT changed alongside the 2026-08-23 heading restore: that "
      + "restore makes six surfaces larger and one commit should not also make several "
      + "hundred paragraphs 3px smaller, for a reader who has twice asked for bigger "
      + "type and once asked why everything keeps moving. Moving it means editing this "
      + "entry, which is the point of the entry.",
    anchors: ["body"],
  },
  "caption and kicker": {
    rung: "--fs-2xs",
    why: "The reading floor, and the rung every uppercase micro-label above a value "
      + "reads. It is not a kicker-only rung — the bare `small` rule, table bodies and "
      + "21 controls read it too, which is why type-ladder-presets.test.ts holds it "
      + "clear of --fs-tick at the compact preset.",
    anchors: [".page-kicker", "small", ".page-insight > small", ".next-step-footer__kicker"],
  },
  "figure and KPI": {
    rung: "--fs-figure",
    why: "The number in a tile, which is the thing a desk is read for. Restored on "
      + "2026-08-23 from 26px to 28.5px, the size a 1512px desk had before the ladder "
      + "stopped being fluid.",
    anchors: [".stat-tile__value", ".verdict-metric__value"],
  },
  "table cell": {
    rung: "--fs-lg",
    why: "Mono and tabular, set once on `table` so every cell in the desk inherits one "
      + "size. Below prose on purpose: a table is scanned in columns, not read.",
    anchors: ["table"],
  },
  "table header": {
    rung: "--fs-xs",
    why: "Uppercase and tracked, one rung under the cells it labels, so a header row "
      + "reads as furniture rather than as the first row of data.",
    anchors: ["th"],
  },
  "control": {
    rung: "--fs-xl",
    why: "Buttons, selects and text inputs are one control family and take one size. "
      + "The three-way split they used to carry is what put a dropdown and the button "
      + "beside it on different rungs.",
    anchors: ["button", "select"],
  },
  "cross-link tile title": {
    rung: "--fs-title",
    why: "The head of a tile that HANDS OFF to another tab rather than reporting "
      + "something itself. One rung under a card title, deliberately: it is a "
      + "signpost standing among cards, and at --fs-h2 it competes with the panel it "
      + "is pointing away from. Recorded on 2026-08-23 rather than converged, because "
      + "measuring found the three of them already agreeing at 14.57 / 17 / 20.64px "
      + "across three tabs while no line anywhere said they were one thing — so the "
      + "next pass to meet one in isolation would have read it as a card title that "
      + "had drifted and 'fixed' it. Naming the role is the whole change; nothing "
      + "moved on screen.",
    anchors: [
      ".cross-link-tile .portfolio-card-heading h2",
      ".data-console-handoff h2",
      ".handoff-head h3",
    ],
  },
  "sub-subtab": {
    rung: "--fs-body",
    why: "The THIRD level of navigation: a `.seg` pane switcher inside one panel, under "
      + "the role tabs and the section rail. Not in the URL and not in lib/sections.ts, "
      + "so no routing test reaches it. It read --fs-sm — 11.14 / 13 / 15.79px, one "
      + "rung under `subtab` — until 2026-08-24 and this ask: \"for markets and "
      + "coherence subtabs and subsubtabs, standardize the font size to 14\". The ask "
      + "was two tabs and the change is TEN, because it cannot be two: seg-metrics, "
      + "tab-chrome-metrics and type-scale each refuse a per-tab seg size by name. Full "
      + "record in nav-type-markets-coherence.test.ts. It still STEPS with the "
      + "preference rather than taking a fixed chrome token.",
    anchors: [".seg button"],
  },
  "subtab": {
    rung: "--fs-body",
    why: "The section rail under the page head. It read --fs-sm to sit quieter than "
      + "the role tabs above it until the reader said otherwise in these words: "
      + "\"subtab headers can be bigger to 14px and bigger for comfortable setting\". "
      + "It is the one navigation control that steps with the Text-size preference, "
      + "deliberately, and tab-chrome-metrics.test.ts records that decision.",
    anchors: ['.workspace-subtabs__rail[data-scroll-affordance="horizontal"] > button'],
  },
  "tab": {
    rung: "--fs-chrome-tab",
    why: "The eight role tabs. Fixed px with no step, because the header's priority "
      + "ladder is a width measurement taken at one size and a preference that moved it "
      + "would cost a reader on Large a toolbar that fits.",
    anchors: [".workspace-tabs button span"],
  },
  "top bar chrome": {
    rung: "--fs-chrome-chip",
    why: "Everything in the header that is not a tab or the brand. Fixed, for the same "
      + "measurement reason; --fs-chrome-caption and --fs-chrome-brand are its two "
      + "siblings, on the status glyph and the lettermark.",
    anchors: [".data-tier"],
  },
};

describe("every named surface reads the rung the map gives it", () => {
  it("each anchor ships the rung its role names", () => {
    const offenders: string[] = [];
    for (const [role, entry] of Object.entries(ROLES)) {
      for (const anchor of entry.anchors) {
        const found = shipped(anchor);
        if (!found) {
          offenders.push(`${role}: ${anchor} declares no size at all (renamed? then rename it here)`);
          continue;
        }
        if (found.rung !== `var(${entry.rung})`) {
          offenders.push(`${role}: ${anchor} ships ${found.rung} at ${found.where}, map says var(${entry.rung})`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "a surface has left its role's rung. Either the rule is wrong, or the map is — "
        + "and if it is the map, change the map FIRST, in the same commit, with the "
        + "reason:\n  " + offenders.join("\n  "),
    );
  });

  it("every role says why, at length", () => {
    // A map whose entries are bare token names is a lookup table, and a lookup
    // table is what the sheet already was. The reason is the part that stops the
    // next pass re-tuning: it says what was tried and what it cost.
    for (const [role, entry] of Object.entries(ROLES)) {
      assert.ok(entry.why.trim().length >= 80, `${role}'s entry is a label, not a reason`);
      assert.ok(entry.anchors.length >= 1, `${role} anchors nothing, so it asserts nothing`);
    }
    // And the banner's own count, which said twelve over fifteen entries from
    // the day it was written: a number nothing reads is a comment that lies
    // quietly, in the one file whose argument is that unstated numbers drift.
    const WORDS = ["twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen"];
    const stated = readFileSync(fileURLToPath(import.meta.url), "utf8").match(/as (\w+) structural roles/)?.[1];
    assert.equal(stated, WORDS[Object.keys(ROLES).length - 12], `the banner says "${stated}" over ${Object.keys(ROLES).length} roles`);
  });

  it("a card title is one rung whichever wrapper it is written in", () => {
    // Stated separately from the loop above because it is the finding, not an
    // instance of it: three selectors, 120+ cards, eight tabs, one object.
    const rungs = ROLES["card title"].anchors.map((anchor) => shipped(anchor)?.rung ?? "(none)");
    assert.equal(new Set(rungs).size, 1, `card titles ship at ${[...new Set(rungs)].join(" and ")}`);
  });
});

/** The first `:root` block: the ladder itself. */
const rootBlock = declarations.slice(
  declarations.indexOf(":root {"),
  declarations.indexOf("\n}\n", declarations.indexOf(":root {")),
);

/** A rung in px at step 1: the plain rem literal, or a clamp's MINIMUM. */
function minPx(token: string): number {
  const fixed = rootBlock.match(new RegExp(`${token}:\\s*(\\d+)px;`));
  if (fixed) return Number(fixed[1]);
  const match = rootBlock.match(new RegExp(`${token}:\\s*calc\\((?:clamp\\()?([\\d.]+)rem`));
  assert.ok(match, `${token} is not in :root`);
  return Number(match![1]) * 16;
}

describe("the roles stand in the order a reader reads them", () => {
  it("page title over card title over prose over caption", () => {
    // The clamp MINIMUM for the fluid rung, because the narrow desk is the case
    // that inverts: --fs-hero-line's old 22px floor sat under --fs-h1's 23px, so
    // on a 1280px desk Data's "Work board" was larger than "Data operations"
    // above it. Every rung multiplies the same --type-step, so an order that
    // holds at step 1 holds at all three presets.
    // "section head" was retired on 2026-08-23 and its anchors took the card-title
    // rung, so the chain is one link shorter. The inversion this test was written
    // for cannot recur through that link, because the link is gone.
    const chain = ["page title", "card title", "body prose", "caption and kicker"];
    for (let index = 1; index < chain.length; index += 1) {
      const above = minPx(ROLES[chain[index - 1]].rung);
      const below = minPx(ROLES[chain[index]].rung);
      assert.ok(
        above > below,
        `${chain[index - 1]} (${above}px) must sit above ${chain[index]} (${below}px) at every viewport width`,
      );
    }
  });

  it("the three navigation levels stand in their own order, at every preset", () => {
    // MEASURED IN CHROME over all 48 rail sections on 2026-08-23, at all three
    // presets, because nothing in this repository can see a pixel: tab 13px
    // fixed, subtab 12 / 14 / 17, sub-subtab 11.14 / 13 / 15.79 — the last of
    // which became 12 / 14 / 17 on 2026-08-24, on the ask recorded in the
    // sub-subtab role. Stated at step 1 only, for the same reason the prose
    // chain above is — both rungs multiply the same --type-step. What CANNOT be
    // stated that way is a fixed rung against a stepping one, which is why the
    // sub-subtab must not reach for a --fs-chrome-* token, asserted below.
    // `>=` since 2026-08-24: the invariant is "does not OUT-SHOUT the rail",
    // never "is smaller", so a LARGER switcher is still forbidden. Equal is not
    // out-shouting — the seg is a bordered group with a raised chip in it.
    assert.ok(minPx(ROLES["subtab"].rung) >= minPx(ROLES["sub-subtab"].rung),
      "a pane switcher inside a section may not out-shout the rail that opened it");
    for (const role of ["subtab", "sub-subtab"]) {
      assert.match(
        rootBlock,
        new RegExp(`${ROLES[role].rung}:\\s*calc\\(`),
        `${role} reads ${ROLES[role].rung}, which must step with the preference`,
      );
    }
    assert.match(
      rootBlock,
      /--fs-chrome-tab:\s*\d+px;/,
      "the role tabs are the one navigation level that is deliberately fixed",
    );
  });

  it("no heading rule sits at or under reading prose unless it is a micro-label", () => {
    // A heading smaller than the text it introduces is not a heading. Three
    // rules are under the body rung today and all three are uppercase tracked
    // group labels — a sticky file-group bar and the shortcut overlay's column
    // heads — which carry rank by voice, not by size. That is a real idiom, so
    // it is carved out by the property that makes it legible rather than by
    // listing the selectors, which would go stale on the first rename.
    const body = minPx("--fs-body");
    const headingRules = rules.filter((rule) => /\bh[1-4]\b/.test(rule.selector) && declaredRung(rule.body));
    const uppercase = new Set(
      headingRules.filter((rule) => /text-transform:\s*uppercase/.test(rule.body)).map((rule) => rule.selector),
    );
    const offenders = headingRules
      .filter((rule) => {
        const token = declaredRung(rule.body)!.match(/--fs-[a-z0-9-]+/);
        if (!token) return false;
        if (minPx(token[0]) > body) return false;
        // `.codebase-filegroup h3 small` inherits its bar's uppercase voice.
        return ![...uppercase].some((carrier) => rule.selector.startsWith(carrier));
      })
      .map((rule) => `${rule.where} — ${rule.selector}: ${declaredRung(rule.body)}`);
    assert.deepEqual(offenders, [], `headings under the prose they introduce:\n  ${offenders.join("\n  ")}`);
  });
});
