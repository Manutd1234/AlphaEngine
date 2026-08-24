/**
 * Every section of Markets and Coherence opens the way the other eight tabs do.
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
 * that drifted on other tabs. This file holds the other half for these two
 * tabs, and it holds it structurally rather than by pixel: every section
 * renders `PaneHead`, `PaneHead` renders the `.section-heading` block with an
 * `<h2>`, and the `<h2>` therefore resolves to the "card title" role like every
 * other card head on the desk. Nothing here re-measures type — `type-role-map`
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

import { COHERENCE_SECTIONS, MARKETS_SECTIONS } from "../lib/sections";
import { stripNonCode } from "./helpers/workspace-sources";

const root = join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

const paneHead = read("components/coherence/PaneHead.tsx");

/**
 * The component that owns each section's head, by section id.
 *
 * Named rather than discovered. A scan for "the file that renders this section"
 * would have to follow the console's JSX into a pane and then into whichever
 * inner component happens to draw first, and a wrong guess there passes by
 * finding nothing — the failure mode this whole file exists to close.
 */
const OWNERS: Record<string, string> = {
  universe: "components/coherence/UniverseSection.tsx",
  books: "components/coherence/BooksSection.tsx",
  lattice: "components/coherence/SurfacePane.tsx",
  shell: "components/coherence/ShellPane.tsx",
  certificate: "components/coherence/CertificatePane.tsx",
  fees: "components/coherence/FeesSection.tsx",
  combos: "components/coherence/CombosPane.tsx",
  index: "components/coherence/IndexPane.tsx",
  calibration: "components/coherence/CalibrationPane.tsx",
  diffusion: "components/coherence/DiffusionPane.tsx",
  lessons: "components/coherence/LessonsPane.tsx",
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

describe("every section of both tabs opens with it", () => {
  const ids = [...MARKETS_SECTIONS, ...COHERENCE_SECTIONS].map((section) => section.id);

  it("names an owner for all eleven, and no more", () => {
    assert.deepEqual([...ids].sort(), Object.keys(OWNERS).sort());
  });

  for (const id of ids) {
    it(`${id} renders the shared head`, () => {
      const source = read(OWNERS[id]);
      // `PaneHead` or `PaneHead, { PaneHeadEmpty }` — a section whose data can
      // be absent imports both, because its head has to survive the branch
      // that decides whether there is anything to draw.
      assert.match(source, /import PaneHead(?:, \{ PaneHeadEmpty \})? from "\.\/PaneHead";/,
        `${id} does not import the shared head`);
      assert.match(source, /<PaneHead\b/, `${id} imports the shared head and renders none`);
      // The id, in either shape: a section whose data can be absent hoists its
      // head into a plain object so the empty branch and the drawn one cannot
      // disagree, and there `id` is a property rather than a JSX attribute.
      const tab = ["universe", "books", "lattice", "shell"].includes(id) ? "markets" : "coherence";
      const heading = `${tab}-${id}-heading`;
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

  it("no section still opens with a bare h4, the rung this replaced", () => {
    // `.console-subhead` h4s are fine and are the desk's own head-inside-a-card
    // role; what may not come back is an UNCLASSED h4 in the opening position.
    const offenders: string[] = [];
    for (const [id, file] of Object.entries(OWNERS)) {
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
