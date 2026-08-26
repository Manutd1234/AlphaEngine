/**
 * The desk sweep walks every VIEW the desk can address, not only every section.
 *
 * `desk-sweep-plan.mjs`'s own header records the cost: eight subjects on the
 * engine were reachable only by pressing a button, "and the sweep did not walk
 * them". The third hash segment ended that cost for Markets on 2026-08-26 and
 * for Proofs with this slice — a view is an address now, so a view can no
 * longer break and stay broken with every suite green while the sweep looks at
 * its section's default.
 *
 * `VIEW_CELLS` is hand-mirrored the way `TABS` is (the sweep runs against a
 * built page, not against the source), and this file is the only thing
 * standing between a view added to `lib/section-views.ts` and a view nobody
 * sweeps: it derives the cells from the table and holds the mirror to them,
 * count included. `EXPECTED_SECTIONS` stays 70 — a view is not a section, and
 * `tour-truth` holds that number against the rails.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultView, viewsFor, VIEWS_BY_TAB } from "../lib/section-views";
import { read } from "./helpers/workspace-sources";

// A static import of the plan's own module, so the cells asserted are the
// cells the sweep runs with — not a copy parsed out of its text.
import * as planModule from "../scripts/desk-sweep-plan.mjs";

const plan = planModule as unknown as {
  TABS: Record<string, string[]>;
  EXPECTED_SECTIONS: number;
  VIEW_CELLS: Record<string, Record<string, string[]>>;
  EXPECTED_VIEW_CELLS: number;
};

/** The non-default views per section, derived from the one table. */
function cellsFromTable(): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  for (const tab of Object.keys(VIEWS_BY_TAB)) {
    for (const section of Object.keys(VIEWS_BY_TAB[tab as keyof typeof VIEWS_BY_TAB] ?? {})) {
      const extra = viewsFor(tab, section).map(([id]) => id).filter((id) => id !== defaultView(tab, section));
      if (extra.length) (out[tab] ??= {})[section] = extra;
    }
  }
  return out;
}

describe("the sweep's view cells mirror the section-views table", () => {
  it("declares exactly the non-default views of every tab that has a table", () => {
    assert.deepEqual(plan.VIEW_CELLS, cellsFromTable(),
      "VIEW_CELLS in desk-sweep-plan.mjs disagrees with lib/section-views.ts — a view nobody sweeps, or a cell that opens nothing");
  });

  it("counts them, and the count is derived here rather than trusted", () => {
    const derived = Object.values(cellsFromTable()).reduce(
      (total, sections) => total + Object.values(sections).reduce((n, views) => n + views.length, 0), 0);
    assert.equal(plan.EXPECTED_VIEW_CELLS, derived);
    assert.ok(derived >= 20, `only ${derived} view cells — the table has lost a tab`);
  });

  it("leaves the section list and its count alone — a view is not a section", () => {
    assert.equal(plan.EXPECTED_SECTIONS, 70);
    for (const [tab, sections] of Object.entries(plan.VIEW_CELLS)) {
      for (const section of Object.keys(sections)) {
        assert.ok(plan.TABS[tab]?.includes(section), `VIEW_CELLS names ${tab}/${section}, which TABS does not sweep`);
      }
    }
  });

  it("is declared below TABS with no diffusion key, so diffusion-sections' parser stays on the rail", () => {
    // `diffusion-sections.test.ts` reads the FIRST `diffusion: [` literal in
    // the plan as the Diffusion rail. A `diffusion` key inside VIEW_CELLS,
    // above TABS, would be parsed as the rail and every Diffusion section
    // would read as missing.
    const source = read("../scripts/desk-sweep-plan.mjs");
    assert.ok(source.indexOf("const VIEW_CELLS") > source.indexOf("const TABS"), "VIEW_CELLS must sit below TABS");
    assert.ok(!("diffusion" in plan.VIEW_CELLS), "Diffusion declares no views; it must not appear in VIEW_CELLS");
  });

  it("the sweep itself walks the cells", () => {
    const sweep = read("../scripts/desk-sweep.mjs");
    assert.match(sweep, /VIEW_CELLS/, "desk-sweep.mjs never reads VIEW_CELLS");
    assert.match(sweep, /`\$\{tab\}\/\$\{section\}\/\$\{view\}`/, "the sweep does not drive a three-segment hash for a view");
    assert.match(sweep, /location\.hash = '#\$\{target\}'/, "the sweep does not write the cell it built into the hash");
    assert.match(sweep, /EXPECTED_VIEW_CELLS/, "the sweep does not refuse to run when the view count disagrees");
  });
});
