/**
 * A view inside a section is a place, and a place has an address.
 *
 * Eight sections on Prices carry twenty-five views between them, and until now
 * seventeen of those were component state: not in the URL, not in the command
 * palette, not walked by `scripts/desk-sweep.mjs` — which is why its count was
 * 70 rather than the number of destinations a reader can actually reach. A
 * reader could not send anyone a link to Fees → Ablation, and the sweep never
 * opened it, so a view could break and stay broken with every suite green.
 *
 * The grammar is `#<tab>/<section>/<view>`, and the third segment is OPAQUE TO
 * THE ROUTER: it carries the string, the tab resolves it, and a tab that
 * declares no views ignores it. Every consumer on the desk today is one picker
 * over flat views, so this buys nothing immediately — it is kept because the
 * router gains nothing from knowing, not because a nested case exists. An
 * earlier draft justified it with `FindingsPane` and was wrong: that pane is a
 * flat three-way picker (`FindingsPane.tsx:69`), and the nesting it once had
 * was deliberately removed.
 *
 * WHAT MUST NOT BREAK, and each of these is a link somebody may already hold:
 * a bare `#markets/fees` still opens Fees, an unknown view falls back to the
 * section's own default rather than to a blank pane, and every id already in
 * `RELOCATED_SECTIONS` keeps resolving. A third segment that could strand a
 * two-segment link would be a worse bug than the one it fixes.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MARKETS_SECTION_IDS } from "../lib/sections";
import { defaultView, railView, viewsFor, VIEWS_BY_TAB } from "../lib/section-views";
import { read } from "./helpers/workspace-sources";

/** Which component owns each section, for the two source cross-checks below. */
const OWNERS: Record<string, string> = {
  universe: "UniverseSection", settlement: "SettlementSection", books: "BooksSection",
  dispersion: "MakersSection", lattice: "SurfacePane", stake: "StakePane",
  fees: "FeesSection", shell: "ShellPane",
};

describe("every Prices section declares the views it actually draws", () => {
  it("covers the rail exactly — no section without views, no views without a section", () => {
    assert.deepEqual(Object.keys(VIEWS_BY_TAB.markets ?? {}).sort(), [...MARKETS_SECTION_IDS].sort());
  });

  it("gives every view an id and a label", () => {
    for (const section of MARKETS_SECTION_IDS) {
      for (const [id, label] of viewsFor("markets", section)) {
        assert.match(id, /^[a-z][a-z0-9]*$/, `${section} has a view id that cannot sit in a URL: ${id}`);
        assert.ok(label.trim().length > 0, `${section}/${id} has no label`);
      }
    }
  });

  it("keeps view ids unique inside a section", () => {
    for (const section of MARKETS_SECTION_IDS) {
      const ids = viewsFor("markets", section).map(([id]) => id);
      assert.equal(new Set(ids).size, ids.length, `${section} declares the same view id twice`);
    }
  });

  it("is the only place a section's view default is written", () => {
    // The assertion this replaces read each component's own
    // `useState<XView>("baskets")` and checked the table agreed with it. That
    // check existed because there were TWO sources; now there is one, and the
    // stronger property is that no second source can come back. A section that
    // reintroduces its own view state would render one view while the URL named
    // another, and nothing downstream would notice — the switcher would work,
    // the link would not, and both would look right in a diff.
    for (const [section, owner] of Object.entries(OWNERS)) {
      const source = read(`../components/coherence/${owner}.tsx`);
      assert.doesNotMatch(source, /const \[view, setView\] = useState/,
        `${owner} holds its own view state again; the hash cannot reach it, so ${section}'s address would be a lie`);
      assert.match(source, /onView/,
        `${owner} no longer takes a view from the console`);
    }
  });

  it("the default is the first view listed, so the switcher opens where the URL does", () => {
    for (const section of MARKETS_SECTION_IDS) {
      assert.equal(defaultView("markets", section), viewsFor("markets", section)[0][0]);
    }
  });

  it("declares exactly the views its section's own switcher offers", () => {
    // The cross-check `developer-analyst-7c` asked for, and the one that stops
    // this table becoming a second vocabulary. `SectionFrame` draws a switcher
    // only when a section hands it more than one view, and
    // `coherence-sections.test.ts` pins that a section either draws exactly one
    // `.seg` or is named single-view. So a row here that disagrees with the
    // component's own VIEWS array is either an address that opens nothing or a
    // button with no address, and neither shows up anywhere else.
    for (const section of MARKETS_SECTION_IDS) {
      const source = read(`../components/coherence/${OWNERS[section]}.tsx`);
      // Selected by SHAPE, not by name. `FeesSection` declares `REPLAY_VIEWS`
      // (a flat list of ids, used to gate a read) BEFORE its `VIEWS` pairs, so
      // a name-ordered match reads the wrong array and reports a disagreement
      // that is not there. The switcher is the one array of [id, label] pairs.
      const candidates = [...source.matchAll(/[A-Z_]*VIEWS[^=]*=\s*\[([\s\S]*?)\]\s*;/g)]
        .map((block) => [...block[1].matchAll(/\["([a-z]+)",\s*"([^"]+)"\]/g)].map((m) => [m[1], m[2]]))
        .filter((pairs) => pairs.length > 1);
      assert.equal(candidates.length, 1,
        `${OWNERS[section]} declares ${candidates.length} arrays of view pairs; expected exactly the switcher's`);
      const drawn = candidates[0];
      assert.deepEqual(
        viewsFor("markets", section).map(([id, label]) => [id, label]), drawn,
        `${section}'s table and ${OWNERS[section]}'s switcher disagree`,
      );
    }
  });

  it("gives every section enough views to need a switcher at all", () => {
    // Fewer than two is not a choice, `SectionFrame` draws no switcher for it,
    // and the section would then owe an entry in that suite's SINGLE_VIEW set.
    for (const section of MARKETS_SECTION_IDS) {
      assert.ok(viewsFor("markets", section).length >= 2, `${section} declares fewer than two views`);
    }
  });
});

describe("resolving the third segment", () => {
  it("accepts a view the section has", () => {
    assert.equal(railView("markets", "fees", "comparison"), "comparison");
    assert.equal(railView("markets", "shell", "commands"), "commands");
  });

  it("falls back to the section's default when the view is unknown", () => {
    // A stale or mistyped link must land on the section, never on nothing.
    assert.equal(railView("markets", "fees", "nonsense"), defaultView("markets", "fees"));
    assert.equal(railView("markets", "fees", ""), defaultView("markets", "fees"));
  });

  it("falls back when the segment is absent, which is every link written so far", () => {
    assert.equal(railView("markets", "books", undefined), defaultView("markets", "books"));
  });

  it("never takes another section's view", () => {
    // `reading` is a real view of both settlement and shell, and `commands` is
    // shell's alone. A section must not accept a sibling's id just because the
    // string is live somewhere on the tab.
    assert.equal(railView("markets", "books", "commands"), defaultView("markets", "books"));
    assert.equal(railView("markets", "fees", "ladder"), defaultView("markets", "fees"));
  });

  it("returns null for a tab that declares no views, so the router leaves it alone", () => {
    // Diffusion and the rest keep working untouched: the segment is carried and
    // ignored until that tab declares a table of its own.
    assert.equal(railView("diffusion", "arm", "absorption"), null);
    assert.equal(railView("research", "summary", "anything"), null);
  });

  it("returns null for a section the tab does not have", () => {
    assert.equal(railView("markets", "not-a-section", "baskets"), null);
  });
});
