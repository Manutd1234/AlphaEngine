/**
 * Fixtures and assertion helpers shared by the `quant-*` suites.
 *
 * The research analytics were one file; they are now split by what they guard
 * (costs, regression, stability, walk-forward, tails, promotion) and four
 * things are common to more than one of them. They live here once so a
 * tolerance cannot drift between copies — `close` in particular is the only
 * place a comparison is loosened, and it is deliberately explicit about how far
 * apart the two numbers were when it fails.
 *
 * `lcg` is the house pattern for anything needing randomness: seeded, so a
 * failure is reproducible rather than a flake someone re-runs away.
 */

import assert from "node:assert/strict";

import type { ParamResult, WalkForwardFold } from "../../lib/types";

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

export function paramResult(fast: number, slow: number, sharpe: number): ParamResult {
  return {
    fast, slow, sharpe,
    totalReturn: 0, cagr: 0, sortino: 0, maxDrawdown: -0.1, calmar: 0,
    winRate: 0.5, trades: 40, avgWin: 0.02, avgLoss: 0.01,
    exposure: 0.5, turnover: 10, feesPaid: 0,
  };
}

export function fold(n: number, isSharpe: number, oosSharpe: number, f = 10, s = 40): WalkForwardFold {
  return {
    fold: n,
    trainStart: "", trainEnd: "", testStart: "", testEnd: "",
    chosenFast: f, chosenSlow: s,
    isSharpe, oosSharpe, oosReturn: 0,
  };
}
