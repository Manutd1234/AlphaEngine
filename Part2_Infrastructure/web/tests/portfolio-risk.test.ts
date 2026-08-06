/**
 * Book-level risk maths.
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
 *
 * And an instrument whose beta cannot be measured must move by nothing rather
 * than by a default of 1, because a stress total inflated by invented exposure
 * is worse than one that admits a gap.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SCENARIOS,
  applyScenario,
  applyManualWeights,
  beta,
  buildCovariance,
  portfolioRisk,
  proposeAllocation,
  rebalanceTrades,
  type ReturnsBySymbol,
} from "../lib/portfolio-risk";
import { bookStatus, sandboxBook } from "../lib/portfolio";

const close = (a: number, b: number, tol: number, what = "") =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} !== ${b} (Δ ${Math.abs(a - b)} > ${tol})`);

/** Deterministic LCG — the house pattern for anything needing randomness. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function toReturns([a, b]: [number[], number[]]): ReturnsBySymbol {
  return { A: a, B: b };
}

/** Two series with a controlled correlation, built from a shared factor. */
function correlatedSeries(n: number, rho: number, seed = 5): [number[], number[]] {
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

describe("covariance is measured, and refuses to guess", () => {
  it("recovers a known correlation", () => {
    const [a, b] = correlatedSeries(500, 0.9);
    const m = buildCovariance(["A", "B"], { A: a, B: b })!;
    assert.ok(m, "model should build");
    assert.ok(m.correlation[0][1] > 0.7, `expected high correlation, got ${m.correlation[0][1]}`);
    close(m.correlation[0][0], 1, 1e-12, "self-correlation");
    close(m.correlation[0][1], m.correlation[1][0], 1e-12, "symmetry");
  });

  it("returns null rather than a covariance built on nothing", () => {
    assert.equal(buildCovariance(["A"], { A: [0.01, 0.02] }), null, "2 observations is not a covariance");
    assert.equal(buildCovariance(["A"], {}), null, "no history at all");
  });

  it("truncates to the shortest common history instead of padding with zeros", () => {
    // Padding would read as zero volatility and zero correlation — the two
    // errors that both make a book look safer than it is.
    const long = Array.from({ length: 200 }, (_, i) => (i % 7) * 0.001 - 0.003);
    const short = long.slice(-40);
    const m = buildCovariance(["L", "S"], { L: long, S: short })!;
    assert.equal(m.observations, 40, "should align to the shorter series");
    assert.ok(m.vol[0] > 0 && m.vol[1] > 0, "neither series should read as zero-vol");
  });
});

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

describe("stress testing never invents exposure", () => {
  const [a, b] = correlatedSeries(300, 0.8, 3);
  const returns: ReturnsBySymbol = { BTCUSDT: a, ETHUSDT: b };

  it("an explicitly shocked position uses the shock, not a beta", () => {
    const r = applyScenario(
      [{ symbol: "BTCUSDT", signedNotional: 1_000_000 }],
      10_000_000,
      [{ symbol: "BTCUSDT", move: -0.2 }],
      returns,
      "BTCUSDT",
    );
    close(r.totalPnl, -200_000, 1e-9, "1M long, -20%");
    assert.equal(r.perPosition[0].viaBeta, false);
  });

  it("an unshocked position moves by its MEASURED beta", () => {
    const r = applyScenario(
      [{ symbol: "ETHUSDT", signedNotional: 1_000_000 }],
      10_000_000,
      [{ symbol: "BTCUSDT", move: -0.1 }],
      returns,
      "BTCUSDT",
    );
    const measured = beta("ETHUSDT", "BTCUSDT", returns)!;
    assert.ok(measured > 0, "these series are positively related");
    close(r.perPosition[0].appliedMove, measured * -0.1, 1e-12, "move = beta x shock");
    assert.equal(r.perPosition[0].viaBeta, true);
  });

  it("an unmeasurable position is held FLAT, not defaulted to beta 1", () => {
    // Defaulting to 1 is how a stress total quietly becomes fiction.
    const r = applyScenario(
      [{ symbol: "UNKNOWN", signedNotional: 5_000_000 }],
      10_000_000,
      [{ symbol: "BTCUSDT", move: -0.3 }],
      returns,
      "BTCUSDT",
    );
    assert.equal(beta("UNKNOWN", "BTCUSDT", returns), null, "no history means no beta");
    assert.equal(r.perPosition[0].appliedMove, 0, "no measurable beta must mean no assumed move");
    assert.equal(r.totalPnl, 0);
  });

  it("a short profits from a down shock", () => {
    const r = applyScenario(
      [{ symbol: "BTCUSDT", signedNotional: -2_000_000 }],
      10_000_000,
      [{ symbol: "BTCUSDT", move: -0.25 }],
      returns,
      "BTCUSDT",
    );
    assert.ok(r.totalPnl > 0, `a short should gain when the market falls, got ${r.totalPnl}`);
    close(r.totalPnl, 500_000, 1e-9, "2M short, -25%");
  });

  it("the no-shock baseline moves nothing", () => {
    const flat = SCENARIOS.find((s) => s.id === "flat")!;
    const r = applyScenario(
      [{ symbol: "BTCUSDT", signedNotional: 1_000_000 }, { symbol: "ETHUSDT", signedNotional: -500_000 }],
      10_000_000,
      flat.shocks,
      returns,
      "BTCUSDT",
    );
    close(r.totalPnl, 0, 1e-9, "a zero shock must produce zero P&L");
  });
});

describe("the sandbox book is coherent and unmistakably flagged", () => {
  const book = sandboxBook();

  it("carries the sandbox flag the UI banners on", () => {
    assert.equal(book.sandbox, true);
    assert.equal(book.gateway?.authoritative, false);
  });

  it("is deterministic — the same book every call", () => {
    assert.deepEqual(sandboxBook(), sandboxBook());
  });

  it("its own arithmetic agrees", () => {
    const gross = book.exposure.positions.reduce((acc, p) => acc + p.notional, 0);
    close(book.exposure.gross, gross, 1e-6, "gross is the sum of notionals");
    close(
      book.exposure.positions.reduce((acc, p) => acc + p.share_of_gross, 0),
      1,
      1e-9,
      "shares sum to 1",
    );
    close(book.exposure.leverage, gross / book.equity.current, 1e-9, "leverage");
    close(
      book.equity.daily_pnl,
      book.equity.current - book.equity.start_of_day,
      1e-6,
      "day P&L",
    );
    for (const p of book.exposure.positions) {
      close(p.total_pnl, p.unrealized_pnl + p.realized_pnl, 1e-6, `${p.symbol} total P&L`);
    }
  });

  it("carries a short, so the risk decomposition has a hedge to show", () => {
    assert.ok(
      book.exposure.positions.some((p) => p.side === "SHORT"),
      "an all-long sandbox cannot demonstrate negative risk contribution",
    );
    assert.ok(book.exposure.net < book.exposure.gross, "net must be below gross with a short present");
  });

  it("names a binding constraint that is actually the tightest", () => {
    const [, utilisation] = book.risk_budget.binding_constraint;
    assert.ok(
      utilisation >= book.risk_budget.gross_exposure.utilisation - 1e-9,
      "the binding constraint must be at least as tight as gross exposure",
    );
  });
});

// --------------------------------------------------------------------------
// Headline status
// --------------------------------------------------------------------------

describe("the status chip cannot name one constraint and size another", () => {
  const book = () => sandboxBook();

  const withBinding = (name: string, utilisation: number) => {
    const b = book();
    b.risk_budget.binding_constraint = [name, utilisation];
    return b;
  };

  it("takes its number from the constraint it names", () => {
    // The shipped bug: the name came from `binding_constraint` and the number
    // from max(gross, drawdown). With symbol exposure at 90% and gross at 72%
    // the chip read "ELEVATED — symbol exposure at 72%" — right name, wrong
    // number, one severity band too low.
    const status = bookStatus(withBinding("symbol_exposure", 0.9));
    assert.equal(status.constraint, "symbol_exposure");
    assert.ok(status.utilisation >= 0.9, `utilisation ignored the binder: ${status.utilisation}`);
    assert.equal(status.level, "critical");
    assert.match(status.detail, /90%/, `detail must quote the binder's own number: ${status.detail}`);
  });

  it("never reports a utilisation below the binding constraint's", () => {
    for (const u of [0.05, 0.4, 0.71, 0.89, 0.9, 1.4]) {
      const status = bookStatus(withBinding("symbol_exposure", u));
      assert.ok(
        status.utilisation >= u,
        `binder at ${u} but status reported ${status.utilisation}`,
      );
    }
  });

  it("still escalates on a headroom the gateway did not name", () => {
    // A gateway that under-reports its own binder must not be able to talk the
    // chip down below what the structured headrooms already show.
    const b = withBinding("symbol_exposure", 0.1);
    b.risk_budget.gross_exposure.utilisation = 0.95;
    assert.equal(bookStatus(b).level, "critical");
  });

  it("a halt outranks every utilisation band", () => {
    const b = withBinding("symbol_exposure", 0.01);
    b.trading_halted = true;
    const status = bookStatus(b);
    assert.equal(status.level, "halted");
    assert.match(status.detail, /kill switch/);
  });

  it("bands are inclusive at their boundaries", () => {
    // The other headrooms have to be flattened to isolate the band edges: the
    // sandbox book's gross sits at 71.7%, so a 0.69 binder correctly still
    // reports "elevated" — which is the previous assertion's whole point.
    const only = (utilisation: number) => {
      const b = withBinding("x", utilisation);
      b.risk_budget.gross_exposure.utilisation = 0;
      b.risk_budget.daily_drawdown.utilisation = 0;
      return bookStatus(b).level;
    };
    assert.equal(only(0.9), "critical", "0.9 is inside critical");
    assert.equal(only(0.7), "elevated", "0.7 is inside elevated");
    assert.equal(only(0.69), "normal");
    assert.equal(only(0.899), "elevated", "just under 0.9 must not read critical");
  });
});

// --------------------------------------------------------------------------
// Manual target weights
//
// The one place on this surface where a number comes from a person rather than
// a solver. What matters is that the panel never quietly edits it: a typed
// weight that does not add up has to be reported, not rescaled.
// --------------------------------------------------------------------------

function _threeAssetProposal() {
  const base = Array.from({ length: 80 }, (_, i) => 0.004 * (i % 2 ? 1 : -1) + 0.0006 * ((i % 7) - 3));
  const swing = Array.from({ length: 80 }, (_, i) => 0.0015 * ((i % 5) - 2) + 0.0004 * (i % 3 ? 1 : -1));
  const history: ReturnsBySymbol = {
    AAA: base,
    BBB: base.map((b, i) => 0.6 * b + 2 * swing[i]),
    CCC: base.map((b, i) => -0.4 * b + 0.5 * swing[i]),
  };
  const model = buildCovariance(Object.keys(history), history);
  assert.ok(model);
  const positions = [
    { symbol: "BBB", signedNotional: 180_000 },
    { symbol: "AAA", signedNotional: 120_000 },
    { symbol: "CCC", signedNotional: -60_000 },
  ];
  const proposal = proposeAllocation(positions, model, "inverse_vol");
  assert.ok(proposal);
  return { proposal, positions, model };
}

describe("a manual override honours what was typed", () => {
  it("holds a pinned weight exactly and spreads the rest pro-rata to the model", () => {
    const { proposal } = _threeAssetProposal();
    const modelWeights = new Map(proposal.targets.map((t) => [t.symbol, t.targetWeight]));

    const manual = applyManualWeights(proposal, { AAA: 0.5 });
    const weights = new Map(manual.targets.map((t) => [t.symbol, t.targetWeight]));

    assert.ok(Math.abs(weights.get("AAA")! - 0.5) < 1e-9, "the typed weight was edited");
    assert.deepEqual(manual.pinned, ["AAA"]);
    assert.equal(manual.balanced, true);

    // The remaining 50% is split in the model's own proportions, so the ratio
    // between two untouched names survives. Splitting it equally would override
    // rows nobody touched.
    const modelRatio = modelWeights.get("BBB")! / modelWeights.get("CCC")!;
    const manualRatio = weights.get("BBB")! / weights.get("CCC")!;
    assert.ok(
      Math.abs(modelRatio - manualRatio) < 1e-9,
      `untouched rows were re-ordered: ${modelRatio} vs ${manualRatio}`,
    );
  });

  it("reports an over-allocation rather than rescaling it away", () => {
    const { proposal, positions } = _threeAssetProposal();
    const manual = applyManualWeights(proposal, { AAA: 0.7, BBB: 0.42 });

    assert.equal(manual.balanced, false);
    assert.ok(Math.abs(manual.weightSum - 1.12) < 1e-9, `weightSum was ${manual.weightSum}`);

    const weights = new Map(manual.targets.map((t) => [t.symbol, t.targetWeight]));
    assert.ok(Math.abs(weights.get("AAA")! - 0.7) < 1e-9, "a typed weight was rescaled to fit");
    assert.ok(Math.abs(weights.get("BBB")! - 0.42) < 1e-9, "a typed weight was rescaled to fit");
    assert.equal(weights.get("CCC"), 0, "an over-allocated book cannot fund the remainder");

    // The panel withholds trades in this state; the engine still has to produce
    // a coherent object rather than throwing or emitting negatives.
    assert.ok(rebalanceTrades(manual, positions, 0.05).every((t) => t.notional >= 0));
  });

  it("clamps a typed weight into the long-only range every solver uses", () => {
    const { proposal } = _threeAssetProposal();
    const manual = applyManualWeights(proposal, { AAA: -0.3, BBB: 4 });
    const weights = new Map(manual.targets.map((t) => [t.symbol, t.targetWeight]));
    assert.equal(weights.get("AAA"), 0);
    assert.ok(Math.abs(weights.get("BBB")! - 1) < 1e-9);
  });

  it("still names the limit that capped a typed weight", () => {
    const { proposal } = _threeAssetProposal();
    // 90% of a 360k book is 324k, well past a 150k symbol cap.
    const manual = applyManualWeights(proposal, { AAA: 0.9 }, { maxSymbolNotional: 150_000 });
    const capped = manual.targets.find((t) => t.symbol === "AAA");
    assert.ok(capped);
    assert.equal(capped.clippedBy, "max_symbol_notional_usd");
    assert.equal(manual.clipped, true);
    assert.ok(capped.targetNotional <= 150_000 + 1e-6);
    // The pre-clip sum is what tells the reader their own numbers balanced —
    // the clip is the gateway's opinion, not theirs.
    assert.equal(manual.balanced, true);
  });

  it("returns the typed weights verbatim when every row is pinned and balances", () => {
    const { proposal } = _threeAssetProposal();
    const manual = applyManualWeights(proposal, { AAA: 0.2, BBB: 0.3, CCC: 0.5 });
    const weights = new Map(manual.targets.map((t) => [t.symbol, t.targetWeight]));
    assert.equal(manual.balanced, true);
    assert.ok(Math.abs(weights.get("AAA")! - 0.2) < 1e-9);
    assert.ok(Math.abs(weights.get("BBB")! - 0.3) < 1e-9);
    assert.ok(Math.abs(weights.get("CCC")! - 0.5) < 1e-9);
  });

  it("keeps the seed method visible instead of renaming itself", () => {
    // `method` names what was solved. A manual proposal is discriminated by its
    // own flag, so a reader can always see which model they started from.
    const { proposal } = _threeAssetProposal();
    const manual = applyManualWeights(proposal, { AAA: 0.5 });
    assert.equal(manual.method, "inverse_vol");
    assert.equal(manual.manual, true);
  });

  it("is a no-op when nothing has been pinned", () => {
    const { proposal } = _threeAssetProposal();
    const manual = applyManualWeights(proposal, {});
    assert.deepEqual(manual.pinned, []);
    assert.equal(manual.balanced, true);
    for (const target of manual.targets) {
      const original = proposal.targets.find((t) => t.symbol === target.symbol);
      assert.ok(original);
      assert.ok(Math.abs(target.targetWeight - original.targetWeight) < 1e-9, target.symbol);
    }
  });
});
