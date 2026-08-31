/**
 * Focused contract for the targeted Proofs instrument pass.
 *
 * These assertions deliberately stop at the named views. The rest of the
 * Proofs drawing inventory is guarded by its existing view/figure tests and
 * is not part of this slice.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

const murphy = read("../components/coherence/MurphyBars.tsx");
const murphyInstrument = read("../components/coherence/MurphyScoreInstrument.tsx");
const murphyTermTable = read("../components/coherence/MurphyTermTable.tsx");
const parlays = read("../components/coherence/ParlaysView.tsx");
const combosPane = read("../components/coherence/CombosPane.tsx");
const bounds = read("../components/coherence/CombosBounds.tsx");
const bands = read("../components/coherence/FrechetInstrument.tsx");
const basket = read("../components/coherence/PortfolioPane.tsx");
const basketNull = read("../components/coherence/BasketNullInstrument.tsx");
const indexSeries = read("../components/coherence/IndexSeriesChart.tsx");
const measurability = read("../components/coherence/MeasurabilityStrip.tsx");
const indexFamilies = read("../components/coherence/IndexFamilies.tsx");
const ridge = read("../components/coherence/FamilyRidge.tsx");
const layout = read("../components/coherence/ProofsTargetInstruments.module.css");
const basketLayout = read("../components/coherence/BasketInstruments.module.css");
const inspectionLayout = read("../app/globals/14zzc-quant-inspection.css");
const inspectionPair = read("../components/coherence/QuantInspectionPair.tsx");
const stableSelection = read("../components/coherence/use-stable-selection-key.ts");

describe("Scorecard Score is an exact selectable decomposition", () => {
  it("links the Equation waterfall to a compact five-box identity", () => {
    assert.match(murphy, /<MurphyScoreInstrument/);
    assert.match(murphy, /useState/);
    assert.match(murphy, /data-selected=/);
    assert.match(murphyInstrument, /from "@\/components\/ui\/button"/);
    assert.match(murphyInstrument, /Reliability − Resolution \+ Uncertainty \+ Binning = Brier/);
    assert.match(murphyInstrument, /const operators = \["", "−", "\+", "\+", "="\] as const/);
    assert.match(murphyInstrument, /readings\.map\(\(reading, index\) => \(/);
  });

  it("supports pointer, focus and explicit keyboard activation without hiding values", () => {
    for (const event of ["onPointerEnter", "onFocus", "onClick"]) {
      assert.match(murphyInstrument, new RegExp(event), `${event} is missing from the score term selector`);
    }
    assert.match(murphyInstrument, /aria-pressed/);
    assert.match(murphyInstrument, /aria-live="polite"/);
    assert.match(layout, /font-family:\s*var\(--mono\)/);
    assert.match(layout, /font-variant-numeric:\s*tabular-nums/);
  });

  it("lets the Brier total reveal the whole rail and a component reveal its route", () => {
    assert.match(murphyInstrument, /const wholeEquation = active\?\.key === "brier"/);
    assert.match(murphyInstrument, /data-active=\{wholeEquation \|\| index === activeIndex \|\| index === readings\.length - 1\}/);
    assert.match(murphyInstrument, /data-related=\{wholeEquation \|\| active\?\.key === reading\.key \|\| reading\.key === "brier"\}/);
    assert.match(layout, /\.equationOperator\[data-active="true"\]/);
    assert.match(layout, /\.termButton\[data-related="true"\]/);
  });

  it("formats the term glossary as a named accessible comparison table", () => {
    assert.match(murphy, /<MurphyTermTable terms=\{terms\} places=\{places\} \/>/);
    assert.match(murphyTermTable, /className="table-wrap coh-calib__terms-wrap"/);
    assert.match(murphyTermTable, /role="region"/);
    assert.match(murphyTermTable, /aria-label="Murphy decomposition term definitions"/);
    assert.match(murphyTermTable, /tabIndex=\{0\}/);
    assert.match(murphyTermTable, /<table className="coh-table coh-calib__terms">/);
    for (const field of ["term.sign", "term.name", "term.raw", "term.direction", "term.meaning"]) {
      assert.match(murphyTermTable, new RegExp(field.replace(".", "\\.")));
    }
  });
});

describe("the targeted Parlays views expose exact interactive mathematics", () => {
  it("keeps Bands' fixed-domain Frechet inspector interactive", () => {
    assert.match(bands, /aria-pressed/);
    assert.match(bands, /onPointerEnter/);
    assert.match(bands, /onFocus/);
    assert.match(bands, /aria-live="polite"/);
    assert.match(bands, /aria-atomic="true"/);
  });

  it("links the compact parlay picker to one local quote simulator", () => {
    assert.match(combosPane, /useStableSelectionKey/);
    assert.doesNotMatch(parlays, /useStableSelectionKey/);
    assert.match(stableSelection, /keys\.includes\(requested\)/);
    assert.match(parlays, /<ParlaySimulator combo=\{selected\} mode="quote"/);
    assert.match(parlays, /from "@\/components\/ui\/button"/);
    assert.match(parlays, /aria-pressed/);
    assert.match(parlays, /function ParlayPicker[\s\S]*?onClick=\{\(\) => onSelectTicker\(combo\.ticker\)\}/);
    assert.doesNotMatch(parlays, /onPointerEnter|onFocus/,
      "the compact picker changes the experiment merely because a pointer or focus passes over it");
  });

  it("makes every Bounds dumbbell one selectable exact row", () => {
    assert.match(bounds, /useStableSelectionKey\([\s\S]*?shown\.map\(rowKey\),[\s\S]*?preferred \? rowKey\(preferred\) : null/);
    assert.match(bounds, /<Plot[\s\S]*height=\{height\}[\s\S]*onSelect=\{\(index\) => onSelect\(cells\[index\]\?\.key \?\? null\)\}/);
    assert.match(bounds, /onPointerEnter=\{\(\) => onSelect\(cell\.key\)\}/);
    assert.match(bounds, /data-selected=/);
    assert.match(bounds, /aria-live="polite"/);
    assert.match(bounds, /bound.*cost.*slack/is);
  });
});

describe("Basket and Size draw their truthful zero-leg lifecycle", () => {
  it("replaces both weak empty frames without touching the populated instruments", () => {
    assert.match(basket, /<BasketNullInstrument variant="basket"/);
    assert.match(basket, /<BasketNullInstrument variant="size"/);
    assert.match(basket, /<LinkedX>/, "the populated Basket linked figures were removed");
    assert.match(basket, /<BasketFootprint/, "the populated Size instrument was removed");
  });

  it("keeps null facts null while providing pointer and keyboard exact values", () => {
    assert.match(basketNull, /<Figure/);
    assert.match(basketNull, /className=\{styles\.dependencyRail\}/);
    assert.match(basketNull, /className=\{styles\.dependencyGauge\}/);
    assert.match(basketNull, /className=\{styles\.dependencyInspector\}/);
    assert.match(basketNull, /role="tablist"/);
    assert.match(basketNull, /role="tab"/);
    assert.match(basketNull, /aria-selected=\{selected === index\}/);
    assert.match(basketNull, /tabIndex=\{selected === index \? 0 : -1\}/,
      "the lifecycle puts every stage in the page tab order instead of roving one stop");
    assert.match(basketNull, /aria-controls=\{`\$\{circuitId\}-detail`\}/);
    assert.match(basketNull, /role="tabpanel"/);
    assert.match(basketNull, /aria-labelledby=\{`\$\{circuitId\}-stage-\$\{selected\}`\}/);
    for (const event of ["onPointerEnter", "onFocus", "onClick", "onKeyDown"]) {
      assert.match(basketNull, new RegExp(event), `${event} does not select a lifecycle stage`);
    }
    for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"]) {
      assert.match(basketNull, new RegExp(`${key}:`), `${key} is missing from the lifecycle keyboard map`);
    }
    assert.match(basketNull, /data-selected-detail=""/);
    assert.match(basketNull, /aria-live="polite"/);
    assert.match(basketNull, /aria-atomic="true"/);
    assert.match(basketNull, /not evaluated|withheld/i);
    assert.doesNotMatch(basketNull, /<Plot|sharedX=/,
      "the lifecycle uses the shared conditional-height plot readout again");
    assert.doesNotMatch(stripNonCode(basketNull), /fetch\(/, "the sparse-state instrument invented a second data read");
    assert.doesNotMatch(stripNonCode(basketNull), /\?\?\s*0\b/, "a missing metric is coerced to zero");
  });
});

describe("both Coherence Index views are linked, exact, and pinnable", () => {
  it("pins one poll against another across the linked series instruments", () => {
    assert.match(indexSeries, /link:\s*"index-polls"/);
    assert.match(indexSeries, /pin:\s*true/);
    assert.match(measurability, /link,/);
    assert.match(measurability, /pin:\s*link === "index-polls"/);
    assert.match(indexSeries, /diff:/);
    assert.match(indexSeries, /signedCenticents/);
  });

  it("links the family strip and exact rows in both pointer directions", () => {
    assert.match(indexFamilies, /<QuantInspectionPair/);
    assert.match(indexFamilies, /<QuantInspectionRow/);
    assert.match(indexFamilies, /<QuantInspectionReadout/);
    assert.match(indexFamilies, /hot=\{hot\}/);
    assert.match(ridge, /pin:\s*true/, "the existing family-ridge pin was lost");
  });
});

describe("targeted instruments stay contained and visibly focusable", () => {
  it("uses bounded auto-fit tracks with no component-level horizontal scroller", () => {
    assert.match(layout, /min-inline-size:\s*0/);
    assert.match(layout, /repeat\(auto-fit,\s*minmax\(min\(100%/);
    assert.doesNotMatch(layout, /overflow-x:\s*(auto|scroll)/);
  });

  it("uses shared radius tokens and an explicit focus-visible treatment", () => {
    assert.doesNotMatch(layout, /border-radius:\s*999px/);
    assert.match(layout, /var\(--radius-/);
    assert.match(layout, /:focus-visible/);
  });

  it("keeps full lifecycle copy in a stable responsive process and detail grid", () => {
    assert.match(basketLayout, /\.dependencyRail\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--dependency-stage-count\), minmax\(0, 1fr\)\)/s);
    assert.match(basketLayout, /\.dependencyRail > li:not\(:last-child\)::after/,
      "connectors are not owned by the stages they join");
    assert.doesNotMatch(basketLayout, /\.dependencyRail::before/,
      "the rail-wide connector can drift away from its nodes");
    assert.match(basketLayout, /\.dependencyLabel :is\(strong, small\),\s*\.dependencyValue\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*normal/s,
      "stage labels and values cannot wrap without clipping");
    assert.match(basketLayout, /\.dependencyCanvas\s*\{[^}]*grid-template-columns:\s*minmax\(9rem, 0\.34fr\) minmax\(0, 1fr\)[^}]*min-height:\s*15rem/s,
      "the circuit does not reserve a stable gauge-and-inspector canvas");
    assert.match(basketLayout, /\.dependencyInspector\s*\{[^}]*min-height:\s*11rem/s,
      "the selected stage explanation can change the figure height");
    assert.match(basketLayout, /\.dependencyInspector p\s*\{[^}]*line-height:\s*1\.5/s,
      "the full dependency explanation is not readable");
    assert.match(basketLayout, /@container basket-instrument \(max-width: 52rem\)[\s\S]*?\.dependencyRail\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
      "the circuit nodes do not stack before narrow geometry can overlap");
    assert.match(basketLayout, /@container basket-instrument \(max-width: 52rem\)[\s\S]*?\.dependencyCanvas\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
      "the selected gauge and full explanation do not stack on narrow cards");
  });

  it("styles the inspection plate only after a real row is active", () => {
    assert.match(inspectionPair, /data-active=\{row \? "true" : "false"\}/);
    assert.match(inspectionLayout, /quant-inspection__readout\[data-active="true"\]/);
    assert.doesNotMatch(inspectionLayout, /quant-inspection__readout:not\(:empty\)/);
  });
});
