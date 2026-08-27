/**
 * The browser's decision thresholds are the gateway's, read from the gateway.
 *
 * This engine's maths exists twice — Python for the server and the Telegram
 * companion, TypeScript for the browser — because neither runtime can call the
 * other, and CLAUDE.md is explicit that Python is the reference. Formulas are
 * held together by parity fixtures. A bare THRESHOLD has no fixture, and it is
 * the divergence that hides best: both sides stay green, both draw a verdict,
 * and for a book near the line they draw different ones.
 *
 * So this reads the Python source and asserts the mirror against it, rather
 * than asserting the mirror against a number typed twice in this repository.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { MEANINGFUL_EDGE, MIN_TAPE_FORECASTS, THIN_CORPUS } from "../lib/coherence/thresholds";

const dutchbook = readFileSync(
  fileURLToPath(new URL("../../modules/coherence/kernel/dutchbook.py", import.meta.url)),
  "utf8",
);
const calibration = readFileSync(
  fileURLToPath(new URL("../../modules/coherence/kernel/calibration.py", import.meta.url)),
  "utf8",
);
const calibrate = readFileSync(
  fileURLToPath(new URL("../../modules/coherence/syscalls/calibrate.py", import.meta.url)),
  "utf8",
);

describe("the thresholds mirror is the gateway's own number", () => {
  it("finds MIN_MEANINGFUL_EDGE where it expects it", () => {
    // Guards the regex below: a rename that stopped it matching would make the
    // assertion pass by comparing against nothing.
    assert.match(dutchbook, /MIN_MEANINGFUL_EDGE\s*=\s*Decimal\("([\d.]+)"\)/,
      "the LP's threshold is no longer declared where the browser mirror says it is");
  });

  it("agrees with it exactly", () => {
    const found = dutchbook.match(/MIN_MEANINGFUL_EDGE\s*=\s*Decimal\("([\d.]+)"\)/);
    assert.ok(found);
    assert.equal(
      Number(found[1]),
      MEANINGFUL_EDGE,
      "lib/coherence/thresholds.ts and dutchbook.py disagree about when an optimum is a trade",
    );
  });

  it("is the exchange's own smallest increment, not a rounder number", () => {
    // A centicent. An "edge" below it is smaller than any price that could
    // express it, which is why the line sits there and not at a penny.
    assert.equal(MEANINGFUL_EDGE, 0.0001);
  });
});

describe("the figure that draws the line reads it from the mirror", () => {
  const axis = readFileSync(
    fileURLToPath(new URL("../components/coherence/MarginAxis.tsx", import.meta.url)),
    "utf8",
  );

  it("imports the threshold rather than restating it", () => {
    assert.match(axis, /import \{ MEANINGFUL_EDGE \} from "@\/lib\/coherence\/thresholds"/);
    assert.doesNotMatch(axis.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""), /0\.0001/,
      "the margin axis restates the threshold instead of reading it");
  });

  it("draws a mark rather than a bar, because the common answer sits on the line", () => {
    // A coherent optimum is at or below zero, so a bar has no length — and a
    // bar of no length is indistinguishable from a bar that failed to draw,
    // which is the failure this whole figure replaced.
    assert.match(axis, /<polygon/, "the margin is drawn as a bar again");
    assert.doesNotMatch(axis, /className="coh-margin__mark"[^>]*<rect/);
  });

  it("scales its axis to the threshold, not to the value", () => {
    // A coherent margin is a millionth of a dollar and an incoherent one can be
    // fifty; scaled to the value, `-0.000001` would draw as a mark at the edge
    // of the plot and read as an enormous something.
    assert.match(axis, /Math\.max\(MEANINGFUL_EDGE \* 5/);
  });
});

describe("the corpus thresholds are the gateway's own numbers too", () => {
  // Both were drawn on this desk before they were named: the Scorecard has
  // shown a `thin` flag and an engine word since it existed, and neither said
  // what number decided it. A reader could see "thin" without knowing whether
  // the corpus was five markets short or forty-five.
  it("finds THIN_CORPUS where it expects it, and agrees exactly", () => {
    const found = calibration.match(/^THIN_CORPUS: int = (\d+)$/m);
    assert.ok(found, "THIN_CORPUS is not declared as this expects; the assertion below would compare nothing");
    assert.equal(THIN_CORPUS, Number(found[1]),
      "the browser and the gateway disagree about when a corpus is thin");
  });

  it("finds MIN_TAPE_FORECASTS where it expects it, and agrees exactly", () => {
    const found = calibrate.match(/^MIN_TAPE_FORECASTS = (\d+)$/m);
    assert.ok(found, "MIN_TAPE_FORECASTS is not declared as this expects");
    assert.equal(MIN_TAPE_FORECASTS, Number(found[1]),
      "the browser and the gateway disagree about when a forecast test becomes a convergence test");
  });

  it("keeps them apart, because they decide different things", () => {
    // One decides whether the reliability term can be trusted; the other
    // decides which measurement was taken at all. A single number standing for
    // both would let a corpus over one floor read as over the other.
    assert.notEqual(THIN_CORPUS, MIN_TAPE_FORECASTS);
  });
});
