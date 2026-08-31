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

import { COHERENCE_SECTION_IDS, MARKETS_SECTION_IDS } from "../lib/sections";
import { LESSON_GROUPS } from "../lib/coherence/lessons";
import { defaultView, locationHash, railView, viewsFor, VIEWS_BY_TAB } from "../lib/section-views";
import { read } from "./helpers/workspace-sources";

/** Which component owns each section, for the two source cross-checks below. */
const OWNERS: Record<string, Record<string, string>> = {
  markets: {
    universe: "UniverseSection", settlement: "SettlementSection", books: "BooksSection",
    dispersion: "MakersSection", lattice: "SurfacePane", stake: "StakePane",
    fees: "FeesSection", shell: "ShellPane",
  },
  // Proofs adopted the grammar on 2026-08-26 — the second tab, and the one the
  // table's header said it was designed against.
  coherence: {
    certificate: "CertificatePane", portfolio: "BasketSection", combos: "CombosSection",
    index: "IndexSection", calibration: "CalibrationPane", corpus: "CorpusSection", lessons: "LessonsPane",
  },
};
const RAILS: Record<string, readonly string[]> = { markets: MARKETS_SECTION_IDS, coherence: COHERENCE_SECTION_IDS };
/**
 * Sections that draw no switcher and declare no views — `coherence-sections`
 * names the same set. Basket is one view until its redo.
 */
// EMPTY BOTH SIDES since 2026-08-26: Basket was the last single-view section
// on either engine tab and its redo gave it three. Kept as a table rather than
// deleted, because the next section to arrive with one view needs somewhere to
// say so rather than silently failing the checks below.
const SINGLE_VIEW: Record<string, readonly string[]> = { markets: [], coherence: [] };
/**
 * Where the default is NOT the first listed, and why: Lessons leads with its
 * four curriculum slices ("segregate the content better", the reader's own
 * reorder) and still opens on Coverage, the map. Pinned here so a future
 * reorder cannot move the landing view by accident.
 */
const NAMED_DEFAULTS: Record<string, Record<string, string>> = { coherence: { lessons: "coverage" } };
/**
 * Owners whose switcher is built from data rather than a literal pairs array:
 * the expected pairs are assembled from the same data.
 */
const DERIVED: Record<string, () => Array<[string, string]>> = {
  LessonsPane: () => [...LESSON_GROUPS.map((g) => [g.id, g.label] as [string, string]), ["coverage", "Coverage"], ["states", "Episode states"]],
};

for (const [tab, owners] of Object.entries(OWNERS)) {
  describe(`every ${tab} section declares the views it actually draws`, () => {
    const rail = RAILS[tab];
    it("covers the rail exactly — no section without a row, no row without a section", () => {
      assert.deepEqual(Object.keys(VIEWS_BY_TAB[tab as keyof typeof VIEWS_BY_TAB] ?? {}).sort(), [...rail].sort());
    });

    it("gives every view an id and a label", () => {
      for (const section of rail) {
        for (const [id, label] of viewsFor(tab, section)) {
          assert.match(id, /^[a-z][a-z0-9]*$/, `${section} has a view id that cannot sit in a URL: ${id}`);
          assert.ok(label.trim().length > 0, `${section}/${id} has no label`);
        }
      }
    });

    it("keeps view ids unique inside a section", () => {
      for (const section of rail) {
        const ids = viewsFor(tab, section).map(([id]) => id);
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
      for (const [section, owner] of Object.entries(owners)) {
        const source = read(`../components/coherence/${owner}.tsx`);
        assert.doesNotMatch(source, /const \[view, setView\] = useState/,
          `${owner} holds its own view state again; the hash cannot reach it, so ${section}'s address would be a lie`);
        if (SINGLE_VIEW[tab].includes(section)) continue;
        assert.match(source, /onView/, `${owner} no longer takes a view from the console`);
      }
    });

    it("the default is the first view listed unless the table names another, so the switcher opens where the URL does", () => {
      for (const section of rail) {
        if (SINGLE_VIEW[tab].includes(section)) continue;
        const named = NAMED_DEFAULTS[tab]?.[section];
        assert.equal(defaultView(tab, section), named ?? viewsFor(tab, section)[0][0],
          `${tab}/${section} opens on ${defaultView(tab, section)}`);
        if (named) assert.ok(viewsFor(tab, section).some(([id]) => id === named), `${section}'s named default ${named} is not one of its views`);
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
      for (const section of rail) {
        if (SINGLE_VIEW[tab].includes(section)) continue;
        const owner = owners[section];
        const source = read(`../components/coherence/${owner}.tsx`);
        const drawn = DERIVED[owner]
          ? DERIVED[owner]()
          : (() => {
            // Selected by SHAPE, not by name. `FeesSection` declares `REPLAY_VIEWS`
            // (a flat list of ids, used to gate a read) BEFORE its `VIEWS` pairs, so
            // a name-ordered match reads the wrong array and reports a disagreement
            // that is not there. The switcher is the one array of [id, label] pairs.
            const candidates = [...source.matchAll(/[A-Z_]*VIEWS[^=]*=\s*\[([\s\S]*?)\]\s*;/g)]
              .map((block) => [...block[1].matchAll(/\["([a-z]+)",\s*"([^"]+)"\]/g)].map((m) => [m[1], m[2]] as [string, string]))
              .filter((pairs) => pairs.length > 1);
            assert.equal(candidates.length, 1,
              `${owner} declares ${candidates.length} arrays of view pairs; expected exactly the switcher's`);
            return candidates[0];
          })();
        assert.deepEqual(viewsFor(tab, section).map(([id, label]) => [id, label]), drawn,
          `${section}'s table and ${owner}'s switcher disagree`);
      }
    });

    it("gives every section enough views to need a switcher at all, or names it single-view", () => {
      for (const section of rail) {
        const count = viewsFor(tab, section).length;
        if (SINGLE_VIEW[tab].includes(section)) assert.equal(count, 0, `${section} is named single-view and declares views`);
        else assert.ok(count >= 2, `${section} declares fewer than two views`);
      }
    });
  });
}

describe("the one hash writer", () => {
  it("writes two segments for a default view and for a tab with none, three otherwise", () => {
    assert.equal(locationHash("markets", "fees", "example"), "markets/fees");
    assert.equal(locationHash("markets", "fees", "comparison"), "markets/fees/comparison");
    assert.equal(locationHash("coherence", "lessons", "coverage"), "coherence/lessons");
    assert.equal(locationHash("coherence", "lessons", "record"), "coherence/lessons/record");
    assert.equal(locationHash("coherence", "portfolio", "anything"), "coherence/portfolio");
    assert.equal(locationHash("research", "summary", "results"), "research/summary");
    assert.equal(locationHash("research", "summary", "setup"), "research/summary/setup");
    assert.equal(locationHash("coherence", "certificate", undefined), "coherence/certificate");
  });
});

describe("resolving the third segment", () => {
  it("accepts a view the section has", () => {
    assert.equal(railView("markets", "fees", "comparison"), "comparison");
    assert.equal(railView("markets", "shell", "tree"), "tree");
  });

  it("falls back to the section's default when the view is unknown", () => {
    // A stale or mistyped link must land on the section, never on nothing.
    assert.equal(railView("markets", "fees", "nonsense"), defaultView("markets", "fees"));
    assert.equal(railView("markets", "fees", ""), defaultView("markets", "fees"));
  });

  it("lands a RETIRED view on the section that absorbed it", () => {
    // Shell went from four views to two on 2026-08-26: `reading` merged into
    // Browse (selecting a file was already switching the view under the reader)
    // and `commands` onto Map (both read nothing, and between them they answer
    // what the filesystem IS rather than what is in it).
    //
    // Both ids were minted as addresses hours earlier, so both may be in
    // somebody's link. Neither needs a relocation entry: falling back to the
    // section's own default is the right answer HERE precisely because the
    // absorbing view IS the default. That is a coincidence worth asserting
    // rather than relying on — if Map ever stops being first in the table,
    // these two links start landing somewhere that never held them.
    assert.equal(railView("markets", "shell", "commands"), "layout");
    assert.equal(railView("markets", "shell", "reading"), "layout");
    assert.equal(defaultView("markets", "shell"), "layout",
      "Map is no longer the default, so the two retired Shell views now land on a view that never absorbed them");
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

  it("resolves a Proofs view, falls back to its default, and never takes a sibling's", () => {
    assert.equal(railView("coherence", "certificate", "proof"), "proof");
    assert.equal(railView("coherence", "certificate", "bands"), "verdict", "a sibling's id must land on the default");
    assert.equal(railView("coherence", "lessons", ""), "coverage", "bare #coherence/lessons opens the map, not the first slice");
    assert.equal(railView("coherence", "lessons", "nonsense"), "coverage");
    // Basket stopped being single-view on 2026-08-26, so an unknown segment
    // there now falls back to its default like every other section rather than
    // resolving to nothing. What still resolves to null is a tab with no table
    // at all, which the next case covers.
    assert.equal(railView("coherence", "portfolio", "anything"), "cover",
      "an unknown Basket view must land on Cover, the one drawable on every read");
    assert.equal(railView("coherence", "portfolio", "size"), "size");
  });

  it("resolves Research Summary while tabs without a table stay untouched", () => {
    // Diffusion was the third adopter; Research Summary is the fourth and only
    // declares the result/setup split rather than teaching every role section views.
    assert.equal(railView("diffusion", "arm", "absorption"), "absorption");
    assert.equal(railView("research", "summary", "setup"), "setup");
    assert.equal(railView("research", "summary", "anything"), "results");
    assert.equal(railView("portfolio", "overview", "anything"), null);
  });

  it("returns null for a section the tab does not have", () => {
    assert.equal(railView("markets", "not-a-section", "baskets"), null);
  });
});

/* ── A section's views exist before its data does ─────────────────────── */

import { read as readSource } from "./helpers/workspace-sources";

describe("every frame a Markets section renders carries its views", () => {
  // FOUND BY A PEER'S BROWSER WALK, 2026-08-26. During a slow universe read —
  // or a failed one — Stake and Lattice rendered their `!target` frame with no
  // switcher at all, so a deep link to `#markets/stake/method` pointed at
  // nothing a reader could see or press until the read landed. The views are
  // structural: they exist whether or not the data has arrived, the URL and
  // the palette both name them, and a frame that drops them for the empty
  // branch makes the address a lie for as long as the gateway is slow.
  // The rule: as many `views=` as `<SectionFrame` in every section the table
  // gives views to. The six single-frame sections already satisfy it.
  const SECTIONS: ReadonlyArray<readonly [section: string, file: string]> = [
    ["universe", "../components/coherence/UniverseSection.tsx"],
    ["settlement", "../components/coherence/SettlementSection.tsx"],
    ["books", "../components/coherence/BooksSection.tsx"],
    ["dispersion", "../components/coherence/MakersSection.tsx"],
    ["lattice", "../components/coherence/SurfacePane.tsx"],
    ["stake", "../components/coherence/StakePane.tsx"],
    ["fees", "../components/coherence/FeesSection.tsx"],
    ["shell", "../components/coherence/ShellPane.tsx"],
  ];
  for (const [section, file] of SECTIONS) {
    it(`${section}: no frame is rendered without its switcher`, () => {
      const source = readSource(file);
      assert.ok(source.trim().length > 2000, `${file} is empty`);
      const frames = (source.match(/<SectionFrame\b/g) ?? []).length;
      const withViews = (source.match(/^\s+views=\{/gm) ?? []).length;
      assert.ok(frames >= 1, `${section} renders no SectionFrame`);
      assert.equal(withViews, frames,
        `${section} renders ${frames} frame(s) and only ${withViews} carry views= — the empty branch has dropped the switcher, so a deep link to a view shows nothing until the read lands`);
    });
  }
});
