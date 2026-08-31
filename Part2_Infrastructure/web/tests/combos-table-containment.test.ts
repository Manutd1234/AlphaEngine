import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(join(import.meta.dirname, "..", path), "utf8");
const parlays = read("components/coherence/ParlaysView.tsx");
const bands = read("components/coherence/BandsTable.tsx");
const pane = read("components/coherence/CombosPane.tsx");
const bounds = read("components/coherence/CombosBounds.tsx");
const css = read("components/coherence/CombosTables.module.css");

describe("Proofs Combos tables contain their complete data locally", () => {
  it("keeps the detailed leg table contained without repeating a summary table in Test quote", () => {
    assert.match(parlays, /aria-label=\{`Parlay legs for \$\{parlayName\(combo\)\}`\}/);
    assert.equal((parlays.match(/role="region"/g) ?? []).length, 1);
    assert.equal((parlays.match(/tabIndex=\{0\}/g) ?? []).length, 1);
    for (const heading of ["Leg", "Must land", "Implied p", "Buy cost", "Opposite cost"]) {
      assert.match(parlays, new RegExp(`>${heading}<`));
    }
    const quoteView = parlays.slice(parlays.indexOf("export function ParlaysView"), parlays.indexOf("export function ParlayInputsView"));
    assert.doesNotMatch(quoteView, /<table/, "Test quote repeats data already available in Ranges");
  });

  it("keeps one folded Bounds leg table and one compact measurement summary", () => {
    assert.match(bounds, /aria-label="Selected bound portfolio legs"/);
    assert.equal((bounds.match(/role="region"/g) ?? []).length, 1);
    assert.equal((bounds.match(/tabIndex=\{0\}/g) ?? []).length, 1);
    assert.match(bounds, /<details key=\{rowKey\(row\)\}/);
    for (const heading of ["Leg", "Direction", "Side", "Cost"]) {
      assert.match(bounds, new RegExp(`>${heading}<`));
    }
    for (const fact of ["Bound", "Portfolio cost", "Slack", "Scope"]) {
      assert.match(bounds, new RegExp(`<dt>${fact}<\\/dt>`));
    }
  });

  it("contains the Bands comparison in one named, keyboard-reachable region", () => {
    assert.match(bands, /aria-label="Loaded parlays and Fréchet bounds"/);
    assert.match(bands, /className="table-wrap"[\s\S]*?role="region"[\s\S]*?tabIndex=\{0\}/);
    for (const heading of ["Parlay", "Legs", "Allowed range", "Quote", "Position"]) {
      assert.match(bands, new RegExp(`>${heading}<`));
    }
    assert.doesNotMatch(bands, />Independence<|>Band width<|>Lower bound<|>Upper bound</,
      "the compact comparison restored the columns moved into its inspector");
    assert.match(bands, /className=\{styles\.rowSelect\}[\s\S]*?aria-pressed=/,
      "the first cell is not a native keyboard-selectable row control");
  });

  it("keeps local search, state filtering and sorting separate from server ticker lookup", () => {
    assert.match(bands, /id="coh-bands-local-search"[\s\S]*?type="search"/);
    assert.match(bands, /id="coh-bands-local-state"/);
    assert.match(bands, /aria-sort=\{ariaSort\(/);
    assert.doesNotMatch(bands, /combosRoute|useCoherenceRead|fetch\(/,
      "a local table control issues its own server read");
    assert.match(pane, /combosRoute\(6, ticker\)/,
      "the existing submitted-ticker server lookup no longer owns the read");
  });

  it("uses a component-scoped horizontal scroll owner without clipping or hiding rows", () => {
    assert.match(css, /\.scrollport[\s\S]*overflow-x:\s*auto/);
    assert.match(css, /max-inline-size:\s*100%/);
    assert.match(css, /overscroll-behavior-inline:\s*contain/);
    assert.match(css, />\s*:global\(\.coh-table\)[\s\S]*min-inline-size:\s*max-content/);
    assert.doesNotMatch(css, /display:\s*none|overflow-x:\s*(?:clip|hidden)/);
  });
});
