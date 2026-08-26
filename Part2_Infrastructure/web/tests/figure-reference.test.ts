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
    // The WORD is the exception, since 2026-08-26: painted after the children,
    // because a label under 339 bars is a label struck through. The line
    // stays first; the two are separate elements so each can be in its place.
    const word = code.indexOf("<ReferenceLabel");
    assert.ok(word !== -1, "the reference's word is no longer rendered separately, so it is back under the marks");
    assert.ok(word > kids, "the reference's label is painted BEFORE the marks again, where a dense figure strikes through it");
  });

  it("carries a word as well as a stroke", () => {
    // Colour-only meaning is banned; a bare hairline is exactly that until it
    // is labelled. The label is rendered as SVG text beside the line, and the
    // pair is one mark to the readout, so a keyboard reader arrives on it too.
    const at = overlayCode.indexOf("function ReferenceLine");
    assert.ok(at !== -1, "ReferenceLine is not in plot-overlays.tsx");
    const line = overlayCode.slice(at, at + 600);
    assert.match(line, /<title>/, "the reference is not a mark, so the readout cannot say what it is");
    const wordAt = overlayCode.indexOf("function ReferenceLabel");
    assert.ok(wordAt !== -1, "ReferenceLabel is not in plot-overlays.tsx, so the word is under the marks again");
    const word = overlayCode.slice(wordAt, wordAt + 600);
    assert.match(word, /<text/, "the reference has no label, so it means something by colour alone");
    // One title between them: the line is the mark. A second would make one
    // reference two stops for a keyboard reader.
    assert.doesNotMatch(word, /<title>/, "the label carries a title of its own, so the reference is two marks");
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

describe("a reference may be a diagonal, and it is still one labelled mark", () => {
  it("takes an optional far-end y", () => {
    // The desk's most convincing reference is `EdgeScatter`'s diagonal — the
    // line where a price equals its worth — and a level-only prop would have
    // left exactly that shape hand-drawn, which is what the prop exists to end.
    assert.match(figure, /y1\?: number;/, "PlotReference cannot express a diagonal");
  });

  it("draws the far end from y1 and keeps the label and title", () => {
    const at = overlayCode.indexOf("function ReferenceLine");
    const block = overlayCode.slice(at, at + 900);
    assert.match(block, /y2=\{diagonal \? y1 : y\}/, "the line's far end ignores y1");
    // A diagonal's label sits at its far end, a level line's at its start:
    // both branches must still print the word, or one shape is colour-only.
    assert.equal((block.match(/<text/g) ?? []).length, 2, "one of the two label branches is missing");
    assert.match(block, /<title>/);
  });

  it("is used for a diagonal by the contribution scatter, not hand-drawn", () => {
    const scatter = stripNonCode(read("../components/portfolio/ContributionScatter.tsx"));
    assert.match(scatter, /reference=\{/, "the scatter draws no reference");
    assert.match(scatter, /y1: y\(1\)/, "the scatter's reference is level, not the diagonal");
    assert.doesNotMatch(scatter, /coh-edge__fair/, "the scatter hand-draws the diagonal EdgeScatter draws by class");
  });
});

/* ── Legible over the marks it is painted under ───────────────────────── */

const figuresCss = read("../app/globals/10b-coherence-figures.css");

describe("the reference's label survives being painted under the marks", () => {
  it("the stylesheet is non-empty", () => assert.ok(figuresCss.trim().length > 5000));

  it("carries a halo in the plate colour, painted before its fill", () => {
    // FOUND IN A BROWSER, 2026-08-26. Painting the reference FIRST keeps the
    // line checkable — nothing occludes it — and put every mark on top of its
    // label: on the 339-bar exceedance calendar the leftmost breach bars struck
    // straight through "the forecast — above this line is a breach". A halo
    // alone did NOT fix it — the text was still under the bars — which is why
    // the word is now painted after the children (pinned above). Over the
    // marks, `paint-order: stroke` puts a stroke in the plate colour under the
    // fill: a halo that keeps the word legible and vanishes over the plate.
    const rule = figuresCss.slice(figuresCss.indexOf(".coh-plot__reference text {"));
    const body = rule.slice(0, rule.indexOf("}"));
    assert.ok(body.length > 20, "the `.coh-plot__reference text` rule is gone");
    assert.match(body, /paint-order:\s*stroke/, "the label's stroke is painted over its fill, or not at all");
    assert.match(body, /stroke:\s*var\(--/, "the halo is not a token, so it cannot follow the theme");
    assert.match(body, /stroke-width:\s*[2-4]px/, "a halo thinner than 2px does not cover a 1px bar edge; wider than 4px eats the neighbour");
  });
});
