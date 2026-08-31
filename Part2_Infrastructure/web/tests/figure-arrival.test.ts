/**
 * A keyboard reader arriving at a figure is told what is under the cursor.
 *
 * `useMarkReadout`'s own header records why this matters: a reader tabs to a
 * plot, is told nothing, and has to guess that arrows do something. Both
 * readout hooks now put a cursor somewhere on arrival and speak it — and this
 * file pins the STRUCTURE that makes that reach assistive technology, because
 * every part of it is the kind of thing a later refactor removes without
 * noticing. The announcement is invisible in a diff of the figure that shows it.
 *
 * MEASURED, NOT ONLY DERIVED, WHICH IS UNUSUAL HERE. `npm test` has no DOM
 * (CLAUDE.md fact 6), so these are source assertions — but the behaviour behind
 * them was run in headless Chrome on 2026-08-26 against the live gateway:
 * **eight plots across `markets/books`, `coherence/corpus` and
 * `coherence/calibration`, all eight speaking on arrival, none silent.**
 * `scripts/figure-arrival-measure.mjs` is that run, committed so the claim is
 * re-checkable rather than remembered.
 *
 * WHAT PROMPTED IT. A report reached this tree saying the live region stayed
 * empty on arrival while the cursor was demonstrably set. It did not reproduce
 * on any figure that could be drawn that day. Two things came out of failing to
 * reproduce it, and both are pinned below:
 *
 *   1. A page-wide `.coh-plot__live` lookup reads the WRONG figure's region.
 *      Panels stay mounted behind `hidden`, and a section carries several
 *      figures, so `document.querySelector` returns whichever comes first in
 *      document order — an empty one — while the figure under test is speaking.
 *      That mistake reproduces the reported symptom exactly, which is why the
 *      harness scopes every read to one figure and says so in its banner.
 *   2. In a headless tab `element.focus()` sets `document.activeElement` and
 *      fires NO focus events unless `Page.bringToFront` ran first. The same
 *      figure reads "silent" without it and "speaks" with it.
 *
 * Neither is a defect in the desk. Both are defects in how the desk gets
 * measured, and this repository has lost afternoons to that class before.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

const figure = read("../components/coherence/Figure.tsx");
const marks = read("../lib/coherence/use-mark-readout.ts");
const shared = read("../lib/coherence/use-shared-x-readout.ts");
const harness = read("../scripts/figure-arrival-measure.mjs");

describe("the sources these assertions read were actually loaded", () => {
  // The empty-scan trap: a scan of "" satisfies every negative assertion in
  // this file and reads exactly like a clean bill of health. Found twice in
  // this tree; see `copy-audit.test.ts`.
  for (const [name, source] of [
    ["Figure.tsx", figure], ["use-mark-readout.ts", marks],
    ["use-shared-x-readout.ts", shared], ["figure-arrival-measure.mjs", harness],
  ] as const) {
    it(`${name} is non-empty`, () => {
      assert.ok(source.trim().length > 400, `${name} read as empty or truncated`);
    });
  }
});

describe("one figure, one live region, outside the labelled plot group", () => {
  it("the figure renders the region as a sibling of its `role=\"group\"` wrapper", () => {
    // The labelled group may contain the focusable plot; role=img may not.
    // The single live region remains a sibling, never a duplicated child.
    const wrapper = figure.indexOf('role="group"');
    const region = figure.indexOf('className="coh-plot__live"', wrapper);
    assert.ok(wrapper > 0, "Figure no longer marks its plot area as a labelled group");
    assert.ok(region > wrapper, "Figure's live region is no longer after the plot group");
    const between = figure.slice(wrapper, region);
    assert.match(between, /<\/div>/, "the live region is inside the plot group instead of remaining its sibling");
  });

  it("the plot renders a region of its own ONLY when it is not inside a figure", () => {
    // Two unconditional regions would be two `role="status"` nodes for one
    // figure, and a screen reader may read both or neither. Verified in Chrome:
    // `regionsInThisFigure` was 1 on all eight plots measured.
    assert.match(
      stripNonCode(figure),
      /publish \? null : \(/,
      "Plot's fallback region is no longer gated on being outside a Figure",
    );
  });

  it("the plot publishes to the figure rather than speaking for itself", () => {
    assert.match(stripNonCode(figure), /publish\?\.\(announce\)/, "Plot no longer publishes its readout");
  });
});

describe("both readouts put a cursor somewhere on arrival", () => {
  // React's synthetic `onFocus` does not fire on an `<svg>` at all — measured in
  // Chrome 151, and the reason both hooks bind the native event. If either one
  // is ever "simplified" back to onFocus, arrival goes silent and no suite that
  // reads only React props would notice.
  for (const [name, source] of [["the mark readout", marks], ["the shared-x readout", shared]] as const) {
    it(`${name} binds native focusin, not React's onFocus`, () => {
      // RAW source, not `stripNonCode`: stripping blanks string literals, so
      // `addEventListener("focusin")` becomes `addEventListener("")` and the
      // assertion passes over a hook that binds nothing. Same trap
      // `coherence-plot-interaction.test.ts` records for its Escape check. The
      // patterns below carry punctuation no doc comment in these files has —
      // both headers write the events as `focusin` in backticks, never as a
      // call — so the raw match stays specific.
      assert.match(source, /addEventListener\("focusin"/, `${name} no longer binds a native focusin listener`);
      assert.doesNotMatch(source, /onFocus:/, `${name} has gone back to React's synthetic focus, which never fires on an svg`);
    });
  }

  it("the shared-x readout arrives at the end its axis asks for", () => {
    // `arriveAt` belongs to the AXIS, not to the hook: a record of runs in time
    // arrives at "now", an ordered ladder at its first strike.
    // Raw for the same reason: "first" is a string literal.
    assert.match(shared, /arriveRef\.current === "first" \? 0 : countRef\.current - 1/,
      "arrival no longer honours the axis's own preferred end");
  });

  it("neither readout puts an empty control in the tab order", () => {
    // `Heatmap` set this rule for the desk: one keyboard instrument, not
    // hundreds of tab stops — and never a stop with nothing behind it.
    assert.match(stripNonCode(figure), /tabIndex=\{interactive \? 0 : undefined\}/);
    assert.match(stripNonCode(shared), /interactive: count > 0/);
  });
});

describe("the harness that measured this is honest about how it can lie", () => {
  it("brings the page to front before focusing", () => {
    assert.match(harness, /Page\.bringToFront/, "the harness would report every plot silent without this");
  });

  it("scopes every read to one figure rather than to the page", () => {
    assert.match(harness, /:scope > \.coh-plot__live/,
      "a page-wide region lookup reads another figure's region and reproduces the reported symptom");
  });

  it("skips figures that have not drawn instead of counting them as silent", () => {
    // A figure whose data has not arrived renders its empty branch with no
    // `<svg>`, which is correct behaviour and looks identical to a broken
    // instrument. On the measured run this is what `markets/lattice` did: every
    // watched family was priced as bucket intervals, so there was no survival
    // curve to focus, and the harness reported the reason rather than a failure.
    assert.match(harness, /svg\[tabindex="0"\]/);
    assert.match(harness, /undrawn/);
  });

  it("filters to visible figures, because hidden panels stay mounted", () => {
    assert.match(harness, /offsetParent !== null/);
  });
});
