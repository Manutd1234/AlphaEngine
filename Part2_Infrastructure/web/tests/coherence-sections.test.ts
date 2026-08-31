/**
 * Proofs is a rail of six sections, and every retired location still resolves.
 *
 * "no i still want two tabs instead but rename markets and coherance as
 *  something else / then split the 9 tabs currently into the two renamed tabs
 *  based on their features"
 *
 * FOUR RESTRUCTURES IN ONE DAY, AND THIS FILE IS WHERE THE BILL IS PAID.
 * 2026-08-24 went: one tab of eleven (what `origin/main` publishes) → Markets +
 * Coherence → seventeen sections, when six in-pane `.seg` views were promoted to
 * rails → back to one tab → consolidated to nine → these two tabs. Every one of
 * those moves stranded a location, and a location that does not resolve does not
 * fail loudly: it lands on a rail default while the URL still names something
 * else, which is the house's own failure mode — green, plausible, and wrong.
 *
 * So the relocation table is asserted here rather than in either console: an id
 * that moved TAB belongs to neither console, and pinning it against one of them
 * would let the other drift. `markets-sections.test.ts` is the sibling and holds
 * the Prices console's own wiring.
 *
 * This is not a rendering test: `npm test` has no DOM and never will (CLAUDE.md,
 * fact 6), so what is pinned is that a future edit has to break the wiring
 * deliberately.
 *
 * A FIFTH RESTRUCTURE, on 2026-08-25, and it is the first that UNDID a
 * consolidation: Dutch book's three groups became three sections — Coherence
 * test, Basket, Parlays — because three questions behind two rows of chrome is
 * what the reader meant by "too many subtabs and subsubtabs". It cost this file
 * nothing and paid it back two entries: `portfolio` and `combos` were both in
 * the relocation table and both left it, being ids on their own rail again.
 *
 * The COPY half is `coherence-proof-claims.test.ts`, and its sibling
 * `coherence-reading-claims.test.ts` covers Prices; the two exist because this
 * engine is the one part of the desk with no `summarised-<tab>` /
 * `disclosure-<tab>` pair. The READ half — which section calls what, and when
 * it is allowed to — is `coherence-reads.test.ts`, split off when this file
 * crossed the ceiling in that same change.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COHERENCE_SECTIONS, COHERENCE_SECTION_IDS, DIFFUSION_SECTION_IDS, ENGINE_SECTION_IDS, MARKETS_SECTION_IDS,
} from "../lib/sections";
import { DEFAULT_SECTION, RELOCATED_SECTIONS } from "../lib/workspace-hash";
import { read, stripNonCode } from "./helpers/workspace-sources";

const console_ = read("../components/CoherenceConsole.tsx");
const code = stripNonCode(console_);
const hash = read("../lib/workspace-hash.ts");

/** Every component that owns a section, by the id it draws. */
const SECTION_FILES: Record<string, string> = {
  certificate: "../components/coherence/CertificatePane.tsx",
  portfolio: "../components/coherence/BasketSection.tsx",
  combos: "../components/coherence/CombosSection.tsx",
  calibration: "../components/coherence/CalibrationPane.tsx",
  corpus: "../components/coherence/CorpusSection.tsx",
  index: "../components/coherence/IndexSection.tsx",
  lessons: "../components/coherence/LessonsPane.tsx",
};

describe("the Proofs rail and its panels agree", () => {
  it("the console draws a panel for every rail id, and no id it does not have", () => {
    const drawn = [...console_.matchAll(/<WorkspaceSubtabPanel workspaceId="coherence" tabId="([a-z]+)"/g)]
      .map((match) => match[1]);
    assert.deepEqual(drawn, COHERENCE_SECTIONS.map((section) => section.id),
      "the panels and the rail have diverged — a rail entry with no panel renders an empty section");
  });

  it("every section id has a component that owns it", () => {
    assert.deepEqual(Object.keys(SECTION_FILES).sort(), [...COHERENCE_SECTION_IDS].sort());
  });

  it("the published tab id stays on the half that carries the proof", () => {
    // `coherence` is the ONLY Kalshi tab id `origin/main` has ever published.
    // Keeping it here — rather than on Quotes, or on a third invented word — is
    // what makes every `#coherence/<section>` link in the world resolve
    // natively for the four sections still on this rail, and resolve through
    // the relocation table for the five that left.
    assert.match(console_, /workspaceId="coherence"/);
    assert.match(console_, /kicker="Proofs"/);
  });

  it("focus moves to the rail button the reader just pressed", () => {
    assert.match(code, /requestAnimationFrame/);
    assert.match(code, /coherence-subtab-\$\{next\}/);
  });
});

describe("exactly one subtab rail on the tab", () => {
  it("the console renders it and no section component does", () => {
    assert.equal((code.match(/<WorkspaceSubtabs\b/g) ?? []).length, 1);
    for (const [id, file] of Object.entries(SECTION_FILES)) {
      assert.doesNotMatch(
        stripNonCode(read(file)),
        /<WorkspaceSubtabs\b/,
        `${id} nests a second rail. It publishes --rail-h onto document.documentElement `
        + "and two instances fight over it — in-section switchers are .seg with aria-pressed",
      );
    }
  });

  it("no section draws two segs, which is what a reader reads as one broken control", () => {
    // The rule this has always been about is TWO, not one: two `.seg` controls
    // stacked in a section's grid read as a single control that has come apart,
    // which is what `DiffusionPane`'s header rejected before any of this was
    // built and what the 2026-08-25 split was asked to undo one level higher.
    //
    // It said "exactly one" until then, and could, because every section had
    // more views than a row could hold. Three do not any more: the split gave
    // Coherence test two views, Basket ONE, and Parlays three, so Basket draws
    // no switcher at all — a segment that cannot be pressed is not a control.
    // Requiring one would have made an empty control the price of being a
    // section. The floor moved to the assertion below, which is stronger than
    // a count: a section with no seg must have nothing to switch between.
    // Raw source, because a `.seg` is a class-name STRING and `stripNonCode`
    // blanks those.
    for (const [id, file] of Object.entries(SECTION_FILES)) {
      const segs = (read(file).match(/className="seg[ "]/g) ?? []).length;
      assert.ok(segs <= 1, `${id} draws ${segs} .seg groups; two in one section read as one broken control`);
    }
  });

  it("a section with no switcher has nothing to switch between", () => {
    // The other half of the rule above, and the reason relaxing the count did
    // not relax the contract: a section that drew no seg because its views got
    // lost would look exactly like one that draws none because it has one view.
    // EMPTY since 2026-08-26: Basket was the last single-view section and its
    // redo gave it three. A name left here would be a section allowed to draw
    // no switcher, which is the hole this set exists to close.
    const SINGLE_VIEW = new Set<string>();
    for (const [id, file] of Object.entries(SECTION_FILES)) {
      const source = read(file);
      const segs = (source.match(/className="seg[ "]/g) ?? []).length;
      if (segs === 0) {
        assert.ok(SINGLE_VIEW.has(id), `${id} draws no switcher and is not named as a single-view section`);
      } else {
        assert.ok(!SINGLE_VIEW.has(id), `${id} is named single-view and draws a switcher; one of the two is wrong`);
      }
    }
  });

  it("a folded pane brings no switcher of its own", () => {
    // The failure a fold makes: a pane that was a section owns a `.seg`, and
    // left in place it becomes a second control stacked under its new parent's.
    // `FindingsPane` keeps one by design — it is the only folded pane whose
    // three views are readings of one study — and is exempted by name so the
    // exemption is a decision.
    for (const file of [
      "../components/coherence/PortfolioPane.tsx",
      "../components/coherence/CombosPane.tsx",
      "../components/coherence/IndexPane.tsx",
    ]) {
      assert.equal(
        (read(file).match(/className="seg[ "]/g) ?? []).length, 0,
        `${file} still draws its own switcher; its views belong on its parent's seg`,
      );
    }
    assert.equal(
      (read("../components/coherence/diffusion/FindingsPane.tsx").match(/className="seg[ "]/g) ?? []).length,
      1,
      "FindingsPane's exemption was removed or doubled; both need saying here",
    );
  });

  it("the view labels are guarded, and it is coherence-groups that guards them", () => {
    // This assertion used to list every option of every switcher. A TWO-level
    // section keeps its labels on the section OR on the child that owns its
    // views, so reading only the section file reports a label as deleted the
    // moment it moves; `coherence-groups.test.ts` reads each pair and pins the
    // same labels, and what is left here is the check that it is still doing
    // so. A guard that quietly stopped covering a section is the failure this
    // file exists to prevent.
    //
    // ONE-level sections are guarded differently and have to be, or this would
    // demand a two-level entry for a section that has no second level. Their
    // labels are all in their own file by definition, so that is what is
    // asserted: every one of them names its views where it draws them.
    const groups = read("../tests/coherence-groups.test.ts");
    // EVERY section is one-level now. The two-level contract has no subjects
    // left — `coherence-groups.test.ts` records why — so each of these names
    // its own views where it draws them, and that file's table is empty.
    const ONE_LEVEL: Record<string, readonly string[]> = {
      certificate: ["Verdict", "Proof", "Checks", "Prices", "Sizes"],
      combos: ["Ranges", "Test quote", "Leg prices", "Test legs", "Checks"],
      calibration: ["Overview", "Equation", "Component scale", "Measures", "Reliability", "Bands"],
      corpus: ["Composition", "Score trend"],
      index: ["By poll", "By family"],
      portfolio: ["Cover", "Basket", "Size"],
      lessons: [],
    };
    for (const [id, file] of Object.entries(SECTION_FILES)) {
      const views = ONE_LEVEL[id];
      if (views === undefined) {
        assert.ok(
          new RegExp(`^  ${id}: \\{`, "m").test(groups),
          `${id} has no entry in coherence-groups.test.ts, so its view labels are guarded by nothing`,
        );
        continue;
      }
      const source = read(file);
      for (const label of views) {
        assert.ok(source.includes(`"${label}"`), `${id} lost its ${label} view`);
      }
    }
  });
});

describe("the page head stays compact while its premise remains available", () => {
  it("moves the one-sentence premise into Evidence as a plain string", () => {
    const pageHead = console_.slice(console_.indexOf("<PageHead"), console_.indexOf("<EngineStatePanel"));
    assert.doesNotMatch(
      pageHead,
      /description=/,
      "the repeated proof premise returned to the at-rest page head instead of progressive disclosure",
    );

    const match = console_.match(/deskContext="([^"]+)"/);
    assert.ok(match, "the exact proof premise is no longer available from the Evidence sheet");
    const sentence = match![1];
    assert.ok(sentence.length <= 100, `the premise is ${sentence.length} characters, which has outgrown its compact technical contract`);
    assert.equal((sentence.match(/\. /g) ?? []).length, 0, `the premise is more than one sentence: ${sentence}`);
    // The four proof objects this tab evaluates. Detailed claims and their
    // witnesses belong in the active view's Evidence sheet, where the contract
    // names unit, method and source without turning the page head into a paragraph.
    assert.match(sentence, /LP feasibility/);
    assert.match(sentence, /settled calibration/);
  });
});
