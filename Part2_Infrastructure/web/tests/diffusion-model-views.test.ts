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

import { read } from "./helpers/workspace-sources";

const MODEL_FILES = [
  "../components/coherence/diffusion/model/ModelFormulas.tsx",
  "../components/coherence/diffusion/model/HalfLifeCalculator.tsx",
  "../components/coherence/diffusion/model/DiffusionSimulator.tsx",
  "../components/coherence/diffusion/model/SpectrumExplorer.tsx",
];

const sources = new Map(MODEL_FILES.map((file) => [file, read(file)] as const));

describe("the Model group is offered and is reachable", () => {
  it("the group's four views are named on the switcher", () => {
    const groups = read("../components/coherence/diffusion/DiffusionGroups.tsx");
    for (const label of ["Measurement", "Instrument", "Half-life", "Simulator", "Spectrum"]) {
      assert.ok(groups.includes(`"${label}"`), `the Model group lost its ${label} view`);
    }
  });

  it("the section offers the group itself", () => {
    assert.match(read("../components/coherence/DiffusionPane.tsx"), /"Model"/);
  });
});

describe("it computes in the browser, which is the claim it is making", () => {
  it("no view in the group reads the gateway", () => {
    // `gaussian.py`: the closed form is what lets the instrument ship before the
    // model does. A fetch here would contradict the thing being demonstrated.
    const offenders: string[] = [];
    for (const [file, source] of sources) {
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
