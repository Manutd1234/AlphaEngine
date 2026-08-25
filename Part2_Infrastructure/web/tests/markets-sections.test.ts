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
import { NAV_ITEMS } from "../lib/workspace-nav";
import { declaredSelectors } from "./helpers/css-selectors";
import { read, stripNonCode } from "./helpers/workspace-sources";

const console_ = read("../components/MarketsConsole.tsx");
const code = stripNonCode(console_);
const prose = read("../app/globals/14q-markets-density.css");

/** Every component that owns a section, by the id it draws. */
const SECTION_FILES: Record<string, string> = {
  universe: "../components/coherence/UniverseSection.tsx",
  settlement: "../components/coherence/SettlementSection.tsx",
  books: "../components/coherence/BooksSection.tsx",
  dispersion: "../components/coherence/MakersSection.tsx",
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

  it("the tab id is the published word and the kicker agrees with the nav row", () => {
    // The id is what the hash, the sweep and the relocation table speak; the
    // label is what a reader finds on the row. A rename of the ID would be a
    // broken link, which is why it is asserted rather than left to look like an
    // oversight — and it is the half that did NOT change on 2026-08-25.
    assert.match(console_, /workspaceId="markets"/);

    // The kicker is read off NAV_ITEMS rather than written down twice. It said
    // "Quotes" here and on the row, and the two had to be changed together by
    // hand; asserting the pair is what stops the head naming a tab the row
    // does not have. The desk has three ids whose label differs deliberately
    // (`live`/Execution, `activity`/Blotter, `coherence`/Proofs), so this is a
    // claim about THIS tab and not a rule about the row.
    const label = NAV_ITEMS.find((item) => item.id === "markets")!.label;
    assert.equal(label, "Markets", "the nav row no longer reads Markets");
    assert.match(console_, new RegExp(`kicker="${label}"`),
      `the page head's kicker disagrees with the nav row, which reads "${label}"`);
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

  it("no section builds a switcher of its own; the frame builds the only one", () => {
    // THE WHOLE HISTORY OF THIS ASSERTION IS A COUNT SHRINKING, AND ON
    // 2026-08-25 IT REACHED ZERO. It began as "at most three segs per section"
    // while `SurfacePane` carried a view seg, a stake seg and a family picker;
    // the consolidation took it to one per section with no exception; and the
    // shared `SectionFrame` takes it to none, because the switcher is the
    // frame's and every section passes it a `views` list instead of markup.
    //
    // THAT IS STRICTLY STRONGER THAN THE COUNT IT REPLACES, and the reason is
    // worth stating because a count going to zero looks like a guard being
    // retired. "Exactly one `.seg` per file" could be satisfied by DELETING a
    // switcher as easily as by keeping the rule — a section that lost its views
    // passed. "Zero here, one in the frame, and every section hands the frame a
    // views list" cannot be: the three clauses have to agree, and the second
    // half of this suite pins the LABEL each list carries, so a deleted
    // switcher fails there.
    //
    // Raw source, because a `.seg` is a class-name STRING and `stripNonCode`
    // blanks those.
    for (const [id, file] of Object.entries(SECTION_FILES)) {
      assert.equal(
        (read(file).match(/className="seg[ "]/g) ?? []).length, 0,
        `${id} hand-builds a switcher again; the row belongs to SectionFrame, which is the `
        + "one place a section can have exactly one of them",
      );
      assert.match(stripNonCode(read(file)), /<SectionFrame\b/,
        `${id} does not render the shared frame, so nothing holds its control row to one`);
    }
  });

  it("and the frame draws exactly one, only when there is a choice", () => {
    const frame = read("../components/coherence/SectionFrame.tsx");
    assert.equal((frame.match(/className="seg[ "]/g) ?? []).length, 1,
      "SectionFrame draws more than one switcher, which is the defect it was written to make impossible");
    // One option is not a choice. A section down to a single view must draw no
    // control at all rather than a row with one pressed button in it — the same
    // rule `UniverseSection` applies to its own asset filter.
    assert.match(stripNonCode(frame), /views\.length > 1/,
      "the frame draws a switcher for a single view; one option is not a choice");
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
    //
    // A `viewsLabel` PROP now, not an `aria-label` attribute: the switcher is
    // `SectionFrame`'s and the name is what the section tells it to call the
    // row. The string still lives in the section file, which is the property
    // being defended — a reader looking for what a section's views are called
    // finds it in the section, and the frame spends it on the `role="group"`.
    assert.match(read(SECTION_FILES.universe), /viewsLabel="Universe view"/);
    assert.match(read(SECTION_FILES.settlement), /viewsLabel="Settlement view"/);
    assert.match(read(SECTION_FILES.books), /viewsLabel="Books view"/);
    assert.match(read(SECTION_FILES.dispersion), /viewsLabel="Makers view"/);
    assert.match(read(SECTION_FILES.lattice), /viewsLabel="Which question"/);
    // The picker's accessible name is a `label` PROP now, not an attribute:
    // `FamilyPicker` spends it on both the button and the listbox, so it is one
    // string in the section and two in the rendered control.
    assert.match(read(SECTION_FILES.lattice), /label="Choose a family"/);
    // The stake's switcher keeps the name it had as the lattice's second seg,
    // because it names the same three readings of the same one answer.
    assert.match(read(SECTION_FILES.stake), /viewsLabel="Stake view"/);
    assert.match(read(SECTION_FILES.stake), /label="Choose a family"/);
    assert.match(read(SECTION_FILES.fees), /viewsLabel="Fees view"/);
    assert.match(read(SECTION_FILES.shell), /viewsLabel="Shell view"/);
    // And the frame spends it. Without this the eight strings above could all
    // be present and reach no accessible name at all.
    assert.match(read("../components/coherence/SectionFrame.tsx"), /aria-label=\{viewsLabel\}/);
  });
});

describe("the reads are gated by section, and the expensive views by view", () => {
  it("one section, one read — the book and the channel no longer share a gate", () => {
    // THE WHOLE HISTORY OF THIS ASSERTION IS A GATE SHRINKING. While Dispersion
    // was a VIEW of Books the CONSOLE owned the book read and had to be told
    // which view was open — a `booksView` state and an `onViewChange` callback
    // — so a signed 25-second private-channel call and a public book read were
    // never in flight together. That callback went when both reads moved into
    // `BooksSection`, leaving a `!onChannel` predicate in one file. The split
    // of 2026-08-25 removes the predicate too: the channel is `MakersSection`,
    // and a section gates itself.
    // WHAT THIS GUARD IS FOR, restated because its shape changed on 2026-08-26
    // and the change must not be mistaken for a relaxation. The defect it was
    // written against is a READ GATED ON A VIEW FROM THE CONSOLE: the signed
    // 25-second channel call firing because the console, not the section,
    // decided which view was open. `booksView` was that state and it stays
    // banned by name.
    //
    // The console does now hold view state, for an unrelated reason: a view is
    // an ADDRESS (`#markets/<section>/<view>`), and a `useState` inside a
    // section is unreachable from the hash, so `lib/section-views.ts` seeds it
    // and `use-rail-sections` owns it. That plumbing may carry a view to a
    // SWITCHER and must never carry one to a READ — so the ban is now on the
    // reads themselves, which is narrower in wording and identical in teeth.
    assert.doesNotMatch(code, /booksView/,
      "the console gates a read on a view again; the gate belongs beside the read it gates");
    const reads = code.slice(code.indexOf("const SECTION_READS"), code.indexOf("export interface MarketsConsoleProps"));
    assert.doesNotMatch(reads, /view/i,
      "a section's read plan mentions a view; reads are gated by SECTION, and by view inside the section that owns them");
    for (const call of code.match(/useCoherenceRead<[^>]*>\([\s\S]*?\);/g) ?? []) {
      assert.doesNotMatch(call, /views|viewProps|onViewChange/,
        `a console read is gated on a view: ${call.slice(0, 80)}`);
    }
    const books = read(SECTION_FILES.books);
    assert.match(books, /booksRoute\(\), active\)/,
      "the book read is gated on something other than its own section");
    // Comments blanked: this file's header EXPLAINS that the `!onChannel` half
    // of the gate was removed, and a raw scan reads that sentence as the defect
    // — the same trap the seg-count assertion above documents.
    assert.doesNotMatch(stripNonCode(books), /onChannel/,
      "Books is gating against a channel read it no longer holds");
    assert.match(read(SECTION_FILES.dispersion), /<RfqPane view=\{view\} active=\{active\}/,
      "the signed channel is not gated on its own section");
  });

  it("the signed channel is the one section that warms nothing", () => {
    // `/rfq` is the desk's slowest read and on any keyless deployment it
    // answers "no view, unsigned" every time, so warming it pre-fetches a
    // refusal. Pinned as an EMPTY entry rather than a missing one: the record
    // is `Record<MarketsSection, readonly string[]>`, so a section that plans
    // no read has to say so, and a reader diffing this file can tell a decision
    // from an oversight.
    const start = console_.indexOf("const SECTION_READS");
    const plan = console_.slice(start, console_.indexOf("\n};", start));
    assert.match(plan, /dispersion: \[\]/);
    assert.match(plan, /settlement: \[settlementRoute\(PUBLISHED_CITY\)\]/);
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
