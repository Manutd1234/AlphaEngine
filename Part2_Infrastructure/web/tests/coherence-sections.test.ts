/**
 * Proofs is a rail of four sections, and every retired location still resolves.
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
 * The COPY half is `coherence-proof-claims.test.ts`, and its sibling
 * `coherence-reading-claims.test.ts` covers Prices; the two exist because this
 * engine is the one part of the desk with no `summarised-<tab>` /
 * `disclosure-<tab>` pair.
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
      // Stopped being sections AND changed tab with their carrier.
      settlement: { view: "markets", section: "universe" },
      dispersion: { view: "markets", section: "books" },
      ablation: { view: "markets", section: "fees" },
      // Stopped being sections; their carrier stayed here. `index` and `combos`
      // are the two that were PUBLISHED, which is what makes this table
      // load-bearing rather than a courtesy to one unpushed morning.
      portfolio: { view: "coherence", section: "certificate" },
      combos: { view: "coherence", section: "certificate" },
      index: { view: "coherence", section: "calibration" },
      findings: { view: "coherence", section: "diffusion" },
    },
    // `markets/stake` was a third entry here and is RETIRED, not re-pointed:
    // `stake` is on this rail again, the rail is asked before this table, so
    // the entry could never have been reached. The assertion below that no
    // relocated id is still a section of the tab that names it is what would
    // have caught leaving it.
    markets: {
      settlement: { view: "markets", section: "universe" },
      dispersion: { view: "markets", section: "books" },
    },
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
   * failure the table was written against. These three are not that:
   * `portfolio` and `combos` were folded into Dutch book because it is the
   * section that answers their question, and `settlement` into Universe for the
   * same reason — each of those carriers is its tab's default only because it
   * is first in rail order. Naming them keeps the check meaningful for the
   * other fourteen and makes the coincidence a decision.
   */
  const LANDS_ON_DEFAULT = new Set([
    "coherence/portfolio", "coherence/combos", "markets/settlement",
  ]);

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

  it("each section draws only the switchers its subject needs", () => {
    // ONE seg each, and the consolidation is what makes that worth counting:
    // Dutch book absorbed the parlays and went from three views to six,
    // Scorecard absorbed the index and went from three to five, and neither
    // stacked a second control. Raw source, because a `.seg` is a class-name
    // STRING and `stripNonCode` blanks those.
    for (const [id, file] of Object.entries(SECTION_FILES)) {
      const segs = (read(file).match(/className="seg[ "]/g) ?? []).length;
      assert.equal(segs, 1, `${id} draws ${segs} .seg groups, expected 1`);
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

  it("the six-view and five-view switchers name every option", () => {
    // Pinned by name because these labels are the only route a reader has to
    // the other views of a section — and for `combos` and `index` they are the
    // only route at all, since both stopped being addressable.
    const certificate = read(SECTION_FILES.certificate);
    assert.match(certificate, /aria-label="Certificate view"/);
    for (const label of ["Verdict", "Proof", "Certificate", "Bands", "Parlays", "Bounds"]) {
      assert.ok(certificate.includes(`"${label}"`), `Dutch book lost its ${label} view`);
    }
    const calibration = read(SECTION_FILES.calibration);
    assert.match(calibration, /aria-label="Calibration view"/);
    for (const label of ["Score", "Bands", "Corpus", "Index series", "Index families"]) {
      assert.ok(calibration.includes(`"${label}"`), `Scorecard lost its ${label} view`);
    }
    assert.match(read(SECTION_FILES.diffusion), /aria-label="Diffusion view"/);
  });
});

describe("the reads are gated by section, and the folded reads by view", () => {
  it("the certificate warms the universe rather than a family nobody picked", () => {
    assert.match(console_, /section === "certificate"/,
      "the universe read is not gated on the one section that needs the family list");
    const start = console_.indexOf("const SECTION_READS");
    const plan = console_.slice(start, console_.indexOf("\n};", start));
    assert.doesNotMatch(plan, /certifyRoute|combosRoute/);
  });

  it("the parlay read is gated on the three views that draw it", () => {
    assert.match(read(SECTION_FILES.certificate), /active && !onParlays/,
      "the certify call runs while a reader is looking at parlays");
    assert.match(read(SECTION_FILES.certificate), /active=\{active && onParlays\}/,
      "the combos read is not gated on the three views that draw it");
  });

  it("the index read is gated on its own two views", () => {
    assert.match(read(SECTION_FILES.calibration), /active && !onIndex/,
      "the settled-corpus read runs while a reader is on an index view");
    assert.match(read(SECTION_FILES.calibration), /active=\{active && onIndex\}/,
      "the index read is not gated on the two views that draw it");
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
