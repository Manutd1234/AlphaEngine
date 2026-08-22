/**
 * The Oracle VaR panel's live diagram, held to the panel's own honesty rules.
 *
 * The desk asked twice for "a diagram that shows the changes in real time like
 * the execution tab", and the risk in granting that is precise: a chart is a
 * claim about history, and this panel's figure has almost none. It is a
 * terminal-value GBM VaR recomputed only when the volatility model, the
 * horizon or the book's equity bucket changes — a handful of observations in a
 * session, not a series. Every assertion below exists to stop the chart
 * implying otherwise.
 *
 * Rendering is not available to this runner (no DOM), so the properties that
 * live in the markup are read from the source. The properties that live in
 * arithmetic — the reserve, the cap — are executed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ORACLE_TREND_RESERVE } from "../components/risk/OracleVarTrend";
import { readSource, stripCode } from "./helpers/source-files";

const trend = readSource("components/risk/OracleVarTrend.tsx");
const trendCode = stripCode(trend);
const panel = readSource("components/portfolio/OracleVarPanel.tsx");
const panelCode = stripCode(panel);

describe("the chart is built from the in-tree primitives", () => {
  it("adds no dependency and hand-rolls no scale", () => {
    // The house rule, and the reason this is a chart rather than a library
    // call. `chart-kit` owns the scales, the gap-breaking path builder and the
    // grid; a second copy of any of them here would be the drift the kit
    // exists to prevent.
    assert.match(trendCode, /from "@\/components\/chart-kit"/);
    for (const primitive of ["linearScale", "linePath", "extent", "ticks", "Grid"]) {
      assert.ok(trendCode.includes(primitive), `${primitive} must come from chart-kit`);
    }
    assert.doesNotMatch(trend, /^import .* from "(?!@\/|\.)/m, "no bare package import");
  });

  it("keys its draw animation on the data, never on the measured width", () => {
    // `useMeasuredWidth` re-renders on every drag of a window edge. A
    // width-keyed AnimatedPath would replay its draw on each one — the exact
    // failure chart-kit's own comment records.
    assert.match(trendCode, /drawKey=\{drawKey\}/);
    assert.match(trendCode, /const drawKey = `\$\{shown\.length\}-\$\{latest\.at\}`/);
    assert.doesNotMatch(trendCode, /drawKey=\{[^}]*width/);
  });

  it("respects reduced motion by using the one animation contract", () => {
    // `AnimatedPath` renders `.chart-draw`, which is a CSS animation, and the
    // single `prefers-reduced-motion` block in 12 collapses every duration to
    // 1ms. Nothing here animates in JavaScript, so there is no second contract
    // to keep in step and no timer on the event loop.
    assert.match(trendCode, /AnimatedPath/);
    assert.doesNotMatch(trendCode, /setInterval|setTimeout|requestAnimationFrame/);
  });
});

describe("the series never implies more history than it holds", () => {
  it("says how many observations it has, in words, every time", () => {
    assert.match(trendCode, /\{shown\.length\} observation\{shown\.length === 1 \? "" : "s"\}/);
  });

  it("reports the empty case instead of drawing an empty plot", () => {
    assert.match(trendCode, /No completed run at the \{horizonDays\}-day horizon yet/);
    assert.doesNotMatch(trendCode, /shown\.length === 0\) return null/,
      "an absent chart and a chart reporting an absence mean different things");
  });

  it("a single observation is drawn as a point and says a line needs two", () => {
    assert.match(trendCode, /a line needs two/);
  });

  it("keeps the terminal-value figure off one scale with other horizons", () => {
    // The panel's copy is careful that this is a terminal-value VaR over a
    // horizon and NOT the one-day book VaR. Joining points measured over
    // different horizons would draw a jump in risk where only the question
    // changed, which is the same blur in chart form.
    assert.match(trendCode, /o\.horizonDays === horizonDays/);
    assert.match(trendCode, /answered a different horizon and are not on one scale/);
  });
});

describe("a point that could not be computed is absent, not zero", () => {
  it("nothing in the chart coerces a nullable figure", () => {
    assert.doesNotMatch(trendCode, /var99 \?\? 0/);
    assert.doesNotMatch(trendCode, /clientVar \?\? 0/);
    assert.doesNotMatch(panelCode, /NumberTicker value=\{[^}]*\?\? 0/);
  });

  it("the line breaks at a missing point rather than bridging it", () => {
    assert.match(trendCode, /o\.var99 === null \? null : yScale\(o\.var99\)/,
      "linePath breaks at nulls; handing it a number here would close the gap");
  });

  it("an unavailable run is still recorded, so the gap keeps its width", () => {
    assert.match(panelCode, /record\(failure\)/);
    assert.match(panelCode, /var99: answer\.state === "ok" \? answer\.var99 : null/);
  });

  it("a horizon where every run failed reports rather than inventing a scale", () => {
    // `extent` falls back to [0, 1] on an all-null series, so a chart drawn
    // anyway would carry a dollar axis running $0 to $1 under no data at all.
    assert.match(trendCode, /shown\.every\(\(o\) => o\.var99 === null && o\.clientVar === null\)/);
    assert.match(trendCode, /none of\s+which returned a figure/);
  });

  it("the missing points are counted on screen", () => {
    assert.match(trendCode, /could not be computed and are drawn as gaps, never as zero/);
  });
});

describe("a re-run repaints the chart and does not move the card", () => {
  it("the chart sits in a box reserved at its own height", () => {
    assert.ok(ORACLE_TREND_RESERVE > 0, "a reserve of zero reserves nothing");
    assert.match(panelCode, /minHeight: ORACLE_TREND_RESERVE/,
      "the reserve must be the constant the chart is drawn at, not a second literal");
    // The tiles above keep their own 192px box; the chart adds a second one
    // rather than growing the first, so neither state can collapse the other.
    assert.match(panelCode, /minHeight: 192/);
  });

  it("the measuring frame cannot collapse the reserved box", () => {
    assert.match(panelCode, /chartWidth > 0 &&/,
      "the box is the ref'd element, so it is measured whether or not the chart draws");
  });
});

describe("one observation per input set, not per attempt", () => {
  it("the point is keyed on the inputs the simulation ran on", () => {
    assert.match(panelCode, /key: `\$\{equityForRun\}\|\$\{annualVol\}\|\$\{horizonDays\}`/);
    assert.match(panelCode, /held\.findIndex\(\(o\) => o\.key === point\.key\)/,
      "a repeated request updates its own point rather than claiming a second observation");
  });

  it("the trend is capped, and the cap is what the caption counts", () => {
    assert.match(panelCode, /TREND_MAX_OBSERVATIONS/);
    assert.match(panelCode, /next\.slice\(next\.length - TREND_MAX_OBSERVATIONS\)/,
      "the oldest leaves; the chart never claims history it has dropped");
  });
});
