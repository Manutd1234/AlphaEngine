/**
 * Focused source contract for the screenshot-driven Parlays, Legs and Bounds
 * repair. Browser geometry remains owned by the all-route layout audit; this
 * suite pins the component topology and containment that make it possible.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LAYOUT_AUDIT_ROUTES } from "../scripts/engine-layout-audit.mjs";
import { VISIBLE_COPY_ROUTES } from "../scripts/visible-copy-audit.mjs";
import { readSource, stripCode } from "./helpers/source-files";

const parlays = readSource("components/coherence/ParlaysView.tsx");
const combosPane = readSource("components/coherence/CombosPane.tsx");
const legs = readSource("components/coherence/ParlayLegs.tsx");
const proofsLayout = readSource("app/globals/14zzbb-proofs-contrast.css");
const simulator = readSource("components/coherence/ParlaySimulator.tsx");
const simulatorLayout = readSource("components/coherence/ParlaySimulator.module.css");
const bounds = readSource("components/coherence/CombosBounds.tsx");
const boundsLayout = readSource("components/coherence/CombosBounds.module.css");

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing source boundary: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing source boundary: ${end}`);
  return source.slice(from, to);
}

function cssRule(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing CSS rule: ${selector}`);
  const end = source.indexOf("}", start);
  assert.notEqual(end, -1, `unclosed CSS rule: ${selector}`);
  return source.slice(start, end + 1);
}

describe("Test quote and Leg prices keep one focused job each", () => {
  it("keeps one compact picker and the quote simulator in Test quote", () => {
    const summary = between(parlays, "export function ParlaysView", "export function ParlayInputsView");
    assert.match(summary, /<ParlayPicker combos=\{combos\} selected=\{selected\}/);
    assert.match(summary, /<ParlaySimulator combo=\{selected\} mode="quote" \/>/);
    assert.doesNotMatch(summary, /<table/,
      "the quote experiment repeats the comparison table instead of staying focused");
    assert.doesNotMatch(summary, /<ParlayLegs|<ParlayLegInputs|parlayStyles\.workbench/);
  });

  it("gives the selected leg diagram and exact inputs a full-width Leg prices view", () => {
    const inputs = between(parlays, "export function ParlayInputsView", "export function ParlayDetailsView");
    assert.match(inputs, /<ParlayPicker combos=\{combos\} selected=\{selected\}/);
    assert.match(inputs, /<ParlayLegs[\s\S]*?selectedTicker=\{selected\?\.ticker \?\? null\}[\s\S]*?\/>/);
    assert.match(inputs, /<ParlayLegInputs combos=\{combos\} selectedTicker=\{selected\?\.ticker \?\? null\} \/>/);
    const legsCall = between(inputs, "<ParlayLegs", "/>");
    assert.doesNotMatch(legsCall, /onSelectTicker=/);
    assert.doesNotMatch(inputs, /workbench|ParlaySimulator/);
  });

  it("hoists one stable ticker across all four parlay-selection views", () => {
    assert.match(combosPane, /useStableSelectionKey\(\s*data\?\.combos\.map\(\(combo\) => combo\.ticker\) \?\? \[\]/);
    assert.equal((combosPane.match(/selectedTicker=\{selectedTicker\}/g) ?? []).length, 4);
    assert.equal((combosPane.match(/onSelectTicker=\{setSelectedTicker\}/g) ?? []).length, 4);
    assert.match(combosPane, /view === "inputs"[\s\S]*?<ParlayInputsView/);
    assert.doesNotMatch(parlays, /useStableSelectionKey/);
  });

  it("keeps the visible input heading outside the horizontal table scrollport", () => {
    const inputs = legs.slice(legs.indexOf("export function ParlayLegInputs"));
    const headingAt = inputs.indexOf("<header className={styles.inspectorHead}>");
    const tableAt = inputs.indexOf("className={`table-wrap ${styles.tableWrap}`}");
    assert.ok(headingAt >= 0 && tableAt > headingAt, "the inspector heading fell into the table scrollport");

    const visibleHeading = inputs.slice(headingAt, tableAt);
    assert.match(visibleHeading, /<small>Selected leg details<\/small>/);
    assert.doesNotMatch(visibleHeading, /sr-only/);
    assert.match(inputs.slice(tableAt), /<caption className="coh-table__caption sr-only">Selected parlay leg details<\/caption>/);
  });
});

describe("Legs picker labels stay inside responsive touch targets", () => {
  it("uses a contained auto-fit grid and clips only inside each local control", () => {
    const picker = cssRule(proofsLayout, ".proofs-plane .coh-parlay-picker");
    assert.match(picker, /display:\s*grid/);
    assert.match(picker, /grid-template-columns:\s*repeat\(auto-fit, minmax\(min\(100%, 14rem\), 1fr\)\)/);
    assert.match(picker, /min-inline-size:\s*0/);
    assert.match(picker, /max-inline-size:\s*100%/);
    assert.match(picker, /overflow:\s*hidden/);

    const button = cssRule(proofsLayout, ".proofs-plane .coh-parlay-picker button");
    assert.match(button, /inline-size:\s*100%/);
    assert.match(button, /min-width:\s*0/);
    assert.match(button, /min-height:\s*44px/);
    assert.match(button, /overflow:\s*hidden/);

    const label = cssRule(proofsLayout, ".proofs-plane .coh-parlay-picker__label");
    assert.match(label, /min-width:\s*0/);
    assert.match(label, /overflow:\s*hidden/);
    assert.match(label, /text-overflow:\s*ellipsis/);
  });

  it("keeps tickers in the accessible description and selected header, not the picker button face", () => {
    const picker = between(parlays, "function ParlayPicker", "export function ParlaysView");
    const button = picker.match(/<Button[\s\S]*?<\/Button>/)?.[0] ?? "";
    assert.ok(button, "missing parlay picker button");
    const openEnd = /\n\s*>\s*\n/.exec(button);
    assert.ok(openEnd, "could not locate the picker button face");
    const face = button.slice((openEnd.index ?? 0) + openEnd[0].length, button.indexOf("</Button>"));

    assert.match(face, /coh-parlay-picker__label/);
    assert.doesNotMatch(face, /combo\.ticker|<code/);
    assert.match(parlays, /return `Inspect \$\{parlayName\(combo\)\}, \$\{combo\.ticker\}`/);
    assert.match(parlays, /<code className="coh-combo__ticker">\{selected\.ticker\}<\/code>/);
  });
});

describe("Parlay diagrams are local, resettable simulations", () => {
  it("wires quote simulation in Parlays and leg simulation in Legs", () => {
    assert.match(parlays, /<ParlaySimulator combo=\{selected\} mode="quote" \/>/);
    assert.match(parlays, /<ParlaySimulator combo=\{combo\} mode="legs" \/>/);
    assert.match(simulator, /mode: "quote" \| "legs"/);
    assert.match(simulator, /key=\{parlaySimulationKey\(combo, mode\)\}/);
  });

  it("states that edits are local and restores both quote and leg state", () => {
    assert.match(simulator, /<strong>Local only\.<\/strong> Market data does not change\./);
    assert.match(simulator, /const \[quoteCc, setQuoteCc\] = useState\(source\.live\.quoteCc\)/);
    assert.match(simulator, /const \[legValues, setLegValues\] = useState\(\(\) => source\.legs\.map/);

    const reset = between(simulator, "const reset = () => {", "  };");
    assert.match(reset, /setQuoteCc\(source\.live\.quoteCc\)/);
    assert.match(reset, /setLegValues\(source\.legs\.map/);
    assert.match(simulator, /disabled=\{!changed\} onClick=\{reset\}>Reset<\/Button>/);
  });

  it("uses a native touch, pointer and keyboard range with explicit cent steps", () => {
    const control = between(simulator, "function RangeControl", "function SimulatorSession");
    assert.match(control, /type="range"/);
    assert.match(control, /origin: number/);
    assert.match(control, /const domain = centStepDomain\(origin\)/);
    assert.match(control, /min=\{domain\.minCc\}/);
    assert.match(control, /max=\{domain\.maxCc\}/);
    assert.match(control, /step=\{CENT_CC\}/);
    assert.match(control, /aria-valuetext=\{dollarText\(value\)\}/);
    assert.match(control, /onChange=\{\(event\) =>/);
    assert.match(simulator, /Each step is \$0\.01; arrow keys work\./);

    const range = cssRule(simulatorLayout, '.control input[type="range"]');
    assert.match(range, /inline-size:\s*100%/);
    assert.match(range, /min-block-size:\s*var\(--control-h\)/);
  });
});

describe("legs are measured while Bounds renders one safe read", () => {
  it("measures Test legs and drops the retired Compare route", () => {
    const legsHash = "coherence/combos/legs";
    const comparisonHash = "coherence/combos/comparison";
    assert.ok(VISIBLE_COPY_ROUTES.some((route) => route.hash === legsHash), `${legsHash} is absent from copy measurement`);
    assert.ok(LAYOUT_AUDIT_ROUTES.some((route) => route.hash === legsHash), `${legsHash} is absent from layout measurement`);
    assert.ok(!VISIBLE_COPY_ROUTES.some((route) => route.hash === comparisonHash), `${comparisonHash} remains in copy measurement`);
    assert.ok(!LAYOUT_AUDIT_ROUTES.some((route) => route.hash === comparisonHash), `${comparisonHash} remains in layout measurement`);
  });

  it("keeps the Bounds legend in wrapping HTML before the SVG plot", () => {
    const strip = between(bounds, "function SlackStrip", "function SelectedRowSummary");
    const legendAt = strip.indexOf("<ul className={styles.legend}");
    const plotAt = strip.indexOf("<Plot");
    assert.ok(legendAt >= 0 && plotAt > legendAt, "the legend returned to the SVG right gutter");
    assert.doesNotMatch(strip.slice(plotAt), /styles\.legend|aria-label="Figure legend"/);

    const legend = cssRule(boundsLayout, ".legend");
    assert.match(legend, /display:\s*flex/);
    assert.match(legend, /flex-wrap:\s*wrap/);
  });

  it("renders one selected portfolio summary instead of repeating row blocks", () => {
    const code = stripCode(bounds);
    assert.equal((code.match(/<SelectedRowSummary row=\{selected\} \/>/g) ?? []).length, 1);
    assert.equal((code.match(/function SelectedRowSummary\b/g) ?? []).length, 1);
    assert.doesNotMatch(code, /function RowBlock\b|<RowBlock\b/);
  });
});
