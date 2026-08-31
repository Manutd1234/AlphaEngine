/**
 * The Parlays view: a readable name on every row, and no grey slab under it.
 *
 * Two of Ian's ten: "Redo the Parlays subtab and use better background, the
 * grey part is ugly. redo the entire thing", and "Rename the Parlays so that
 * we can read it, now it is a bunch of gibberish".
 *
 * THE GIBBERISH WAS A RENDER DEFECT, not missing data. `combo.label` — which
 * the gateway composes from the venue's own `yes_sub_title` — has been on the
 * wire since the route was written, and the view rendered it in exactly one
 * place: a paragraph inside a closed fold. Every other site printed
 * `combo.ticker`, so the table, the two strips and the fold summaries all read
 * as tickers. The name leads now and the ticker keeps its place as an
 * identifier, in `<code>` or in a title where a reader can still copy it.
 *
 * THE GREY WAS ONE TOKEN. Six ~900x14 `.coh-combo__track` rects filled
 * `--surface-2` stacked at the top of the view, plus the formula's code slab
 * above the switcher. Killing it at the class fixes `ParlayLegs`,
 * `ComboBandStrips` and every `FrechetBand` at once: the track is a hairline
 * now, and the meaning stays where it always was — on the edges and the words.
 *
 * DERIVED, NEVER OBSERVED (CLAUDE.md, fact 6): that the view reads lighter is
 * a screenshot's claim, not this file's.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";

import { isNamed, parlayName } from "../lib/coherence/parlay-name";
import type { CoherenceCombo } from "../lib/coherence/types-lab";
import { globalsCss } from "./globals-css";
import { read, stripNonCode } from "./helpers/workspace-sources";

const combo = (label: string, ticker: string) => ({ label, ticker }) as unknown as CoherenceCombo;

describe("parlayName", () => {
  it("capitalises the venue's own words", () => {
    assert.equal(parlayName(combo("yes Liverpool", "KXMVE-26AUG25-LIV")), "Yes Liverpool");
    assert.equal(parlayName(combo("  both teams score  ", "KX-1")), "Both teams score");
    assert.equal(parlayName(combo("NYC above 90", "KX-2")), "NYC above 90", "an already-capitalised name is untouched");
  });

  it("names an unnamed parlay by its tail, never by the bare ticker", () => {
    const bare = parlayName(combo("", "KXMVE26AUG25LIV9C1"));
    assert.match(bare, /^Unnamed parlay /, "an unnamed parlay does not say so");
    assert.match(bare, /LIV9C1$/, "the tail is what tells two unnamed parlays apart");
    assert.notEqual(bare, "KXMVE26AUG25LIV9C1");
    // A label that is only the ticker is not a name.
    assert.equal(parlayName(combo("KX-3", "KX-3")), parlayName(combo("", "KX-3")));
  });

  it("never returns the bare ticker for any input", () => {
    for (const [label, ticker] of [["", "ABCDEFGH"], ["   ", "ABCDEFGH"], ["ABCDEFGH", "ABCDEFGH"]] as const) {
      assert.notEqual(parlayName(combo(label, ticker)), ticker);
    }
  });

  it("isNamed says whether the venue gave it words", () => {
    assert.equal(isNamed(combo("yes Liverpool", "KX-1")), true);
    assert.equal(isNamed(combo("", "KX-1")), false);
    assert.equal(isNamed(combo("KX-1", "KX-1")), false);
  });
});

describe("the view is split, so both halves stay under the ceiling", () => {
  it("ParlaysView has its own file and CombosViews does not define it", () => {
    assert.ok(existsSync(new URL("../components/coherence/ParlaysView.tsx", import.meta.url)),
      "ParlaysView.tsx does not exist");
    assert.doesNotMatch(read("../components/coherence/CombosViews.tsx"), /function ParlaysView\(/,
      "ParlaysView is still defined in CombosViews");
  });
});

describe("the name leads and the ticker is an identifier", () => {
  const SITES = ["ParlaysView.tsx", "ParlayLegs.tsx", "ComboBandStrips.tsx"];
  for (const file of SITES) {
    it(`${file} names its parlays`, () => {
      const source = read(`../components/coherence/${file}`);
      assert.match(source, /parlayName/, `${file} does not use the name`);
    });
  }

  it("the compact picker leads with names while the selected audit keeps a copyable identifier", () => {
    const source = read("../components/coherence/ParlaysView.tsx");
    // The dense picker deliberately omits the identifier; its full name and
    // ticker remain available to assistive tech and as a pointer title. The
    // audit row keeps the copyable identifier, immediately after the name.
    assert.match(source, /function pickerDescription[\s\S]*?parlayName\(combo\)[\s\S]*?combo\.ticker/);
    const picker = source.slice(source.indexOf('<nav className="coh-parlay-picker"'), source.indexOf("</nav>"));
    const button = picker.match(/<Button[\s\S]*?<\/Button>/)?.[0] ?? "";
    const openEnd = /\n\s*>\s*\n/.exec(button);
    assert.ok(openEnd, "could not locate the compact picker button face");
    const face = button.slice((openEnd.index ?? 0) + openEnd[0].length, button.indexOf("</Button>"));
    assert.match(face, /coh-parlay-picker__label/);
    assert.doesNotMatch(face, /<code|\{combo\.ticker\}/,
      "the compact picker repeats a long identifier inside every control");
    assert.match(source, /<h3>\{parlayName\(selected\)\}<\/h3>[\s\S]*?<code className="coh-combo__ticker">\{selected\.ticker\}<\/code>/);
  });

  it("each diagram measures the exact label it draws", () => {
    const ranges = read("../components/coherence/ComboBandStrips.tsx");
    const legs = read("../components/coherence/ParlayLegs.tsx");
    assert.match(ranges, /gutterFor\(rows\.map\(\(row\) => row\.name\)/);
    assert.match(legs, /gutterFor\(rows\.map\(\(row\) => row\.ticker\)/);
    assert.match(legs, /truncateMiddle\(row\.ticker/);
  });
});

describe("the grey is gone at the token", () => {
  const sheet = read("../app/globals/10e-coherence-combos.css").replace(/\/\*[\s\S]*?\*\//g, " ");

  it("the band track is a hairline, not a filled slab", () => {
    const rule = sheet.match(/\.coh-combo__track \{([^}]*)\}/);
    assert.ok(rule, ".coh-combo__track is gone");
    assert.match(rule[1], /fill: none/, "the track is still filled");
    assert.match(rule[1], /stroke:/, "the track has no edge, so it is invisible rather than quiet");
    assert.doesNotMatch(rule[1], /var\(--surface-2\)/);
  });

  it("the formula is a left-ruled aside rather than a code slab", () => {
    const rule = sheet.match(/\.coh-combo__formula \{([^}]*)\}/);
    assert.ok(rule, ".coh-combo__formula is gone");
    assert.doesNotMatch(rule[1], /background:/, "the formula keeps its slab");
    assert.match(rule[1], /border-left:/, "the formula has no rule, so it reads as loose prose");
  });

  it("the legend is gone, class and site together, in every partial that named it", () => {
    // TWO partials named it: its own rule in 10e and a comma-list member in
    // 14q's density block. A class deleted from one and left in the other is
    // still a dead rule, and `dead-css` counts classes rather than files.
    // COMMENTS BLANKED FIRST: 10e's own note records that the class was
    // deleted and why, and a guard that reads the note as a rule would be
    // satisfied by the explanation of the absence — the shape TESTING.md
    // calls the comment shadow.
    const everyPartial = globalsCss.replace(/\/\*[\s\S]*?\*\//g, " ");
    assert.doesNotMatch(everyPartial, /coh-combo__legend/, "the legend rule outlives its site");
    for (const file of ["ParlaysView.tsx", "CombosViews.tsx"]) {
      assert.doesNotMatch(read(`../components/coherence/${file}`), /coh-combo__legend/,
        `${file} still renders the legend the name replaced`);
    }
  });

  it("declares the ticker's own type, since it is now a code element", () => {
    assert.match(sheet, /\.coh-combo__ticker \{[^}]*font-family: var\(--mono\)/);
  });
});

describe("Bands is comparative rather than a stack of repeated cards", () => {
  it("keeps the overview strip and reveals one selected exact range without a table", () => {
    const views = stripNonCode(read("../components/coherence/CombosViews.tsx"));
    const ranges = views.slice(views.indexOf("export function BandsView"), views.indexOf("export function caveatCount"));
    assert.match(ranges, /<ComboBandStrips[\s\S]*?combos=\{combos\}[\s\S]*?selectedTicker=\{selectedTicker\}/,
      "the all-parlay overview disappeared with the repeated cards");
    assert.match(ranges, /<Button[\s\S]*?aria-expanded=\{instrumentOpen\}[\s\S]*?aria-controls=\{instrumentId\}/);
    assert.match(ranges, /\{instrumentOpen \? \([\s\S]*?<FrechetInstrument combo=\{selected\} \/>/);
    assert.doesNotMatch(ranges, /BandsTable|<details|coh-combo__row|<ComboChips/,
      "the repetitive Band cards still render beside the table");
  });

  it("does not repeat the joint-bound equation above every parlay subtab", () => {
    const pane = stripNonCode(read("../components/coherence/CombosPane.tsx"));
    assert.doesNotMatch(pane, /FrechetEquation|coh-combo__formula/);
  });
});

describe("what the redo must not lose", () => {
  const view = read("../components/coherence/ParlaysView.tsx");
  it("keeps Test quote focused and leaves comparison measurements in Ranges", () => {
    const quote = view.slice(view.indexOf("export function ParlaysView"), view.indexOf("export function ParlayInputsView"));
    const ranges = read("../components/coherence/CombosViews.tsx");
    const instrument = read("../components/coherence/FrechetInstrument.tsx");
    assert.match(quote, /<ParlayPicker/);
    assert.match(quote, /<ParlaySimulator/);
    assert.doesNotMatch(quote, /<table/);
    assert.match(ranges, /<ComboBandStrips[\s\S]*?<FrechetInstrument combo=\{selected\} \/>/);
    for (const heading of ["Lower", "Upper", "Quote", "Leg product Πpᵢ"]) {
      assert.match(instrument, new RegExp(`>${heading}<`));
    }
  });
  it("keeps every named parlay reachable while rendering one detailed audit at a time", () => {
    const source = stripNonCode(view);
    assert.match(source, /function ParlayDetailsView/);
    assert.match(source, /combos\.map\(\(combo\) => \(\s*<Button/);
    assert.match(source, /<ComboCard combo=\{selected\} \/>/);
    assert.doesNotMatch(source, /combos\.map\(\(combo\) => \(\s*<details/);
  });

  it("keeps gateway and fallback provenance inside the compact context disclosure", () => {
    const pane = read("../components/coherence/CombosPane.tsx");
    const ranges = read("../components/coherence/CombosViews.tsx");
    assert.match(pane, /caveatCount\(data\.combos, data\.notes \?\? \[\]\)/);
    assert.match(pane, /<NotesView combos=\{data\.combos\} notes=\{data\.notes \?\? \[\]\} \/>/);
    assert.match(ranges, /notes\.map\(\(note, index\) => <li key=\{`\$\{index\}-\$\{note\}`\}>\{note\}<\/li>\)/);
  });
});
