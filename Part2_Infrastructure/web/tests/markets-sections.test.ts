/**
 * Prices is a rail of six sections, and each one is reachable.
 *
 * "no i still want two tabs instead but rename markets and coherance as
 *  something else / then split the 9 tabs currently into the two renamed tabs
 *  based on their features"
 *
 * WHAT THIS FILE IS, after four restructures in one day. The Kalshi engine went
 * one tab of eleven → two tabs → seventeen sections → one tab → nine sections →
 * two tabs of nine, all on 2026-08-24 and none of it pushed. A suite of this
 * name existed during the first split and was deleted at the merge; this is not
 * that file restored. It guards the six the fifth restructure left — universe,
 * books, lattice, stake, fees, shell — where the earlier one guarded four and
 * then seven, and the consolidation five. `stake` is back on the rail because
 * as a view of `lattice` it needed a SECOND `.seg` stacked under the first, and
 * the seg-count assertion below is where that shows up.
 *
 * Its sibling is `coherence-sections.test.ts`, which guards the Proofs console
 * and owns the relocation table: an id that moved tab is a property of the
 * table, not of either console, so it is asserted in one place.
 *
 * The COPY half is `coherence-reading-claims.test.ts`, which guards what this
 * tab's sections say, because the Kalshi engine is the one part of the desk
 * with no `summarised-<tab>` / `disclosure-<tab>` pair.
 *
 * This is not a rendering test: `npm test` has no DOM and never will (CLAUDE.md,
 * fact 6), so what is pinned is that a future edit has to break the wiring
 * deliberately.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MARKETS_SECTIONS, MARKETS_SECTION_IDS } from "../lib/sections";
import { declaredSelectors } from "./helpers/css-selectors";
import { read, stripNonCode } from "./helpers/workspace-sources";

const console_ = read("../components/MarketsConsole.tsx");
const code = stripNonCode(console_);
const prose = read("../app/globals/14q-markets-density.css");

/** Every component that owns a section, by the id it draws. */
const SECTION_FILES: Record<string, string> = {
  universe: "../components/coherence/UniverseSection.tsx",
  books: "../components/coherence/BooksSection.tsx",
  lattice: "../components/coherence/SurfacePane.tsx",
  stake: "../components/coherence/StakePane.tsx",
  fees: "../components/coherence/FeesSection.tsx",
  shell: "../components/coherence/ShellPane.tsx",
};

describe("the Prices rail and its panels agree", () => {
  it("the console draws a panel for every rail id, and no id it does not have", () => {
    const drawn = [...console_.matchAll(/<WorkspaceSubtabPanel workspaceId="markets" tabId="([a-z]+)"/g)]
      .map((match) => match[1]);
    assert.deepEqual(drawn, MARKETS_SECTIONS.map((section) => section.id),
      "the panels and the rail have diverged — a rail entry with no panel renders an empty section");
  });

  it("every section id has a component that owns it", () => {
    assert.deepEqual(Object.keys(SECTION_FILES).sort(), [...MARKETS_SECTION_IDS].sort());
  });

  it("the tab id is the published word and the label is the read one", () => {
    // `markets` renders "Quotes". The id is what the hash, the sweep and the
    // relocation table speak; the label is what a reader finds on the row. A
    // rename of the id would be a broken link, which is why it is asserted
    // rather than left to look like an oversight.
    assert.match(console_, /workspaceId="markets"/);
    assert.match(console_, /kicker="Quotes"/);
  });

  it("focus moves to the rail button the reader just pressed", () => {
    // Without this a keyboard reader who opens a section lands nowhere: the
    // button they pressed has been re-rendered under them.
    assert.match(code, /requestAnimationFrame/);
    assert.match(code, /markets-subtab-\$\{next\}/);
  });
});

describe("exactly one subtab rail on the tab", () => {
  it("the console renders it and no section component does", () => {
    // Comments blanked: this file's own header and the console's quote
    // `<WorkspaceSubtabs>` while explaining why a second may not exist, and a
    // raw count reads that as the defect.
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

  it("each section draws only the switchers its subject needs", () => {
    // The count is the assertion, and the consolidation is what makes it
    // interesting: a section that absorbed a demoted one FLATTENS its views
    // into the existing switcher rather than stacking a second under it.
    // Universe went from two options to five, Books from two to four, Fees from
    // two to four — and each still draws ONE seg.
    //
    // `SurfacePane` used to be the exception at THREE — the view seg, a second
    // seg for the stake's Plan/Capital/Method, and the family picker — and the
    // exception is what the reader saw: "there are too many subtabs for lattice".
    // Splitting `stake` back onto the rail took it to TWO, and the shared
    // `FamilyPicker` takes it to ONE: "there are 4 subtabs for 4 families when
    // we can use a dropdown instead". A picker was never a view switcher — it
    // chooses the subject every view is a question about — and drawing it as a
    // row of pills said otherwise in the only vocabulary a reader has.
    //
    // So ONE seg per section is now the rule with no exception, and a second
    // one appearing is a control that has been given the switcher's shape
    // without the switcher's meaning.
    //
    // Raw source, because a `.seg` is a class-name STRING and `stripNonCode`
    // blanks those.
    const expected: Record<string, number> = {
      universe: 1, books: 1, lattice: 1, stake: 1, fees: 1, shell: 1,
    };
    for (const [id, count] of Object.entries(expected)) {
      const segs = (read(SECTION_FILES[id]).match(/className="seg[ "]/g) ?? []).length;
      assert.equal(segs, count, `${id} draws ${segs} .seg groups, expected ${count}`);
    }
  });

  it("the sections that choose a family use the shared control, not one of their own", () => {
    // The counting assertion above can be satisfied by DELETING a picker as
    // easily as by unifying one, and a section that lost its family control
    // would still draw one seg. So the replacement is pinned from the other
    // side: both sections that read per-family mount `FamilyPicker`, which is
    // the same control the two Proofs sections built on `/certify` mount.
    //
    // One control and not two copies of the markup, for the reason that file's
    // header gives: four call sites keying a shared read cache four ways is
    // four chances to read the exchange twice for one answer.
    for (const id of ["lattice", "stake"] as const) {
      const source = read(SECTION_FILES[id]);
      assert.match(source, /import FamilyPicker from "\.\/FamilyPicker";/,
        `${id} no longer mounts the shared family control`);
      assert.match(source, /<FamilyPicker\b/, `${id} imports the shared control and renders none`);
      assert.doesNotMatch(source, /className="seg coh-books__picker"/,
        `${id} has hand-rolled a picker again; that row is what the reader counted`);
    }
  });

  it("a demoted pane brings no switcher of its own", () => {
    // The other half of the flattening rule, and the one a fold gets wrong: a
    // pane that was a section owns a `.seg`, and left in place it becomes a
    // second control stacked under its new parent's.
    for (const file of [
      "../components/coherence/SettlementPane.tsx",
      "../components/coherence/RfqPane.tsx",
      "../components/coherence/AblationPane.tsx",
    ]) {
      assert.equal(
        (read(file).match(/className="seg[ "]/g) ?? []).length, 0,
        `${file} still draws its own switcher; its views belong on its parent's seg`,
      );
    }
  });

  it("the view switchers name their options", () => {
    // Pinned by name because these labels are the only route a reader has to
    // the other views of a section, and a rename that silently drops one leaves
    // the view unreachable exactly the way an unaddressable pane id does.
    assert.match(read(SECTION_FILES.universe), /aria-label="Universe view"/);
    assert.match(read(SECTION_FILES.books), /aria-label="Books view"/);
    assert.match(read(SECTION_FILES.lattice), /aria-label="Which question"/);
    // The picker's accessible name is a `label` PROP now, not an attribute:
    // `FamilyPicker` spends it on both the button and the listbox, so it is one
    // string in the section and two in the rendered control.
    assert.match(read(SECTION_FILES.lattice), /label="Choose a family"/);
    // The stake's switcher keeps the name it had as the lattice's second seg,
    // because it names the same three readings of the same one answer.
    assert.match(read(SECTION_FILES.stake), /aria-label="Stake view"/);
    assert.match(read(SECTION_FILES.stake), /label="Choose a family"/);
    assert.match(read(SECTION_FILES.fees), /aria-label="Fees view"/);
    assert.match(read(SECTION_FILES.shell), /aria-label="Shell view"/);
  });
});

describe("the reads are gated by section, and the expensive views by view", () => {
  it("the console no longer owns the book read, so it cannot race the RFQ channel", () => {
    // While Dispersion was a VIEW of Books the console owned the exchange's
    // book read and had to be told which view was open — a `booksView` state
    // and an `onViewChange` callback — so a signed 25-second private-channel
    // call and a public book read were never in flight together. Both reads
    // live in `BooksSection` now, each gated on its own views.
    assert.doesNotMatch(code, /booksView|onViewChange/,
      "the view plumbing is back; the gate belongs beside the read it gates");
    const books = read(SECTION_FILES.books);
    assert.match(books, /booksRoute\(\), active && !onChannel/,
      "the book read is not gated away from the channel views");
    assert.match(books, /active=\{active && onChannel\}/,
      "the RFQ channel is not gated on the two views that draw it");
  });

  it("the universe read serves the three sections that need the family list", () => {
    assert.match(
      console_,
      /section === "universe" \|\| section === "lattice" \|\| section === "stake"/,
      "the slowest read on the engine is asked for once and shared, or it is asked for three times",
    );
  });

  it("the stake warms the universe and never its own per-family read", () => {
    // The same rule the lattice obeys, asserted for the section that was added
    // last: `/stake` names a family the reader has not picked, so warming it
    // would spend the exchange's token bucket on a guess. The general form is
    // the surfaceRoute|stakeRoute|certifyRoute check below; this pins that the
    // new section plans a read at all rather than opening cold.
    const start = console_.indexOf("const SECTION_READS");
    const plan = console_.slice(start, console_.indexOf("\n};", start));
    assert.match(plan, /stake: \[universeRoute\(\)\]/);
  });

  it("and it is shared with the other tab rather than re-fetched", () => {
    // `read-cache.ts` holds one answer per URL, so the Proofs certificate's own
    // universe read is the same read. Stated because the split is exactly the
    // change that would tempt someone to give each console its own route.
    assert.match(console_, /read-cache\.ts` holds one answer per URL/);
  });

  it("the 20,000-row replay is gated on its own two views", () => {
    assert.match(read(SECTION_FILES.fees), /active=\{active && onReplay\}/,
      "the largest read on the engine runs for a reader who opened Fees to see a fee");
  });

  it("no section warms a read that names a family the reader picks", () => {
    // `surface`, `stake` and `certify` take an event ticker. Warming one
    // guesses at an answer rather than at a question, and it spends the
    // exchange's token bucket on a family nobody selected.
    const start = console_.indexOf("const SECTION_READS");
    const plan = console_.slice(start, console_.indexOf("\n};", start));
    assert.doesNotMatch(plan, /surfaceRoute|stakeRoute|certifyRoute/);
  });
});

describe("the page head is one sentence", () => {
  it("the description is a plain string, not a paragraph of JSX", () => {
    // It rendered as a four-to-five-line paragraph before the condensation
    // pass. The tab's argument belongs in the file's own header comment, which
    // is long on purpose; what a reader meets above the rail is one sentence.
    const match = console_.match(/description="([^"]+)"/);
    assert.ok(match, "the description is no longer a plain string prop — a fragment is how it grew last time");
    const sentence = match![1];
    assert.ok(sentence.length <= 160, `the description is ${sentence.length} characters, which is a paragraph again`);
    assert.equal((sentence.match(/\. /g) ?? []).length, 0, `the description is more than one sentence: ${sentence}`);
    // What a contract IS. The other half of the argument — what follows when a
    // family of them admits no measure — is the Proofs head's sentence, and
    // neither may borrow the other's.
    assert.match(sentence, /probability with a price on it/);
  });
});

describe("the prose half of the density pass", () => {
  it("ends in a newline, so it cannot weld onto the next partial", () => {
    assert.ok(prose.endsWith("\n"));
  });

  it("is scoped to the plane both consoles render", () => {
    // Both roots carry `.coherence-plane` plus a tab class of their own. The
    // shared class is what lets ONE density pass serve two tabs that draw the
    // same figures out of one component library; the tab class is for a rule
    // whose subject is the tab.
    assert.match(console_, /className="coherence-plane markets-plane"/);
    assert.match(read("../components/CoherenceConsole.tsx"), /className="coherence-plane proofs-plane"/);
    const selectors = declaredSelectors(prose);
    // RULES, not comma-parts. The splitter is paren-aware, so a `:is()` list of
    // twenty class names counts once — which is what makes the scoping check
    // mean anything, and why this floor is single digits rather than the sixty
    // a naive comma split reported.
    assert.ok(selectors.length >= 6, `only ${selectors.length} selectors — is the partial empty?`);
    const unscoped = selectors.filter((selector) => !selector.includes(".coherence-plane"));
    assert.deepEqual(unscoped, [], `these rules are not scoped to the plane:\n  ${unscoped.join("\n  ")}`);
  });

  it("names its own tab class and never the other file's", () => {
    // One tab class per partial. A `.proofs-plane` rule here would be a rule
    // about the other tab living in this file, which is how the first split's
    // two partials ended up each maintaining half of the other's ladder.
    assert.ok(prose.includes(".markets-plane"), "the partial spends no tab class at all");
    assert.doesNotMatch(prose.replace(/\/\*[\s\S]*?\*\//g, ""), /\.proofs-plane/,
      "14q reaches into the Proofs plane; that rule belongs in 14r");
  });

  it("sizes nothing that names the seg", () => {
    // Three suites forbid a second selector sizing the segmented control by
    // name; the whole record is in nav-type-markets-coherence.test.ts.
    const rules = prose.replace(/\/\*[\s\S]*?\*\//g, "").split("}");
    assert.deepEqual(rules.filter((rule) => /\bseg\b/.test(rule) && /font-size/.test(rule)), []);
  });

  it("reads every size off the ladder", () => {
    const off = [...prose.matchAll(/font-size:\s*([^;]+);/g)]
      .map((match) => match[1].trim())
      .filter((value) => !/^var\(--fs-[a-z0-9-]+\)$/.test(value));
    assert.deepEqual(off, [], `font sizes off the scale: ${off.join(", ")}`);
  });

  it("holds only the PROSE ladder, so the seam with 14r is by concern", () => {
    // The invariant the concern seam creates, and this is the cheap half of
    // checking it: on one shared plane, a selector declared in both partials is
    // one selector sized twice and 14r wins in silence. The cut is prose here,
    // diagram there — so no diagram token may be spent in this file at all.
    const body = prose.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(body, /--fs-diagram-/, "a diagram rung is spent in the prose partial");
    assert.doesNotMatch(body, /--fs-tick/, "--fs-tick is :root's and is the SVG ladder's floor");
    assert.doesNotMatch(body, /@media/, "packing lives in 14r; a rung is not a width decision");
  });

  it("no selector is declared in both partials", () => {
    // Stated here as well as in `rung-single-declaration.test.ts` because that
    // suite reads the concatenated sheet and reports a pair; this reads the two
    // files and says WHICH seam broke, which is the message the next reader
    // needs when they add a rule to the file they happen to have open.
    const diagram = new Set(declaredSelectors(read("../app/globals/14r-coherence-density.css")));
    const shared = [...new Set(declaredSelectors(prose))].filter((selector) => diagram.has(selector));
    assert.deepEqual(shared, [], `declared in 14q and 14r, and 14r wins:\n  ${shared.join("\n  ")}`);
  });
});
