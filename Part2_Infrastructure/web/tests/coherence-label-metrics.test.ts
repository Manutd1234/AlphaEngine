/**
 * One advance-width constant for the engine's figures, and it is measured.
 *
 * SVG text neither wraps nor clips, so every row-labelled figure reserves a
 * gutter before it draws. Each did that arithmetic itself, and on 2026-08-25
 * there were eight spellings of the same ratio in the tree — 0.56, 0.567,
 * 0.575, ~7.3, ~7.6, 6.9, 6.72 and a bare 5.2 with no derivation at all.
 *
 * One of them was wrong in a way no assertion could catch. `ComboBandStrips`
 * reserved 205px for a 26-glyph combo ticker from `26 × 13 × 0.577`; that
 * ratio is for tabular mono and the text is set in Inter, which measures
 * 0.668 em on the same string. The label ran past its gutter, and because the
 * `<text>` was emitted before the opaque track rect, paint order hid the
 * overrun as a clip rather than showing it as an overlap. The suite was green
 * throughout, because the only check available was redoing the same wrong
 * multiplication (CLAUDE.md, fact 6: no DOM, so geometry is derived).
 *
 * WHAT THIS FILE CAN AND CANNOT DO. It cannot measure a glyph either. What it
 * holds is that there is ONE place to be wrong instead of eight, that the place
 * records how its numbers were obtained, and that the two font sizes it
 * multiplies by still agree with the stylesheet that declares them.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DIAGRAM_LABEL_PX, DIAGRAM_LEGEND_PX, GLYPH_EM,
  advancePx, glyphClassOf, glyphsWithin, gutterFor, truncateMiddle,
} from "../lib/coherence/label-metrics";
import { globalsCss } from "./globals-css";
import { read, stripNonCode } from "./helpers/workspace-sources";

describe("the ratios are the measured ones, and say so", () => {
  it("keeps uppercase, prose and digits apart", () => {
    // One ratio cannot serve all three, which is why eight accumulated.
    // Uppercase measured 0.668–0.681 and prose 0.526 on the same face: using
    // the ticker ratio for prose would over-reserve by a quarter of the gutter.
    assert.ok(GLYPH_EM.upper > GLYPH_EM.digits, "an uppercase ticker sets wider than tabular figures");
    assert.ok(GLYPH_EM.digits > GLYPH_EM.prose, "tabular figures set wider than mixed-case prose");
  });

  it("rounds up rather than down, because the failure is asymmetric", () => {
    // A gutter 5px too wide costs 5px of track. A gutter 5px too narrow costs
    // the reader the end of every label on the figure.
    assert.ok(GLYPH_EM.upper >= 0.681, "narrower than the widest measured uppercase string");
    assert.ok(GLYPH_EM.digits >= 0.648, "narrower than the measured tabular figures");
    assert.ok(GLYPH_EM.prose >= 0.526, "narrower than the measured mixed-case prose");
  });

  it("records the method beside the numbers", () => {
    const source = read("../lib/coherence/label-metrics.ts");
    assert.match(source, /getComputedTextLength/,
      "the module does not say how its ratios were obtained, so the next reader must guess again");
  });
});

describe("the font sizes it multiplies by are the stylesheet's own", () => {
  it("mirrors --fs-diagram-label and --fs-diagram-legend", () => {
    // The module needs a NUMBER before layout, so it cannot read the custom
    // property. A mirror that drifted would put every gutter on this tab a rung
    // out with nothing failing, so the mirror is asserted rather than trusted.
    assert.match(globalsCss, new RegExp(`--fs-diagram-label:\\s*${DIAGRAM_LABEL_PX}px`),
      "label-metrics disagrees with the stylesheet about the diagram label rung");
    assert.match(globalsCss, new RegExp(`--fs-diagram-legend:\\s*${DIAGRAM_LEGEND_PX}px`),
      "label-metrics disagrees with the stylesheet about the diagram legend rung");
  });
});

describe("classifying a string picks the ratio a caller would get wrong", () => {
  it("reads a combo ticker as uppercase", () => {
    assert.equal(glyphClassOf("KXMVECROSSCATEGORY-SHARD1-S2026D454E16D73F"), "upper");
  });
  it("reads a row label as prose", () => {
    assert.equal(glyphClassOf("Worst-case payoff"), "prose");
  });
  it("reads a bare amount as digits", () => {
    assert.equal(glyphClassOf("0.2730"), "digits");
  });
  it("treats a mostly-capital mixture as uppercase, which is the safe reading", () => {
    assert.equal(glyphClassOf("KXBTCD-26AUG2517"), "upper");
  });
});

describe("the gutter is bounded on both sides", () => {
  const TICKERS = ["KXMVECROSSCATEGORY-SHARD1-S2026D454E16D73F-109F07259C1"];

  it("never takes more of the plot than maxFraction allows", () => {
    // Unbounded, one long ticker takes the whole figure and leaves no track to
    // read it against — which is a different way of showing nothing.
    const gutter = gutterFor(TICKERS, 600, DIAGRAM_LABEL_PX, { maxFraction: 0.34 });
    assert.ok(gutter <= Math.round(600 * 0.34), `gutter ${gutter} exceeds a third of a 600px plot`);
  });

  it("never drops below min, so short labels still read as a column", () => {
    assert.ok(gutterFor(["a", "b"], 600, DIAGRAM_LABEL_PX, { min: 96 }) >= 96);
  });

  it("actually fits the widest label when there is room for it", () => {
    // The property the 205px constant did not have.
    const label = "KXBTCD-26AUG2517";
    const gutter = gutterFor([label], 1200, DIAGRAM_LABEL_PX, { maxFraction: 0.34, max: 260 });
    assert.ok(gutter >= advancePx(label, DIAGRAM_LABEL_PX),
      `gutter ${gutter} is narrower than the label it reserves for`);
  });
});

describe("truncation keeps both ends of an identifier", () => {
  const TICKER = "KXMVECROSSCATEGORY-SHARD1-S2026D454E16D73F-109F07259C1";

  it("keeps the tail, which is what tells two parlays apart", () => {
    // A trailing ellipsis cuts exactly the half a reader is using: six rows of
    // `KXMVECROSSCATEGORY-SHARD1-S2026D4…` are six identical labels.
    const short = truncateMiddle(TICKER, 200, DIAGRAM_LABEL_PX);
    assert.ok(short.includes("…"), "nothing was truncated, so the case is not being tested");
    assert.ok(short.endsWith(TICKER.slice(-4)), `the tail was cut: ${short}`);
    assert.ok(short.startsWith(TICKER.slice(0, 4)), `the head was cut: ${short}`);
  });

  it("returns the string untouched when it fits", () => {
    assert.equal(truncateMiddle("KXBTCD", 400, DIAGRAM_LABEL_PX), "KXBTCD");
  });

  it("what it returns fits the budget it was given", () => {
    for (const px of [60, 120, 200, 260]) {
      const short = truncateMiddle(TICKER, px, DIAGRAM_LABEL_PX);
      assert.ok(short.length <= glyphsWithin(px, DIAGRAM_LABEL_PX, "upper"),
        `at ${px}px the result is ${short.length} glyphs, which does not fit`);
    }
  });
});

describe("the figure that carried the defect now derives its gutter", () => {
  const strips = read("../components/coherence/ComboBandStrips.tsx");

  it("declares no width constant of its own", () => {
    assert.doesNotMatch(strips, /const LABEL_W/, "the fixed gutter is back");
    assert.match(strips, /gutterFor\(/, "the gutter is not derived from the shared module");
  });

  it("draws its labels after the opaque track, so an overrun shows rather than hides", () => {
    // The clip was paint order, not only arithmetic. Both halves are fixed and
    // both are held: if the gutter is ever wrong again it must be VISIBLE.
    const trackAt = strips.indexOf("coh-combo__track");
    const labelAt = strips.lastIndexOf("coh-combo__label");
    assert.ok(trackAt !== -1 && labelAt !== -1);
    assert.ok(labelAt > trackAt,
      "a row label is emitted before the opaque track again, which hides an overrun as a clip");
  });
});

describe("no figure keeps a per-glyph constant of its own", () => {
  // Eight spellings of one ratio is how the wrong one survived: each looked
  // locally reasonable, and no two could be compared without opening both
  // files. This is the assertion that keeps the count at one.
  //
  // The list is the figures rewired on 2026-08-25. It is a list rather than a
  // sweep of the directory on purpose — a sweep would also catch the twenty
  // inner components that never did this arithmetic, and an assertion that
  // passes for files it was never about stops meaning anything.
  const REWIRED = [
    "../components/coherence/ComboBandStrips.tsx",
    "../components/coherence/ValueStrip.tsx",
    // ChannelStates left this list when its SVG labels became wrapping HTML
    // cards; it no longer performs glyph or gutter arithmetic at all.
    // Joined 2026-08-25 with the Universe rebuild: it divided by a literal
    // 7.48 for a label column that holds both prose titles and tickers.
    "../components/coherence/BasketOverview.tsx",
  ];

  for (const file of REWIRED) {
    it(`${file.split("/").pop()} derives its gutter rather than declaring one`, () => {
      const source = read(file);
      assert.match(source, /from "@\/lib\/coherence\/label-metrics"/,
        "the figure does its own advance-width arithmetic again");
      // CODE only. A rewired file is expected to explain in a comment what its
      // constant used to be and why it was wrong — that history is the reason
      // the next reader does not reinstate it — and a scan of raw source would
      // read the explanation as the defect.
      const code = stripNonCode(source);
      for (const literal of ["7.28", "7.37", "7.48", "0.577", "0.575", "0.567", "6.72"]) {
        assert.ok(!code.includes(literal),
          `${literal} is a hand-derived glyph advance; label-metrics owns that number now`);
      }
    });
  }
});

describe("a value printed beside a bar is clamped by its far edge", () => {
  const strip = read("../components/coherence/ValueStrip.tsx");

  it("reserves the value's own width before clamping it", () => {
    // Clamping the ANCHOR is the bug: start-anchored text extends rightward
    // from the point being clamped, so `Math.min(width - 4, …)` put the first
    // glyph inside the plot and let the rest run out of the viewBox. Reported
    // on Fees → Worked example, where a bar reaching the end of the track
    // printed "0.010097" — about 68px against the 64px `PAD.right` reserves —
    // past the edge of the card.
    assert.match(strip, /const valueW = advancePx\(valueText, DIAGRAM_LABEL_PX\)/,
      "the value's width is not measured before it is placed");
    assert.match(strip, /width - 4 - valueW/,
      "a positive bar's value is clamped by its start again, so a wide one overflows");
  });

  it("clamps a negative bar's value against the label gutter, not the plot edge", () => {
    // The mirror image: an end-anchored value extends LEFT, so the clamp that
    // keeps it inside the plot has to keep it out of the label column instead.
    assert.match(strip, /Math\.max\(gutter \+ 2 \+ valueW/,
      "a negative bar's value can run back into the labels");
  });
});
