/**
 * A figure a reader can choose from hands its section an index, and the
 * section turns that into the thing it means.
 *
 * `Plot`'s `onSelect` shipped with zero callers on the whole desk. This file
 * holds the rule for every caller it gains: a selection figure builds ONE
 * array in document order and maps it, so the index the hook hands out is an
 * index into that array and nothing else; the handler is passed only when the
 * section gave one (an always-passed `onSelect` makes every strip
 * `is-selectable` with a click that does nothing); the section announces the
 * choice through a live region OUTSIDE any `role="img"`, and never at mount.
 *
 * DERIVED, NEVER OBSERVED (CLAUDE.md, fact 6): whether Enter speaks the two
 * sentences in the right order is the harness's to hear.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

const chosen = read("../lib/coherence/use-chosen.tsx");
const interaction = read("../app/globals/10n-engine-interaction.css").replace(/\/\*[\s\S]*?\*\//g, " ");
const forced = read("../app/globals/15-navigator-and-trailing-layer.css");

interface Source {
  file: string;
  /** The array the marks are mapped from, in document order. */
  array: string;
  /** The section that turns the index into an entity. */
  holder: string;
}

const SOURCES: Source[] = [
  // L3: a share bar chooses its composition row.
  { file: "CorpusShares.tsx", array: "rows", holder: "CalibrationCorpus.tsx" },
];

describe("the chosen primitive", () => {
  it("announces through a live region of its own, empty at mount", () => {
    assert.match(chosen, /export function useChosen</);
    assert.match(chosen, /export function ChosenStatus\(/);
    assert.match(chosen, /className="coh-plot__live" role="status" aria-live="polite"/);
    assert.match(stripNonCode(chosen), /useState\(""\)/, "the region has words at mount");
  });
});

describe("every selection source", () => {
  for (const row of SOURCES) {
    describe(row.file, () => {
      const source = read(`../components/coherence/${row.file}`);
      const code = stripNonCode(source);

      it("passes the handler through only when the section gave one", () => {
        const escaped = row.array.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        assert.match(code, new RegExp(`onSelect=\\{onSelect \\? \\(index\\) => onSelect\\(${escaped}\\[index\\]\\) : undefined\\}`),
          "the handler is always passed, or indexes something other than the mapped array");
      });

      it("maps one titled mark per entry and draws no title before the map", () => {
        const plot = code.indexOf("<Plot");
        const map = code.indexOf(`${row.array}.map((`, plot);
        assert.ok(plot !== -1 && map !== -1, "the plot or the map is gone");
        assert.doesNotMatch(code.slice(plot, map), /<title>/, "a title before the map shifts every index by one");
      });

      it("binds no click or key handler of its own — the plot's are the instrument", () => {
        assert.doesNotMatch(code, /onKeyDown=|onClick=/);
      });
    });
  }

  it("counts the sources it has", () => {
    assert.equal(SOURCES.length, 1);
  });
});

describe("the sites that choose", () => {
  for (const row of SOURCES) {
    it(`${row.holder} chooses through the primitive, above its first early return, and announces beside the pair`, () => {
      const holder = read(`../components/coherence/${row.holder}`);
      const code = stripNonCode(holder);
      const hook = code.indexOf("useChosen<");
      const firstIf = code.search(/^  if \(/m);
      assert.ok(hook !== -1, `${row.holder} does not use useChosen`);
      assert.ok(firstIf === -1 || hook < firstIf, "useChosen sits below a conditional return");
      assert.match(code, /<ChosenStatus announced=\{announced\} \/>/, "the choice is never announced");
      assert.match(code, /tabIndex=\{-1\}/, "the chosen target cannot take focus");
      assert.match(holder, /is-chosen/, "the chosen target is not marked");
      assert.match(code, /requestAnimationFrame\(/, "focus is moved during render, or never");
    });
  }
});

describe("one CSS home for chosen and hot", () => {
  it("draws the chosen row on its header cell, never on the tr", () => {
    // A box-shadow on a `<tr>` under `border-collapse` paints unreliably
    // outside Chrome; the header cell is a box in every engine.
    assert.match(interaction, /\.coherence-plane \.coh-table tr\.is-chosen > th\[scope="row"\] \{[^}]*box-shadow: inset 3px 0 0 var\(--text-primary\)/);
    assert.match(interaction, /\.coherence-plane \.coh-table tr\.is-hot > th\[scope="row"\] \{[^}]*box-shadow: inset 2px 0 0 var\(--text-secondary\)/);
    assert.doesNotMatch(interaction, /tr\.is-chosen \{|tr\.is-hot \{/, "a shadow on the tr itself");
  });
  it("gives the chosen row an outline in High Contrast", () => {
    assert.match(forced, /\.coherence-plane \.coh-table tr\.is-chosen > th/, "the chosen row is invisible under forced colours");
  });
});
