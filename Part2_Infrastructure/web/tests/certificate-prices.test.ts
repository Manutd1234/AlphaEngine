/**
 * The Coherence test's third view: the prices the test is about.
 *
 * Ian, on the Verdict view: "we want the 'Both sides of every leg, on one
 * dollar axis, sized by open interest' diagram in another tab". It was drawn
 * BELOW the verdict — a figure about prices under an answer about prices,
 * where a reader arrived at the conclusion first and the evidence after
 * scrolling. It is a view of its own now, and it gained the companion that
 * makes it worth its own view: the same legs on the same strike axis, sized
 * three ways.
 *
 * WHY THE SIZES ARE A SECOND FIGURE AND NOT A SECOND ENCODING. The payload
 * carries four size fields per leg and its own type says they "disagree with
 * each other, legitimately" — a market reporting zero liquidity while carrying
 * open interest and traded volume. A mark encoding two of them is a mark that
 * can be read wrong in one direction, so `LadderPrices` keeps open interest as
 * its area and `LegSizes` draws all three as small multiples under it, each
 * normalised to its own maximum because they are not the same unit.
 *
 * STACKED, NEVER PAIRED. Two figures sharing an x extent must share a width:
 * side by side, a strike would sit at two different pixels and the eye would
 * read the pair as two families.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

const pane = read("../components/coherence/CertificatePane.tsx");
const views = read("../components/coherence/CertificateViews.tsx");
const ladder = read("../components/coherence/LadderPrices.tsx");
const sizes = read("../components/coherence/LegSizes.tsx");
const sectionViews = read("../lib/section-views.ts");

describe("the prices leave the verdict", () => {
  it("the pane declares three views and renders the ladder in none of them", () => {
    assert.match(pane, /type CertificateView = "verdict" \| "proof" \| "prices";/,
      "the third view is not declared");
    assert.match(pane, /\["prices", "Prices"\]/, "the switcher has no Prices button");
    assert.doesNotMatch(stripNonCode(pane), /<LadderPrices/,
      "the ladder is still drawn by the pane, so it still rides under the verdict");
  });

  it("the view is gated on a family and draws nothing without one", () => {
    // RAW: `stripNonCode` blanks string literals, so `"prices"` reads as `""`
    // and this would pass over a gate on any view at all.
    assert.match(pane, /view === "prices" && chosen \? <PricesView event=\{chosen\} \/> : null/,
      "the Prices view is ungated, or takes something other than the chosen family");
  });

  it("section-views declares it, so it has a URL, a palette entry and a sweep cell", () => {
    assert.match(sectionViews, /certificate: \[\["verdict", "Verdict"\], \["proof", "Proof"\], \["prices", "Prices"\]\]/,
      "the view table does not carry Prices");
  });
});

describe("the two figures share one strike axis", () => {
  it("PricesView draws the ladder first and the sizes under it, stacked in one column", () => {
    const at = views.indexOf("export function PricesView(");
    assert.ok(at !== -1, "PricesView does not exist");
    const body = views.slice(at);
    const ladderAt = body.indexOf("<LadderPrices");
    const sizesAt = body.indexOf("<LegSizes");
    assert.ok(ladderAt !== -1 && sizesAt !== -1, "the view is missing one of its two figures");
    assert.ok(ladderAt < sizesAt, "the sizes are drawn above the prices they are the sizes of");
    // A one-column grid: the two share an x extent, so they must share a width.
    assert.doesNotMatch(body.slice(0, sizesAt), /coh-grid--2|coh-grid--aside/,
      "the pair is drawn side by side, so a strike sits at two different pixels");
  });

  it("both place their legs through the one module, and neither keeps its own copy", () => {
    for (const [name, source] of [["LadderPrices", ladder], ["LegSizes", sizes]] as const) {
      assert.match(source, /from "@\/lib\/coherence\/strike-axis"/, `${name} does not use the shared axis`);
      assert.doesNotMatch(stripNonCode(source), /function strikeOf\(/,
        `${name} keeps its own copy of the placement rule`);
    }
  });
});

describe("LegSizes says what it cannot measure", () => {
  it("never coerces an absent field to zero", () => {
    assert.doesNotMatch(stripNonCode(sizes), /\?\? 0\b|\|\| 0\b/,
      "a field the venue stopped sending is drawn as a size of zero");
  });

  it("marks an unreported field apart from a reported zero, and says which is which", () => {
    assert.match(sizes, /is-null/, "an unreported field is not drawn differently from a measured zero");
    assert.match(sizes, /protocol change/,
      "the reason an unreported field is not an empty market is nowhere in the figure");
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

  it("is one mark per leg, so a reader walks legs rather than cells", () => {
    const code = stripNonCode(sizes);
    assert.equal((code.match(/<title>/g) ?? []).length, 1,
      "a title per cell makes one leg three stops on the keyboard");
  });
});
