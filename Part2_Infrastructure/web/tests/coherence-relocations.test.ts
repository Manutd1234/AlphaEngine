/**
 * Every location the engine has ever published still resolves.
 *
 * SIX RESTRUCTURES IN TWO DAYS, AND THIS FILE IS WHERE THE BILL IS PAID.
 * 2026-08-24 went: one tab of eleven → Markets + Coherence → seventeen sections
 * → back to one tab → consolidated to nine → two tabs. 2026-08-25 then re-cut
 * both rails so every section asks one question, and split Diffusion out as an
 * eleventh tab. Every one of those moves stranded a location, and a location
 * that does not resolve does not fail loudly: it lands on a rail default while
 * the URL still names something else, which is this house's own failure mode —
 * green, plausible, and wrong.
 *
 * The table is asserted here rather than in any console: an id that moved TAB
 * belongs to none of them, and pinning it against one would let the others
 * drift.
 *
 * WHAT THE LAST TWO RESTRUCTURES DID TO IT IS THE INTERESTING PART, because it
 * SHRANK. Five ids left the table entirely — `stake`, `portfolio`, `combos`,
 * `index` and, on the Prices side, `settlement` and `dispersion` — every one of
 * them a published id that became a section again. `readLocation` asks the rail
 * before it asks this table, so an id back on its own rail is reached without a
 * lookup, and an entry that cannot be reached is a table claiming a move that
 * was undone. The ids that STAY are the ones that changed TAB, which is the one
 * kind of move a rail cannot answer for.
 *
 * Its own file since 2026-08-25, when `coherence-sections.test.ts` crossed the
 * four-hundred-line ceiling for the second time. The seam is subject rather
 * than convenience: that file asserts the rail is WIRED, this one asserts the
 * URLs still land.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COHERENCE_SECTION_IDS, DIFFUSION_SECTION_IDS, MARKETS_SECTION_IDS,
} from "../lib/sections";
import { DEFAULT_SECTION, RELOCATED_SECTIONS } from "../lib/workspace-hash";
import { read } from "./helpers/workspace-sources";

const hash = read("../lib/workspace-hash.ts");

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
      // `index` RETIRED on 2026-08-25 — a Proofs section again when the
      // Scorecard split, so `readLocation` reaches it on the rail and this
      // table is never consulted. Fourth published id brought back for free.
      //
      // `diffusion` and `findings` are the newest tab move and the one kind
      // this table cannot stop being needed for: Diffusion is a TAB now, so
      // both URLs name the wrong tab and only a lookup can say so. `findings`
      // lands on the section that carries it natively.
      diffusion: { view: "diffusion", section: "arm" },
      findings: { view: "diffusion", section: "findings" },
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
      diffusion: DIFFUSION_SECTION_IDS,
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
    // The ids ever shipped UNDER `#coherence/`, which is this rail plus its
    // history — NOT `ENGINE_SECTION_IDS`. That constant spans three tabs since
    // Diffusion became its own on 2026-08-25, and `arm`/`episodes`/`model` were
    // never Proofs sections, so asking this table to resolve them would demand
    // entries for links that have never existed.
    const everShipped = [
      ...COHERENCE_SECTION_IDS,
      "settlement", "dispersion", "stake", "portfolio", "ablation", "findings", "index", "combos",
      // `diffusion` WAS a section id under `#coherence/` before it became a
      // tab, so a link naming it resolves like any other retired section.
      "diffusion",
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
