/**
 * The browser's diffusion estimator, held to Python's answers.
 *
 * The gateway's maths exists twice, because neither runtime can call the other,
 * and CLAUDE.md's rule is that **Python is the reference**. `lib/coherence/
 * diffusion-model.ts` is the browser twin of `modules/coherence/diffusion/`,
 * and it exists so the Diffusion tab can show a reader what the estimator does
 * — a half-life calculator, a simulator of the whole pipeline, the closed-form
 * information spectrum — without a round trip per keystroke.
 *
 * A twin is a liability unless something holds it to the original, so this reads
 * `fixtures/diffusion-parity.json`, which `tools/export_diffusion_parity.py`
 * writes from the reference itself. Regenerate the fixture deliberately when a
 * formula moves; never loosen TOLERANCE to make a disagreement go away. A moved
 * formula SHOULD fail the other language — that is the whole design, and it is
 * the same contract `gate-parity`, `mc-parity` and `risk-parity` already hold.
 *
 * WHAT IS COMPARED IS NOT ONLY THE NUMBERS. Half the cases below are refusals —
 * `at_or_before_first`, `never_reached`, `too_few_points`, a fit that declines
 * because three points do not determine one. A twin that agrees on every value
 * and disagrees about when to say "not resolved" is a twin that lies at exactly
 * the moment honesty matters, and this tab's whole argument is that a missing
 * measurement says why it is missing.
 *
 * TOLERANCE is 1e-9 relative, not exact equality. Both sides do the same
 * arithmetic in binary64 but not in the same ORDER — numpy sums a vector where
 * the twin folds a loop — so the last bit can differ. It is far tighter than the
 * 1e-4 the cross-language fixtures use for fitted quantities, because nothing
 * here is fitted by iteration: every value is closed form or a two-parameter
 * least squares.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  entropyNats,
  fitExponential,
  fitPower,
  gaussianInformation,
  gaussianSpectrum,
  halfLife,
  mmse,
  sigmoid,
} from "../lib/coherence/diffusion-model";

const TOLERANCE = 1e-9;

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/diffusion-parity.json", import.meta.url)), "utf8"),
) as {
  half_life: Array<{
    name: string; x: number[]; absorbed: number[];
    expect: { state: string; value: number | null; lower: number | null; upper: number | null };
  }>;
  fits: Array<{
    name: string; seconds: number[]; absorbed: number[];
    expect: {
      exponential: {
        model: string; half_life: number | null; terminal_unpriced_fraction: number | null;
        sse: number | null; n_points: number; overshoot_points: number;
      };
      power: { model: string; half_life: number | null; sse: number | null; n_points: number; overshoot_points: number };
    };
  }>;
  spectrum: Array<{
    name: string; alpha: number[]; log_lambda: number[]; log_mu: number[];
    expect: {
      mmse_unconditional: number[]; density: number[];
      information_nats: number; entropy_nats: number; sigmoid: number[];
    };
  }>;
};

/** Equal to within a RELATIVE tolerance, and a null must match a null exactly. */
function close(actual: number | null, expected: number | null, what: string): void {
  if (expected === null || actual === null) {
    assert.equal(
      actual, expected,
      `${what}: one side says ${actual} and the other ${expected}. A null is a refusal, not a value — `
      + "the two languages must decline in the same cases or the twin lies where it matters most",
    );
    return;
  }
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(
    Math.abs(actual - expected) <= TOLERANCE * scale,
    `${what}: ${actual} against Python's ${expected} (tolerance ${TOLERANCE} relative)`,
  );
}

describe("the fixture is the specification, and it is present", () => {
  it("carries every state the estimator can be in", () => {
    // A fixture that lost its refusal cases would leave this suite green over a
    // twin that only ever agrees about numbers.
    const states = new Set(fixture.half_life.map((entry) => entry.expect.state));
    assert.deepEqual(
      [...states].sort(),
      ["at_or_before_first", "never_reached", "ok", "too_few_points"],
      "the parity fixture no longer covers all four half-life states",
    );
    assert.ok(fixture.fits.length >= 3, "too few fit cases to be checking anything");
    assert.ok(fixture.spectrum.length >= 3, "too few spectrum cases to be checking anything");
  });
});

describe("the half-life crossing agrees with the reference", () => {
  for (const entry of fixture.half_life) {
    it(entry.name, () => {
      const actual = halfLife(entry.x, entry.absorbed);
      assert.equal(actual.state, entry.expect.state, `${entry.name}: state`);
      close(actual.value, entry.expect.value, `${entry.name}: value`);
      close(actual.lower, entry.expect.lower, `${entry.name}: lower`);
      close(actual.upper, entry.expect.upper, `${entry.name}: upper`);
    });
  }
});

describe("the two decay fits agree with the reference", () => {
  for (const entry of fixture.fits) {
    it(entry.name, () => {
      const exponential = fitExponential(entry.seconds, entry.absorbed);
      assert.equal(exponential.model, entry.expect.exponential.model, "exponential model");
      close(exponential.halfLife, entry.expect.exponential.half_life, "exponential half-life");
      close(
        exponential.terminalUnpricedFraction,
        entry.expect.exponential.terminal_unpriced_fraction,
        "exponential asymptote",
      );
      close(exponential.sse, entry.expect.exponential.sse, "exponential SSE");
      assert.equal(exponential.nPoints, entry.expect.exponential.n_points, "exponential n");
      assert.equal(exponential.overshootPoints, entry.expect.exponential.overshoot_points, "overshoot");

      const power = fitPower(entry.seconds, entry.absorbed);
      assert.equal(power.model, entry.expect.power.model, "power model");
      close(power.halfLife, entry.expect.power.half_life, "power half-life");
      close(power.sse, entry.expect.power.sse, "power SSE");
    });
  }
});

describe("the closed-form Gaussian spectrum agrees with the reference", () => {
  for (const entry of fixture.spectrum) {
    it(entry.name, () => {
      entry.alpha.forEach((alpha, index) => {
        close(sigmoid(alpha), entry.expect.sigmoid[index], `sigmoid(${alpha})`);
      });
      const error = mmse(entry.alpha, entry.log_lambda);
      error.forEach((value, index) => {
        close(value, entry.expect.mmse_unconditional[index], `mmse at a=${entry.alpha[index]}`);
      });
      const density = gaussianSpectrum(entry.alpha, entry.log_lambda, entry.log_mu);
      density.forEach((value, index) => {
        close(value, entry.expect.density[index], `g(a) at a=${entry.alpha[index]}`);
      });
      close(
        gaussianInformation(entry.log_lambda, entry.log_mu),
        entry.expect.information_nats,
        "I(x;c) in nats",
      );
      close(entropyNats(entry.log_lambda), entry.expect.entropy_nats, "entropy in nats");
    });
  }

  it("the density integrates to the information, which is the identity the tab draws", () => {
    // The reason the browser can show this at all: for jointly Gaussian (x, c)
    // the integral of g over the whole log-SNR axis is exactly I(x;c), with no
    // torch, no network and no training. Checked by quadrature on a wide grid
    // rather than read off the fixture, because it is the IDENTITY that makes
    // the drawing meaningful and a twin could satisfy every point above while
    // getting the relationship between them wrong.
    for (const entry of fixture.spectrum) {
      const step = 0.01;
      const alphas: number[] = [];
      for (let a = -40; a <= 40; a += step) alphas.push(a);
      const density = gaussianSpectrum(alphas, entry.log_lambda, entry.log_mu);
      const integral = density.reduce((total, value) => total + value * step, 0);
      const exact = gaussianInformation(entry.log_lambda, entry.log_mu);
      assert.ok(
        Math.abs(integral - exact) < 1e-4,
        `${entry.name}: the spectrum integrates to ${integral} but I(x;c) is ${exact}`,
      );
    }
  });
});
