/**
 * Every section of the Kalshi engine opens the way the other eight tabs do.
 *
 * "standardise the words and headers with the rest of the 8 so everything is
 *  consistent, layout, formatting, fontsize"
 *
 * Measured over Chrome across all 59 rail sections before this change: on the
 * eight desk tabs the first heading under a subtab rail is an `<h2>` computing
 * 20.5px at weight 700, inside a `.section-heading` block. On the Kalshi engine
 * it was a bare `<h4>` at 15.5px — four rungs down — and on nine of its eleven
 * sections there was no heading at all; the pane simply started with a
 * paragraph.
 *
 * `panel-heading-rung.test.ts` already holds the RUNG for the four selectors
 * that drifted on other tabs. This file holds the other half for this tab, and
 * it holds it structurally rather than by pixel: every section renders
 * `PaneHead`, `PaneHead` renders the `.section-heading` block with an `<h2>`,
 * and the `<h2>` therefore resolves to the "card title" role like every other
 * card head on the desk. Nothing here re-measures type — `type-role-map`
 * owns that — because the defect was never a wrong number, it was a different
 * grammar.
 *
 * Structural on purpose: there is no DOM in this suite, so what is pinned is
 * that a future edit has to break the shared head deliberately.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { COHERENCE_SECTIONS, DIFFUSION_SECTIONS, MARKETS_SECTIONS } from "../lib/sections";
import { stripNonCode } from "./helpers/workspace-sources";

const root = join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

const paneHead = read("components/coherence/PaneHead.tsx");

/**
 * The component that owns each section's head, and the TAB that owns the
 * section, by section id.
 *
 * Named rather than discovered. A scan for "the file that renders this section"
 * would have to follow a console's JSX into a pane and then into whichever
 * inner component happens to draw first, and a wrong guess there passes by
 * finding nothing — the failure mode this whole file exists to close.
 *
 * TEN, over two tabs, and the `tab` field is what makes the heading-id check
 * below possible: a head's id is `<tab>-<section>-heading`, so a section that
 * moves tab has to move its id with it or its card is labelled by an id
 * belonging to a rail it is no longer on. Five did move on 2026-08-24 when the
 * consolidated nine were split into Prices and Proofs.
 *
 * TWELVE, not seventeen and not eleven. Earlier that day six in-pane `.seg` views
 * had been promoted to rail sections, each growing a head of its own, and two
 * published sections were later folded into the sections that answer the same
 * question. A section that stops being one MUST STOP DRAWING `PaneHead` — one
 * head per section, drawn by the section's owner. That is what the "and no
 * more" assertion holds: if `SettlementPane`, `PortfolioPane` or `IndexPane`
 * kept its head, the tab would show two card titles in one card and every
 * other assertion here would still pass.
 */
const OWNERS: Record<string, { file: string; tab: string }> = {
  universe: { file: "components/coherence/UniverseSection.tsx", tab: "markets" },
  // Back on the Quotes rail on 2026-08-25, each with a wrapper that owns the
  // head while the pane goes on drawing the subject — the shape `portfolio`
  // and `combos` took hours earlier. Both panes therefore STAY in DEMOTED
  // below: a section's head belongs to the section's owner, and a pane that
  // regained one would put two card titles in one card.
  settlement: { file: "components/coherence/SettlementSection.tsx", tab: "markets" },
  books: { file: "components/coherence/BooksSection.tsx", tab: "markets" },
  dispersion: { file: "components/coherence/MakersSection.tsx", tab: "markets" },
  lattice: { file: "components/coherence/SurfacePane.tsx", tab: "markets" },
  // Back on the rail on the fifth restructure of 2026-08-24, with a file and a
  // head of its own. It was a view of `lattice` for one afternoon and drew no
  // head at all, which is why it used to sit in DEMOTED below.
  stake: { file: "components/coherence/StakePane.tsx", tab: "markets" },
  fees: { file: "components/coherence/FeesSection.tsx", tab: "markets" },
  shell: { file: "components/coherence/ShellPane.tsx", tab: "markets" },
  certificate: { file: "components/coherence/CertificatePane.tsx", tab: "coherence" },
  // Back on the rail on 2026-08-25, both with a head of their own, for the
  // reason `stake` is above: each was a group inside Dutch book, and three
  // groups over six views over a family picker is three rows of chrome before
  // a drawing. `PortfolioPane` and `CombosPane` still draw no head — the
  // SECTION owns it and the pane draws the subject, which is why both stay in
  // DEMOTED below rather than moving up here with their sections.
  portfolio: { file: "components/coherence/BasketSection.tsx", tab: "coherence" },
  combos: { file: "components/coherence/CombosSection.tsx", tab: "coherence" },
  calibration: { file: "components/coherence/CalibrationPane.tsx", tab: "coherence" },
  // The Scorecard split on 2026-08-25 and the coherence index is a section
  // again, under the id it was published with.
  index: { file: "components/coherence/IndexSection.tsx", tab: "coherence" },
  lessons: { file: "components/coherence/LessonsPane.tsx", tab: "coherence" },
  // Diffusion became the ELEVENTH TAB in the same change, so its four groups
  // are four sections with four heads. `findings` is the fourth published id
  // this restructure has brought back rather than invented.
  arm: { file: "components/coherence/diffusion/ArmSection.tsx", tab: "diffusion" },
  episodes: { file: "components/coherence/diffusion/EpisodesSection.tsx", tab: "diffusion" },
  model: { file: "components/coherence/diffusion/ModelSection.tsx", tab: "diffusion" },
  findings: { file: "components/coherence/diffusion/FindingsSection.tsx", tab: "diffusion" },
};

/**
 * The seven that were sections and are views, with the file that draws each.
 * None of them may render a head.
 *
 * SEVEN, not eight: `stake` left this map on the fifth restructure of
 * 2026-08-24 and is in OWNERS above. That is the direction this list is not
 * supposed to move in, so it is worth the sentence — the demotion was undone
 * because the subject needed a second `.seg` under the lattice's first, which
 * is a control row the reader counted out loud.
 *
 * A second list rather than an absence, because "no head here" is only a claim
 * worth checking if the file is named: a scan of every `.tsx` under
 * `components/coherence` would also name the twenty inner components that never
 * had a head and never will, and the assertion would stop meaning anything.
 *
 * `index` is the one still here that was PUBLISHED, which is why its head is
 * the one most likely to be restored by someone reading `origin/main`.
 * `RELOCATED_SECTIONS` is what keeps its link working; a head is not what a
 * link needs.
 *
 * `PortfolioPane` and `CombosPane` STAY on this list although `portfolio` and
 * `combos` are sections again, and that is the distinction the list is for: a
 * section's head belongs to the section's OWNER, and the owner is
 * `BasketSection` / `CombosSection`. The pane draws the subject. If a pane
 * regained a head when its section came back, the tab would show two card
 * titles in one card — which is the exact failure this list was written to
 * catch, arriving by the opposite route.
 */
const DEMOTED: Record<string, string> = {
  settlement: "components/coherence/SettlementPane.tsx",
  dispersion: "components/coherence/RfqPane.tsx",
  portfolio: "components/coherence/PortfolioPane.tsx",
  ablation: "components/coherence/AblationPane.tsx",
  findings: "components/coherence/diffusion/FindingsPane.tsx",
  index: "components/coherence/IndexPane.tsx",
  combos: "components/coherence/CombosPane.tsx",
};

describe("the shared head is the desk's own card grammar", () => {
  it("renders .section-heading with an h2, not a heading of its own invention", () => {
    assert.match(paneHead, /className="section-heading compact"/);
    assert.match(paneHead, /<h2 id=\{id\}>\{title\}<\/h2>/);
    assert.match(paneHead, /className="page-kicker"/);
    assert.match(paneHead, /className="section-note"/);
    assert.match(paneHead, /<p className="sub">\{lede\}<\/p>/);
  });

  it("declares no font-size of its own", () => {
    // The rung is the "card title" role in type-role-map, declared once in the
    // standardisation layer. A size here would be a second authority for one
    // object, which is the defect that role map was written against.
    assert.doesNotMatch(paneHead, /fontSize|text-fs-|--fs-/);
  });
});

describe("every section of the engine opens with it", () => {
  // Both rails. The engine spans two tabs and a suite that read one array would
  // let the other tab's five sections lose their heads in silence.
  const rails: Array<[string, readonly { id: string }[]]> = [
    ["markets", MARKETS_SECTIONS],
    ["coherence", COHERENCE_SECTIONS],
    ["diffusion", DIFFUSION_SECTIONS],
  ];
  const ids: string[] = rails.flatMap(([, sections]) => sections.map((section) => section.id));

  it("names an owner for every engine section, and no more", () => {
    assert.deepEqual([...ids].sort(), Object.keys(OWNERS).sort());
  });

  it("and files each under the tab whose rail actually carries it", () => {
    // The half a tab move breaks. `OWNERS` states the tab, the heading id below
    // is derived from it, and this is what stops the two drifting: a section
    // moved on the rail and left at its old prefix here would still pass every
    // assertion below while its card was labelled for the wrong tab.
    for (const [tab, sections] of rails) {
      for (const section of sections) {
        assert.equal(OWNERS[section.id].tab, tab, `${section.id} is filed under the wrong tab`);
      }
    }
  });

  for (const id of ids) {
    it(`${id} renders the shared head`, () => {
      const source = read(OWNERS[id].file);
      // `PaneHead` or `PaneHead, { PaneHeadEmpty }` — a section whose data can
      // be absent imports both, because its head has to survive the branch
      // that decides whether there is anything to draw.
      // `./PaneHead` or `../PaneHead`: the four Diffusion owners live a level
      // deeper, under `coherence/diffusion/`, because their panes always did.
      // What matters is that it is THE shared head and not a local one — a
      // section inventing its own heading is the defect this asserts against,
      // and a relative depth is not that.
      assert.match(source, /import PaneHead(?:, \{ PaneHeadEmpty \})? from "\.{1,2}\/PaneHead";/,
        `${id} does not import the shared head`);
      assert.match(source, /<PaneHead\b/, `${id} imports the shared head and renders none`);
      // The id, in either shape: a section whose data can be absent hoists its
      // head into a plain object so the empty branch and the drawn one cannot
      // disagree, and there `id` is a property rather than a JSX attribute.
      //
      // TWO PREFIXES, derived from the tab that owns the section rather than
      // written down. There was one for the hours the engine was a single tab,
      // and the split of 2026-08-24 moved five heads back to `markets-`. Derived
      // is what matters: a hardcoded prefix would have silently mislabelled
      // every card that moved.
      const heading = `${OWNERS[id].tab}-${id}-heading`;
      assert.ok(
        source.includes(`id="${heading}"`) || source.includes(`id: "${heading}"`),
        `${id}'s head does not carry the id its card is labelled by`,
      );
      assert.ok(
        source.includes(`aria-labelledby="${heading}"`),
        `${id}'s card is not labelled by its own heading`,
      );
    });
  }

  it("a demoted section draws no head of its own", () => {
    // The failure mode every fold has, and the reason this list exists. Eight
    // panes were rail sections and grew a `PaneHead` each; left in place under
    // a parent that also draws one, a reader meets two card titles in one card
    // and every other assertion here still passes.
    //
    // NO FILE IS IN BOTH MAPS ANY MORE. `SurfacePane` was, for the one day it
    // owned `lattice`'s head and carried `stake` as a view, and the `owned`
    // guard below was written to excuse it. The guard stays because the shape
    // it excuses is legitimate and will recur the next time a section absorbs
    // one; it currently excuses nothing, which is the state to keep.
    const owned = new Set(Object.values(OWNERS).map((owner) => owner.file));
    const offenders: string[] = [];
    for (const [id, file] of Object.entries(DEMOTED)) {
      if (owned.has(file)) continue;
      if (/<PaneHead\b/.test(stripNonCode(read(file)))) offenders.push(`${id}: ${file}`);
    }
    assert.deepEqual(
      offenders,
      [],
      "a demoted section still draws the shared head; one head per section, drawn by the section's owner",
    );
  });

  it("no section still opens with a bare h4, the rung this replaced", () => {
    // `.console-subhead` h4s are fine and are the desk's own head-inside-a-card
    // role; what may not come back is an UNCLASSED h4 in the opening position.
    const offenders: string[] = [];
    for (const [id, owner] of Object.entries(OWNERS)) {
      const file = owner.file;
      // Comments blanked first: several of these files QUOTE the old bare
      // `<h4>` in the header that explains what replaced it, and a raw scan
      // read that as the defect coming back.
      const source = stripNonCode(read(file));
      const head = source.indexOf("<PaneHead");
      for (const match of source.matchAll(/<h4(?![^>]*className)/g)) {
        if (head === -1 || match.index > head) offenders.push(`${id}: ${file}`);
      }
    }
    assert.deepEqual([...new Set(offenders)], []);
  });
});
