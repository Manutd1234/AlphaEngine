/**
 * Every axis figure on the engine answers a pointer the same way.
 *
 * `Plot` gives a figure one of two readouts: per-mark titles (a band, a
 * ladder, a waterfall — facts that belong to shapes) or a shared-x crosshair
 * (a panel of measures over one axis — facts that belong to positions). When
 * this file was written three Proofs figures used the crosshair and about
 * twenty used marks, and the axis figures among the twenty — a tape in poll
 * order, runs at their own stamps, states in ordinal order — answered a
 * pointer with a title per segment, which is a fact about a segment and not
 * the reader's question ("what was everything, THEN").
 *
 * ONE TABLE, ONE ROW PER CROSSHAIR FIGURE. Each row names the geometry
 * identifier the marks and the crosshair share, so the rule can never drift
 * from the drawing; whether the axis is by value (`positions`) or evenly
 * spaced; which end a keyboard reader arrives at; and the pair it belongs to,
 * if any. Two things a row must never carry:
 *
 *  - A `<title>`. `Plot` picks the ref by `axis`, and a leftover title beside
 *    `sharedX` makes BOTH hooks interactive — two tab stops and two voices on
 *    one figure. Per-position facts go in `read()` rows; a non-positional
 *    fact (a lane's peak, a run's length) goes in the reading, an in-plot
 *    label, or a note.
 *  - A zero for a null. A position the recorder could not measure reads "—"
 *    with its reason, never `?? 0`.
 *
 * The rows for the Markets figures are the Markets session's to add; the
 * count below moves with them.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

interface Row {
  file: string;
  /** The identifier both the marks and the crosshair position through. */
  geometry: string;
  /** `positions` declared: the axis is drawn by value, not evenly spaced. */
  byValue: boolean;
  arriveAt: "first" | "last";
  /** The pair's key, or "prop" when the figure is shared and its caller passes the key. */
  link?: string;
}

const SHARED_X: Row[] = [
  // The four that had the crosshair before this file — evenly spaced by
  // construction (runs, polls, strikes and tiers as ordinals).
  { file: "CorpusHistory.tsx", geometry: "geometry(width", byValue: false, arriveAt: "last", link: "calibration-runs" },
  { file: "FamilyRidge.tsx", geometry: "advancePx(lane.ticker", byValue: false, arriveAt: "last" },
  { file: "ConstraintLadder.tsx", geometry: "x0", byValue: false, arriveAt: "first" },
  { file: "SurvivalChart.tsx", geometry: "x(", byValue: false, arriveAt: "first" },
  // The index pair: polls at their own stamps, one index space for both.
  { file: "IndexSeriesChart.tsx", geometry: "x(", byValue: true, arriveAt: "last", link: "index-polls" },
  // Shared with the settled trend, which links it to nothing: the key is the caller's.
  { file: "MeasurabilityStrip.tsx", geometry: "x(", byValue: true, arriveAt: "last", link: "prop" },
  // The settled trend: runs at their own stamps, linked to the record of every measure.
  { file: "CalibrationTrend.tsx", geometry: "xAt(", byValue: true, arriveAt: "last", link: "calibration-runs" },
  // The basket pair: states in the exchange's order, one slot each — even by construction.
  { file: "PayoffByState.tsx", geometry: "cx(", byValue: false, arriveAt: "first", link: "basket-states" },
  // Drawn alone on the no-basket branch too, so the key is the caller's.
  { file: "StateCoverage.tsx", geometry: "cx(", byValue: false, arriveAt: "first", link: "prop" },
  // Ten equal price bands: even by construction; read through reliability-read.ts.
  { file: "ReliabilityDiagram.tsx", geometry: "px(", byValue: false, arriveAt: "first" },
];

describe("every crosshair figure on the engine", () => {
  for (const row of SHARED_X) {
    describe(row.file, () => {
      const source = read(`../components/coherence/${row.file}`);
      const code = stripNonCode(source);
      const at = code.indexOf("sharedX={");
      const block = code.slice(at, at + 1600);
      // RAW for the string literals: `stripNonCode` blanks string contents, so
      // `link: "index-polls"` reads as `link: ""` through it.
      const rawBlock = source.slice(source.indexOf("sharedX={"), source.indexOf("sharedX={") + 1600);

      it("shares one axis and carries no per-mark title", () => {
        assert.ok(at !== -1, `${row.file} no longer declares sharedX`);
        assert.doesNotMatch(code, /<title>/,
          "a title beside sharedX makes both readouts interactive — two tab stops on one figure");
      });

      it("declares which end a keyboard reader arrives at", () => {
        assert.match(source, new RegExp(`arriveAt: "${row.arriveAt}"`), `${row.file} arrives at the wrong end, or does not say`);
      });

      it("positions the crosshair through the same geometry as its marks", () => {
        const escaped = row.geometry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        assert.match(block, new RegExp(escaped), `the crosshair block does not use ${row.geometry}`);
      });

      it(row.byValue ? "declares its positions, because the axis is drawn by value" : "is evenly spaced and says nothing about positions", () => {
        if (row.byValue) assert.match(block, /positions:/, "a by-value axis without positions drifts wherever the spacing is uneven");
        else assert.doesNotMatch(block, /positions:/);
      });

      if (row.link === "prop") {
        it("links under whatever key its caller passes", () => {
          assert.match(block, /\blink,\s*\}/, "the shared figure does not pass its caller's key through");
        });
      } else if (row.link) {
        it(`links as ${row.link}`, () => {
          assert.match(rawBlock, new RegExp(`link: "${row.link}"`));
        });
      }

      it("never coerces a null position to zero", () => {
        assert.doesNotMatch(block, /\?\? 0\b/, "a position nobody measured reads as zero");
      });
    });
  }

  it("counts the rows it has", () => {
    // Ten on Proofs now; the Markets session appends theirs.
    assert.equal(SHARED_X.length, 10);
  });
});
