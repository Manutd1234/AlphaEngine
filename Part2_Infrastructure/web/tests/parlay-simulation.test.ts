import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CENT_CC,
  centStepDomain,
  frechetFromCenticents,
  parlaySimulationSource,
  simulateParlay,
} from "../lib/coherence/parlay-simulation";
import type { CoherenceCombo } from "../lib/coherence/types-lab";

const combo: CoherenceCombo = {
  ticker: "KX-PARLAY-ONE",
  label: "yes Home, no Away",
  collection_ticker: "KX-COLLECTION",
  scope: "cross-shard",
  legs: [
    { ticker: "KX-HOME", label: "Home", side: "yes", probability: "0.7250", buy_cost: "0.7300", opposite_cost: "0.2800" },
    { ticker: "KX-AWAY", label: "Away", side: "no", probability: "0.5650", buy_cost: "0.5700", opposite_cost: "0.4400" },
  ],
  combo_bid: "0.4100",
  combo_ask: "0.4300",
  combo_mid: "0.4200",
  price: "0.4200",
  price_basis: "mid",
  lower_bound: "0.2900",
  upper_bound: "0.5650",
  independence: "0.409625",
  band_width: "0.2750",
  band_position: "0.4727",
  dependence: "positive",
  inside_band: true,
  violated_rows: 0,
  detail: "fixture",
};

const closeTo = (actual: number | null, expected: number) => {
  assert.ok(actual != null && Math.abs(actual - expected) < 1e-12, `${actual} was not close to ${expected}`);
};

describe("local parlay simulation arithmetic", () => {
  it("computes the two-leg Fréchet interval and independence product", () => {
    const result = frechetFromCenticents([7_250, 5_650]);
    assert.deepEqual(
      { lowerCc: result.lowerCc, upperCc: result.upperCc, missing: result.missing },
      { lowerCc: 2_900, upperCc: 5_650, missing: 0 },
    );
    closeTo(result.independence, 0.409625);
  });

  it("uses n minus one in the lower bound and floors it at zero", () => {
    const tight = frechetFromCenticents([9_000, 9_000, 9_000]);
    assert.deepEqual({ lowerCc: tight.lowerCc, upperCc: tight.upperCc, missing: tight.missing }, {
      lowerCc: 7_000, upperCc: 9_000, missing: 0,
    });
    closeTo(tight.independence, 0.729);
    assert.equal(frechetFromCenticents([8_000, 6_000, 5_000]).lowerCc, 0);
  });

  it("declines the entire calculation when any required side is absent or invalid", () => {
    assert.deepEqual(frechetFromCenticents([7_500, null, 5_000]), {
      lowerCc: null, upperCc: null, independence: null, missing: 1,
    });
    assert.deepEqual(frechetFromCenticents([7_500, 10_001]), {
      lowerCc: null, upperCc: null, independence: null, missing: 1,
    });
    assert.deepEqual(frechetFromCenticents([]), {
      lowerCc: null, upperCc: null, independence: null, missing: 0,
    });
  });

  it("keeps the live band fixed in quote mode", () => {
    const source = parlaySimulationSource(combo);
    assert.deepEqual(simulateParlay(source, "quote", 5_100, [8_000, 6_500]), {
      quoteCc: 5_100,
      lowerCc: 2_900,
      upperCc: 5_650,
      independence: 0.409625,
    });
  });

  it("keeps the live quote fixed and recalculates all leg outputs in legs mode", () => {
    const source = parlaySimulationSource(combo);
    assert.deepEqual(simulateParlay(source, "legs", 9_900, [8_000, 6_500]), {
      quoteCc: 4_200,
      lowerCc: 4_500,
      upperCc: 6_500,
      independence: 0.52,
    });
  });

  it("does not turn malformed or missing wire probabilities into zero", () => {
    const source = parlaySimulationSource({
      ...combo,
      price: null,
      lower_bound: "not-a-price",
      upper_bound: "1.2000",
      independence: null,
      legs: [{ ...combo.legs[0], probability: null }],
    });
    assert.deepEqual(source.live, { quoteCc: null, lowerCc: null, upperCc: null, independence: null });
    assert.equal(source.legs[0].probabilityCc, null);
    assert.deepEqual(simulateParlay(source, "legs", null, [null]), {
      quoteCc: null, lowerCc: null, upperCc: null, independence: null,
    });
  });

  it("offsets the native cent grid so a half-cent live value is never snapped", () => {
    assert.deepEqual(centStepDomain(7_250), { minCc: 50, maxCc: 9_950 });
    assert.deepEqual(centStepDomain(7_200), { minCc: 0, maxCc: 10_000 });
    const domain = centStepDomain(7_255);
    assert.equal((7_255 - domain.minCc) % CENT_CC, 0);
    assert.equal((domain.maxCc - 7_255) % CENT_CC, 0);
  });
});

describe("ParlaySimulator interaction contract", () => {
  const component = readFileSync(new URL("../components/coherence/ParlaySimulator.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../components/coherence/ParlaySimulator.module.css", import.meta.url), "utf8");

  it("exports the requested component and uses an exact native one-cent range plus Reset", () => {
    assert.match(component, /export function ParlaySimulator\(\{ combo, mode \}/);
    assert.match(component, /type="range"/);
    assert.equal(CENT_CC, 100);
    assert.match(component, /step=\{CENT_CC\}/);
    assert.match(component, /min=\{domain\.minCc\}/);
    assert.match(component, /max=\{domain\.maxCc\}/);
    assert.match(component, />Reset<\/Button>/);
  });

  it("states the local-only boundary and covers pointer, touch and keyboard use", () => {
    assert.match(component, /<strong>Local only\.<\/strong> Market data does not change\./);
    assert.match(component, /Each step is \$0\.01; arrow keys work\./);
    assert.match(component, /aria-live="polite"/);
  });

  it("contains responsively and removes transitions for reduced motion", () => {
    assert.match(css, /container:\s*parlay-simulator \/ inline-size/);
    assert.match(css, /@container parlay-simulator/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.doesNotMatch(css, /pointer:\s*coarse/);
  });
});
