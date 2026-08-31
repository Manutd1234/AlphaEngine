/**
 * Parlays and Score are controlled instruments: one semantic row or term is
 * selected everywhere it appears, even when a live payload changes order.
 *
 * npm test has no DOM, so these source contracts are paired with the existing
 * Plot interaction tests that pin pointer, keyboard and live-region behavior.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";
import { parlayLegBandRole } from "../lib/coherence/parlay-leg-role";

const bandsView = read("../components/coherence/CombosViews.tsx");
const bands = read("../components/coherence/ComboBandStrips.tsx");
const parlaysView = read("../components/coherence/ParlaysView.tsx");
const combosPane = read("../components/coherence/CombosPane.tsx");
const legs = read("../components/coherence/ParlayLegs.tsx");
const bounds = read("../components/coherence/CombosBounds.tsx");
const stableSelection = read("../components/coherence/use-stable-selection-key.ts");
const murphy = read("../components/coherence/MurphyBars.tsx");
const scoreInstrument = read("../components/coherence/MurphyScoreInstrument.tsx");
const instrumentCss = read("../components/coherence/ProofsTargetInstruments.module.css");

describe("one stable parlay selection drives every representation", () => {
  it("keeps a selected key through reorder and clamps it when removed", () => {
    assert.match(stableSelection, /keys\.includes\(requested\) \? requested : first/);
    assert.match(stableSelection, /if \(requested !== selected\) setRequested\(selected\)/);
    assert.doesNotMatch(stableSelection, /selectedIndex|keys\[requested/);
  });

  it("controls the Ranges overview and exact instrument from one ticker", () => {
    assert.doesNotMatch(bandsView, /useStableSelectionKey/,
      "Ranges created a second selection instead of using the section's ticker");
    assert.equal((bandsView.match(/selectedTicker=\{selectedTicker\}/g) ?? []).length, 1);
    assert.equal((bandsView.match(/onSelectTicker=\{onSelectTicker\}/g) ?? []).length, 1);
    assert.match(bands, /onSelect=\{\(index\) => onSelectTicker\(rows\[index\]\?\.ticker \?\? null\)\}/);
    assert.match(bandsView, /const selected = combos\.find\(\(combo\) => combo\.ticker === selectedTicker\)/);
    assert.match(bandsView, /<Button[\s\S]*?aria-expanded=\{instrumentOpen\}[\s\S]*?aria-controls=\{instrumentId\}/);
    assert.match(bandsView, /\{instrumentOpen \? \([\s\S]*?<FrechetInstrument combo=\{selected\} \/>/);
    assert.doesNotMatch(bandsView, /BandsTable|BandComparisonView|<details/);
  });

  it("makes each composite Bands row one mark and one full hit target", () => {
    assert.equal((bands.match(/<title>/g) ?? []).length, 1, "Bands regressed to sub-mark arrow stops");
    assert.match(bands, /<title>\{describe\(row\)\}<\/title>/);
    assert.match(bands, /className=\{instrumentStyles\.rowHitTarget\}/);
    assert.doesNotMatch(bands, /<circle[^>]*>\s*<title>|<line[^>]*>\s*<title>/s);
  });

  it("uses the shared picker to control the selected-only leg diagram and quote instrument", () => {
    assert.match(combosPane, /useStableSelectionKey\(\s*data\?\.combos\.map\(\(combo\) => combo\.ticker\) \?\? \[\]/);
    assert.doesNotMatch(parlaysView, /useStableSelectionKey/);
    assert.match(parlaysView, /selectedTicker=\{selected\?\.ticker \?\? null\}/);
    assert.match(parlaysView, /function ParlayPicker[\s\S]*?aria-pressed=\{selected\.ticker === combo\.ticker\}/);
    assert.match(legs, /const rows = selected\?\.legs \?\? \[\]/);
    assert.doesNotMatch(legs, /onSelect=|rowHitTarget/,
      "individual leg rows became competing parlay-selection controls");
    assert.match(legs, /\{`\$\{index \+ 1\}\. MUST \$\{row\.side\.toUpperCase\(\)\}`\}/);
    assert.match(parlaysView, /<ParlaySimulator combo=\{selected\} mode="quote" \/>/);
  });

  it("assigns the upper bound to the actual minimum even when legs arrive unsorted", () => {
    const probabilities = [7_500, null, 2_300, 5_100];
    const minimum = Math.min(...probabilities.filter((value): value is number => value !== null));
    assert.deepEqual(probabilities.map((value) => parlayLegBandRole(value, minimum)), [
      "Affects minimum",
      "Unquoted; range unavailable",
      "Sets maximum; also affects minimum",
      "Affects minimum",
    ]);
  });

  it("keys Bounds selection by row identity rather than polling order", () => {
    const identity = bounds.slice(bounds.indexOf("function rowKey"), bounds.indexOf("function RowLegs"));
    assert.match(identity, /row\.scope/);
    assert.match(identity, /row\.because/);
    assert.match(identity, /row\.legs\.map/);
    assert.doesNotMatch(identity, /row\.(?:cost|slack)/, "a changing measurement resets Bounds selection");
    assert.match(bounds, /useStableSelectionKey\([\s\S]*?shown\.map\(rowKey\)/);
    assert.match(bounds, /onSelect=\{\(index\) => onSelect\(cells\[index\]\?\.key \?\? null\)\}/);
    assert.doesNotMatch(stripNonCode(bounds), /useState\(0\)|selectedIndex/);
    assert.match(bounds, /<span>\{row\.because\}<\/span>/);
  });

  it("makes each Bounds interval one labelled mark with a full-row hit target", () => {
    const strip = bounds.slice(bounds.indexOf("function SlackStrip"), bounds.indexOf("function SelectedRowSummary"));
    const row = strip.slice(strip.indexOf("{cells.map((cell, index)"), strip.indexOf("{/* `toFixed`"));
    assert.equal((row.match(/<title>/g) ?? []).length, 1, "Bounds regressed to separate sub-mark stops");
    assert.match(row, /<title>\{description\}<\/title>/);
    assert.match(row, /truncateMiddle\(cell\.label, gutter - 10, DIAGRAM_LABEL_PX\)/);
    assert.match(row, /onPointerEnter=\{\(\) => onSelect\(cell\.key\)\}/);
    assert.match(row, /x=\{0\}\s+y=\{y\}\s+width=\{width\}\s+height=\{ROW_H\}\s+className=\{styles\.rowHitTarget\}/s);
    assert.equal((row.match(/className=\{styles\.rowHitTarget\}/g) ?? []).length, 1);
    assert.doesNotMatch(row, /<circle[^>]*>\s*<title>|<line[^>]*>\s*<title>/s);
  });
});

describe("Score diagrams and labels are one controlled instrument", () => {
  it("maps both Murphy plots back to stable term keys", () => {
    assert.match(murphy, /scoreReadings\[index\]\?\.key \?\? current/);
    assert.match(murphy, /insetBars\[index\]\?\.term\.key \?\? current/);
    assert.match(murphy, /onPointerEnter=\{\(\) => setSelectedTerm\(bar\.key\)\}/);
    assert.match(murphy, /data-selected=\{bar\.key === selectedTerm\}/);
  });

  it("gives full term labels enough geometry instead of overlapping them", () => {
    assert.match(murphy, /minWidth=\{560\}[\s\S]*?scrollLabel="Murphy decomposition terms"/);
    assert.match(murphy, /minWidth=\{420\}[\s\S]*?scrollLabel="Murphy inset terms"/);
    assert.match(scoreInstrument, /<span>\{reading\.label\.replace\([\s\S]*?\)\}<\/span>/);
    assert.match(scoreInstrument, /<code>\{reading\.value\}<\/code>/);
  });

  it("connects all five desk-width boxes with explicit signed operators", () => {
    assert.match(instrumentCss, /container-name:\s*score-workbench/);
    assert.match(instrumentCss, /container-type:\s*inline-size/);
    assert.match(instrumentCss, /\.scoreInspector\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    assert.match(
      instrumentCss,
      /\.termRail\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) max-content minmax\(0, 1fr\) max-content minmax\(0, 1fr\) max-content minmax\(0, 1fr\) max-content minmax\(0, 1fr\)/s,
      "the five boxes and four operators no longer occupy one connected equation rail",
    );
    assert.match(scoreInstrument, /const operators = \["", "−", "\+", "\+", "="\] as const/);
    assert.match(scoreInstrument, /<Fragment key=\{reading\.key\}>[\s\S]*?\{index \? \([\s\S]*?className=\{styles\.equationOperator\}[\s\S]*?\{operators\[index\]\}[\s\S]*?<Button/s);
    assert.match(scoreInstrument, /data-role=\{reading\.key === "brier" \? "total" : "term"\}/);
    assert.match(instrumentCss, /@container score-workbench \(max-width: 72rem\)/);
    assert.match(instrumentCss, /@container score-workbench \(max-width: 48rem\)/);
    assert.match(instrumentCss, /@container score-workbench \(max-width: 32rem\)/);
    const termRule = instrumentCss.match(/\.termButton\s*\{([^}]*)\}/s)?.[1] ?? "";
    const labelRule = instrumentCss.match(/\.termButton span\s*\{([^}]*)\}/s)?.[1] ?? "";
    assert.match(termRule, /white-space:\s*nowrap/);
    assert.match(termRule, /overflow-wrap:\s*normal/);
    assert.match(labelRule, /white-space:\s*nowrap/);
    assert.doesNotMatch(termRule, /overflow:\s*hidden|text-overflow:\s*ellipsis/);
  });

  it("makes a selected box illuminate its equation path through Brier", () => {
    assert.match(scoreInstrument, /const wholeEquation = active\?\.key === "brier"/);
    assert.match(
      scoreInstrument,
      /data-active=\{wholeEquation \|\| index === activeIndex \|\| index === readings\.length - 1\}/,
      "operators no longer react to the selected term and its route to the total",
    );
    assert.match(
      scoreInstrument,
      /data-related=\{wholeEquation \|\| active\?\.key === reading\.key \|\| reading\.key === "brier"\}/,
      "the selected component and Brier total no longer read as one relationship",
    );
    assert.match(instrumentCss, /\.equationOperator\[data-active="true"\]/);
    assert.match(instrumentCss, /\.termButton\[data-related="true"\]/);
  });

  it("keeps the identity operator when an additive term has a negative value", () => {
    assert.match(murphy, /operator: step\.term\.sign < 0 \? "−" : "\+"/);
    assert.match(murphy, /\{`\$\{bar\.operator\} \$\{bar\.name\}`\}/);
    assert.doesNotMatch(murphy, /Signed contribution \$\{term\.sign[^\n]*\$\{cut\(term\.raw\)\}/,
      "a negative Binning value can render as the malformed operator sequence '+-'");
  });
});
