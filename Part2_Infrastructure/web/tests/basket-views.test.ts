/**
 * Basket asks three questions, so it has three views.
 *
 * Ian: "Redo the baskets section and use better diagrams and subtabs inside".
 * It was one view carrying two different answers stacked — what a cover costs,
 * and what the portfolio the solver returned pays — plus a branch for the
 * common case where there IS no portfolio, because the exchange is almost
 * always coherent. A reader who came for one met the other first.
 *
 * THE THREE ARE THREE QUESTIONS, and each is drawable on a different set of
 * reads, which is why they are views rather than one scroll:
 *
 *   Cover  — what buying the cover costs. Drawable ALWAYS: it needs the
 *            quotes, not the certificate, so it draws while the test runs.
 *   Basket — the portfolio the test handed back. Honestly empty on the
 *            ordinary answer, and says which answer that is.
 *   Size   — whether it can be put on at all: each leg's size against the
 *            open interest actually outstanding at that strike.
 *
 * WHAT MUST NOT REGRESS. `BasketWhatIf` is not gated on the certificate — that
 * was deliberate and is the reason the section has anything to look at while a
 * 188-strike family is being certified. The state space is still computed once
 * for every view, `exact` still decides whether a ticker match is a covering,
 * and the leg table still carries the portfolio at the exchange's own
 * precision.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

const section = read("../components/coherence/BasketSection.tsx");
const pane = read("../components/coherence/PortfolioPane.tsx");
const footprint = existsSync(new URL("../components/coherence/BasketFootprint.tsx", import.meta.url))
  ? read("../components/coherence/BasketFootprint.tsx")
  : "";
const sectionViews = read("../lib/section-views.ts");

describe("the section carries the switcher and the views are addressable", () => {
  it("declares the three, in the order a reader meets them", () => {
    assert.match(section, /\["cover", "Cover"\][\s\S]{0,80}\["basket", "Basket"\][\s\S]{0,80}\["size", "Size"\]/,
      "BasketSection has no three-view pairs array");
    assert.match(section, /<div className="seg" role="group" aria-label="Basket view">/,
      "the section draws no switcher");
  });

  it("section-views declares them, so each has a URL, a palette entry and a sweep cell", () => {
    assert.match(sectionViews, /portfolio: \[\["cover", "Cover"\], \["basket", "Basket"\], \["size", "Size"\]\]/,
      "the view table still says Basket is single-view");
  });

  it("the cover figure is still ungated on the certificate", () => {
    // A 188-strike family takes seconds to certify. Gated, the one operated
    // figure on this tab vanishes exactly while a reader is waiting.
    assert.match(section, /view === "cover" && chosen \? <BasketWhatIf event=\{chosen\} \/> : null/,
      "BasketWhatIf is gated on the answer, or is no longer on the Cover view");
  });
});

describe("the pane is a dispatcher over three views", () => {
  it("exports one function per view", () => {
    for (const view of ["CoverView", "BasketView", "SizeView"]) {
      assert.match(pane, new RegExp(`export function ${view}\\(`), `${view} is not exported`);
    }
  });

  it("computes the state space once, for every view", () => {
    assert.match(pane, /const exact = Boolean\(chosen\?\.mutually_exclusive\);/,
      "the exactness of the covering is no longer decided in one place");
    assert.equal((pane.match(/const states: CoverageState\[\]/g) ?? []).length, 1,
      "the state space is rebuilt per view");
  });

  it("Cover leads with the shortfall and the covering, side by side", () => {
    const body = pane.slice(pane.indexOf("export function CoverView("), pane.indexOf("export function BasketView("));
    assert.ok(body.length > 200, "CoverView was not found");
    assert.match(body, /<ShortfallScale/, "the shortfall is not on the view about what a cover costs");
    assert.match(body, /<StateCoverage/, "what the cover would have to cover is not drawn");
  });

  it("Basket says which answer it is empty for, rather than drawing nothing", () => {
    const body = pane.slice(pane.indexOf("export function BasketView("), pane.indexOf("export function SizeView("));
    assert.ok(body.length > 200, "BasketView was not found");
    // The REASON on the empty frame, not merely the word somewhere in the
    // function: `missing` also says "Coherent", so a file-scoped match was
    // green with the drawn reason mutated to "Nothing to draw."
    assert.match(body, /<FigureEmpty reason="Coherent[^"]*" \/>/,
      "the empty frame does not name the verdict that produced it, so it reads like a feed that failed");
    assert.match(body, /<PayoffByState/, "the payoff figure is gone");
    assert.match(body, /<LinkedX>/, "the payoff and the covering no longer share a crosshair");
    assert.match(body, /Every leg through all three fee components/, "the leg table's fold lost its summary");
  });

  it("Size draws the footprint and nothing that needs a certificate it may not have", () => {
    const body = pane.slice(pane.indexOf("export function SizeView("));
    assert.ok(body.length > 100, "SizeView was not found");
    assert.match(body, /<BasketFootprint/, "the footprint is not on the Size view");
  });
});

describe("BasketFootprint measures a size against what is outstanding", () => {
  it("exists and reads the market's open interest by ticker", () => {
    assert.ok(footprint.length > 0, "BasketFootprint.tsx does not exist");
    assert.match(footprint, /open_interest/, "the footprint measures against nothing");
    assert.match(footprint, /find\(\(market\) => market\.ticker === leg\.ticker\)/,
      "a leg is matched to a market by something other than its ticker");
  });

  it("never coerces an unreported open interest to zero", () => {
    assert.doesNotMatch(stripNonCode(footprint), /\?\? 0\b|\|\| 0\b/,
      "a leg whose open interest the venue withheld is drawn as a leg nobody holds");
    assert.match(footprint, /not reported/, "an unreported open interest is not named as unreported");
  });

  it("counts a leg that is not in this family rather than dropping it", () => {
    assert.match(footprint, /offBoard/,
      "a leg naming a market outside the family vanishes, so the figure draws a smaller basket than the solver built");
  });

  it("draws the whole outstanding interest as the rule the shares are read against", () => {
    assert.match(footprint, /reference=\{/, "there is no rule at the whole open interest");
  });
});
