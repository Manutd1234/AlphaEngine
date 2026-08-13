/**
 * The ring that painted nothing on the only book we actually run.
 *
 * `AllocationDonut` hand-built its arcs. With a single 100% slice the outer
 * arc's start and end are the same point — and SVG 1.1 §F.6.2 says an
 * elliptical-arc segment whose endpoints are identical is dropped entirely. Both
 * arcs went, leaving `M…L…Z`: a line, zero area, `fill` and no `stroke`. The
 * live deployment holds exactly one position, so the card was a blank 190×190
 * box with a number floating in the middle of it.
 *
 * Nothing caught it because everything else was right: the component rendered,
 * the aria-label was accurate, the legend printed the correct 100%. So this does
 * not assert on the path string — a string assertion would have passed on the
 * broken version too. It MEASURES the area a renderer would actually fill,
 * reproducing the drop rule rather than papering over it, and checks that each
 * slice paints its own share of the ring at 1, 2 and 8 slices. The multi-slice
 * case is the common one and must not regress to fix the single-slice one.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DONUT_RADIUS,
  DONUT_SIZE,
  DONUT_THICKNESS,
  donutArc,
} from "../components/portfolio/donut-arc";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const TAU = Math.PI * 2;
const CENTRE = DONUT_SIZE / 2;
const INNER = DONUT_RADIUS - DONUT_THICKNESS;
/** Area of the complete annulus, which every slice set must sum back to. */
const RING = Math.PI * (DONUT_RADIUS ** 2 - INNER ** 2);

/** Boundary angles for `n` equal slices, as the component lays them out. */
const equalSlices = (n: number): Array<[number, number]> =>
  Array.from({ length: n }, (_, i) => [(TAU * i) / n, (TAU * (i + 1)) / n]);

/** One `M`/`A`/`L`/`Z` command and its numbers. */
type Command = { type: string; nums: number[] };

const commands = (d: string): Command[] =>
  (d.match(/[MALZ][^MALZ]*/g) ?? []).map((token) => ({
    type: token[0],
    nums: (token.slice(1).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number),
  }));

/**
 * The area a renderer would fill, by flattening the path the way one does.
 *
 * The load-bearing line is the coincident-endpoint check: SVG DROPS such a
 * segment, so this drops it too. Softening that into "treat it as a full circle"
 * would make the harness pass on the exact path that shipped blank.
 */
function paintedArea(d: string): number {
  const points: Array<[number, number]> = [];
  let cursor: [number, number] = [0, 0];

  for (const { type, nums } of commands(d)) {
    if (type === "M" || type === "L") {
      cursor = [nums[0], nums[1]];
      points.push(cursor);
      continue;
    }
    if (type !== "A") continue; // `Z` closes; the shoelace below already wraps.

    const [radius, , , , sweepFlag, x, y] = nums;
    if (x === cursor[0] && y === cursor[1]) continue; // §F.6.2: segment omitted.

    const from = Math.atan2(cursor[1] - CENTRE, cursor[0] - CENTRE);
    const to = Math.atan2(y - CENTRE, x - CENTRE);
    let delta = to - from;
    if (sweepFlag === 1) while (delta <= 0) delta += TAU;
    else while (delta >= 0) delta -= TAU;

    const steps = 128;
    for (let i = 1; i <= steps; i++) {
      const angle = from + (delta * i) / steps;
      points.push([CENTRE + radius * Math.cos(angle), CENTRE + radius * Math.sin(angle)]);
    }
    cursor = [x, y];
  }

  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    twice += x0 * y1 - x1 * y0;
  }
  return Math.abs(twice) / 2;
}

describe("the measurement itself catches the defect", () => {
  it("scores the path that shipped as zero area", () => {
    // Byte-for-byte what the old builder emitted for a one-position book. If
    // this ever reads as painted, every assertion below is vacuous.
    const shipped = "M95.00,21.00A74,74 0 1 1 95.00,21.00L95.00,47.00A48,48 0 1 0 95.00,47.00Z";
    assert.equal(paintedArea(shipped), 0);
  });

  it("scores a known annulus correctly, so the flattener is not just optimistic", () => {
    const half = paintedArea(donutArc(0, Math.PI));
    assert.ok(
      Math.abs(half - RING / 2) / RING < 0.005,
      `a half ring measured ${half.toFixed(1)} against ${(RING / 2).toFixed(1)}`,
    );
  });
});

describe("every slice paints the share it claims", () => {
  for (const count of [1, 2, 8]) {
    it(`${count} slice${count === 1 ? "" : "s"}: each arc fills its own wedge and they sum to the ring`, () => {
      const slices = equalSlices(count);
      let total = 0;

      for (const [from, to] of slices) {
        const area = paintedArea(donutArc(from, to));
        const expected = ((to - from) / TAU) * RING;
        assert.ok(area > 0, `a slice of ${(((to - from) / TAU) * 100).toFixed(1)}% painted nothing`);
        assert.ok(
          Math.abs(area - expected) / expected < 0.01,
          `slice ${from.toFixed(2)}→${to.toFixed(2)} painted ${area.toFixed(1)}, expected ${expected.toFixed(1)}`,
        );
        total += area;
      }

      assert.ok(
        Math.abs(total - RING) / RING < 0.01,
        `${count} slices covered ${total.toFixed(1)} of a ${RING.toFixed(1)} ring`,
      );
    });
  }

  it("a lone 100% slice is a full ring, which is the case that was broken", () => {
    const area = paintedArea(donutArc(0, TAU));
    assert.ok(area / RING > 0.99, `the whole book painted ${((area / RING) * 100).toFixed(1)}% of the ring`);
  });
});

describe("no segment can be dropped at any slice count", () => {
  it("every arc command moves the cursor", () => {
    for (const count of [1, 2, 3, 4, 8, 12]) {
      for (const [from, to] of equalSlices(count)) {
        const d = donutArc(from, to);
        let cursor: [number, number] | null = null;
        for (const { type, nums } of commands(d)) {
          if (type === "M" || type === "L") { cursor = [nums[0], nums[1]]; continue; }
          if (type !== "A") continue;
          const end: [number, number] = [nums[5], nums[6]];
          assert.ok(cursor, "an arc preceded the first move");
          assert.ok(
            end[0] !== cursor![0] || end[1] !== cursor![1],
            `${count} slices: an arc starts and ends on ${end.join(",")} and would be dropped`,
          );
          cursor = end;
        }
      }
    }
  });

  it("costs nothing on the slice sizes a real book draws", () => {
    // The split must not turn every ordinary slice into a fan of segments: a
    // quarter turn or less — any book of four or more — stays one arc per edge.
    const arcs = commands(donutArc(0, TAU / 8)).filter((c) => c.type === "A");
    assert.equal(arcs.length, 2, "an eighth of the ring should still be one outer and one inner arc");
  });
});

describe("the card draws through the measured builder", () => {
  const donut = read("../components/portfolio/AllocationDonut.tsx");

  it("no longer hand-rolls its own arcs", () => {
    assert.match(donut, /donutArc\(s\.from, s\.to\)/);
    assert.doesNotMatch(
      donut.replace(/\/\*[\s\S]*?\*\//g, ""),
      /function arc\(/,
      "a second arc builder reappeared beside the tested one",
    );
  });

  it("collapses the facts row when the three facts are one fact", () => {
    /**
     * With one position, largest share, HHI and effective positions are the
     * same tautology three times: 100%, 1.000, 1.0. Printed side by side they
     * read as three independent findings about concentration.
     */
    assert.match(donut, /slices\.length === 1 \?/);
    assert.match(donut, /trivially 100% of itself/);
  });

  it("does not say '1 positions' to a screen reader", () => {
    assert.match(donut, /position\$\{slices\.length === 1 \? "" : "s"\}/);
  });
});
