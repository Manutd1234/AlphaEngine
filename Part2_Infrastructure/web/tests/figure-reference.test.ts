/**
 * A figure with a reference paints it first, and says so in the caption.
 *
 * Every figure on this desk that actually convinces has a line the reader can
 * check the marks against — `EdgeScatter`'s diagonal, the tape's window mean,
 * the Murphy bars' base rate. It turns "no outcome is admitted" from an
 * assertion into a picture. Three figures drew one by hand and each drew it
 * differently, and nothing stopped a fourth drawing it OVER the marks, where
 * it stops being checkable and starts being decoration.
 *
 * So the reference is a prop on `Plot` now, and two things are structural
 * rather than remembered: it is painted before the marks, and it carries a
 * word as well as a stroke. The first is document order — an SVG paints in
 * source order, so "under" means "earlier", and a source scan can hold that
 * where no DOM-less suite could hold a pixel. The second is the house rule
 * that nothing means anything by colour alone; a hairline is colour-only
 * meaning until it has a label.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

const figure = read("../components/coherence/Figure.tsx");
const code = stripNonCode(figure);
// The line itself lives with the other two overlays since the split; the
// plot's paint ORDER stays in Figure.tsx, so each assertion reads the file
// its subject is actually in.
const overlays = read("../components/coherence/plot-overlays.tsx");
const overlayCode = stripNonCode(overlays);

describe("the source these assertions read was actually loaded", () => {
  it("Figure.tsx is non-empty", () => assert.ok(figure.trim().length > 1000));
  it("plot-overlays.tsx is non-empty", () => assert.ok(overlays.trim().length > 800));
});

describe("the reference is the plot's, not each figure's", () => {
  it("Plot accepts one", () => {
    // A value OR a function of the measured width — the tape needs the second,
    // because the axis its reference spans is one the figure lays out from a
    // label gutter it cannot size until measured. Same reason `sharedX` is a
    // function.
    assert.match(figure, /reference\?: PlotReference \| \(\(width: number\) => PlotReference \| null\) \| null/,
      "Plot no longer takes a reference, so every figure draws its own and one will draw it over the marks");
  });

  it("paints it before the children, in document order", () => {
    // An SVG paints in source order, so "under the marks" means "earlier in
    // the source". Nothing can occlude what is painted first.
    const ref = code.indexOf("<ReferenceLine");
    const kids = code.indexOf("{children(width)}");
    assert.ok(ref !== -1, "the reference is not rendered at all");
    assert.ok(kids !== -1, "the plot no longer renders its children where this looks");
    assert.ok(ref < kids, "the reference is painted AFTER the marks, where they can hide it");
  });

  it("carries a word as well as a stroke", () => {
    // Colour-only meaning is banned; a bare hairline is exactly that until it
    // is labelled. The label is rendered as SVG text beside the line, and the
    // pair is one mark to the readout, so a keyboard reader arrives on it too.
    const at = overlayCode.indexOf("function ReferenceLine");
    assert.ok(at !== -1, "ReferenceLine is not in plot-overlays.tsx");
    const block = overlayCode.slice(at, at + 600);
    assert.match(block, /<text/, "the reference has no label, so it means something by colour alone");
    assert.match(block, /<title>/, "the reference is not a mark, so the readout cannot say what it is");
  });

  it("survives forced colours as a stroke", () => {
    // The forced-colors block in the trailing partial catches `svg line[stroke]`;
    // a reference drawn as a fill or a CSS-only stroke would vanish in Windows
    // High Contrast, and it is the one line on the figure that must not.
    const at = overlayCode.indexOf("function ReferenceLine");
    assert.ok(at !== -1, "ReferenceLine is not in plot-overlays.tsx");
    const block = overlayCode.slice(at);
    assert.match(block.slice(0, 1200), /<line[^>]*\bstroke=/, "the reference line has no stroke attribute, so the forced-colors rule cannot reach it");
  });
});
