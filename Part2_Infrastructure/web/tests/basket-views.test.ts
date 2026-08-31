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
const nullInstrument = read("../components/coherence/BasketNullInstrument.tsx");
const footprint = existsSync(new URL("../components/coherence/BasketFootprint.tsx", import.meta.url))
  ? read("../components/coherence/BasketFootprint.tsx")
  : "";
const sectionViews = read("../lib/section-views.ts");

describe("the section carries the switcher and the views are addressable", () => {
  it("declares the three, in the order a reader meets them", () => {
    assert.match(section, /\["cover", "Cover"\][\s\S]{0,80}\["basket", "Basket"\][\s\S]{0,80}\["size", "Size"\]/,
      "BasketSection has no three-view pairs array");
    assert.match(
      section,
      /<ProofsViewControl[\s\S]{0,180}className="seg"[\s\S]{0,180}label="Basket view"[\s\S]{0,180}options=\{VIEWS\}[\s\S]{0,180}value=\{view\}[\s\S]{0,180}onValue=\{onView\}/,
      "the section no longer draws the canonical, addressable Basket switcher",
    );
  });

  it("section-views declares them, so each has a URL, a palette entry and a sweep cell", () => {
    assert.match(sectionViews, /portfolio: \[\["cover", "Cover"\], \["basket", "Basket"\], \["size", "Size"\]\]/,
      "the view table still says Basket is single-view");
  });

  it("the cover figure is still ungated on the certificate", () => {
    // A 188-strike family takes seconds to certify. Gated, the one operated
    // figure on this tab vanishes exactly while a reader is waiting.
    assert.match(
      section,
      /view === "cover" && chosen \?[\s\S]{0,420}<BasketWhatIf key=\{chosen\.event_ticker\} event=\{chosen\} \/>[\s\S]{0,80}: null/,
      "BasketWhatIf is gated on the answer, or is no longer on the Cover view");
  });

  it("keeps Basket and Size visibly operable while their matching certificate is absent", () => {
    assert.match(section, /type BasketReadState = "pending" \| "stale-target" \| "unavailable"/,
      "the view cannot distinguish an arriving read, a previous-family snapshot and a failed read");
    assert.match(section, /data && data\.component_id !== target[\s\S]*?"stale-target"/,
      "a cached certificate for the previous family is not named as a transition");
    assert.match(
      section,
      /view === "basket" \|\| view === "size" \?[\s\S]*?<BasketViewReadStatus[\s\S]*?onRetry=\{read\.refresh\}/,
      "Basket and Size still render no body before the matching certificate arrives",
    );
    assert.match(section, /role="status"[\s\S]*?aria-live="polite"[\s\S]*?aria-busy=/,
      "the non-settled view state is not announced as an accessible status");
    assert.match(section, /state === "unavailable"[\s\S]*?<Button[\s\S]*?onClick=\{onRetry\}/,
      "a failed Basket or Size read has no local retry action");
    assert.doesNotMatch(section, /\{answer \? <PortfolioPane[^\n]+: null\}/,
      "the old answer gate still reduces Basket and Size to an empty body");
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

  it("Basket draws the coherent zero-leg lifecycle rather than a weak empty frame", () => {
    const body = pane.slice(pane.indexOf("export function BasketView("), pane.indexOf("export function SizeView("));
    assert.ok(body.length > 200, "BasketView was not found");
    assert.match(body, /<BasketNullInstrument variant="basket"/,
      "the ordinary coherent result is back to an undifferentiated empty frame");
    assert.match(nullInstrument, /value: `\|L\| = \$\{legCount\} returned`/,
      "the lifecycle hard-codes the zero-leg result instead of reading the certificate");
    assert.match(nullInstrument, /undefined, not zero|withheld/i,
      "the lifecycle can be mistaken for a measured zero payoff");
    assert.match(nullInstrument, /className=\{styles\.dependencyRail\}/,
      "the zero-leg answer fell back to three inert boxes");
    assert.match(nullInstrument, /className=\{styles\.dependencyGauge\}/,
      "the dependency circuit has no selected-stage progress measure");
    assert.match(nullInstrument, /className=\{styles\.dependencyInspector\}/,
      "the dependency circuit has no full selected-stage explanation");
    assert.match(nullInstrument, /className=\{styles\.settlementStrip\}/,
      "the Basket circuit no longer shows the exact settlement field it declined to score");
    assert.match(body, /<PayoffByState/, "the payoff figure is gone");
    assert.match(body, /<LinkedX>/, "the payoff and the covering no longer share a crosshair");
    assert.match(body, /Every leg through all three fee components/, "the leg table's fold lost its summary");
  });

  it("Size draws the footprint and nothing that needs a certificate it may not have", () => {
    const body = pane.slice(pane.indexOf("export function SizeView("));
    assert.ok(body.length > 100, "SizeView was not found");
    assert.match(body, /return <BasketNullInstrument variant="size" certificate=\{certificate\} event=\{chosen\} \/>/,
      "the zero-leg Size view does not lead with its own capacity gate");
    assert.doesNotMatch(body, /<LegSizes\b/,
      "Basket Size is still the same family-size curve as Coherence Test Sizes");
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

  it("puts the requirement and whole outstanding interest on the same capacity row", () => {
    assert.match(footprint, /label="Requirement"/, "the certificate requirement is not visible");
    assert.match(footprint, /label="Available \/ open interest"/, "the available open interest is not visible");
    assert.match(footprint, /scale=\{scale\}/, "the two capacity bars do not share one per-leg scale");
    assert.match(footprint, /aria-pressed=\{selected === index\}/,
      "the capacity row does not expose its selected state");
    for (const event of ["onPointerEnter", "onFocus", "onClick"]) {
      assert.match(footprint, new RegExp(event), `${event} does not inspect a capacity row`);
    }
    assert.match(footprint, /data-selected-detail=""[\s\S]*?aria-live="polite"/,
      "the selected leg's exact numerator and denominators are not announced");
  });
});
