/**
 * The x-axis labels, and the arithmetic that keeps them apart.
 *
 * THE BUG. `XAxis` chose its ticks with a constant: keep a candidate when its
 * tick CENTRE is at least `minGap` = 78px from every centre already kept. What
 * must not overlap is the rendered TEXT, and text width is not a constant —
 * `07 Mar` is six characters where `21 Sept 25` is ten. Worse, the outermost
 * labels are anchored inward (`start` runs rightwards from its tick, `end`
 * leftwards from its), so the two outer gaps have to hold one and a half
 * labels where an interior gap holds one. Three anchor modes, three
 * clearances, one number — and on the research charts the ends printed through
 * their neighbours: `21 Sept` over `25 Nov 25`, `26 Jun 26` over `26 Aug 26`.
 *
 * THE PROPERTY. Given a series and a formatter, no two labels the axis keeps
 * may overlap once each is laid out at the anchor it will actually be drawn
 * with. It holds for every formatter in use, at every width, or the axis is
 * broken at some width nobody screenshotted.
 *
 * Reading `chart-axis.ts` as text could never have caught this, which is why
 * the geometry is a module and this test calls it.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  LABEL_CLEARANCE,
  MONO_ADVANCE_EM,
  TICK_FONT_SIZE,
  axisTicks,
  labelExtent,
  type AxisTick,
} from "../components/chart-axis";
import { shortDate } from "../lib/format";

const root = fileURLToPath(new URL("..", import.meta.url));

/** `DEFAULT_MARGIN` in chart-kit: every dated chart lays out inside these. */
const MARGIN = { left: 52, right: 56 };

const DAY = 86_400_000;
/** The series in the screenshot: a year of daily closes from 21 September. */
const daily = (n: number, from = Date.UTC(2025, 8, 21)) =>
  Array.from({ length: n }, (_, i) => from + i * DAY);
const minutely = (n: number, from = Date.UTC(2026, 0, 8, 8, 0)) =>
  Array.from({ length: n }, (_, i) => from + i * 60_000);

/** The clock formatters the two operational charts pass. */
const clock = (t: number) =>
  new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const clockDefaultLocale = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Every component that mounts an `<XAxis>`, with the formatter it passes.
 *
 * The fix has to hold for the WIDEST formatter in use, not the one that was
 * screenshotted, so the coverage test below refuses to let a new chart mount
 * the axis without landing here first.
 */
const CALLERS: Record<string, Array<{ format: (v: number) => string; points: number[] }>> = {
  "components/PriceChart.tsx": [{ format: shortDate, points: daily(365) }],
  "components/EquityChart.tsx": [{ format: shortDate, points: daily(365) }],
  "components/portfolio/VarBacktestChart.tsx": [
    // Dated when the series carries timestamps, ordinal when it does not.
    { format: shortDate, points: daily(250) },
    { format: (v) => `#${Math.round(v)}`, points: daily(250).map((_, i) => i) },
  ],
  "components/portfolio/RiskAdjustedTrend.tsx": [{ format: clock, points: minutely(240) }],
  "components/systems/LatencyTrend.tsx": [{ format: clockDefaultLocale, points: minutely(240) }],
};

/** Plot widths from a phone column to an ultrawide desk pane. */
const WIDTHS = [280, 320, 420, 560, 680, 720, 860, 1024, 1280, 1600, 1920];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every pair of kept labels, left to right, as the gap between their extents. */
function gaps(ticks: AxisTick[]): Array<{ gap: number; left: AxisTick; right: AxisTick }> {
  const out = [];
  for (let i = 1; i < ticks.length; i++) {
    const [, leftEnd] = labelExtent(ticks[i - 1].x, ticks[i - 1].label, ticks[i - 1].anchor);
    const [rightStart] = labelExtent(ticks[i].x, ticks[i].label, ticks[i].anchor);
    out.push({ gap: rightStart - leftEnd, left: ticks[i - 1], right: ticks[i] });
  }
  return out;
}

describe("no two axis labels overlap", () => {
  it("holds for every formatter mounted on XAxis, at every width", () => {
    const offenders: string[] = [];
    for (const [file, cases] of Object.entries(CALLERS)) {
      for (const { format, points } of cases) {
        for (const width of WIDTHS) {
          const x0 = MARGIN.left;
          const x1 = Math.max(x0 + 10, width - MARGIN.right);
          const ticks = axisTicks({ points, x0, x1, format });
          for (const { gap, left, right } of gaps(ticks)) {
            if (gap < LABEL_CLEARANCE) {
              offenders.push(
                `${file} at ${width}px — "${left.label}" (${left.anchor}) and ` +
                  `"${right.label}" (${right.anchor}) are ${gap.toFixed(1)}px apart`,
              );
            }
          }
        }
      }
    }
    assert.deepEqual(offenders, [], `labels collide:\n  ${offenders.join("\n  ")}`);
  });

  it("covers every component that mounts the axis", () => {
    // A new chart with a wider formatter is exactly how this regresses.
    const mounted = sources(join(root, "components"))
      .filter((file) => /<XAxis[\s/>]/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(root.length))
      .sort();
    assert.deepEqual(
      mounted,
      Object.keys(CALLERS).sort(),
      "a chart mounts <XAxis> with a formatter this test has never laid out",
    );
  });
});

describe("the screenshot", () => {
  // 720px is `useMeasuredWidth`'s own fallback and sits mid-range for a
  // research pane, so this is the axis as reported, not a contrived width.
  const x0 = MARGIN.left;
  const x1 = 720 - MARGIN.right;
  const points = daily(365);
  const ticks = axisTicks({ points, x0, x1, format: shortDate });

  it("prints the reported dates without printing them on top of each other", () => {
    assert.match(ticks[0].label, /^21 Sept? 25$/, "the series still starts where it did");
    for (const { gap, left, right } of gaps(ticks)) {
      assert.ok(gap >= LABEL_CLEARANCE, `"${left.label}" and "${right.label}" overlap`);
    }
  });

  it("would have failed against the rule that shipped", () => {
    /**
     * The shipped selection, reproduced: evenly spaced indices plus a forced
     * final tick, kept when the CENTRES are `minGap` apart. If this still
     * cleared its own labels the property above would be proving nothing.
     */
    const minGap = 78;
    const xScale = (i: number) => x0 + (i / (points.length - 1)) * (x1 - x0);
    const target = Math.max(2, Math.min(7, Math.floor((x1 - x0) / minGap) + 1));
    const candidates = [points.length - 1];
    const stride = (points.length - 1) / (target - 1);
    for (let k = target - 2; k >= 0; k--) candidates.push(Math.round(k * stride));
    const kept: number[] = [];
    for (const i of candidates) {
      if (kept.every((j) => Math.abs(xScale(i) - xScale(j)) >= minGap)) kept.push(i);
    }
    kept.sort((a, b) => a - b);
    const shipped: AxisTick[] = kept.map((i, k) => ({
      index: i,
      x: xScale(i),
      label: shortDate(points[i]),
      anchor: k === 0 ? "start" : i === points.length - 1 ? "end" : "middle",
    }));

    const collisions = gaps(shipped).filter(({ gap }) => gap < 0);
    assert.ok(
      collisions.length > 0,
      "the old constant-gap rule must overlap here, or this axis was never the bug",
    );
    assert.ok(
      shipped.length > ticks.length,
      "the fix trades tick count for legibility: it must keep fewer than the rule that overlapped",
    );
  });
});

describe("the three anchor modes get three clearances", () => {
  const wide = (n: number) => Array.from({ length: n }, (_, i) => i);
  const ten = () => "0123456789";
  const width = () => 10 * TICK_FONT_SIZE * MONO_ADVANCE_EM;

  it("measures the first label rightwards from its tick", () => {
    const ticks = axisTicks({ points: wide(200), x0: 0, x1: 900, format: ten });
    assert.equal(ticks[0].anchor, "start");
    assert.deepEqual(labelExtent(ticks[0].x, ticks[0].label, ticks[0].anchor), [0, width()]);
    assert.ok(
      gaps(ticks)[0].gap >= LABEL_CLEARANCE,
      "the second label was placed as though the first were centred on its tick",
    );
  });

  it("measures the last label leftwards from its tick", () => {
    const ticks = axisTicks({ points: wide(200), x0: 0, x1: 900, format: ten });
    const end = ticks[ticks.length - 1];
    assert.equal(end.anchor, "end");
    assert.deepEqual(labelExtent(end.x, end.label, end.anchor), [900 - width(), 900]);
  });

  it("measures an interior label half each way", () => {
    const [, middle] = axisTicks({ points: wide(200), x0: 0, x1: 900, format: ten });
    assert.equal(middle.anchor, "middle");
    assert.deepEqual(labelExtent(middle.x, middle.label, middle.anchor), [
      middle.x - width() / 2,
      middle.x + width() / 2,
    ]);
  });
});

describe("a tick is dropped rather than overprinted", () => {
  const points = daily(365);

  it("thins the axis as the pane narrows, and never below the two endpoints", () => {
    const counts = WIDTHS.map(
      (w) =>
        axisTicks({
          points,
          x0: MARGIN.left,
          x1: Math.max(MARGIN.left + 10, w - MARGIN.right),
          format: shortDate,
        }).length,
    );
    for (let i = 1; i < counts.length; i++) {
      assert.ok(counts[i] >= counts[i - 1], `a wider pane lost a label: ${counts.join(",")}`);
    }
    assert.ok(Math.min(...counts) >= 2, `an axis fell below two dates: ${counts.join(",")}`);
    assert.ok(Math.max(...counts) <= 7, "the axis never exceeds its own tick budget");
  });

  it("never truncates or ellipsises a date to make one fit", () => {
    for (const width of WIDTHS) {
      const ticks = axisTicks({
        points,
        x0: MARGIN.left,
        x1: Math.max(MARGIN.left + 10, width - MARGIN.right),
        format: shortDate,
      });
      for (const tick of ticks) {
        assert.equal(
          tick.label,
          shortDate(points[tick.index]),
          "a label was rewritten rather than dropped",
        );
        assert.doesNotMatch(tick.label, /[…]|\.\.\./, "a half-printed date is a wrong date");
      }
    }
  });

  it("keeps both ends of a two-point series, and the one end of a one-point series", () => {
    const pair = axisTicks({ points: daily(2), x0: 52, x1: 664, format: shortDate });
    assert.deepEqual(
      pair.map((t) => t.anchor),
      ["start", "end"],
    );
    const single = axisTicks({ points: daily(1), x0: 52, x1: 664, format: shortDate });
    assert.equal(single.length, 1);
    assert.equal(single[0].label, shortDate(daily(1)[0]));
  });

  it("returns nothing for an empty series rather than inventing a domain", () => {
    assert.deepEqual(axisTicks({ points: [], x0: 52, x1: 664, format: shortDate }), []);
  });
});

describe("the advance width is measured, not guessed", () => {
  it("covers the widest face in the --mono stack", () => {
    /**
     * Read out of the shipped font files, all of them monospace so one advance
     * describes every glyph: JetBrains Mono (the webfont next/font serves)
     * 600/1000 upem = 0.600em, Menlo 1233/2048 = 0.60205em, Andale Mono
     * 1229/2048 = 0.60010em. The constant has to cover the whole stack,
     * because a machine that never loads the webfont still has to lay out.
     */
    assert.ok(MONO_ADVANCE_EM >= 1233 / 2048, "narrower than Menlo: labels would touch");
    assert.ok(MONO_ADVANCE_EM < 0.62, "padded so far it is no longer a measurement");
  });

  it("keeps the tick size on the inline rung the axis draws with", () => {
    const chartKit = readFileSync(join(root, "components/chart-kit.tsx"), "utf8");
    assert.match(chartKit, /fontSize=\{TICK_FONT_SIZE\}/);
    assert.equal(TICK_FONT_SIZE, 12.5);
  });
});
