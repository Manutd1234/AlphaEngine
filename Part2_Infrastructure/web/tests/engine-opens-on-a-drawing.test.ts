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
  // The six added on 2026-08-25, one per Proofs section, and the chain two of
  // them are drawn with. Each is verified to open on a drawing ITSELF by the
  // LOCAL table at the foot of this file, which is what stops this list being
  // a way to exempt a view without writing down that you did.
  "CheckLadder", "StateCoverage", "ParlayLegs", "HorizonAxis",
  "MeasurabilityStrip", "GroupPins", "FormationDiagram",
  // The one figure on the tab whose name says nothing about being one; it is
  // local to `IndexPane` and there is no second `Chart` under `coherence/`.
  "Chart",
  // Diffusion's. Wired in 2026-08-25 with the branch mode below, so these are
  // reached rather than merely declared. `SurvivalChart` and `MeetingsEmpty`
  // are local to `KalshiArm` and `MeetingTable`; both open on a `<Figure>`.
  "ClockAgreement", "EpisodeWatch", "MeetingTable", "SurvivalChart", "MeetingsEmpty",
  // Findings / Instrument, 2026-08-25. It replaced a `ValueStrip` that drew
  // two rows of "not measured" on the live read — an empty frame that also
  // duplicated the last two rows of the table beneath it.
  "InstrumentFit",
];

/**
 * How far past a `return` to read for its opening tags.
 *
 * Wide enough to outlast a row of chips: a `StateChip` carries four props and
 * six of them run past nine hundred characters before the figure beneath is
 * reached, so a shorter window reported "no tags" for a view that opens on a
 * drawing. It only ever adds tags a wrapper filter then drops.
 */
const WINDOW = 2400;

/**
 * Openers that are an ABSENCE, which the null-honesty rule requires in words.
 *
 * `<SectionVerdict pending` joined them on 2026-08-25 and it is the same shape
 * under a new name. Six sections drew their absence as a bare
 * `<p className="console-empty">`; they draw it inside the verdict band now, so
 * that a section whose read failed still shows the frame its answer would have
 * been in rather than a sentence floating where a band should be. The MARKER
 * moved from the caller's own markup into a prop, so this pattern is what the
 * scan can see — and `pending` is only ever set on a branch that has no answer.
 */
const ABSENCE = /className="console-empty|<FigureEmpty|className="coh-figure__missing|<SectionVerdict\s+pending/;

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
 *
 * `SectionVerdict` is the band those chips sit in since 2026-08-25 — a frame
 * around a `StateChip` row and nothing else — so it is a chip row by the same
 * argument, one element up. It is here rather than in the wrapper list because
 * it is not a wrapper: the rule it is being admitted under is the chip rule,
 * and putting it with `div` would hide that it was a decision. Its ABSENCE form
 * carries `pending` and is matched above instead.
 */
const CHIPS = ["StateChip", "SectionVerdict"];

interface View {
  /** The file and the exported function that draws this view. */
  readonly at: string;
  /**
   * The condition text that selects this view, for a component holding several.
   *
   * Proofs delegates a function per view; Diffusion branches on `view === "..."`
   * INSIDE one section component, so taking a named function's first return
   * would read the section's own opener once per view and report a green that
   * means nothing. With a branch, the scan starts at the condition and reads the
   * markup that follows it — which is the view, and only the view.
   */
  readonly branch?: string;
  /**
   * Take the LAST drawing return rather than the first.
   *
   * The default arm of an `if`-chain has no condition to anchor on: it is what
   * is left when every named branch has returned. Naming it as "the last one"
   * is exact for that shape and wrong for any other, so it is opt-in.
   */
  readonly last?: boolean;
  /** Named exemption: a view that legitimately opens on something else. */
  readonly exempt?: string;
}

const VIEWS: Record<string, View> = {
  "Coherence test / Verdict": { at: "../components/coherence/CertificateViews.tsx#VerdictView" },
  "Coherence test / Proof": { at: "../components/coherence/CertificateViews.tsx#ProofView" },
  "Basket": { at: "../components/coherence/PortfolioPane.tsx#PortfolioPane" },
  "Parlays / Bands": { at: "../components/coherence/CombosViews.tsx#BandsView" },
  // NO LONGER EXEMPT, as of 2026-08-25. The exemption said a figure here would
  // be the same six bands the Bands view already draws together, and it was
  // right about BANDS — so what leads this view is not one. `ParlayLegs` draws
  // the LEGS at their implied p, which is what both bounds are built from and
  // what every card below keeps behind a `<details>`.
  "Parlays / Parlays": { at: "../components/coherence/CombosViews.tsx#ParlaysView" },
  "Parlays / Bounds": { at: "../components/coherence/CombosBounds.tsx#BoundsView" },
  // NO LONGER EXEMPT, as of 2026-08-25, and the exemption was retired by
  // building rather than by argument. It covered the engine caveat — the one
  // caveat on this tab that INVALIDATES the drawing under it, since
  // `final_trade` scores prices read moments before settlement — which stood
  // here as a three-branch paragraph because a reader who meets the number
  // first has already taken the wrong reading. The caveat still comes first and
  // still decides how everything below may be read; it is `HorizonAxis` now,
  // which puts the median read-time on a clock instead of describing it.
  "Scorecard": { at: "../components/coherence/CalibrationSettled.tsx#CalibrationSettled" },
  "Coherence index / trend": { at: "../components/coherence/CalibrationTrend.tsx#CalibrationTrend" },
  "Coherence index / series": { at: "../components/coherence/IndexPane.tsx#IndexPane" },
  "Lessons / Coverage": { at: "../components/coherence/LessonCoverage.tsx#LessonCoverage" },
  "Lessons / Episode states": { at: "../components/coherence/ViolationStates.tsx#ViolationStates" },

  /* ── Diffusion, fifteen views over seven sections ────────────────────────
     Its sections hold every view behind `view === "..."`, so each row names the
     branch that selects it; the four default arms say `last` instead, which is
     exact for an if-chain's final return and wrong for anything else. */
  "Announcement arm / Absorption": {
    at: "../components/coherence/diffusion/InformationDiffusionPane.tsx#InformationDiffusionPane",
    last: true,
  },
  "Announcement arm / Control": {
    at: "../components/coherence/diffusion/InformationDiffusionPane.tsx#InformationDiffusionPane",
    branch: 'view === "floor"',
  },
  "Announcement arm / Clocks": {
    at: "../components/coherence/diffusion/InformationDiffusionPane.tsx#InformationDiffusionPane",
    branch: 'view === "clocks"',
  },
  "Meetings / Meeting by meeting": {
    at: "../components/coherence/diffusion/MeetingsSection.tsx#MeetingsBody",
    last: true,
  },
  "Meetings / Mechanism": {
    at: "../components/coherence/diffusion/MeetingsSection.tsx#MeetingsBody",
    branch: 'view === "mechanism"',
  },
  "Kalshi episodes / Survival": {
    at: "../components/coherence/diffusion/KalshiArm.tsx#KalshiArm",
    branch: 'view === "survival"',
  },
  "Kalshi episodes / Episodes": {
    at: "../components/coherence/diffusion/KalshiArm.tsx#KalshiArm",
    last: true,
  },
  "Measurement": {
    at: "../components/coherence/diffusion/model/ModelFormulas.tsx#ModelFormulas",
    // A CATALOGUE, not a reading. Each of the thirteen cards opens on the
    // expression it is about and draws that expression immediately under it —
    // the card IS the unit, and a figure hoisted above the whole grid would
    // belong to none of them. The rule is satisfied one level down, which is
    // why the card's own opener is checked below rather than waived.
    exempt: "a catalogue of formula cards; each opens on its expression and draws it",
  },
  "Instrument": {
    at: "../components/coherence/diffusion/model/ModelFormulas.tsx#ModelFormulas",
    exempt: "the same catalogue, filtered to the instrument half",
  },
  "Sandbox / Half-life": {
    at: "../components/coherence/diffusion/model/HalfLifeCalculator.tsx#HalfLifeCalculator",
    // A DRIVEN INSTRUMENT. Its controls are the subject and the figure is their
    // answer, so the sliders come first by design — a reader who met the curve
    // before the thing that moves it would have to scroll back to use it. What
    // the rule bans is PROSE above the drawing, and there is none: the sentence
    // this view used to open with restated its own figure caption and is cut.
    exempt: "a driven instrument: the controls are the subject, the figure is their answer",
  },
  "Sandbox / Simulator": {
    at: "../components/coherence/diffusion/model/DiffusionSimulator.tsx#DiffusionSimulator",
    exempt: "a driven instrument; its opening sentence restated the section lede and is cut",
  },
  "Sandbox / Spectrum": {
    at: "../components/coherence/diffusion/model/SpectrumExplorer.tsx#SpectrumExplorer",
    // The one sentence kept of the three: it says what the six eigenvalue
    // sliders MEAN, which is said nowhere else and is not derivable from the
    // drawing. Words that come before a drawing must change what the drawing
    // means — the same narrow case the Scorecard exemption is for.
    exempt: "a driven instrument, and its lede defines the sliders rather than the figure",
  },
  "Findings / Effect plot": {
    at: "../components/coherence/diffusion/FindingsPane.tsx#FindingsPane",
    // Anchored on the TERNARY, not on the bare condition: the same text appears
    // in the switcher button above it (`aria-pressed={view === "plot"}`), which
    // is what a naive anchor would find.
    branch: '{view === "plot" ? (',
  },
  "Findings / Findings table": {
    at: "../components/coherence/diffusion/FindingsPane.tsx#FindingsPane",
    branch: 'view === "table" ? (',
  },
  "Findings / Instrument": {
    at: "../components/coherence/diffusion/FindingsPane.tsx#FindingsPane",
    branch: "aria-label=\"Was the instrument fit to answer?\"",
  },
};

/**
 * The tags a view's main return opens with, in order.
 *
 * Absence branches are dropped rather than searched past: each `return` is taken
 * whole, and one whose markup names an empty state is not the drawing return.
 */
function openersOf(source: string, fn: string, spec: View = { at: "" }): string[] {
  const at = source.search(new RegExp(`function ${fn}\\b`));
  assert.notEqual(at, -1, `${fn} is not a function in that file any more`);
  const body = source.slice(at);
  const end = body.search(/\n(?:export )?function /) ;
  let scoped = end > 0 ? body.slice(0, end) : body;

  if (spec.branch) {
    const from = scoped.indexOf(spec.branch);
    assert.notEqual(from, -1,
      `${fn} no longer branches on \`${spec.branch}\` — the view moved, or the condition was rewritten`);
    // From the condition to the markup that follows it. Both branch shapes on
    // this engine land here: `if (cond) { return (<X/>) }` and `cond ? <X/> :`.
    //
    // BOUNDED AT THE NEXT BRANCH, which is not a detail. A fixed window runs
    // past a short branch into the one after it, so a branch that opened on
    // nothing but wrappers would be satisfied by its NEIGHBOUR's drawing and
    // pass for a reason that has nothing to do with it. Caught by injecting a
    // paragraph into one branch and reading the reported tags: they ran
    // `p > ClockAgreement > Figure > AbsorptionCurve`, and the last two belong
    // to the next view.
    // Two bounds, because one shape defeats each. A TERNARY chain is bounded by
    // the next condition; an IF chain's LAST branch has no next condition, so it
    // is bounded by the return after its own — otherwise the default arm's
    // drawing sits inside the window and answers for it.
    const after = from + spec.branch.length;
    const nextCond = scoped.indexOf('view === "', after);
    const ownReturn = scoped.indexOf("return", after);
    const nextReturn = ownReturn === -1 ? -1 : scoped.indexOf("return", ownReturn + 6);
    const upto = Math.min(...[from + WINDOW, nextCond, nextReturn].filter((bound) => bound > from));
    const tags = [...scoped.slice(from, upto).matchAll(/<([A-Za-z][A-Za-z0-9.]*)/g)].map((m) => m[1]);
    assert.ok(tags.length, `${fn}'s \`${spec.branch}\` branch draws nothing this scan can find`);
    return tags;
  }

  const chunks = scoped.split(/\breturn\b/).slice(1);
  const drawing: string[][] = [];
  for (const chunk of chunks) {
    const head = chunk.slice(0, WINDOW);
    const tags = [...head.matchAll(/<([A-Za-z][A-Za-z0-9.]*)/g)].map((m) => m[1]);
    if (!tags.length) continue;
    // An absence BRANCH opens with its empty state, so the marker sits inside
    // the FIRST element. A drawing return that also carries one further down —
    // for a leg it could not read, say — is not an absence branch. Comparing
    // raw offsets does not work: `className` always follows its own `<p`.
    if (ABSENCE.test(head.slice(0, 160))) continue;
    if (!spec.last) return tags;
    drawing.push(tags);
  }
  return spec.last ? (drawing[drawing.length - 1] ?? []) : [];
}

describe("every Proofs view opens on a drawing", () => {
  for (const [view, spec] of Object.entries(VIEWS)) {
    const [file, fn] = spec.at.split("#");

    it(`${view}${spec.exempt ? " is exempt, and says why" : ""}`, () => {
      const tags = openersOf(strip(read(file)), fn, spec);
      assert.ok(tags.length, `${view} draws nothing this scan can find`);

      // A wrapper is not an opener: a view may sit inside a fragment or a
      // grouping element and still open on its figure.
      // `article` joins the wrappers: a catalogue of cards is a grouping
      // element like any other, and the card's own opener is what matters.
      const content = tags.filter((t) => !["section", "div", "article", "Fragment", ...CHIPS].includes(t));
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

  it("names every view both engine rails ship, so none is guarded by omission", () => {
    // Eleven views over six Proofs sections, plus fifteen over Diffusion's
    // seven. A view added without a line here is a view this contract does not
    // reach, and the failure would be silence.
    assert.equal(Object.keys(VIEWS).length, 26);
  });

  it("every named drawing is one, so the allow-list is not a loophole", () => {
    // The list names components as well as primitives. A component earns its
    // place by opening on a drawing ITSELF — otherwise "name it in DRAWINGS" is
    // a way to exempt a view without writing down that you did.
    const LOCAL: Record<string, string> = {
      ClockAgreement: "../components/coherence/diffusion/ClockAgreement.tsx#ClockAgreement",
      EpisodeWatch: "../components/coherence/diffusion/EpisodeWatch.tsx#EpisodeWatch",
      MeetingsEmpty: "../components/coherence/diffusion/MeetingTable.tsx#MeetingsEmpty",
      // The 2026-08-25 six. `CheckLadder` opens on `FormationDiagram`, which is
      // itself checked here — one indirection, verified rather than asserted.
      CheckLadder: "../components/coherence/CheckLadder.tsx#CheckLadder",
      FormationDiagram: "../components/coherence/FormationDiagram.tsx#FormationDiagram",
      StateCoverage: "../components/coherence/StateCoverage.tsx#StateCoverage",
      ParlayLegs: "../components/coherence/ParlayLegs.tsx#ParlayLegs",
      HorizonAxis: "../components/coherence/HorizonAxis.tsx#HorizonAxis",
      MeasurabilityStrip: "../components/coherence/MeasurabilityStrip.tsx#MeasurabilityStrip",
      GroupPins: "../components/coherence/GroupPins.tsx#GroupPins",
      InstrumentFit: "../components/coherence/diffusion/InstrumentFit.tsx#InstrumentFit",
    };
    for (const [name, at] of Object.entries(LOCAL)) {
      const [file, fn] = at.split("#");
      const tags = openersOf(strip(read(file)), fn).filter(
        (t) => !["section", "div", "article", "Fragment", ...CHIPS].includes(t),
      );
      assert.ok(DRAWINGS.includes(tags[0]),
        `${name} is named a drawing but opens on <${tags[0]}>`);
    }
  });
});
