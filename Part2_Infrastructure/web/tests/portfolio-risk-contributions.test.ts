/**
 * Book-level risk maths: the decomposition, and what it is allowed to claim.
 *
 * The properties here are the ones that separate a real risk decomposition from
 * a plausible-looking ranking. Component contributions must **sum to total
 * volatility** — otherwise "what do I cut" has no answer.
 *
 * The hedge tests below are the interesting pair, and writing them is what
 * caught a wrong assumption: a correlated short *always* lowers total
 * volatility, but its risk **contribution** only turns negative once the
 * correlation is high enough to overcome its own variance. Below that crossover
 * it is diversifying rather than hedging — it carries positive risk while
 * reducing the total. Asserting "short ⇒ negative contribution" would have
 * pinned something untrue of most real books.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCovariance,
  portfolioRisk,
  type ReturnsBySymbol,
} from "../lib/portfolio-risk";
import { close, correlatedSeries, toReturns } from "./helpers/risk-series";

describe("risk contributions decompose the actual total", () => {
  const [a, b] = correlatedSeries(400, 0.5, 11);
  const returns: ReturnsBySymbol = { A: a, B: b };
  const model = buildCovariance(["A", "B"], returns)!;

  it("component contributions sum to portfolio volatility", () => {
    // The Euler property. Without it the column is a ranking, not an
    // attribution, and cannot answer "what do I cut to lose the most risk".
    const risk = portfolioRisk(
      [{ symbol: "A", signedNotional: 3_000_000 }, { symbol: "B", signedNotional: 2_000_000 }],
      10_000_000,
      model,
      365,
    )!;
    const summed = risk.contributions.reduce((acc, c) => acc + c.contribution, 0);
    close(summed, risk.volatility, 1e-12, "contributions must sum to total vol");
    close(risk.contributions.reduce((acc, c) => acc + c.contributionShare, 0), 1, 1e-12, "shares sum to 1");
  });

  it("a correlated short lowers total volatility", () => {
    const hedged = portfolioRisk(
      [{ symbol: "A", signedNotional: 3_000_000 }, { symbol: "B", signedNotional: -2_500_000 }],
      10_000_000,
      model,
      365,
    )!;
    const longOnly = portfolioRisk(
      [{ symbol: "A", signedNotional: 3_000_000 }],
      10_000_000,
      model,
      365,
    )!;
    assert.ok(
      hedged.volatility < longOnly.volatility,
      `the short must reduce book volatility: ${hedged.volatility} vs ${longOnly.volatility}`,
    );
  });

  it("a hedge's CONTRIBUTION goes negative only once it is correlated enough", () => {
    // Worth pinning because the two facts above and below are easy to conflate,
    // and the panel shows the second one.
    //
    // For a short B against a long A, the component contribution is
    // `w_B · (Σw)_B / σₚ`, and `(Σw)_B ∝ w_A·ρ − |w_B|`. With w_A = 0.30 and
    // w_B = −0.25 that flips sign at ρ ≈ 0.833. Below it the short still lowers
    // total volatility while *carrying* positive risk — it is diversifying, not
    // hedging. A test that asserted "short ⇒ negative contribution" would be
    // asserting something untrue of most real books.
    const weak = buildCovariance(["A", "B"], toReturns(correlatedSeries(400, 0.5, 11)))!;
    const strong = buildCovariance(["A", "B"], toReturns(correlatedSeries(400, 0.9, 11)))!;
    const book = [
      { symbol: "A", signedNotional: 3_000_000 },
      { symbol: "B", signedNotional: -2_500_000 },
    ];

    const weakShort = portfolioRisk(book, 10_000_000, weak, 365)!
      .contributions.find((c) => c.symbol === "B")!;
    const strongShort = portfolioRisk(book, 10_000_000, strong, 365)!
      .contributions.find((c) => c.symbol === "B")!;

    assert.ok(
      weakShort.contribution > 0,
      `at rho 0.5 the short still carries risk, got ${weakShort.contribution}`,
    );
    assert.ok(
      strongShort.contribution < 0,
      `at high correlation the short must take risk OUT, got ${strongShort.contribution}`,
    );
  });

  it("VaR scales with equity-relative exposure, not gross notional", () => {
    const small = portfolioRisk([{ symbol: "A", signedNotional: 1_000_000 }], 10_000_000, model, 365)!;
    const levered = portfolioRisk([{ symbol: "A", signedNotional: 5_000_000 }], 10_000_000, model, 365)!;
    close(levered.var95 / small.var95, 5, 1e-9, "5x the exposure is 5x the VaR");
    assert.ok(levered.var99 > levered.var95, "99% must be deeper than 95%");
    assert.ok(levered.cvar95 > levered.var95, "expected shortfall is beyond VaR");
  });

  it("historical VaR is reported alongside, from real replay", () => {
    const risk = portfolioRisk(
      [{ symbol: "A", signedNotional: 4_000_000 }],
      10_000_000,
      model,
      365,
      returns,
    )!;
    assert.ok(risk.historicalVar95 !== null, "history was supplied, so it must be used");
    assert.ok(risk.historicalCvar95! >= risk.historicalVar95!, "ES is at least as deep as VaR");
  });

  it("a flat book has no risk to decompose", () => {
    assert.equal(portfolioRisk([], 10_000_000, model, 365), null);
    assert.equal(
      portfolioRisk([{ symbol: "A", signedNotional: 0 }], 10_000_000, model, 365),
      null,
    );
  });
});
