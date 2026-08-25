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
  COHERENCE_SECTIONS, COHERENCE_SECTION_IDS, ENGINE_SECTION_IDS, MARKETS_SECTION_IDS,
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
  diffusion: "../components/coherence/DiffusionPane.tsx",
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

describe("every location the engine has ever published still resolves", () => {
  /**
   * The migration the four restructures owe their readers, as a table rather
   * than as a behaviour: `readLocation` needs a DOM to run and this suite has
   * none.
   *
   * Three kinds of entry, and the third is why a same-tab table would not do:
   * an id that stopped being a section, an id that moved tab, and an id that
   * did both.
   */
  const CARRIERS: Record<string, Record<string, { view: string; section: string }>> = {
    coherence: {
      // Moved tab. Four of these five were published under `#coherence/`.
      universe: { view: "markets", section: "universe" },
      books: { view: "markets", section: "books" },
      lattice: { view: "markets", section: "lattice" },
      fees: { view: "markets", section: "fees" },
      shell: { view: "markets", section: "shell" },
      // Moved tab and is a section again on both sides of the move: `stake` was
      // absorbed into `lattice` for one afternoon and pointed there; the fifth
      // restructure of 2026-08-24 gave it its own rail entry, so the entry is a
      // plain tab move now.
      stake: { view: "markets", section: "stake" },
      // Moved tab and are sections again, as of 2026-08-25. They still have to
      // CROSS — neither id is on the Proofs rail — but each now lands on the
      // section that carries the subject rather than on the one that had
      // absorbed it. Retiring them the way the `markets` half was retired would
      // strand both links on the Proofs default, because it is the TAB these
      // URLs get wrong.
      settlement: { view: "markets", section: "settlement" },
      dispersion: { view: "markets", section: "dispersion" },
      // Still a fold: `ablation` is two views of Fees and has no rail entry.
      ablation: { view: "markets", section: "fees" },
      // Stopped being sections; their carrier stayed here. `index` and `combos`
      // are the two that were PUBLISHED, which is what makes this table
      // load-bearing rather than a courtesy to one unpushed morning.
      index: { view: "coherence", section: "calibration" },
      findings: { view: "coherence", section: "diffusion" },
    },
    // EMPTY AS OF 2026-08-25, and it emptied the way `markets/stake` emptied
    // before it: `settlement` and `dispersion` are rail sections again under
    // the ids they were published under, the rail is asked before this table,
    // so neither entry could ever be reached. An entry that cannot be reached
    // is a lookup claiming a move that was undone, and the assertion below
    // that no relocated id is still a section of the tab that names it is
    // exactly what would fire on leaving one here.
    markets: {},
  };

  it("names every id that moved or stopped being a section, and only those", () => {
    assert.deepEqual(Object.keys(RELOCATED_SECTIONS).sort(), Object.keys(CARRIERS).sort());
    for (const workspace of Object.keys(CARRIERS)) {
      assert.deepEqual(
        Object.keys(RELOCATED_SECTIONS[workspace]).sort(),
        Object.keys(CARRIERS[workspace]).sort(),
        `${workspace}'s relocation table has drifted`,
      );
    }
  });

  /**
   * The two entries whose carrier IS their tab's default, exempted by name.
   *
   * The check below exists because an entry landing on the tab default is
   * indistinguishable from an entry that does nothing at all — the whole
   * failure the table was written against. This one is not that: `settlement`
   * was folded into Universe because that is the section answering its
   * question, and Universe is its tab's default only because it is first in
   * rail order. Naming it keeps the check meaningful for the rest and makes the
   * coincidence a decision.
   *
   * IT IS EMPTY NOW, and the emptying is the same event three times over.
   * `coherence/portfolio` and `coherence/combos` left the table when both
   * became sections again; `markets/settlement` was the last one standing and
   * left the same way hours later, when the Quotes rail split and `settlement`
   * stopped needing a carrier at all. An exemption for an entry that no longer
   * exists is a stale exemption, which the test below is written to catch — so
   * the set shrinks in the same change rather than being left to fire.
   *
   * An empty set rather than a deleted constant: the check below still runs,
   * and a future entry that lands on a default has somewhere to be argued for.
   */
  const LANDS_ON_DEFAULT = new Set<string>();

  it("sends each to the tab AND the section that carries it", () => {
    // Not the rail default. Landing on Dutch book from `#coherence/settlement`
    // is the house's own failure mode — green, plausible, and wrong — because
    // the URL would still say Settlement while the reader stood somewhere else.
    for (const [workspace, table] of Object.entries(CARRIERS)) {
      assert.deepEqual(RELOCATED_SECTIONS[workspace], table);
      for (const [id, carrier] of Object.entries(table)) {
        if (LANDS_ON_DEFAULT.has(`${workspace}/${id}`)) continue;
        const isDefault = carrier.view === workspace
          && carrier.section === DEFAULT_SECTION[workspace as "coherence" | "markets"];
        assert.ok(
          !isDefault,
          `${workspace}/${id} resolves to that tab's own default, which is indistinguishable `
          + "from not resolving at all",
        );
      }
    }
  });

  it("the exemptions above are still exemptions", () => {
    // A stale exemption is worse than none: it would quietly excuse an entry
    // that HAD gone wrong. Each named pair must still both exist and still
    // land on the default it is excused for.
    for (const key of LANDS_ON_DEFAULT) {
      const [workspace, id] = key.split("/");
      const carrier = RELOCATED_SECTIONS[workspace]?.[id];
      assert.ok(carrier, `${key} is exempted and is no longer in the table`);
      assert.equal(
        carrier!.section,
        DEFAULT_SECTION[workspace as "coherence" | "markets"],
        `${key} no longer lands on the default; delete its exemption in the same change`,
      );
    }
  });

  it("no relocated id is still a section of the tab that names it, and every carrier is real", () => {
    // An entry that outlived its relocation is a lie in a lookup table:
    // `readLocation` asks the rail FIRST, so a live id can never reach it, and
    // the entry would sit there claiming a move that was undone.
    const rails: Record<string, readonly string[]> = {
      markets: MARKETS_SECTION_IDS,
      coherence: COHERENCE_SECTION_IDS,
    };
    for (const [workspace, table] of Object.entries(CARRIERS)) {
      for (const [id, carrier] of Object.entries(table)) {
        assert.ok(!rails[workspace].includes(id),
          `${workspace}/${id} is on that rail again; retire its entry in the same change`);
        assert.ok(rails[carrier.view].includes(carrier.section),
          `${workspace}/${id} points at ${carrier.view}/${carrier.section}, which is not a section`);
      }
    }
  });

  it("every id the engine has ever shipped as a section resolves somewhere", () => {
    // The list `origin/main` published, plus the six the promotion pass created
    // and the two the consolidation folded away. Derived from the rails where a
    // section still exists, so this cannot rot into a hand-kept duplicate.
    const everShipped = [
      ...ENGINE_SECTION_IDS,
      "settlement", "dispersion", "stake", "portfolio", "ablation", "findings", "index", "combos",
    ];
    const unresolved = everShipped.filter((id) =>
      !(COHERENCE_SECTION_IDS as readonly string[]).includes(id)
      && !(id in RELOCATED_SECTIONS.coherence));
    assert.deepEqual(unresolved, [],
      `these ids were sections under #coherence/ and now resolve to nothing:\n  ${unresolved.join("\n  ")}`);
  });

  it("the parser asks the rail, then the table, then the default — in that order", () => {
    // The order is the whole contract. Asked before the rail, this table could
    // shadow a live id; asked after the default, it would never run. The middle
    // branch is also the only one that may change the VIEW, because since the
    // split a relocated id can land on the other tab.
    const rail = hash.indexOf("const onRail = applier[hashView](named)");
    const table = hash.indexOf("RELOCATED_SECTIONS[hashView]?.[named]");
    const fallback = hash.indexOf("applier[hashView](DEFAULT_SECTION[hashView])");
    assert.ok(rail !== -1 && table !== -1 && fallback !== -1, "readLocation no longer resolves in three tries");
    assert.ok(rail < table && table < fallback, "the resolution order changed");
    assert.match(hash, /setView\(moved\.view\)/,
      "a relocated id that crossed tabs would set the section without switching the tab");
  });

  it("the only retired workspace left is the one that was really retired", () => {
    // `markets` was in `LEGACY_VIEWS` for the hours the engine was one tab and
    // is a live view again. `systems` is the genuine retirement.
    assert.match(hash, /systems: "reliability"/);
    const start = hash.indexOf("export const LEGACY_VIEWS");
    const block = hash.slice(start, hash.indexOf("\n};", start));
    assert.doesNotMatch(block, /markets:/, "markets is a live tab and a retired one at once");
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
    const SINGLE_VIEW = new Set(["portfolio"]);
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
    const ONE_LEVEL: Record<string, readonly string[]> = {
      certificate: ["Verdict", "Proof"],
      combos: ["Bands", "Parlays", "Bounds"],
      portfolio: [],
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

describe("the page head is one sentence", () => {
  it("the description is a plain string, not a paragraph of JSX", () => {
    const match = console_.match(/description="([^"]+)"/);
    assert.ok(match, "the description is no longer a plain string prop — a fragment is how it grew last time");
    const sentence = match![1];
    assert.ok(sentence.length <= 160, `the description is ${sentence.length} characters, which is a paragraph again`);
    assert.equal((sentence.match(/\. /g) ?? []).length, 0, `the description is more than one sentence: ${sentence}`);
    // What follows when a family of contracts admits no measure. The other half
    // — what a contract IS — is the Prices head's sentence.
    assert.match(sentence, /wins in every state/);
  });
});
