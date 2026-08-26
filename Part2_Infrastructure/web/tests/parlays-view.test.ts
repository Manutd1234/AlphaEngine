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

  it("ParlaysView prints the name before the ticker, and the ticker inside a <code>", () => {
    const source = read("../components/coherence/ParlaysView.tsx");
    // Every RENDERED `{combo.ticker}` sits inside a `<code>` element. A
    // `key={combo.ticker}` is not rendered — React reads it and never draws
    // it — so it is skipped rather than exempted, and the skip is narrow
    // enough that a real render can never hide behind it.
    let rendered = 0;
    for (const match of source.matchAll(/\{combo\.ticker\}/g)) {
      const before = source.slice(Math.max(0, (match.index ?? 0) - 200), match.index);
      if (/key=$/.test(before)) continue;
      rendered += 1;
      assert.match(before, /<code className="coh-combo__ticker">\s*$/,
        "a bare ticker is rendered where a reader expects a name");
    }
    assert.ok(rendered >= 2, `only ${rendered} rendered tickers found — the scan has stopped seeing them`);
    // `{" "}` between them is JSX's way of keeping one space across a line
    // break, so the scan allows it — and nothing else.
    // COUNTED, not "at least one". `assert.match` is satisfied by a single
    // site, so with two — the row header and the fold summary — it passed
    // while one of them led with the ticker. Every rendered ticker must have
    // the name in front of it.
    const led = (source.match(/parlayName\(combo\)\}(\{" "\})?\s*<code className="coh-combo__ticker">/g) ?? []).length;
    assert.equal(led, rendered, `${rendered} tickers rendered but ${led} led by the name`);
  });

  it("both strips measure their gutter against the NAME they draw", () => {
    for (const file of ["ParlayLegs.tsx", "ComboBandStrips.tsx"]) {
      const source = read(`../components/coherence/${file}`);
      assert.match(source, /gutterFor\(rows\.map\(\(row\) => row\.name\)/,
        `${file} measures its gutter against a string it does not draw`);
      assert.match(source, /ticker/, `${file} has dropped the ticker entirely, so a row cannot be identified`);
    }
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

describe("what the redo must not lose", () => {
  const view = read("../components/coherence/ParlaysView.tsx");
  it("keeps the table, its caption's key and its pinned judgement", () => {
    assert.match(view, /<table className="coh-table">/);
    assert.match(view, /worst position first/);
    assert.match(view, /the only reading on this view that is a mispricing/);
  });
  it("keeps one fold per parlay, so a named parlay is reachable", () => {
    assert.match(stripNonCode(view), /combos\.map\(\(combo\) => \(\s*<details/);
  });
});
