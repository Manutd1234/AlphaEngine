/**
 * Share of gross against share of P&L: the numbers, before the drawing.
 *
 * Grammar rule 4. The trap this derivation carries — P&L is signed and its
 * total can be near zero, so "share of P&L" is not a share of a whole — is
 * exactly the kind of thing a source scan can hold and a rendered figure
 * cannot: a wrong denominator draws a plausible scatter.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { contributionPoints, contributionReading } from "../lib/portfolio-risk/contribution";

const pos = (symbol: string, share: number, pnl: number) =>
  ({ symbol, share_of_gross: share, realized_pnl: pnl, unrealized_pnl: 0 });

describe("contribution is P&L over the book's total ABSOLUTE P&L", () => {
  it("sums to the book's sign, so a loser on a winning book reads below zero", () => {
    const s = contributionPoints([pos("A", 0.5, 300), pos("B", 0.5, -100)]);
    const a = s.points.find((p) => p.symbol === "A")!;
    const b = s.points.find((p) => p.symbol === "B")!;
    assert.equal(a.contribution, 0.75);
    assert.equal(b.contribution, -0.25);
    assert.equal(a.contribution + b.contribution, 0.5, "shares sum to the book's net sign, not to one");
  });

  it("never divides by a net that cancels", () => {
    // Two positions, +100 and -100: net zero, absolute 200. A share of NET
    // would be Infinity. A share of ABSOLUTE is ±0.5, which is readable.
    const s = contributionPoints([pos("A", 0.5, 100), pos("B", 0.5, -100)]);
    assert.ok(s.points.every((p) => Number.isFinite(p.contribution)));
    assert.deepEqual(s.points.map((p) => p.contribution), [0.5, -0.5]);
  });

  it("marks above, below and on the line", () => {
    const s = contributionPoints([pos("A", 0.2, 600), pos("B", 0.7, 300), pos("C", 0.1, 100)]);
    const by = Object.fromEntries(s.points.map((p) => [p.symbol, p]));
    assert.equal(by.A.earnedMoreThanSize, true, "20% of gross, 60% of P&L: above the line");
    assert.equal(by.B.earnedMoreThanSize, false, "70% of gross, 30% of P&L: below");
    assert.equal(by.C.earnedMoreThanSize, null, "10% of gross, 10% of P&L: on it");
  });
});

describe("withheld, never drawn at the origin", () => {
  it("an empty book", () => {
    const s = contributionPoints([]);
    assert.equal(s.points.length, 0);
    assert.match(s.withheld!, /no positions/);
  });

  it("a book with no P&L to attribute", () => {
    const s = contributionPoints([pos("A", 0.6, 0), pos("B", 0.4, 0)]);
    assert.equal(s.points.length, 0);
    assert.match(s.withheld!, /zero P&L/);
  });

  it("a book with no gross", () => {
    const s = contributionPoints([pos("A", 0, 50)]);
    assert.equal(s.points.length, 0);
    assert.match(s.withheld!, /no gross/);
  });
});

describe("the reading names the two positions a reader wants", () => {
  it("best above the line, worst below, with both shares", () => {
    const s = contributionPoints([pos("BTC", 0.2, 600), pos("ETH", 0.7, 300), pos("SOL", 0.1, 100)]);
    const r = contributionReading(s);
    assert.match(r, /^BTC is 20% of gross and 60% of the P&L/);
    assert.match(r, /ETH is 70% of gross and 30% of the P&L\.$/);
  });

  it("says withheld when it is, and never a clean sentence over nothing", () => {
    assert.match(contributionReading(contributionPoints([])), /^Withheld:/);
  });
});

/* ── The figure's structure ────────────────────────────────────────────── */

import { read } from "./helpers/workspace-sources";

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");


// Comments stripped, NOT `stripNonCode`: that helper blanks string literals,
// and half of what this guards IS a string literal — the ▲ in a title, the
// hatch url. The first run reported every one of them missing.
const figure = stripComments(read("../components/portfolio/ContributionScatter.tsx"));

describe("the scatter is an instrument in EdgeScatter's grammar", () => {
  it("is non-empty", () => assert.ok(figure.length > 1200));

  it("takes the mark readout, not a shared axis — its x is a value", () => {
    // Grammar rule 7: `sharedX` snaps by even division, and weights are never
    // evenly spaced, so the cursor would land on the wrong dot.
    assert.match(figure, /<Plot/);
    assert.doesNotMatch(figure, /sharedX=/, "the scatter uses a shared axis over a value x");
  });

  it("draws the diagonal as the plot's reference, in EdgeScatter's classes", () => {
    assert.match(figure, /y1: y\(1\)/, "the reference is level, not the earned-its-size diagonal");
    assert.match(figure, /coh-edge__dot/, "the dots do not share EdgeScatter's class, so the two figures look different");
    assert.doesNotMatch(figure, /coh-edge__fair/, "the diagonal is hand-drawn instead of the plot's reference");
  });

  it("carries above/below in words, not colour alone", () => {
    assert.match(figure, /▲ above/);
    assert.match(figure, /▼ below/);
    assert.match(figure, /on the line/);
  });

  it("withholds through FigureEmpty and derives from the pure module", () => {
    assert.match(figure, /<FigureEmpty/);
    assert.match(figure, /contributionPoints\(positions\)/);
    assert.doesNotMatch(figure, /realized_pnl \+ /, "the figure recomputes P&L instead of reading the derivation");
  });
});
