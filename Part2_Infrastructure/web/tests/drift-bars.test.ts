/**
 * The drift chart, and the arithmetic trap it exists to avoid.
 *
 * The obvious chart here is a dumbbell from current weight to target weight.
 * It is wrong, and wrong in a way nobody would notice by looking: `drift` and
 * the weight pair are measured over DIFFERENT DENOMINATORS, and they part
 * company exactly when the gross cap binds — which is the state a rebalance
 * chart is most likely to be read in. The first test proves the divergence is
 * real rather than theoretical; the rest pin the chart's response to it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { placeDriftFigure } from "../components/portfolio/drift-label";
import {
  buildCovariance,
  proposeAllocation,
  type ReturnsBySymbol,
} from "../lib/portfolio-risk";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const chart = read("../components/portfolio/DriftBars.tsx");
const panel = read("../components/portfolio/AllocationPanel.tsx");

function proposal(limits: { maxGrossNotional?: number; maxSymbolNotional?: number } = {}) {
  const base = Array.from({ length: 80 }, (_, i) => 0.004 * (i % 2 ? 1 : -1) + 0.0006 * ((i % 7) - 3));
  const swing = Array.from({ length: 80 }, (_, i) => 0.0015 * ((i % 5) - 2) + 0.0004 * (i % 3 ? 1 : -1));
  const history: ReturnsBySymbol = {
    AAA: base,
    BBB: base.map((b, i) => 0.6 * b + 2 * swing[i]),
  };
  const model = buildCovariance(Object.keys(history), history);
  assert.ok(model);
  const positions = [
    { symbol: "BBB", signedNotional: 180_000 },
    { symbol: "AAA", signedNotional: 120_000 },
  ];
  const result = proposeAllocation(positions, model, "inverse_vol", limits);
  assert.ok(result);
  return result;
}

describe("drift and the weight pair do not measure the same thing", () => {
  it("agree while the gross cap is slack", () => {
    for (const target of proposal().targets) {
      assert.ok(
        Math.abs(target.drift - (target.targetWeight - target.currentWeight)) < 1e-9,
        `${target.symbol} disagreed with no cap in force`,
      );
    }
  });

  it("DISAGREE once the gross cap binds — which is why no dumbbell is drawn", () => {
    /**
     * `targetWeight = targetNotional / min(gross, cap)` but
     * `drift = (targetNotional - currentNotional) / gross`. With a cap below
     * current gross the denominators differ, so a span drawn from current to
     * target would not equal the drift bar beside it, on the same axis.
     */
    const capped = proposal({ maxGrossNotional: 150_000 }); // gross is 300k
    const divergent = capped.targets.filter(
      (t) => Math.abs(t.drift - (t.targetWeight - t.currentWeight)) > 1e-6,
    );
    assert.ok(
      divergent.length > 0,
      "expected the capped budget to separate drift from the weight difference",
    );
  });

  it("plots drift itself rather than recomputing it from the weights", () => {
    // Comments stripped first: the header explains this exact trap, and the
    // prose describing what not to do must not read as doing it.
    const code = chart.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(
      code,
      /targetWeight\s*-\s*.*currentWeight/,
      "the chart derived drift from the weight pair, reintroducing the denominator bug",
    );
    assert.match(code, /x\(target\.drift\)/);
  });

  it("withholds the current-to-target annotation when the cap binds", () => {
    assert.match(chart, /capBinds\s*\?\s*"—"/);
    assert.match(panel, /limits\.maxGrossNotional < active\.grossBefore/);
  });
});

describe("the axis and the band tell the truth about magnitude", () => {
  it("is symmetric, so neither side is visually favoured", () => {
    assert.match(chart, /linearScale\(-domain,\s*domain,/);
  });

  it("floors the domain at the band so an idle book still looks idle", () => {
    // Without the floor, a book entirely inside the band would have the band
    // fill the whole plot and every row would read as an outlier.
    assert.match(chart, /Math\.max\(driftBand \* 1\.25/);
  });

  it("draws the band edges as strokes, not only as a fill", () => {
    // Forced colours discards the fill; a stroked line is what the single
    // permitted high-contrast rule reaches.
    assert.match(chart, /stroke="var\(--grid\)"/);
  });

  it("gives a position exactly on target a hairline rather than nothing", () => {
    assert.match(chart, /Math\.max\(1, Math\.abs\(x\(target\.drift\) - x\(0\)\)\)/);
  });

  it("names the directions in words, not only in hue", () => {
    assert.match(chart, />\s*trim\s*</);
    assert.match(chart, />\s*add\s*</);
  });
});

describe("the panel keeps its statuses visible", () => {
  it("leaves the unbalanced-weights banner outside every disclosure", () => {
    const firstDisclosure = panel.indexOf("<details");
    assert.ok(firstDisclosure > 0);
    assert.ok(
      panel.indexOf("banner warn") < firstDisclosure,
      "the warning that trades are withheld was collapsed",
    );
  });

  it("says on the chart that trades are withheld when weights do not balance", () => {
    assert.match(chart, /trades withheld — weights sum to/);
  });

  it("forces the table open while an override is active", () => {
    // The toggle's entire effect is the inputs in that table; collapsing it
    // makes the control look inert.
    assert.match(panel, /<details className="disclosure" open=\{override\}>/);
  });
});

/**
 * The figures beside the bars had no lane discipline, and it was invisible to
 * every test here because they all read the component as text. `x(drift) ± 5`
 * anchored outward puts the largest bar's figure past the plot edge — onto the
 * symbol at one extreme, onto the current→target pair at the other, glyph over
 * glyph. It fired for most of the drift-band slider's travel.
 *
 * These assert the geometry instead: no figure may enter the gutter that holds
 * another label. That is the property, and it is checkable.
 */
describe("a drift figure never lands on another label", () => {
  // The plot as the component lays it out at its default width.
  const PLOT_LEFT = 88;
  const PLOT_RIGHT = 470;
  const ZERO = (PLOT_LEFT + PLOT_RIGHT) / 2;
  const GAP = 5;
  // "+10.4%" at roughly 6px per glyph in the mono face.
  const FIGURE = 6 * 6;

  /** Where the figure's box actually starts and ends, given its anchor. */
  function box(placement: ReturnType<typeof placeDriftFigure>) {
    return placement.anchor === "start"
      ? { left: placement.x, right: placement.x + FIGURE }
      : { left: placement.x - FIGURE, right: placement.x };
  }

  const place = (end: number, up: boolean) =>
    placeDriftFigure({
      end, zero: ZERO, up, figureWidth: FIGURE, gap: GAP,
      plotLeft: PLOT_LEFT, plotRight: PLOT_RIGHT,
    });

  it("keeps a full-width add inside the plot, off the current-to-target pair", () => {
    // The exact case that overprinted: the bar reaches the right edge.
    const drawn = box(place(PLOT_RIGHT, true));
    assert.ok(
      drawn.right <= PLOT_RIGHT,
      `figure ran ${drawn.right - PLOT_RIGHT}px past the plot into the right annotation`,
    );
  });

  it("keeps a full-width trim inside the plot, off the symbol", () => {
    const drawn = box(place(PLOT_LEFT, false));
    assert.ok(
      drawn.left >= PLOT_LEFT,
      `figure ran ${PLOT_LEFT - drawn.left}px into the symbol gutter`,
    );
  });

  it("holds for every bar length, in both directions", () => {
    // The band moves continuously, so the property has to hold continuously —
    // a single sampled width is how this shipped green the first time.
    for (let step = 0; step <= 100; step += 1) {
      const reach = (step / 100) * (PLOT_RIGHT - ZERO);
      for (const up of [true, false]) {
        const drawn = box(place(up ? ZERO + reach : ZERO - reach, up));
        assert.ok(
          drawn.left >= PLOT_LEFT && drawn.right <= PLOT_RIGHT,
          `at ${step}% ${up ? "add" : "trim"} the figure left the plot: `
          + `${drawn.left.toFixed(1)}–${drawn.right.toFixed(1)} outside ${PLOT_LEFT}–${PLOT_RIGHT}`,
        );
      }
    }
  });

  it("still prefers the gutter beside the bar when there is room for it", () => {
    // The fallback must be a fallback. A figure that always retreats to the
    // axis is no longer attached to the bar it describes.
    const short = place(ZERO + 20, true);
    assert.equal(short.beyondBar, true);
    assert.equal(short.x, ZERO + 20 + GAP);
    assert.equal(short.anchor, "start");
  });

  it("falls back across the empty half of the row, never onto the fill", () => {
    // A bar occupies one side of zero, so the other side is free. Placing the
    // figure there avoids needing a colour that survives a diverging fill in
    // both themes and in forced colours.
    const long = place(PLOT_RIGHT, true);
    assert.equal(long.beyondBar, false);
    assert.equal(long.anchor, "end");
    assert.ok(long.x <= ZERO, "the fallback figure was drawn over its own bar");
  });

  it("gives the axis headroom so the longest bar is not flush with the edge", () => {
    // The root cause underneath the placement: linearScale maps the domain onto
    // the whole range, so without padding the largest bar ends exactly on the
    // plot edge and has no gutter to be placed in at all.
    assert.match(chart, /const domain = extent \* 1\.08/);
    assert.match(chart, /Math\.max\(driftBand \* 1\.25/);
  });

  it("leaves room for the capped marker rather than clipping it", () => {
    // `12.3% → 39.2% capped` is about 120px at 9.5px mono; the margin was 116,
    // so the marker whose whole job is to say the target was constrained ran
    // past the viewBox.
    const margin = chart.match(/const MARGIN = \{[^}]*right:\s*(\d+)/);
    assert.ok(margin, "the chart stopped declaring a right margin");
    assert.ok(
      Number(margin[1]) >= 140,
      `right margin ${margin[1]}px cannot hold the current-to-target pair plus " capped"`,
    );
  });
});
