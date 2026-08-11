/**
 * The cross-engine Monte Carlo parity claim, made checkable.
 *
 * One fixed simulation — deterministic returns, pinned seed, 2,000 paths —
 * run to completion and serialised canonically. Three parties compute it:
 *
 *   1. `scripts/generate-mc-parity.ts` wrote the committed reference
 *      (`lib/mc-parity-reference.generated.ts`) at authoring time;
 *   2. the server recomputes it per instance and reports match/drift as
 *      delivery evidence (`delivery.numerics` in the health payload);
 *   3. the Developer console can re-run it in the visitor's own browser —
 *      through the same Blob worker the Risk tab uses — and compare byte for
 *      byte against the committed reference.
 *
 * The claim being tested is strong on purpose: identical doubles, identical
 * serialisation, across V8 on Vercel, the page's JS engine, and whatever
 * machine regenerated the reference. IEEE-754 arithmetic and ECMAScript's
 * specified number formatting make that a fair demand, and the moment an
 * "optimisation" reorders a reduction or a helper drifts from its original,
 * this stops matching — which is the point.
 *
 * Isomorphic on purpose; hashing stays in `lib/delivery-readiness.ts`.
 */

import { canonicalJson } from "@/lib/canonical-json";
import {
  createMcSimulation,
  type McDistributionRequest,
  type McDistributionResult,
} from "@/lib/mc-distribution";
import { mulberry32 } from "@/lib/random";

/** Bars of deterministic pseudo-returns driving the fixture. */
const FIXTURE_BARS = 96;
const FIXTURE_RETURNS_SEED = 0x51f7_2026;

export const MC_PARITY_SEED = 0xa1fa_0007;
export const MC_PARITY_PATHS = 2_000;
export const MC_PARITY_HORIZON_BARS = 30;
export const MC_PARITY_EQUITY = 1_000_000;

/**
 * The fixture is generated, not committed: `mulberry32` is already pinned by
 * the band's own tests, so these bytes cannot drift without a test failing
 * first — and a 96-number array in source would just be noise.
 */
export function mcParityFixture(): McDistributionRequest {
  const rand = mulberry32(FIXTURE_RETURNS_SEED);
  const returns = Array.from({ length: FIXTURE_BARS }, () => (rand() - 0.48) * 0.04);
  return {
    returns,
    horizonBars: MC_PARITY_HORIZON_BARS,
    paths: MC_PARITY_PATHS,
    seed: MC_PARITY_SEED,
    equity: MC_PARITY_EQUITY,
  };
}

/** Run the fixture to completion on the calling engine. */
export function runMcParityFixture(): McDistributionResult {
  const simulation = createMcSimulation(mcParityFixture());
  while (simulation.done < simulation.total) simulation.step(simulation.total);
  return simulation.finish();
}

/** The byte sequence every engine must agree on. */
export function computeMcParityJson(): string {
  return canonicalJson(runMcParityFixture());
}
