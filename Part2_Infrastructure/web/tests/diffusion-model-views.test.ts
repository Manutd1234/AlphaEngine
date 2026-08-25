/**
 * The Model group: four views that COMPUTE rather than fetch.
 *
 * Diffusion draws an absorption curve, a noise floor and a survival curve, and
 * until now a reader could see every output of the estimator and none of the
 * estimator. The maths is real — an absorbed fraction with one terminal for both
 * stages, a half-life interpolated in log-x, two decay fits chosen in u-space, a
 * volatility clock built from control windows, and a closed-form Gaussian
 * information spectrum — and the tab said none of it.
 *
 * These four views say it, and let a reader work it:
 *
 *   Formulas    what each expression measures, its symbols, the module that is
 *               its reference implementation, and what it fails under
 *   Half-life   set the absorbed curve on the real horizon grid and read back
 *               the crossing, its bracketing points and its STATE
 *   Simulator   the whole pipeline over synthetic data, including the cases
 *               where it refuses to answer
 *   Spectrum    the closed-form g(alpha), its centroid, and the identity that
 *               its integral is I(x;c)
 *
 * WHAT THIS SUITE DEFENDS, and each is a way the group could quietly become
 * decoration:
 *
 *  1. IT READS NOTHING. `gaussian.py` says the closed form exists so "the
 *     instrument ships before the model does" — no network, no torch, no
 *     training. A gateway call in here would make an argument about being
 *     computable in the browser while not being computable in the browser.
 *  2. IT USES THE TWIN. Every number comes from `lib/coherence/diffusion-model`,
 *     which `diffusion-model-parity.test.ts` holds to Python. A view that
 *     re-derived a half-life inline would be a third implementation, guarded by
 *     nothing, drifting from two others.
 *  3. NO FORMULA APPEARS WITHOUT ITS BOUNDARY. The curriculum's rule, applied
 *     here: a lesson that says only what is true teaches a reader to trust it
 *     everywhere. Every formula card carries what breaks it.
 *  4. THE CONTROLS ARE THE DESK'S. `label`/`input[type="range"]` are styled once
 *     in `00-tokens-and-base.css`; a control sized here would be a second
 *     vocabulary on a tab whose whole density argument is that there is one.
 *
 * DERIVED, NEVER OBSERVED. Nothing here has seen a pixel or moved a slider.
 * That the simulator's refusals are legible, and that the spectrum reads as a
 * density rather than a squiggle, want a human at a viewport.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DIFFUSION_SECTIONS } from "../lib/sections";
import { read } from "./helpers/workspace-sources";

const FORMULAS_FILE = "../components/coherence/diffusion/model/ModelFormulas.tsx";

const MODEL_FILES = [
  "../components/coherence/diffusion/model/ModelFormulas.tsx",
  "../components/coherence/diffusion/model/HalfLifeCalculator.tsx",
  "../components/coherence/diffusion/model/DiffusionSimulator.tsx",
  "../components/coherence/diffusion/model/SpectrumExplorer.tsx",
];

const sources = new Map(MODEL_FILES.map((file) => [file, read(file)] as const));

/**
 * The three sections the five Model views became, with the file that draws each.
 *
 * RE-CUT ON 2026-08-25, and deliberately rather than loosened. This suite used
 * to assert that the five labels "Measurement", "Instrument", "Half-life",
 * "Simulator" and "Spectrum" all appeared on ONE switcher in `ModelSection`.
 * Two of those were never views of a thing a reader drives — they are the two
 * halves of the formula catalogue — so the five became three sections: the
 * cards about a price path, the cards about the instrument built on it, and the
 * three a reader can actually move a slider on.
 */
const SECTION_FILES: Record<string, string> = {
  model: "../components/coherence/diffusion/ModelSection.tsx",
  instrument: "../components/coherence/diffusion/InstrumentSection.tsx",
  sandbox: "../components/coherence/diffusion/SandboxSection.tsx",
};

describe("the estimator's three sections are offered and are reachable", () => {
  it("the two formula halves are drawn, one section each, with no switcher", () => {
    // One view each, so neither may draw a control row: a switcher with one
    // option is a control that cannot be operated.
    assert.match(read(SECTION_FILES.model), /<ModelFormulas part="measurement"/);
    assert.match(read(SECTION_FILES.instrument), /<ModelFormulas part="instrument"/);
    for (const id of ["model", "instrument"] as const) {
      assert.equal(
        (read(SECTION_FILES[id]).match(/className="seg[ "]/g) ?? []).length, 0,
        `${id} draws a switcher and has one view`,
      );
    }
  });

  it("the three a reader can drive are named on the Sandbox switcher", () => {
    const sandbox = read(SECTION_FILES.sandbox);
    for (const label of ["Half-life", "Simulator", "Spectrum"]) {
      assert.ok(sandbox.includes(`"${label}"`), `the Sandbox section lost its ${label} view`);
    }
  });

  it("the rail offers all three", () => {
    // From the registry rather than from a console's markup: the rail is data,
    // and a section missing from it is unreachable however it is drawn.
    for (const id of Object.keys(SECTION_FILES)) {
      assert.ok(DIFFUSION_SECTIONS.some((section) => section.id === id),
        `the ${id} section is not on the Diffusion rail`);
    }
  });
});

describe("every formula card carries a figure", () => {
  it("the registry and the catalogue are the same list", () => {
    // COMPLETE, unlike `lesson-figures`, which covers ten of fourteen on
    // purpose. Every card here names a mechanism AND a failure, so a card with
    // no drawing is a gap rather than a decision — the two views this catalogue
    // fills were the only two on the desk that drew nothing at all.
    const catalogue = [...read(FORMULAS_FILE).matchAll(/^ {4}id: "([a-z]+)",$/gm)].map((m) => m[1]);
    const registry = [...read("../components/coherence/diffusion/model/formula-figures/index.tsx")
      .matchAll(/^ {2}([a-z]+): [A-Z]/gm)].map((m) => m[1]);
    assert.ok(catalogue.length >= 13, `only ${catalogue.length} cards were found; the scan has drifted`);
    assert.deepEqual(registry.sort(), [...catalogue].sort(),
      "a formula card has no figure, or a figure has no card");
  });

  it("a card figure can be asked what a part means, without joining the tab order", () => {
    // REVISED 2026-08-25, and the old assertion is the one this replaces:
    // `assert.doesNotMatch(source, /<title>/)` — no marks at all, on the
    // argument that thirteen diagrams would put seven extra tab stops in
    // Measurement alone to re-read labels already drawn.
    //
    // Half of that argument holds and is kept below: these figures still must
    // NOT go through `Plot`, because `Plot` promotes a figure to a tab stop and
    // nineteen diagrams of an argument would be nineteen new stops to walk
    // decoration. The frame already names the whole drawing once.
    //
    // The other half does not. A `<title>` on a plain `<svg>` is a native
    // tooltip and creates no tab stop, so hover and the keyboard order are
    // separable — and the sentences say what a part is DOING in the argument,
    // which is the thing the card's prose says and the drawing could not.
    const primitives = read("../components/coherence/diffusion/model/formula-figures/primitives.tsx");

    // COMMENTS BLANKED FIRST. Every one of these files argues in prose about
    // why it does not use that component, so a raw scan finds the word in the
    // explanation and fails the file for explaining itself. Cost one red run.
    const codeOf = (file: string) =>
      read(`../components/coherence/diffusion/model/formula-figures/${file}.tsx`)
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^[ \t]*\/\/.*$/gm, " ");

    for (const file of ["primitives", "measurement", "instrument"]) {
      assert.doesNotMatch(
        codeOf(file),
        /\bPlot\b/,
        `${file} reaches for Plot, which would put every card figure in the tab order`,
      );
    }

    // The hit shape is what a title hangs on: a 1px hairline in a 260-unit box
    // is not a pointer target, so a title on the stroke itself would be a fact
    // nobody can reach.
    assert.match(primitives, /diff-cardfig__hit/,
      "the primitives no longer draw a hit shape, so their titles cannot be pointed at");
    assert.match(primitives, /role="img" aria-label=\{label\}/,
      "the card frame no longer names itself, and its marks are not named either");

    // A `why` that merely repeats the `word` printed beside it is the defect the
    // old rule was guarding against, and it is the one worth keeping out.
    for (const file of ["measurement", "instrument"]) {
      const source = read(`../components/coherence/diffusion/model/formula-figures/${file}.tsx`);
      for (const [, word, why] of source.matchAll(/word="([^"]*)"[^/]*?why="([^"]+)"/gs)) {
        if (!word) continue;
        assert.notEqual(why.trim().toLowerCase(), word.trim().toLowerCase(),
          `a ${file} figure's hover text is just its own label again: "${word}"`);
      }
    }

    const sentences = [...primitives.matchAll(/why\?: string/g)].length;
    assert.ok(sentences >= 4, "fewer than four primitives can carry a why, so most parts cannot be asked");
  });
});

describe("it computes in the browser, which is the claim it is making", () => {
  it("no view in the group reads the gateway", () => {
    // `gaussian.py`: the closed form is what lets the instrument ship before the
    // model does. A fetch here would contradict the thing being demonstrated.
    // The SECTION wrappers are scanned too, not only the four view files. The
    // wrapper is where a fetch would most naturally be added — it is the thing
    // holding the props — and until 2026-08-25 nothing scanned it at all.
    const offenders: string[] = [];
    const scanned = new Map([...sources, ...Object.values(SECTION_FILES).map((f) => [f, read(f)] as const)]);
    for (const [file, source] of scanned) {
      if (/useCoherenceRead|absorptionRoute|episodesRoute|findingsRoute|fetch\(/.test(source)) {
        offenders.push(file);
      }
    }
    assert.deepEqual(offenders, [], `these Model views reach the gateway:\n  ${offenders.join("\n  ")}`);
  });

  it("every number comes from the twin the parity fixture holds", () => {
    // A view that re-derived a half-life inline would be a THIRD implementation
    // of arithmetic that already exists twice, guarded by nothing.
    for (const [file, source] of sources) {
      if (file.includes("ModelFormulas")) continue;
      assert.match(
        source,
        /from "@\/lib\/coherence\/diffusion-model"/,
        `${file} does not use lib/coherence/diffusion-model — a third implementation is a third answer`,
      );
    }
  });

  it("the spectrum's identity is computed rather than printed", () => {
    // The integral of g over log-SNR IS I(x;c). Printing a literal beside the
    // curve would assert the identity rather than demonstrate it, and the
    // demonstration is the whole reason the view exists.
    const spectrum = sources.get(MODEL_FILES[3]) as string;
    assert.match(spectrum, /gaussianInformation\(/);
    assert.match(spectrum, /gaussianSpectrum\(/);
  });
});

describe("what is taught carries its own boundary", () => {
  it("every formula card names what breaks it", () => {
    // The curriculum's rule, and the reason its cards are the grammar reused
    // here: a lesson that says only what is true teaches a reader to trust it
    // everywhere, and every one of these has a boundary that matters more than
    // the statement.
    const formulas = sources.get(MODEL_FILES[0]) as string;
    const cards = (formulas.match(/formula:/g) ?? []).length;
    const breaks = (formulas.match(/breaks:/g) ?? []).length;
    assert.ok(cards >= 8, `only ${cards} formulas — the model has more than that on screen elsewhere`);
    assert.equal(breaks, cards, `${cards} formulas and ${breaks} boundaries; every formula needs one`);
  });

  it("every formula names the module that is its reference", () => {
    const formulas = sources.get(MODEL_FILES[0]) as string;
    const cards = (formulas.match(/formula:/g) ?? []).length;
    const sites = (formulas.match(/reference:/g) ?? []).length;
    assert.equal(sites, cards, "a formula with no reference module cannot be checked against anything");
    // And the references are real files, not prose.
    for (const match of formulas.matchAll(/reference: "([^"]+)"/g)) {
      assert.match(match[1], /^modules\/coherence\/diffusion\/[a-z_]+\.py$/, `${match[1]} is not a module path`);
    }
  });
});

describe("the controls are the desk's own", () => {
  it("the interactive views use the shared range control", () => {
    for (const file of MODEL_FILES.slice(1)) {
      assert.match(sources.get(file) as string, /type="range"/, `${file} draws no control`);
    }
  });

  it("no view sizes a control from the outside", () => {
    // `input[type="range"]` and `label.field` are styled once, desk-wide. An
    // inline metric here is a second vocabulary on the one tab whose density
    // argument is that there is exactly one.
    const offenders: string[] = [];
    for (const [file, source] of sources) {
      if (/style=\{\{[^}]*(fontSize|padding|minHeight|fontWeight|border)/.test(source)) offenders.push(file);
    }
    assert.deepEqual(offenders, [], `a control sized outside the sheet:\n  ${offenders.join("\n  ")}`);
  });

  it("every control is labelled, since a bare slider names nothing", () => {
    for (const file of MODEL_FILES.slice(1)) {
      const source = sources.get(file) as string;
      const ranges = (source.match(/type="range"/g) ?? []).length;
      const labels = (source.match(/<label/g) ?? []).length;
      assert.ok(
        labels >= ranges,
        `${file} has ${ranges} sliders and ${labels} labels — a slider with no label is a control `
        + "a screen reader cannot name",
      );
    }
  });
});
