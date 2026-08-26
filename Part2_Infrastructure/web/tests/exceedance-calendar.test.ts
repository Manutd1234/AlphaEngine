/**
 * The VaR calendar's numbers, asserted before any drawing exists.
 *
 * Grammar rule 4: a derivation lives in a pure module so a suite with no DOM
 * can check it. These are the facts the figure will draw — the ratio per
 * bar, the breach flag, the longest run — and the one sentence the band chart
 * cannot write, about whether breaches cluster.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clusteringReading, exceedanceCells } from "../lib/portfolio-risk/exceedance";
import type { VarSeriesPoint } from "../lib/portfolio-risk/var-validation";

const bar = (index: number, pnl: number, var95: number, exception95 = -pnl > var95): VarSeriesPoint =>
  ({ index, t: null, pnl, sigma: var95 / 1.645, var95, var99: var95 * 1.4, exception95, exception99: false } as VarSeriesPoint);

describe("the ratio is loss over forecast, and never below zero", () => {
  it("a loss exactly at the forecast is 1.0", () => {
    const { cells } = exceedanceCells([bar(0, -100, 100, false)]);
    assert.equal(cells[0].ratio, 1);
  });

  it("a profitable bar is 0, not negative", () => {
    // "How far into the forecast did the loss reach" has no meaning below zero,
    // and a negative cell would read as a credit against the model.
    const { cells } = exceedanceCells([bar(0, 40, 100)]);
    assert.equal(cells[0].ratio, 0);
    assert.equal(cells[0].breach, false);
  });

  it("a breach is the series' own flag, not a recomputation", () => {
    // The flag is what the Kupiec count was scored on; the ratio is the
    // magnitude beside it. If they ever disagreed the flag would win.
    const { cells, breaches } = exceedanceCells([bar(0, -150, 100, true), bar(1, -150, 100, false)]);
    assert.equal(cells[0].breach, true);
    assert.equal(cells[1].breach, false);
    assert.equal(breaches, 1);
  });
});

describe("a bar with no forecast is withheld, not scored", () => {
  it("has a null ratio and a reason, and counts toward neither side", () => {
    const s = exceedanceCells([bar(0, -50, 0), bar(1, -50, 100)]);
    assert.equal(s.cells[0].ratio, null);
    assert.match(s.cells[0].withheld!, /no forecast/);
    assert.equal(s.withheld, 1);
    assert.equal(s.scored, 1);
    assert.equal(s.breaches, 0);
  });

  it("breaks a run — a gap is not a breach and not a clear day", () => {
    const s = exceedanceCells([bar(0, -200, 100, true), bar(1, -50, 0), bar(2, -200, 100, true)]);
    assert.equal(s.longestRun, 1);
  });
});

describe("clustering is measured as the longest run", () => {
  it("finds the run and where it starts", () => {
    const s = exceedanceCells([
      bar(0, -10, 100, false), bar(1, -200, 100, true), bar(2, -200, 100, true), bar(3, -200, 100, true),
      bar(4, -10, 100, false), bar(5, -200, 100, true),
    ]);
    assert.equal(s.breaches, 4);
    assert.equal(s.longestRun, 3);
    assert.equal(s.longestRunAt, 1);
  });

  it("says so in words the band chart cannot", () => {
    const spread = exceedanceCells([bar(0, -200, 100, true), bar(1, -10, 100, false), bar(2, -200, 100, true)]);
    assert.match(clusteringReading(spread), /none consecutive — spread/);
    const clustered = exceedanceCells([bar(0, -200, 100, true), bar(1, -200, 100, true), bar(2, -10, 100, false)]);
    assert.match(clusteringReading(clustered), /2 of them in a row — clustered/);
  });

  it("reports an unscored series as unscored, never as clean", () => {
    // An empty result is reported, not hidden: "no breach" on a series with no
    // forecast would be the most flattering sentence a broken feed could earn.
    assert.match(clusteringReading(exceedanceCells([bar(0, -50, 0)])), /nothing here is scored/);
  });
});

/* ── The figure's structure, which no DOM-less suite can see drawn ─────── */

import { read, stripNonCode } from "./helpers/workspace-sources";

const figure = read("../components/risk/ExceedanceCalendar.tsx");
const code = stripNonCode(figure);

describe("the calendar is an instrument, not a picture", () => {
  it("is non-empty", () => assert.ok(figure.trim().length > 1500));

  it("draws through Figure and Plot, on a shared axis", () => {
    // Bars are uniformly spaced, so `sharedX` is correct here — grammar rule 7
    // — and the readout at any bar is every fact about that bar in one card.
    assert.match(code, /<Figure/);
    assert.match(code, /sharedX=\{/);
  });

  it("carries the forecast as the plot's reference, not a hand-drawn line", () => {
    assert.match(code, /reference=\{/);
    assert.match(figure, /above this line is a breach/, "the reference carries no word saying what crossing it means");
  });

  it("marks a breach by more than colour", () => {
    // Hatched fill plus the ▲ in the title: what survives Windows High Contrast.
    assert.match(figure, /url\(#diff-hatch\)/, "a breach is filled with colour alone");
    assert.match(figure, /▲ breach/, "a breach's own words do not carry the mark");
  });

  it("withholds rather than zeroes, and says why in the mark", () => {
    assert.match(figure, /withheld — \$\{c\.withheld\}/);
    // The RENDER, not the whole file. The domain computes `Math.max(1.5, ...ratio ?? 0)`,
    // where a withheld bar contributing nothing to the top of the axis is
    // correct — it is hatched full-height, not drawn at zero. What must never
    // coerce is the branch that draws a bar from its ratio.
    const render = code.slice(code.indexOf("{cells.map("));
    assert.ok(render.length > 200, "the bars are no longer drawn from cells.map");
    assert.doesNotMatch(render, /ratio \?\? 0/, "a withheld ratio is coerced to zero where a bar is drawn from it");
    assert.match(render, /c\.ratio === null/, "the render no longer branches on a withheld ratio");
  });

  it("derives from the pure module, not inline", () => {
    assert.match(code, /exceedanceCells\(series\.points\)/);
    assert.match(code, /clusteringReading\(summary\)/);
    assert.doesNotMatch(code, /exception95/, "the figure recomputes a breach instead of reading the derivation");
  });
});

/* ── Where it sits, and what the band chart beside it must not clip ─────── */

const engine = read("../components/portfolio/RiskEngine.tsx");
const band = read("../components/portfolio/VarBacktestChart.tsx");

describe("the calendar shares the band chart's frame", () => {
  it("is non-empty", () => {
    assert.ok(engine.trim().length > 1500);
    assert.ok(band.trim().length > 1500);
  });

  it("is mounted INSIDE the VaR card, not beneath it", () => {
    // FOUND IN A BROWSER, 2026-08-26. `VarBacktestChart` wraps its figure in
    // `div.card.var-backtest` (16px of padding, so 1606px wide at x=57) and the
    // calendar sat bare in the section (1640px at x=40): two drawings of one
    // subject, framed 34px apart. The card's own subhead — "where the model was
    // breached, and whether breaches clustered" — already names the calendar's
    // job, so the calendar goes in as the card's children, under the band and
    // above the exceptions table. A sibling `.card` would have aligned the
    // edges and doubled the chrome.
    const engineCode = stripNonCode(engine);
    assert.match(
      engineCode,
      /<VarBacktestChart[^>]*>[\s\S]*?<ExceedanceCalendar[\s\S]*?<\/VarBacktestChart>/,
      "the calendar is no longer rendered as the band chart's children",
    );
    assert.doesNotMatch(engineCode, /<VarBacktestChart[^>]*\/>/, "the band chart is self-closing again, so the calendar sits outside its card");
    assert.match(stripNonCode(band), /\{children\}/, "VarBacktestChart renders no children slot");
  });

  it("the band chart's y-gutter is sized from its own labels, not a constant", () => {
    // The same browser pass: `$100,000` drew as `00,000` at the left edge.
    // `DEFAULT_MARGIN.left` is 52px; nine monospace glyphs at 13px are ~76.
    // Every other figure on the desk that draws row labels sizes its gutter
    // with `gutterFor` — this one now does too.
    const bandCode = stripNonCode(band);
    assert.match(bandCode, /gutterFor\(/, "the gutter is no longer derived from the labels");
    assert.doesNotMatch(bandCode, /const x0 = DEFAULT_MARGIN\.left/, "x0 is the 52px constant again, which clips a six-figure label");
  });
});
