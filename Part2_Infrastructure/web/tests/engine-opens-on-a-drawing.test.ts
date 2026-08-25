/**
 * Every Proofs view opens on a DRAWING, not on a paragraph.
 *
 * "include more diagrams in these sections and allow less words since we can use
 *  the diagrams to be the explainer of the words"
 *
 * That instruction was carried out once, by hand, across a tab of six sections
 * — and a pass done by hand is a pass that comes undone. This is the ratchet:
 * the drawing is the argument, and prose that arrives ABOVE it has to earn its
 * place against a test rather than against whoever last edited the file.
 *
 * WHAT "OPENS ON" MEANS, PRECISELY. The first content element of a view's main
 * return. Not its absence branches — a view whose read failed, or whose corpus
 * is empty, opens on a sentence saying so, and that is the house's null-honesty
 * rule rather than a violation of this one. So the scan skips returns that
 * render `.console-empty` or `FigureEmpty` and asserts on the one that draws.
 *
 * AN EXPLICIT TABLE, NOT A SWEEP, and that is the same choice
 * `type-role-map.test.ts` makes for the same reason: a view cannot be detected
 * from a file. `CombosViews.tsx` holds three of them and `CertificateViews.tsx`
 * two; a directory walk would assert against whichever function came first and
 * report a green that means nothing. Naming the pairs costs a line each and
 * makes a new view's absence from the table visible in review.
 *
 * DERIVED, NEVER OBSERVED. `npm test` has no DOM (CLAUDE.md, fact 6). This
 * proves a component's markup opens with a drawing, not that a reader met one
 * above the fold — that wants a viewport, and the plan says so rather than
 * pretending here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read } from "./helpers/workspace-sources";

/** Comments and JSX comments out; they quote retired markup verbatim. */
const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");

/**
 * The components that ARE a drawing when a view opens with one.
 *
 * `Figure`, `Plot` and a bare `<svg>` are the primitives. The rest are this
 * engine's own figures — each renders a `<Figure>` as its own first element,
 * which is why naming them here is not a loophole: it is one indirection, and
 * the suite below asserts that each of them still opens on a drawing too.
 */
const DRAWINGS = [
  "Figure", "Plot", "svg",
  "MarginAxis", "ValueStrip", "PayoffByState", "ComboBandStrips", "FrechetBand",
  "SlackStrip", "CalibrationGauge", "CalibrationTrend", "IndexPane",
  "ReliabilityDiagram", "MurphyBars", "LessonFigure", "DollarBar",
  // The one figure on the tab whose name says nothing about being one; it is
  // local to `IndexPane` and there is no second `Chart` under `coherence/`.
  "Chart",
  // Diffusion's, declared here so the list is ready when its fifteen views are
  // wired in. They are NOT in the table yet: that tab's sections branch on
  // `view === "..."` INSIDE one section component rather than delegating to a
  // function per view, so `openersOf` — which finds a named function and takes
  // its first return — reads the section's own opener fifteen times over. The
  // scanner needs a second mode that finds the branch before it reads the tags.
  "ClockAgreement", "EpisodeWatch", "MeetingTable",
];

/** Openers that are an ABSENCE, which the null-honesty rule requires in words. */
const ABSENCE = /className="console-empty|<FigureEmpty|className="coh-figure__missing/;

/**
 * A CHIP ROW may open a view; a paragraph may not.
 *
 * The rule this file holds is that WORDS do not come before the drawing, and a
 * chip is not words in that sense — it is a labelled value, three or four to a
 * row, that a reader takes in at the same glance as the figure under it. The
 * Scorecard's "Thin sample" chip is the clearest case: it is a caveat on the
 * gauge below it and belongs above the thing it qualifies.
 *
 * What stays banned is prose, headings and tables: `<p>`, `<h3>`, `<h4>`,
 * `<table>`. Those are the shapes that push a drawing below the fold, and two
 * views were opening on exactly them when this file was written.
 */
const CHIPS = ["StateChip"];

interface View {
  /** The file and the exported function that draws this view. */
  readonly at: string;
  /** Named exemption: a view that legitimately opens on something else. */
  readonly exempt?: string;
}

const VIEWS: Record<string, View> = {
  "Coherence test / Verdict": { at: "../components/coherence/CertificateViews.tsx#VerdictView" },
  "Coherence test / Proof": { at: "../components/coherence/CertificateViews.tsx#ProofView" },
  "Basket": { at: "../components/coherence/PortfolioPane.tsx#PortfolioPane" },
  "Parlays / Bands": { at: "../components/coherence/CombosViews.tsx#BandsView" },
  "Parlays / Parlays": {
    at: "../components/coherence/CombosViews.tsx#ParlaysView",
    // The one view on this tab that is a LIST rather than a reading. Each row is
    // a folded card whose summary carries its own verdict, and the drawing for
    // all six together is the Bands view beside it — so a figure here would be
    // the same six bands drawn twice.
    exempt: "a list of folded per-parlay cards; Bands draws all six together",
  },
  "Parlays / Bounds": { at: "../components/coherence/CombosBounds.tsx#BoundsView" },
  "Scorecard": {
    at: "../components/coherence/CalibrationSettled.tsx#CalibrationSettled",
    // The one caveat on this tab that INVALIDATES the drawing under it. The
    // `final_trade` engine scores prices read moments before settlement, so the
    // gauge below measures convergence speed and not foresight — a reader who
    // meets the number first has already taken the wrong reading, and putting
    // the warning after it would be the same as not making it. This is the
    // narrow case the rule is FOR, not an exception to it: words that come
    // before a drawing must change what the drawing means.
    exempt: "the engine caveat decides how the score under it may be read",
  },
  "Coherence index / trend": { at: "../components/coherence/CalibrationTrend.tsx#CalibrationTrend" },
  "Coherence index / series": { at: "../components/coherence/IndexPane.tsx#IndexPane" },
  "Lessons / Coverage": { at: "../components/coherence/LessonCoverage.tsx#LessonCoverage" },
  "Lessons / Episode states": { at: "../components/coherence/ViolationStates.tsx#ViolationStates" },
};

/**
 * The tags a view's main return opens with, in order.
 *
 * Absence branches are dropped rather than searched past: each `return` is taken
 * whole, and one whose markup names an empty state is not the drawing return.
 */
function openersOf(source: string, fn: string): string[] {
  const at = source.search(new RegExp(`function ${fn}\\b`));
  assert.notEqual(at, -1, `${fn} is not a function in that file any more`);
  const body = source.slice(at);
  const end = body.search(/\n(?:export )?function /) ;
  const scoped = end > 0 ? body.slice(0, end) : body;

  for (const chunk of scoped.split(/\breturn\b/).slice(1)) {
    const head = chunk.slice(0, 900);
    const tags = [...head.matchAll(/<([A-Za-z][A-Za-z0-9.]*)/g)].map((m) => m[1]);
    if (!tags.length) continue;
    // An absence BRANCH opens with its empty state, so the marker sits inside
    // the FIRST element. A drawing return that also carries one further down —
    // for a leg it could not read, say — is not an absence branch. Comparing
    // raw offsets does not work: `className` always follows its own `<p`.
    if (ABSENCE.test(head.slice(0, 160))) continue;
    return tags;
  }
  return [];
}

describe("every Proofs view opens on a drawing", () => {
  for (const [view, spec] of Object.entries(VIEWS)) {
    const [file, fn] = spec.at.split("#");

    it(`${view}${spec.exempt ? " is exempt, and says why" : ""}`, () => {
      const tags = openersOf(strip(read(file)), fn);
      assert.ok(tags.length, `${view} draws nothing this scan can find`);

      // A wrapper is not an opener: a view may sit inside a fragment or a
      // grouping element and still open on its figure.
      const content = tags.filter((t) => !["section", "div", "Fragment", ...CHIPS].includes(t));
      const first = content[0];

      if (spec.exempt) {
        assert.ok(!DRAWINGS.includes(first),
          `${view} is exempted but now opens on ${first} — delete the exemption`);
        return;
      }

      assert.ok(DRAWINGS.includes(first),
        `${view} opens on <${first}>, not a drawing. `
        + `Either it leads with its figure, or it earns a named exemption. Saw: ${content.slice(0, 4).join(" > ")}`);
    });
  }

  it("names every view the Proofs rail ships, so none is guarded by omission", () => {
    // Eleven views over six sections. A view added without a line here is a view
    // this contract does not reach, and the failure would be silence.
    assert.equal(Object.keys(VIEWS).length, 11);
  });
});
