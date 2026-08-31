/**
 * The Coherence test's Prices and Sizes views: the market inputs to the test.
 *
 * Ian, on the Verdict view: "we want the 'Both sides of every leg, on one
 * dollar axis, sized by open interest' diagram in another tab". It was drawn
 * BELOW the verdict — a figure about prices under an answer about prices,
 * where a reader arrived at the conclusion first and the evidence after
 * scrolling. It is a view of its own now, and it gained the companion that
 * makes it worth its own view: the same ordered outcomes, sized three ways.
 *
 * WHY THE SIZES ARE A SECOND FIGURE AND NOT A SECOND ENCODING. The payload
 * carries size fields that "disagree with each other, legitimately" — a market
 * may report zero liquidity while carrying open interest and traded volume.
 * `LegSizes` therefore plots one selected unit at a time and keeps all three
 * exact values in the inspector and ledger.
 *
 * SPLIT, NEVER PAIRED. The quote tracks and size meters use different units,
 * but preserve one outcome order and one full-width reading path. Separate
 * addressable views remove the long stack without adding plot state.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

const pane = read("../components/coherence/CertificatePane.tsx");
const views = read("../components/coherence/CertificateViews.tsx");
const ladder = read("../components/coherence/LadderPrices.tsx");
const sizes = read("../components/coherence/LegSizes.tsx");
const priceCss = [
  read("../components/coherence/CertificatePrices.module.css"),
  read("../components/coherence/CertificateSizes.module.css"),
].join("\n");
const table = read("../components/ui/table.tsx");
const sectionViews = read("../lib/section-views.ts");

describe("the prices leave the verdict", () => {
  it("the pane declares five views and renders the ladder in none of them", () => {
    assert.match(pane, /type CertificateView = "verdict" \| "proof" \| "checks" \| "prices" \| "sizes";/,
      "the five certificate views are not declared");
    assert.match(pane, /\["prices", "Prices"\]/, "the switcher has no Prices button");
    assert.match(pane, /\["sizes", "Sizes"\]/, "the switcher has no Sizes button");
    assert.doesNotMatch(stripNonCode(pane), /<LadderPrices/,
      "the ladder is still drawn by the pane, so it still rides under the verdict");
  });

  it("both views are gated on a current family and explain when it disappears", () => {
    // RAW: `stripNonCode` blanks string literals, so `"prices"` reads as `""`
    // and this would pass over a gate on any view at all.
    assert.match(pane, /view === "prices" && chosen \? <PricesView event=\{chosen\} \/> : null/,
      "the Prices view is ungated, or takes something other than the chosen family");
    assert.match(pane, /view === "sizes" && chosen \? <SizesView event=\{chosen\} \/> : null/,
      "the Sizes view is ungated, or takes something other than the chosen family");
    assert.match(pane, /\(view === "prices" \|\| view === "sizes"\) && !chosen[\s\S]*?selected family is no longer in the current quote roster/,
      "a stale family selection leaves a blank Prices or Sizes tab");
  });

  it("section-views declares both, so each has a URL, palette entry and sweep cell", () => {
    assert.match(sectionViews, /certificate: \[[\s\S]*?\["prices", "Prices"\][\s\S]*?\["sizes", "Sizes"\][\s\S]*?\],/,
      "the view table does not carry Prices and Sizes");
  });
});

describe("the two figures keep one stable interactive outcome flow", () => {
  it("gives quotes and sizes one figure and one addressable view each", () => {
    const pricesAt = views.indexOf("export function PricesView(");
    const sizesAt = views.indexOf("export function SizesView(");
    assert.ok(pricesAt !== -1 && sizesAt > pricesAt, "the two views do not exist in order");
    const pricesBody = views.slice(pricesAt, sizesAt);
    const sizesBody = views.slice(sizesAt);
    assert.match(pricesBody, /<LadderPrices/, "Prices no longer draws the quote ladder");
    assert.doesNotMatch(pricesBody, /<LegSizes/, "Prices still stacks the size figure below quotes");
    assert.match(sizesBody, /<LegSizes/, "Sizes no longer draws the size ribbons");
    assert.doesNotMatch(sizesBody, /<LadderPrices/, "Sizes duplicates the quote ladder");
    assert.doesNotMatch(`${pricesBody}\n${sizesBody}`, /<LinkedX>/,
      "independent quote and size views should not retain a cross-view hover wrapper");
  });

  it("both place their legs through the one module, and neither keeps its own copy", () => {
    for (const [name, source] of [["LadderPrices", ladder], ["LegSizes", sizes]] as const) {
      assert.match(source, /from "@\/lib\/coherence\/strike-axis"/, `${name} does not use the shared axis`);
      assert.doesNotMatch(stripNonCode(source), /function strikeOf\(/,
        `${name} keeps its own copy of the placement rule`);
    }
  });

  it("makes each curve keyboard/pointer inspectable while keeping an exact ledger", () => {
    for (const [name, source] of [["LadderPrices", ladder], ["LegSizes", sizes]] as const) {
      assert.match(source, /<Plot\b/, `${name} has no streamlined curve`);
      assert.match(source, /sharedX=\{\(width\) => \(\{/,
        `${name} does not expose the ordered outcomes to the shared inspector`);
      assert.match(source, /pin: true/,
        `${name} does not let keyboard or pointer readers pin one exact outcome`);
      assert.match(source, /<details className=\{`quant-inspection__table/,
        `${name} has no persistent exact ledger beside its plot`);
      assert.match(source, /<Table scrollLabel=\{/,
        `${name}'s exact ledger is not a labelled keyboard region`);
    }
    assert.match(ladder, /rows:\s*\[[\s\S]*?label: "YES bid"[\s\S]*?label: "YES ask"[\s\S]*?label: "Spread"/,
      "the quote inspector lost bid, ask or spread");
    assert.match(sizes, /\.\.\.scales\.map\(\(scale\) => \(\{[\s\S]*?value: exactMetricValue/,
      "the size inspector does not preserve all three exact measures");
  });
});

describe("LegSizes says what it cannot measure", () => {
  it("never coerces an absent field to zero", () => {
    assert.doesNotMatch(stripNonCode(sizes), /\?\? 0\b|\|\| 0\b/,
      "a field the venue stopped sending is drawn as a size of zero");
  });

  it("marks an unreported field apart from a reported zero, and says which is which", () => {
    assert.match(sizes, /return raw === null \? "Not reported"/,
      "an absent protocol field is not named as unreported");
    assert.match(sizes, /A reported zero sits on the baseline with a visible point\. A protocol absence breaks the curve/,
      "the figure does not explain the zero-versus-absence distinction");
    assert.match(sizes, /r=\{value === 0 \? 5 : 4\.5\}[\s\S]*?data-zero=\{value === 0 \? "true" : undefined\}/,
      "a reported zero has no explicit baseline mark");
    assert.match(priceCss, /\.point\[data-zero="true"\]\s*\{[^}]*fill:\s*var\(--series-1\);[^}]*stroke:\s*var\(--surface-1\)/s,
      "a reported zero has no non-colour mark distinction");
    assert.match(sizes, /if \(value === null\) \{\s*drawing = false;/,
      "an absent value does not break the curve");
  });

  it("withholds the family's own totals rather than summing the legs that answered", () => {
    // The payload withholds `open_interest_total` when ONE leg carries no
    // figure, because a sum over the legs that answered understates the family
    // by exactly the legs it skipped. The figure must not rebuild it.
    assert.match(sizes, /open_interest_total/, "the figure does not read the family's own total");
    assert.match(sizes, /withheld/, "a withheld total is not named as withheld");
    assert.doesNotMatch(stripNonCode(sizes), /reduce\(\(sum/,
      "the figure sums the legs it can read and prints that as the family's size");
  });

  it("draws every ribbon under its own name, never by colour alone", () => {
    for (const word of ["open interest", "traded", "resting"]) {
      assert.match(sizes, new RegExp(word), `the ${word} ribbon carries no word`);
    }
  });

  it("keeps the three units separate and exact on every outcome", () => {
    assert.match(sizes, /const METRICS:[\s\S]*?open-interest[\s\S]*?volume[\s\S]*?liquidity/,
      "the three independent measures are not declared together");
    assert.match(sizes, /role="group" aria-label="Size measure"/,
      "the three units have no explicit metric selector");
    assert.match(sizes, /aria-pressed=\{scale\.metric\.key === metricKey\}/,
      "the active unit is not announced");
    assert.match(sizes, /onClick=\{\(\) => setMetricKey\(scale\.metric\.key\)\}/,
      "the metric selector cannot switch the plotted unit");
    assert.match(sizes, /scales\.map\(\(scale\) => \([\s\S]*?exactMetricValue\(scale\.metric, scale\.rawValues\[index\]\)/,
      "the exact ledger does not print every measure from its wire value");
    assert.match(sizes, /contracts outstanding/);
    assert.match(sizes, /contracts traded/);
    assert.match(sizes, /dollars resting now/);
  });

  it("keeps every bounded native region keyboard reachable, including short mobile families", () => {
    for (const [name, source] of [["LadderPrices", ladder], ["LegSizes", sizes]] as const) {
      assert.match(source, /<Table scrollLabel=\{/,
        `${name} does not opt its exact ledger into the shared keyboard scroll region`);
    }
    assert.match(table, /role=\{scrollLabel \? "region" : undefined\}/);
    assert.match(table, /tabIndex=\{scrollLabel \? 0 : undefined\}/);
    assert.match(table, /aria-label=\{scrollLabel\}/);
    assert.doesNotMatch(priceCss, /overflow-x:\s*(?:auto|scroll)/,
      "the figure CSS adds a competing horizontal scroll owner beside the shared table region");
  });
});

describe("the quote view keeps exact and missing evidence honest", () => {
  it("prints exact quote fields and never draws an absent side at zero", () => {
    for (const field of ["YES bid", "YES ask", "Spread", "Open interest (contracts)", "Volume (contracts)", "Liquidity (dollars)"]) {
      assert.match(ladder, new RegExp(field.replace(/[()]/g, "\\$&")), `${field} is absent from the exact ledger`);
    }
    assert.match(ladder, /raw === null\) return "Unquoted"/);
    assert.match(ladder, /row\.market\.spread \?\? "Not measurable"/);
    assert.doesNotMatch(stripNonCode(ladder), /\?\? 0\b|\|\| 0\b/,
      "a missing quote or size is coerced to zero");
    assert.match(ladder, /<Table scrollLabel=\{exactLegLabel\}>/,
      "the exact quote ledger is not reachable as a labelled table");
  });
});
