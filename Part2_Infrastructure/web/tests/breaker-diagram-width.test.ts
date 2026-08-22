/**
 * The breaker diagram fills the card, and says everything it started saying.
 *
 * Two defects in one drawing, and only one of them was visible. The 560x208
 * viewBox was scaled to fit and then capped at 660px, so on a desk-width card
 * the machine sat in the middle third with the outer two thirds blank. The
 * invisible half is the one that mattered: the half-open caption ran past the
 * viewport's right edge and was cut mid-sentence — "observed only between
 * cooldown and the" — so the diagram was not merely wasting space, it was
 * dropping the sentence that explains why that node reads zero.
 *
 * There is no browser in this suite, so nothing here is observed. Every claim
 * below is DERIVED: the constants are read out of the component, the width
 * floor is read out of the stylesheet, and the arithmetic is done here. That
 * catches a wrong number and cannot catch a layout that is legal and ugly —
 * which is the honest limit of a regex-over-source suite, and the reason the
 * checks are about clipping and dropping rather than about beauty.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { globalsCss } from "./globals-css";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const machine = read("../components/systems/BreakerStateMachine.tsx");

/** The state-machine drawing only: the cooldown rings below it are a separate
 *  `<svg>` and they legitimately keep a viewBox, being 40px dials. */
const drawing = (() => {
  const start = machine.indexOf('className="breaker-machine"');
  assert.notEqual(start, -1, "the drawing has been renamed — this suite is reading nothing");
  const end = machine.indexOf("</svg>", start);
  assert.ok(end > start);
  return machine.slice(start, end);
})();

/** A `const NAME = <number>;` read off the component, so the arithmetic below
 *  is done against the geometry that ships rather than against a copy. */
function constant(name: string): number {
  const found = machine.match(new RegExp(`const ${name} = (-?[\\d.]+);`));
  assert.ok(found, `${name} is no longer a numeric constant in the component`);
  return Number(found![1]);
}

const BOX_Y = constant("BOX_Y");
const BOX_H = constant("BOX_H");
const CAP_Y = constant("CAP_Y");
const CAP_STEP = constant("CAP_STEP");
const RAIL_Y = constant("RAIL_Y");
const WRAP = constant("WRAP");
const HEIGHT = Number(drawing.match(/height=\{(\d+)\}/)![1]);

/** The node anchors, as authored. */
const anchors = [...machine.matchAll(/cx: "([\d.]+)%"/g)].map((m) => Number(m[1]));

/** The stylesheet's floor for the drawing — the width below which the card
 *  scrolls instead of the diagram shrinking. */
const FLOOR = (() => {
  const rule = globalsCss.match(/\.card > \.breaker-machine \{([^}]*)\}/);
  assert.ok(rule, "the drawing has no width floor; below one, its captions meet the frame");
  const min = rule![1].match(/min-width:\s*(\d+)px/);
  assert.ok(min, "the floor is not a px minimum");
  return Number(min![1]);
})();

/**
 * The component's own greedy wrap, mirrored so the lines can be measured here.
 * Mirrored rather than imported because the component is a `"use client"` TSX
 * module and this suite has no DOM to import it into; the property asserted
 * first below — that the lines rejoin into the original string — is what makes
 * the mirror worth having at all.
 */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    const last = lines[lines.length - 1];
    if (last && `${last} ${word}`.length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** Every caption the three nodes can print. Kept in the two groups the node
 *  draws them in — one `sub` line, then the `detail` under it — because the
 *  collision check below needs the sum of the two, not the deepest of all. */
const SUBS = ["calls flow", "provider skipped", "next call probes"];
const DETAILS = [
  "no failures counted",
  "none held out",
  "observed only between cooldown and the next call",
];
const CAPTIONS = [...SUBS, ...DETAILS];

/** Everything else the drawing says. Each must survive as one contiguous
 *  literal — a caption split by hand across two `<text>` elements is a caption
 *  a rewrite can silently shorten. */
const LABELS = [
  "CLOSED",
  "OPEN",
  "HALF-OPEN",
  "operator reset — “Close all circuits”",
  "in a row",
  "consecutive failures",
  "cooldown ends",
  "probe succeeds",
  "no half-open → open edge: a failed probe restarts the count from one",
];

/** A conservative advance for the 10-unit label face: prose at this size
 *  averages nearer 0.45em, and over-estimating is the safe direction for a
 *  clipping check. */
const CHAR_W = 5.2;

describe("the drawing is given the whole card", () => {
  it("has no viewBox, so nothing about it scales with the card's width", () => {
    /**
     * This is the whole fix in one assertion. With a viewBox the drawing is a
     * fixed picture stretched to fit: fill 1900px and it is 706px tall with
     * 34px labels. Without one, a user unit is a CSS pixel, the percentages
     * below do the spreading, and the type never moves.
     */
    assert.doesNotMatch(drawing, /viewBox/, "the state machine must not scale");
    assert.doesNotMatch(drawing, /preserveAspectRatio/, "there is no aspect ratio left to preserve");
    assert.match(drawing, /width="100%"/);
    assert.match(drawing, /height=\{\d+\}/, "an unscaled drawing needs an explicit height");
  });

  it("is capped by nothing, and centred by nothing", () => {
    // The 660px cap and its `margin: auto` are what produced the empty outer
    // thirds the user was looking at. Neither may come back.
    assert.doesNotMatch(globalsCss, /breaker-machine[^{]*\{[^}]*max-width:\s*\d+px/);
    assert.doesNotMatch(globalsCss, /breaker-machine[^{]*\{[^}]*margin:[^;]*auto/);
    assert.ok(FLOOR > 0);
  });

  it("spreads on percentages, so the width it is given is the width it uses", () => {
    // Every horizontal coordinate in the drawing, node boxes included. A single
    // user-unit x means that part of the machine has stopped following the card.
    const xs = [...drawing.matchAll(/\b(x|x1|x2)="([^"]*)"/g)];
    assert.ok(xs.length >= 12, "the drawing has stopped laying out in percentages");
    for (const [, attr, value] of xs) {
      assert.match(value, /^[\d.]+%$/, `${attr}="${value}" is a fixed offset, not a share of the card`);
    }
    assert.deepEqual(anchors, [15, 50, 85], "the three nodes must stay spread across the full width");
    // The return edge runs round the outside, which is where the blank margins
    // were. Inside, it would cross the captions it exists to leave legible.
    assert.match(drawing, /x1="97%"/);
    assert.match(drawing, /x2="3%"/);
  });

  it("stays one height whatever the card does, so a wide desk gets no poster", () => {
    // Derived, not observed: the deepest thing drawn is the footnote baseline.
    const baselines = [...drawing.matchAll(/y=\{(?:RAIL_Y \+ )?(\d+)\}/g)].map((m) => Number(m[1]));
    assert.ok(baselines.length > 0);
    const deepest = RAIL_Y + 32;
    assert.ok(deepest < HEIGHT, `the footnote at ${deepest} falls outside a ${HEIGHT}px drawing`);
    assert.ok(HEIGHT <= 280, "an unscaled machine has no reason to grow taller than it was");
  });
});

describe("no caption is clipped, shortened or dropped", () => {
  it("carries the sentence that used to be cut in half, whole", () => {
    /**
     * The defect, pinned by name. The rendered string stopped at "and the";
     * what a reader needs is the rest of it, because "observed only between
     * cooldown and the next call" is the reason half-open reads zero.
     */
    assert.match(machine, /observed only between cooldown and the next call/);
    assert.doesNotMatch(machine, /observed only between cooldown and the"/);
  });

  for (const text of [...CAPTIONS, ...LABELS]) {
    it(`still says "${text.slice(0, 40)}" in full`, () => {
      assert.ok(machine.includes(text), `"${text}" has left the diagram`);
    });
  }

  it("keeps the two live captions that are computed, not written", () => {
    // The counted branches: a worst-case failure count and the next probe.
    assert.match(machine, /worst \$\{worst\.breaker!\.failures\}\/\$\{threshold\}/);
    assert.match(machine, /next probe in \$\{secs\(/);
  });

  it("wraps rather than truncates, and the wrap loses no word", () => {
    // The property that makes the mirrored `wrap()` above trustworthy: the
    // lines rejoin into exactly the string that went in.
    for (const text of CAPTIONS) {
      const lines = wrap(text, WRAP);
      assert.equal(lines.join(" "), text, `wrapping "${text}" changed it`);
      for (const line of lines) assert.ok(line.length <= WRAP || !line.includes(" "));
    }
  });

  it("wrapped lines fit beside the outer anchors at the narrowest allowed card", () => {
    /**
     * The arithmetic the old drawing never did. An outer node is anchored at
     * 15% (and 85%), its captions are centred on that anchor, so half of the
     * longest line has to fit in the 15% of the card that lies outside it. At
     * the stylesheet's floor that is the tightest this can ever be.
     */
    const margin = (Math.min(...anchors) / 100) * FLOOR;
    for (const text of CAPTIONS) {
      for (const line of wrap(text, WRAP)) {
        const half = (line.length * CHAR_W) / 2;
        assert.ok(
          half <= margin,
          `"${line}" needs ${half.toFixed(0)}px either side of the anchor and has ${margin.toFixed(0)}px `
            + `at the ${FLOOR}px floor — it would be clipped, which is the defect this suite exists for`,
        );
      }
    }
  });

  it("leaves the return edge below the deepest caption line", () => {
    // A node prints its sub line and then its detail, so the tallest caption
    // block is the tallest sub plus the tallest detail — three lines today,
    // because the half-open sentence wraps to two.
    const lines = Math.max(...SUBS.map((text) => wrap(text, WRAP).length))
      + Math.max(...DETAILS.map((text) => wrap(text, WRAP).length));
    const lowest = CAP_Y + (lines - 1) * CAP_STEP;
    assert.equal(lines, 3, "the caption block changed height — re-derive the rail below it");
    assert.ok(
      lowest < RAIL_Y,
      `a caption baseline at ${lowest} collides with the return edge at ${RAIL_Y}`,
    );
    assert.ok(CAP_Y > BOX_Y + BOX_H, "the captions have moved inside the node boxes");
  });
});

describe("the labels do not shrink with the drawing", () => {
  it("sizes every label in the sanctioned inline units, floored at the tick rung", () => {
    /**
     * One user unit is one CSS pixel now, so these numbers are the px the
     * reader gets at every card width — 10 at 1200px and 10 at 1900px, where
     * the old drawing gave 11.8 and would have given 34. The floor is the same
     * rung the charts use, --fs-tick, which is fixed on purpose: it is chart
     * furniture and does not move with the Text size preference. It must not,
     * either — every y in this drawing is an absolute number, so a label that
     * grew a fifth at the Large preset would land on the return edge.
     */
    const sizes = [...drawing.matchAll(/fontSize=\{([\d.]+)\}/g)].map((m) => Number(m[1]));
    assert.ok(sizes.length >= 6, "the drawing has stopped sizing its own labels");
    const tick = globalsCss.match(/--fs-tick:\s*(\d+)px/);
    assert.ok(tick, "--fs-tick has left the scale");
    assert.equal(Math.min(...sizes), Number(tick![1]), "no label may fall below the tick rung");
    for (const size of sizes) assert.ok([10, 12, 12.5, 13, 15].includes(size), `${size} is off the inline scale`);
    // And no rung is read from the ladder into the drawing, which would make
    // the geometry move with a preference the geometry cannot follow.
    assert.doesNotMatch(drawing, /var\(--fs-/);
  });

  it("does not scale itself back down in the stylesheet either", () => {
    // A transform or a zoom on the element would undo all of the above.
    assert.doesNotMatch(globalsCss, /\.breaker-machine[^{]*\{[^}]*(transform|zoom):/);
  });
});

describe("what the widening was not allowed to cost", () => {
  it("keeps the live state marked by weight as well as by colour", () => {
    // Colour alone would leave forced-colors and every colour-blind reader with
    // three identical boxes. The border weight and the count carry it too.
    assert.match(machine, /strokeWidth=\{active \? 1\.6 : 1\}/);
    assert.match(machine, /\{nodeCount\(node\.id\)\}/);
  });

  it("still draws every edge as a stroked path or line, for High Contrast", () => {
    // The forced-colors rule reaches `path[stroke]` and `line[stroke]`; a
    // `<marker>` fill follows neither.
    assert.doesNotMatch(drawing, /<marker/);
    assert.match(machine, /stroke="var\(--axis\)"/);
    // The operator reset is the one human action on the diagram and stays
    // dashed: a person is not the machine running its own course.
    assert.match(machine, /strokeDasharray=\{dashed \? "4 3" : undefined\}/);
    assert.match(drawing, /dashed/);
  });

  it("animates nothing, so there is nothing for reduced motion to turn off", () => {
    // Declarations rather than the words: the header comment says the runtime
    // has no `half_open → open` TRANSITION, and a bare word scan reads that
    // sentence as a CSS property and fails on prose.
    assert.doesNotMatch(machine, /transition:|transitionProperty|animation:|@keyframes/);
    assert.doesNotMatch(machine, /requestAnimationFrame|setInterval|useEffect/);
  });

  it("scrolls the card rather than clipping the drawing below the floor", () => {
    // The only honest answer at phone width: the type does not shrink, so the
    // card takes the overflow. Scoped to the narrow case so no wider viewport
    // turns the card into a scroll container.
    assert.match(globalsCss, /@media \(max-width: 560px\) \{\s*\.card:has\(> \.breaker-machine\) \{\s*overflow-x: auto;/);
  });

  it("frees the nested arrowhead viewports in CSS, not by attribute alone", () => {
    // `svg:not(:root) { overflow: hidden }` in the UA sheet outranks a
    // presentation attribute; without the author rule every arrowhead vanishes.
    assert.match(globalsCss, /\.breaker-machine svg \{\s*overflow: visible;/);
    assert.match(machine, /overflow="visible"/);
  });
});
