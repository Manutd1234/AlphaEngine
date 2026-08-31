/**
 * What the 2026-08-25 Proofs pass added: six figures, and one table.
 *
 * "Revamp all sections of the Proofs tab, add more diagrams for each subtab
 *  pls. reduce the number of words by summarising."
 *
 * Every view on this tab already opened on a drawing —
 * `engine-opens-on-a-drawing.test.ts` is the ratchet that keeps it there — so
 * what was missing was not a figure per VIEW but a second reading per SECTION,
 * and prose that had grown under the figures already present. This file guards
 * the six that were added; the prose half is `coherence-proof-claims.test.ts`,
 * which counts the claims that must survive a condensation.
 *
 * ONE RULE DECIDES WHETHER A FIGURE MAY EXIST HERE, and it is the one
 * `diffusion-figures.test.ts` states for the announcement arm: it draws fields
 * the payload ALREADY carries. A figure that quietly needed a new gateway route
 * would be a schema change wearing a chart's clothes — reviewed as a drawing,
 * shipped as a contract. So each of the six is asserted to fetch nothing.
 *
 * TWO FIGURES ARE PINNED AS ABSENCES, so a later reader does not "fix" them:
 *
 *  - A DEPENDENCE STRIP on the Parlays view — each parlay's price against Πpᵢ.
 *    It was the obvious build and it is not here, because `ComboBandStrips`
 *    already draws the quoted price as a rule and independence as a hollow ring
 *    on that same dollar axis, one press away. `ParlayLegs` draws the legs
 *    instead, which is where the band comes from and which nothing drew.
 *  - A HALF-LIFE OR SUMMARY-LENGTH BAR on the Lessons cards. Both are drawings
 *    of the prose rather than of anything measured. `GroupPins` draws the two
 *    quantities a lesson actually has in one full-title comparison table.
 *
 * THE TABLE IS HERE TOO, and the file is named for figures because that is what
 * five of its six subjects are. "Reformat parlays as a table with proper
 * headings, rows and columns" was a separate ask against the same view, landed
 * in the same pass, and the two are one contract: the view opens on the figure
 * and the table is what follows it. Splitting them across two files would put
 * half of one view's shape somewhere a reader of the other half would not look.
 *
 * DERIVED, NEVER OBSERVED. `npm test` has no DOM (CLAUDE.md, fact 6). This
 * proves the wiring and the refusals; whether the six READ as figures wants a
 * viewport, and the plan says so rather than pretending here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

/** The six, and the view each one is drawn on. */
const FIGURES: Record<string, { file: string; drawnIn: string }> = {
  CheckLadder: {
    file: "../components/coherence/CheckLadder.tsx",
    drawnIn: "../components/coherence/CertificateViews.tsx",
  },
  StateCoverage: {
    file: "../components/coherence/StateCoverage.tsx",
    drawnIn: "../components/coherence/PortfolioPane.tsx",
  },
  ParlayLegs: {
    file: "../components/coherence/ParlayLegs.tsx",
    drawnIn: "../components/coherence/ParlaysView.tsx",
  },
  HorizonAxis: {
    // MOVED TO Bands ON 2026-08-26. It stood over every view in the section,
    // including Score, where it was one of FIVE figure frames on one view and
    // caveated an x axis that view does not have. It is a position on a clock —
    // when the prices on the x axis were read — so it belongs to the view whose
    // x axis they are. The claim is unchanged and still made exactly once.
    file: "../components/coherence/HorizonAxis.tsx",
    drawnIn: "../components/coherence/CalibrationBands.tsx",
  },
  MeasurabilityStrip: {
    file: "../components/coherence/MeasurabilityStrip.tsx",
    drawnIn: "../components/coherence/IndexPane.tsx",
  },
  GroupPins: {
    file: "../components/coherence/GroupPins.tsx",
    drawnIn: "../components/coherence/LessonsPane.tsx",
  },
};

describe("each of the six is drawn, and none of them fetches", () => {
  for (const [name, { file, drawnIn }] of Object.entries(FIGURES)) {
    it(`${name} is drawn on its own view`, () => {
      assert.match(
        stripNonCode(read(drawnIn)),
        new RegExp(`<${name}\\b`),
        `${name} exists but nothing renders it — a figure nobody draws is a file, not a drawing`,
      );
    });

    it(`${name} reads what the section already read`, () => {
      // The rule that keeps a figure a figure. Every one of the six takes its
      // data as a prop from a payload already on screen; a `useCoherenceRead`
      // or a `…Route(` here would mean opening a section costs another call to
      // answer a question the reader has not asked yet.
      assert.doesNotMatch(
        stripNonCode(read(file)),
        /useCoherenceRead|Route\(/,
        `${name} fetches — it must be drawn from the read its section already has`,
      );
    });

    it(`${name} draws a frame, not a bare svg`, () => {
      // `Figure` is what carries the caption, the live region and the footnote
      // vocabulary. A figure that skipped it would be legible and would lose
      // the "what this cannot say" slot every drawing on this tab carries.
      const source = read(file);
      assert.match(source, /<Figure|<FormationDiagram/,
        `${name} draws outside the tab's figure frame`);
    });
  }
});

describe("each figure says what it cannot say", () => {
  it("every one of the six carries a missing line, a notes fold, or both", () => {
    // The null-honesty rule at the figure level. A drawing that quietly omits
    // what it could not measure reads as a complete picture of a smaller world,
    // and this tab's whole argument is that it does not do that.
    const bare = Object.entries(FIGURES)
      .filter(([, { file }]) => !/\bmissing=|\bnotes=/.test(read(file)))
      .map(([name]) => name);
    assert.deepEqual(bare, [], `these figures state no limit on themselves: ${bare.join(", ")}`);
  });

  it("the coverage strip refuses to claim an exact covering it cannot have", () => {
    // The one figure of the six that could draw a world it guessed at. A leg is
    // matched to a state by TICKER, which is exact only where the venue marks
    // the family mutually exclusive — one market, one state. Anywhere else a
    // state is an interval several markets pay in, and the figure has to say
    // the covering is a lower bound rather than draw it as the covering.
    const source = read(FIGURES.StateCoverage.file);
    assert.match(source, /exact/,
      "StateCoverage no longer distinguishes an exact covering from a lower bound");
    assert.match(source, /lower bound on the covering/,
      "the inexact case must SAY it is a lower bound, in words a reader meets");
    // COUNTED, not matched. `exact` is a required prop, so the compiler already
    // proves it is passed; what a test can add is that EVERY call site derives
    // it rather than one of them hard-coding the flattering answer. A single
    // `assert.match` was green with one of the two sites mutated to a literal —
    // caught by mutating it, which is the only way this was ever going to show.
    // SCOPED TO EACH SITE since 2026-08-26. Counting `exact={exact}` across the
    // file counted the pane's own dispatch too — it hands `exact` to each of
    // the three views — so the totals stopped matching for a reason that had
    // nothing to do with a hard-coded flag. Each call site is checked where it
    // stands instead, which is what the rule was always about.
    const pane = stripNonCode(read(FIGURES.StateCoverage.drawnIn));
    const sites = [...pane.matchAll(/<StateCoverage\b/g)];
    assert.ok(sites.length >= 2, `PortfolioPane draws the coverage strip ${sites.length} time(s); both views need it`);
    for (const site of sites) {
      const call = pane.slice(site.index ?? 0, (site.index ?? 0) + 220);
      assert.match(call, /exact=\{exact\}/,
        "a StateCoverage call site hard-codes `exact` instead of deriving it from the family");
    }
    assert.match(pane, /const exact = Boolean\(chosen\?\.mutually_exclusive\)/,
      "PortfolioPane no longer reads exactness off the venue's own mutually-exclusive flag");
  });

  it("a leg the state space does not contain is counted, never dropped", () => {
    // The other way this figure could become a picture of a smaller world: a
    // basket that reaches outside the states drawn would otherwise look fully
    // covered by the columns that happen to be on screen.
    assert.match(read(FIGURES.StateCoverage.file), /offBoard/,
      "a leg naming no drawn state is silently absent from the coverage figure");
  });

  it("an unmeasurable run is drawn as a run, not folded into its neighbour", () => {
    // The claim the index chart makes by breaking its line, made visible. A
    // one-poll gap merged into the run beside it would draw a record more
    // continuous than the one that was kept, which is the same lie as bridging
    // the line.
    const source = read(FIGURES.MeasurabilityStrip.file);
    assert.match(source, /never a time bucket/,
      "the strip no longer states that a run is contiguous polls rather than a clock bucket");
    assert.match(source, /Math\.max\(x\(run\.to\), from \+ 2\)/,
      "a single-poll run has no width of its own and would vanish; it is floored on purpose");
  });

  it("the horizon axis is clamped to the hour rather than scaled to its value", () => {
    // Two engines' horizons differ by orders of magnitude — `final_trade` reads
    // at settlement, `tape` an hour out. An axis fitted to the value would draw
    // both at the same place on different reads and the two would be
    // incomparable, which is precisely the confusion this figure exists to end.
    const source = read(FIGURES.HorizonAxis.file);
    assert.match(source, /const HOUR_S = 3600;/, "the axis lost its fixed reference hour");
    assert.match(source, /Math\.max\(HOUR_S,/, "the span is scaled to the value again");
  });

  it("the check ladder marks an absent optimum as unasked, never as failed", () => {
    // `kernel/dutchbook.py` falls back to the closed-form checks when SciPy is
    // absent, and those solve no programme — so there is no t* at all. Drawing
    // that as ▲ would report a missing measurement as a found violation, which
    // is the house's most-alert defect in its figure form.
    const source = read(FIGURES.CheckLadder.file);
    assert.match(source, /const crossesDecisionLine = marginCrossesDecisionLine\(certificate\.margin\);/,
      "the ladder no longer routes the wire margin through its exact shared comparison");
    assert.match(source, /holds: crossesDecisionLine == null \? null : !crossesDecisionLine/,
      "an absent margin no longer resolves to the could-not-ask mark");
  });
});

describe("the guards this file replaces are gone rather than duplicated", () => {
  it("GroupPins left LessonsPane rather than being copied out of it", () => {
    // The strip was declared inline in `LessonsPane` and is its own file since
    // the dumbbell. Two copies would be two figures drifting apart, and the one
    // nobody edits is the one that stays wrong.
    assert.doesNotMatch(
      read("../components/coherence/LessonsPane.tsx"),
      /function GroupPins/,
      "GroupPins is declared in LessonsPane again as well as in its own file",
    );
  });

  it("the engine banner's paragraph is gone, and its claim is not", () => {
    // The condensation this pass is for, at its sharpest: the longest prose
    // object on the tab became a figure. What must NOT have gone with it is the
    // claim — that a `final_trade` score measures convergence and not foresight
    // — which is the one reading of this section a reader could most
    // damagingly get wrong.
    const score = read("../components/coherence/CalibrationScore.tsx");
    assert.doesNotMatch(score, /coh-calib__engine-body/,
      "the banner paragraph is back; the caveat belongs on the horizon axis");
    assert.match(read(FIGURES.HorizonAxis.file), /Not a forecast test/,
      "the caveat did not survive the move to a figure");
  });
});

describe("the Bands inspector exposes the complete Fréchet range", () => {
  const table = read("../components/coherence/BandsTable.tsx");
  const instrument = read("../components/coherence/FrechetInstrument.tsx");

  it("is driven by the selected loaded row and fetches nothing of its own", () => {
    assert.match(table, /<FrechetInstrument combo=\{selected\} \/>/);
    assert.doesNotMatch(`${table}\n${instrument}`, /useCoherenceRead|Route\(|fetch\(/,
      "the local inspector started a second read");
  });

  it("draws lower, upper, quote and independence as separately inspectable marks", () => {
    for (const [kind, field] of [
      ["lower", "combo.lower_bound"], ["upper", "combo.upper_bound"],
      ["quote", "combo.price"], ["independence", "combo.independence"],
    ] as const) {
      assert.match(instrument, new RegExp(`const ${kind} = toUnit\\(${field.replace(".", "\\.")}\\)`),
        `${kind} does not read the payload field it names`);
      assert.match(instrument, new RegExp(`marker\\(\"${kind}\", ${kind},`),
        `${kind} is not its own inspectable reading`);
    }
    assert.match(instrument, /readings\.map\(\(reading\) => \(\s*<Button/);
    assert.match(instrument, /from "@\/components\/ui\/button"/,
      "the inspectable marks bypass the shared button focus contract");
    assert.match(instrument, /aria-pressed=\{active\?\.kind === reading\.kind\}/);
    assert.match(instrument, /onFocus=\{\(\) => setInspected\(reading\.kind\)\}/,
      "a keyboard can reach a marker but cannot inspect it");
  });

  it("keeps the domain fixed at [0,1] and withholds a band when either edge is missing", () => {
    assert.match(instrument, /const clamp = \(value: number\) => Math\.min\(1, Math\.max\(0, value\)\)/);
    assert.match(instrument, /<span className=\{styles\.rangeZero\}>0<\/span>/);
    assert.match(instrument, /<span className=\{styles\.rangeOne\}>1<\/span>/);
    assert.match(instrument, /const validBand = lower != null && upper != null && lower <= upper/);
    assert.match(instrument, /\{bandStyle \? <div className=\{styles\.rangeBand\}/,
      "a missing bound is being placed at zero");
  });
});

describe("the parlay workflow separates comparison from experimentation", () => {
  const source = read("../components/coherence/ParlaysView.tsx");
  const start = source.indexOf("export function ParlaysView(");
  const end = source.indexOf("export function ParlayInputsView(", start);
  const view = source.slice(start, end);

  it("locates and bounds Test quote before the leg-price view", () => {
    assert.ok(start !== -1, "ParlaysView was not found — every rule below would pass vacuously");
    assert.ok(end > start, "ParlayInputsView was not found — the summary slice has no safe end");
    assert.equal(view.indexOf("export ", 1), -1,
      "another export appears inside the ParlaysView summary slice");
  });

  it("renders a named picker and quote simulator without repeating comparison data", () => {
    assert.match(view, /<ParlayPicker combos=\{combos\} selected=\{selected\}/);
    assert.match(view, /<ParlaySimulator combo=\{selected\} mode="quote" \/>/);
    assert.doesNotMatch(view, /<table|Lower bound|Upper bound|Band width/,
      "Test quote regressed into a second comparison table");
  });

  it("keeps every parlay reachable without stacking every audit", () => {
    assert.match(source, /combos\.map\(\(combo\) => \(\s*<Button/,
      "the named parlay picker is gone; a specific parlay is no longer reachable");
    assert.match(source, /<ComboCard combo=\{selected\} \/>/,
      "the selected parlay no longer exposes its detailed audit");
    assert.doesNotMatch(source, /combos\.map\(\(combo\) => \(\s*<details/,
      "every parlay audit is stacked again, restoring the long-scroll defect");
    assert.match(source, /<ParlaySimulator combo=\{combo\} mode="legs" \/>/,
      "the Legs view no longer exposes its local band simulator");
    assert.match(source, /<LegTable combo=\{combo\} \/>/, "the per-leg costs are gone");
    // The legs are no longer behind a fold of their OWN inside the parlay's —
    // that nesting is what the reader called a dropdown inside a dropdown.
    assert.doesNotMatch(source, /<details className="coh-combo__legs"/,
      "the leg table is folded inside the parlay's fold again");
  });

  it("keeps the five-column comparison and full marker inspector in Compare", () => {
    const table = read("../components/coherence/BandsTable.tsx");
    for (const column of ["Parlay", "Legs", "Allowed range", "Quote", "Position"]) {
      assert.match(table, new RegExp(`>${column}<`), `Compare lost its ${column} column`);
    }
    assert.doesNotMatch(table, />Independence<|>Band width<|>Lower bound<|>Upper bound</);
    assert.match(table, /<FrechetInstrument combo=\{selected\} \/>/);
  });
});
