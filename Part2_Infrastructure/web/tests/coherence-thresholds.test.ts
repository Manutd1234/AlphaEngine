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

import { MEANINGFUL_EDGE } from "../lib/coherence/thresholds";

const dutchbook = readFileSync(
  fileURLToPath(new URL("../../modules/coherence/kernel/dutchbook.py", import.meta.url)),
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
