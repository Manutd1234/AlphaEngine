/**
 * The two diagrams on the Developer tab, and the width they are allowed to use.
 *
 * REPORTED, against the Overview subtab: "use the empty space on the left and
 * right, the words are not aligned properly and the diagram seems very
 * compressed." The surface is `.developer-cp-topology` — kicker "Runtime map",
 * heading "Deployment topology" — a runtime band and three deployable cards on
 * one scoped grid-paper field. It is the only surface on the tab whose
 * geometry was written as fixed centred measures, and it is drawn in DOM and
 * CSS: there is no SVG on this tab at all, so no `viewBox` and no
 * `preserveAspectRatio` were ever in play, and none may arrive to reinstate the
 * letterboxing under a different name.
 *
 * Four defects, four claims here. Geometry is pinned to the layout contract
 * rather than a remembered screenshot.
 *
 *  1. The head of the diagram may not be boxed into a centred measure while the
 *     plane around it is empty. `.developer-cp-edge` was `min(420px, 72%)` on a
 *     1168px plane — 374px of bare space on each side.
 *  2. The topology card uses the ordinary panel surface; the former foolscap
 *     grid competed with the node paths and status pills.
 *  3. The ornamental dashed fork must not return. The enclosing runtime map
 *     already expresses the relationship and the fork read as stray guides.
 *  4. The five rows of the three node cards must share row lines, so a path
 *     that wraps to two lines in one card does not drop that card's detail
 *     sentence a line below its neighbours'.
 *
 * And one found while auditing the tab's OTHER diagram: the six-stage pipeline
 * strip scrolls sideways inside a container no keyboard could focus.
 *
 * Source and stylesheet assertions. `globals-css.ts` is the only honest reader
 * of the sheet — a suite that opens `app/globals.css` directly now scans a
 * 122-line import manifest and agrees with itself for ever.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { globalsCss, readGlobalsPartial } from "./globals-css";
import { overview_, pipelines_, status_ } from "./helpers/developer-sources";
import { stripCode } from "./helpers/source-files";

/** The partial this tab is allowed to write overrides into. */
const density = readGlobalsPartial("app/globals/14i-density-developer.css");

/** The shared partial the base geometry lives in, read only to prove order. */
const BASE_PARTIAL = "app/globals/10-developer-control-plane.css";

/**
 * A declaration block's body, located by selector text in the concatenated
 * sheet. Returns every match, because the cascade is the point: the LAST one
 * is what renders, and a test that reads only the first would pass while the
 * rule it checked was being overridden two partials later. Leading whitespace
 * is allowed, or every rule nested in a media query would read as absent —
 * which is most of what this suite checks.
 */
function blocks(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const opener = new RegExp(`(?:^|\n)[ \t]*${escaped} \\{`, "g");
  const found: string[] = [];
  for (const match of globalsCss.matchAll(opener)) {
    const open = globalsCss.indexOf("{", match.index);
    const close = globalsCss.indexOf("}", open);
    assert.notEqual(close, -1, `${selector} never closes`);
    found.push(globalsCss.slice(open + 1, close));
  }
  assert.ok(found.length > 0, `${selector} is gone from the sheet`);
  return found;
}

describe("the deployment topology is drawn on the plane it has", () => {
  it("is a CSS diagram — no viewBox or aspect-ratio letterboxing may arrive", () => {
    // The three files that render this tab's diagrams. A `viewBox` here would
    // be a fixed coordinate system, and `preserveAspectRatio` on top of it is
    // exactly the letterboxing this fix removed in another form.
    // `stripCode` first: the comments in these files NAME the constructs they
    // exist to explain the absence of, and a scan that cannot tell prose from
    // code reads the explanation as the offence.
    const tabDiagrams = stripCode([overview_, pipelines_, status_].join("\n"));
    assert.doesNotMatch(tabDiagrams, /viewBox|preserveAspectRatio/,
      "the topology and pipeline strip are DOM and CSS; a fixed coordinate system reintroduces the boxing");
    assert.doesNotMatch(stripCode(overview_), /width:|maxWidth|max-width/,
      "the diagram's width belongs to the stylesheet, not to an inline style in the markup");
  });

  it("the runtime band spans the plane instead of floating in the middle of it", () => {
    // The base rule and the override are the same specificity (0,1,0), so this
    // works only while 14i is read after 10. globals-manifest.test.ts pins that
    // order; this asserts the consequence the diagram depends on.
    const base = globalsCss.indexOf("\n.developer-cp-edge {");
    const override = globalsCss.lastIndexOf("\n.developer-cp-edge {");
    assert.ok(override > base, ".developer-cp-edge is no longer overridden after its base rule");

    const last = blocks(".developer-cp-edge").at(-1) ?? "";
    assert.match(last, /width: auto/, "the band is boxed into a fixed measure again");
    assert.match(last, /margin-inline: 0/, "a centred band leaves the plane empty on both sides");
    assert.doesNotMatch(last, /min\(420px/, "the 420px measure is what the report was pointing at");
  });

  it("reclaims the dead band beside the card between 901px and 1120px", () => {
    // `@media (max-width: 1120px)` in 10 puts the overview grid on eight tracks
    // and the topology on five of them. The card spanning the other three is
    // `.developer-cp-readiness`, which is `hidden` on this part — so those three
    // tracks rendered as nothing at all.
    assert.match(readGlobalsPartial(BASE_PARTIAL), /\.developer-cp-topology \{ grid-column: span 5; \}/,
      "the base span this override exists to answer has changed; re-derive the arithmetic");
    assert.match(density, /@media \(min-width: 901px\) \{[\s\S]*?\.developer-cp-overview__grid > \.developer-cp-topology \{\s*grid-column: 1 \/ -1;/,
      "the 901px-1120px band must give the diagram the whole row, as >=1121px already does");
  });

  it("uses a plain topology surface without foolscap ruling", () => {
    const plane = blocks(".developer-cp-overview__grid > .card.developer-cp-topology").at(-1) ?? "";
    assert.match(plane, /background-color: var\(--surface-1\)/);
    assert.match(plane, /background-image: none/,
      "the foolscap ruling returned to the deployment topology card");
    assert.doesNotMatch(density, /\.developer-cp-overview__grid > \.card \{[\s\S]*?background-image/,
      "the topology field leaked onto every card in the overview grid");
  });

  it("removes the ornamental dashed fork instead of restyling it", () => {
    const nodes = blocks(".developer-cp-topology__nodes").at(-1) ?? "";
    assert.match(nodes, /column-gap: var\(--developer-topology-gap\)/);
    assert.match(density, /--developer-topology-gap: 11px/, "the gutter has no value to derive from");
    assert.doesNotMatch(stripCode(overview_), /developer-cp-topology__line/,
      "the connector node returned to the component");
    assert.doesNotMatch(readGlobalsPartial(BASE_PARTIAL), /\.developer-cp-topology__line/,
      "the removed connector still has base styling");
    assert.doesNotMatch(density, /\.developer-cp-topology__line/,
      "the removed connector still has a late override");
  });

  it("puts the three node cards' five rows on shared row lines", () => {
    // The paths are the proof the report's "words are not aligned properly"
    // pointed at: 28 characters for the gateway against 42 for the OpenBB
    // service, under a two-line clamp, so one card's detail sentence started a
    // line above its neighbours'.
    const parent = blocks(".developer-cp-topology__nodes").at(-1) ?? "";
    assert.match(parent, /grid-template-rows: repeat\(5, auto\)/);
    assert.match(parent, /row-gap: 0/, "a row gap would be added on top of the margins the rows already carry");
    const node = blocks(".developer-cp-node").at(-1) ?? "";
    assert.match(node, /grid-template-rows: subgrid/, "the cards are back to independent blocks");
    assert.match(node, /grid-row: span 5/, "a subgrid must span exactly the rows it maps");
  });

  it("still renders exactly the five rows the subgrid maps", () => {
    // A sixth child would fall outside the mapped rows and land in an implicit
    // one, which is the alignment defect back in a new shape.
    const card = overview_.slice(overview_.indexOf("developer-cp-node"), overview_.indexOf("developer-cp-legend"));
    assert.match(card, /<div><span className="num">/, "1: the ordinal and its pill");
    assert.match(card, /<h3>\{deployable\.name\}<\/h3>/, "2: the name");
    assert.match(card, /<p>\{deployable\.role\}<\/p>/, "3: the role");
    assert.match(card, /<code>\{deployable\.entry\}<\/code>/, "4: the entry path");
    assert.match(card, /<small>\{deployable\.detail\}<\/small>/, "5: the detail");
    assert.equal((card.match(/<(h3|p|code|small)>/g) ?? []).length, 4,
      "the node card grew or lost a row; the subgrid span in 14i maps five and must be re-counted");
  });

  it("keeps the ordinals in tabular mono so the three columns read as one figure", () => {
    // `.num` in 00 is the mono + tabular-nums pair, and the developer override
    // only retints and resizes it. Restating the family here would be a second
    // source of truth for the same alignment.
    assert.match(overview_, /<span className="num">0\{index \+ 1\}<\/span>/);
    const num = blocks(".num").at(0) ?? "";
    assert.match(num, /font-variant-numeric: tabular-nums/);
    assert.doesNotMatch(blocks(".developer-cp-node > div > .num").at(-1) ?? "", /font-family/);
  });

  it("says nothing new — this was a layout fix", () => {
    // The diagram's content is someone else's considered work. Every string it
    // draws is still drawn, from the same source.
    assert.match(overview_, /IS_VERCEL_DEPLOYMENT \? "Vercel edge" : "Local runtime"/);
    assert.match(overview_, /<span>Runtime map<\/span><h2>Deployment topology<\/h2>/);
    assert.match(overview_, /<span><i className="is-good" \/>Healthy<\/span>/);
    assert.match(overview_, /<span><i className="is-warn" \/>Degraded<\/span>/);
    assert.match(overview_, /<span><i className="is-off" \/>Off \/ not configured<\/span>/);
  });
});

describe("the pipeline strip scrolls where a keyboard can reach it", () => {
  it("scrolls inside its own focusable container, not inside the card", () => {
    assert.match(pipelines_, /<div className="developer-cp-pipeline-scroll" tabIndex=\{0\}>\s*<PipelineStrip \/>/,
      "wide content scrolls in its own wrapper, and a keyboard must be able to reach that scroll");
    const scroller = blocks(".developer-cp-pipeline-scroll").at(-1) ?? "";
    assert.match(scroller, /overflow-x: auto/);
    assert.match(scroller, /overflow-y: hidden/);
  });

  it("hands the card's overflow back whole, not one axis of it", () => {
    // `overflow-x: visible` beside a non-visible `overflow-y` computes back to
    // `auto`, and the card would have kept the scroll port it is giving up.
    const card = blocks(".developer-cp-pipeline-card").at(-1) ?? "";
    assert.match(card, /overflow: visible/);
    assert.doesNotMatch(card, /overflow-x: visible/, "one axis is not enough; the pair computes back to auto");
  });

  it("never lets the strip push the page sideways", () => {
    assert.match(blocks(".developer-cp-pipeline").at(0) ?? "", /min-width: 660px/,
      "the min-width this scroller exists for is gone; the scroller may no longer be needed");
    assert.match(globalsCss, /overflow-x: clip/, "the page-level guard against a sideways scroll is gone");
  });
});
