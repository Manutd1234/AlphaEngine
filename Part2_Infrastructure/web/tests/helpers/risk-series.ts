/**
 * Return series with a correlation you already know the answer to.
 *
 * Risk maths cannot be tested against captured market data without the test
 * becoming an assertion about a particular week. These builders go the other
 * way: two series are constructed from a shared factor with a chosen weight, so
 * the correlation the covariance model is supposed to recover is a parameter of
 * the fixture rather than a property of history.
 *
 * That matters most for the hedge tests, where the whole question is what
 * happens either side of a correlation threshold — being able to ask for rho
 * 0.5 and rho 0.9 from the same seed is what makes the crossover demonstrable
 * instead of anecdotal.
 */

import assert from "node:assert/strict";

import type { ReturnsBySymbol } from "../../lib/portfolio-risk";

/** Floating-point comparison that reports the gap it rejected, not just "false". */
export const close = (a: number, b: number, tol: number, what = "") =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} !== ${b} (Δ ${Math.abs(a - b)} > ${tol})`);

/** Deterministic LCG — the house pattern for anything needing randomness. */
export function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Two series with a controlled correlation, built from a shared factor. */
export function correlatedSeries(n: number, rho: number, seed = 5): [number[], number[]] {
  const rand = lcg(seed);
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < n; i++) {
    const common = rand() - 0.5;
    const idioA = rand() - 0.5;
    const idioB = rand() - 0.5;
    a.push(0.02 * (rho * common + (1 - Math.abs(rho)) * idioA));
    b.push(0.02 * (rho * common + (1 - Math.abs(rho)) * idioB));
  }
  return [a, b];
}

/** Names the pair `correlatedSeries` returns, so it can be handed to a model. */
export function toReturns([a, b]: [number[], number[]]): ReturnsBySymbol {
  return { A: a, B: b };
}
