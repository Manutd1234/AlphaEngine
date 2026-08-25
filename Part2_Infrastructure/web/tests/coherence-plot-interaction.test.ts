/**
 * Every fact a `<title>` whispers, the plot says out loud.
 *
 * The engine's figures carried roughly forty facts in SVG `<title>` elements —
 * the band a parlay sits in, a bin's mass, why a stage has no percentile. A
 * `<title>` is a native tooltip: reachable with a mouse, and by nothing else.
 * Not on a touch screen, not from a keyboard. It was the one affordance on this
 * desk that excluded the two groups least able to work around it, and it was
 * carrying the detail the figures had been condensed on the promise of.
 *
 * `Plot` now walks those marks itself, so a figure gets the behaviour by having
 * done nothing — twenty-five components draw through it and none needed an
 * edit. What is pinned here is the shape of that, because it is the kind of
 * thing a later refactor removes without noticing: the readout is invisible in
 * a diff of the figure that shows it.
 *
 * DERIVED, NEVER OBSERVED — except that it was. `npm test` has no DOM
 * (CLAUDE.md, fact 6), so these are source assertions. The behaviours they
 * describe were checked in headless Chrome on 2026-08-25, and one of them only
 * exists because of that check: React's synthetic `onFocus` does not fire on an
 * `<svg>` element, so the arrival case was silently dead until a real browser
 * said so.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";
import { read, stripNonCode } from "./helpers/workspace-sources";

const hook = read("../lib/coherence/use-mark-readout.ts");
const figure = read("../components/coherence/Figure.tsx");

describe("the plot is one keyboard instrument, not one per mark", () => {
  it("takes a single tab stop", () => {
    // `Heatmap` set this rule for the desk — "one keyboard instrument, not
    // hundreds of tab stops". A six-parlay figure costing six tab presses to
    // skip would be worse than the tooltip it replaces; the Lattice survival
    // curve, at 130 marks, would be unusable.
    assert.match(figure, /tabIndex=\{interactive \? 0 : undefined\}/,
      "the plot is not a single tab stop, or is one unconditionally");
  });

  it("is only a tab stop once it has a mark to walk to", () => {
    // An empty figure putting an empty control in the tab order is a dead stop
    // a keyboard reader has to pass through for nothing.
    assert.match(hook, /setInteractive\(collect\(\)\.length > 0\)/);
  });

  it("walks with arrows, jumps with Home and End, and lets go with Escape", () => {
    // The four arrows and Home/End are object KEYS in the move table, so they
    // survive `stripNonCode`. Escape is a string COMPARISON, which stripping
    // blanks — so it is read from the handler's own body instead of from the
    // whole file, where this suite's header would have matched it and passed
    // while the handler was gone.
    const code = stripNonCode(hook);
    for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"]) {
      assert.match(code, new RegExp(`\\b${key}\\b`), `${key} is not handled`);
    }
    const handler = hook.slice(hook.indexOf("const onKeyDown"));
    assert.match(handler.slice(0, handler.indexOf("}, [")), /event\.key === "Escape"/,
      "Escape no longer lets go of the plot");
  });
});

describe("arrival is not silence", () => {
  it("uses native focusin, because React's onFocus does not fire on an svg", () => {
    // Measured in Chrome 151, 2026-08-25: the svg took focus,
    // `document.activeElement` was the svg and arrow keys worked, while the
    // synthetic handler never ran. A reader would have tabbed to the plot and
    // been told nothing until they guessed that arrows did something.
    assert.match(hook, /addEventListener\("focusin"/,
      "focus-on-arrival is back on React's synthetic handler, which does not fire here");
    assert.match(hook, /addEventListener\("focusout"/);
    assert.doesNotMatch(hook, /onFocus:/, "a synthetic focus handler was reinstated beside the native one");
  });

  it("shows the first mark on arrival rather than waiting to be asked", () => {
    assert.match(hook, /if \(focusIndexRef\.current === null\) stepRef\.current\("first"\)/);
  });
});

describe("the readout says what the mark says, where the mark is", () => {
  it("reads the mark's own title rather than a second copy of the fact", () => {
    // A prop-threaded mark list would be twenty-five edits to restate what the
    // markup already says, and the two would drift the first time a figure
    // gained a mark.
    assert.match(hook, /tagName\.toLowerCase\(\) === "title"/);
  });

  it("positions in user units, so it lands beside its mark at any width", () => {
    assert.match(hook, /getBBox/);
  });

  it("clamps to the plot on both sides", () => {
    // A mark at the right edge would otherwise put its readout outside the
    // viewBox — the same clipping the label gutters have just been fixed for.
    assert.match(figure, /Math\.min\(Math\.max\(x - width \/ 2, 4\)/);
  });
});

describe("what it does to the accessibility tree", () => {
  it("keeps the svg presentational and the wrapper an image", () => {
    // The figure's one-sentence description is the useful thing to announce for
    // the drawing as a whole; the marks are detail underneath it.
    assert.match(figure, /role="presentation"/);
    assert.match(figure, /role="img" aria-label=\{ariaLabel\}/);
  });

  it("announces through a live region OUTSIDE that image", () => {
    // A `role="img"` subtree is presentational to assistive technology, so
    // labelling the marks themselves would announce nothing at all. The live
    // region has to be a SIBLING of the image, not merely later in the file.
    //
    // STRENGTHENED 2026-08-25, because the old version of this assertion passed
    // while the property was false. It compared two indexes inside this one
    // file — and `Plot` rendered the live region as a sibling of its `<svg>`
    // while `Plot` itself was a child of the `role="img"` div, in all of its
    // callers. So the region sat INSIDE the presentational subtree and was
    // announced to nobody, and the index comparison could not see it.
    assert.match(figure, /className="coh-plot__live" role="status" aria-live="polite"/);
    // Read inside `Figure`'s own body. The previous version compared indexes
    // across the whole file, so it was satisfied by `Plot` being DEFINED after
    // `Figure` — a fact about source order that says nothing about nesting.
    const body = figure.slice(figure.indexOf("export default function Figure"), figure.indexOf("export function Plot"));
    const imageOpen = body.indexOf('role="img"');
    const imageClose = body.indexOf("</div>", imageOpen);
    const liveAt = body.indexOf("coh-plot__live");
    assert.ok(imageOpen !== -1, "Figure no longer renders the image wrapper this scan can find");
    assert.ok(liveAt !== -1, "Figure does not render the live region; the plot cannot put it outside itself");
    assert.ok(
      liveAt > imageClose,
      "the live region is inside the role=img element, where a presentational subtree swallows it",
    );
  });

  it("the plot speaks for itself ONLY when no figure is there to speak for it", () => {
    // Every caller on the engine nests `Plot` inside `Figure`'s `role="img"`
    // wrapper, so a region rendered unconditionally from inside `Plot` is
    // inside the image however it is ordered — which is the defect this pair
    // fixes. The fallback is kept for a `Plot` with no `Figure` around it,
    // where there is no presentational subtree and its own region is the right
    // answer; it just has to be GUARDED on that being the case.
    const plotBody = figure.slice(figure.indexOf("export function Plot"), figure.indexOf("function Readout"));
    const liveAt = plotBody.indexOf("coh-plot__live");
    if (liveAt === -1) return;
    const guardAt = plotBody.indexOf("publish ? null : (");
    assert.ok(
      guardAt !== -1 && guardAt < liveAt,
      "Plot renders its live region unconditionally again — inside the image, where it says nothing",
    );
  });

  it("hides the live region visually without hiding it from AT", () => {
    // `display: none` would take it out of the accessibility tree along with
    // everything it says, which is the usual way this gets broken.
    const rule = globalsCss.slice(globalsCss.indexOf(".coh-plot__live"));
    const body = rule.slice(0, rule.indexOf("}"));
    assert.doesNotMatch(body, /display:\s*none/);
    assert.match(body, /clip-path/);
  });

  it("shows a focus ring, and only for keyboard arrival", () => {
    // One tab stop has to show that it holds focus. `:focus-visible` rather
    // than `:focus`: a pointer user who clicked a mark did not ask for a ring.
    assert.match(globalsCss, /\.coh-plot svg:focus-visible \{[^}]*outline:/);
  });
});
