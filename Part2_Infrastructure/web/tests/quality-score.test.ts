/**
 * The composite score.
 *
 * A single number invites trust it has not earned, so most of these assert the
 * ways it must REFUSE to flatter a run: an unmeasured category cannot be
 * silently skipped, weights must sum to the scale they claim, and the naive
 * statistics must not be able to outvote the corrected ones.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  QUALITY_WEIGHTS,
  QualityInput,
  qualityInputFromSweep,
  qualityScore,
} from "@/lib/quality-score";
import type { SweepResponse } from "@/lib/types";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** Comment-free view: the assertions below quote constructs they forbid. */
const code = (source: string) =>
  source
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    })
    .join("\n");

const solid: QualityInput = {
  deflatedSharpeRatio: 0.96, sharpe: 1.8, maxDrawdown: -0.12, calmar: 2.4,
  totalReturn: 0.8, winRate: 0.56, trades: 64,
  medianEfficiency: 0.9, overfittingProbability: 0.1, walkForwardOosSharpe: 1.4,
  benchmarkSharpe: 0.4, benchmarkTotalReturn: 0.2,
};

describe("the scale is what it claims to be", () => {
  it("the weights sum to 100", () => {
    const sum = Object.values(QUALITY_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.equal(sum, 100, "a score out of 100 whose parts do not sum to 100 is not out of 100");
  });

  it("every category the weights name is actually produced", () => {
    const ids = qualityScore(solid).categories.map((c) => c.id).sort();
    assert.deepEqual(ids, Object.keys(QUALITY_WEIGHTS).sort());
  });

  it("stays within 0-100 for absurd inputs in both directions", () => {
    const wild = qualityScore({
      ...solid, sharpe: 400, totalReturn: 90, calmar: 1e6, trades: 1e6, deflatedSharpeRatio: 1,
    });
    assert.ok(wild.total <= 100 && wild.total >= 0, `out of range: ${wild.total}`);

    const dire = qualityScore({
      ...solid, deflatedSharpeRatio: -5, sharpe: -9, maxDrawdown: -0.99, calmar: -20,
      totalReturn: -0.95, winRate: 0, trades: 0,
      medianEfficiency: -3, overfittingProbability: 1, walkForwardOosSharpe: -2,
      benchmarkSharpe: 9, benchmarkTotalReturn: 9,
    });
    assert.ok(dire.total >= 0 && dire.total <= 100, `out of range: ${dire.total}`);
  });
});

describe("an unmeasured category is not a passed one", () => {
  it("scores robustness zero when walk-forward did not run, and says so", () => {
    // The alternative — omitting the category and rescaling — would let a run
    // that was never validated out-of-sample outscore one that was and did
    // badly. Absence of evidence would become evidence.
    const withWf = qualityScore(solid);
    const withoutWf = qualityScore({
      ...solid, medianEfficiency: null, overfittingProbability: null, walkForwardOosSharpe: null,
    });

    assert.ok(withoutWf.total < withWf.total, "skipping walk-forward did not cost anything");
    assert.equal(withoutWf.incomplete, true);
    assert.match(withoutWf.verdict, /unmeasured|floor/i,
      "the verdict does not warn that the total is a floor");
  });
});

describe("the corrected statistics outrank the naive ones", () => {
  it("a high raw Sharpe with a poor DSR cannot reach a strong score", () => {
    // The specific failure this repository already computes DSR to avoid: a
    // grid search over hundreds of combinations makes the best raw Sharpe a
    // biased estimate, and a score that rewarded it would contradict the
    // machinery sitting next to it.
    const overfit = qualityScore({
      ...solid, sharpe: 3.2, deflatedSharpeRatio: 0.2,
      medianEfficiency: 0.1, overfittingProbability: 0.8, walkForwardOosSharpe: -0.2,
    });
    assert.ok(overfit.total < 55,
      `a Sharpe of 3.2 with DSR 0.2 and PBO 80% scored ${overfit.total} — the naive statistic won`);
  });

  it("robustness alone moves the total materially", () => {
    const robust = qualityScore(solid);
    const fragile = qualityScore({
      ...solid, medianEfficiency: 0.05, overfittingProbability: 0.9, walkForwardOosSharpe: -0.5,
    });
    assert.ok(robust.total - fragile.total >= 12,
      "out-of-sample collapse barely changed the score");
  });
});

describe("it describes history and does not predict", () => {
  it("no verdict promises anything about the future", () => {
    for (const input of [solid, { ...solid, sharpe: 0.1, deflatedSharpeRatio: 0.1 }]) {
      const { verdict } = qualityScore(input);
      assert.doesNotMatch(verdict, /will|expect|profit|guarantee/i,
        `a verdict predicted rather than described: "${verdict}"`);
    }
  });

  it("every category reports its detail in the reader's units", () => {
    // A breakdown of six bare numbers is unreadable; the point of the detail
    // line is that a reader can check the score against something they know.
    for (const c of qualityScore(solid).categories) {
      assert.ok(c.detail.length > 0, `${c.id} has no detail`);
      assert.match(c.detail, /[0-9]/, `${c.id} detail cites no measured value`);
    }
  });
});

// --------------------------------------------------------------------------
// The mapping from a sweep response, and the panel that renders it
// --------------------------------------------------------------------------

/** Only the fields `qualityInputFromSweep` reads; the rest is irrelevant here. */
function sweep(over: Record<string, unknown> = {}): SweepResponse {
  return {
    request: { symbol: "BTCUSDT" },
    deflatedSharpeRatio: 0.9,
    walkForwardOosSharpe: 1.1,
    best: {
      sharpe: 2.7, maxDrawdown: -0.18, calmar: 1.9, totalReturn: 0.44,
      winRate: 0.51, trades: 41,
    },
    walkForwardReport: { medianEfficiency: 0.7, overfittingProbability: 0.2 },
    benchmark: { sharpe: 0.6, totalReturn: 0.25 },
    ...over,
  } as unknown as SweepResponse;
}

describe("the mapping from a sweep response is where the score gets corrupted", () => {
  it("reads each field from the place that owns it", () => {
    const input = qualityInputFromSweep(sweep());
    assert.equal(input.deflatedSharpeRatio, 0.9);   // top level, not best
    assert.equal(input.sharpe, 2.7);                // best, not the report
    assert.equal(input.walkForwardOosSharpe, 1.1);
    assert.equal(input.maxDrawdown, -0.18);
    assert.equal(input.trades, 41);
    assert.equal(input.benchmarkSharpe, 0.6);
  });

  it("never substitutes the in-sample Sharpe for the out-of-sample one", () => {
    // The exact leak that scored an overfit run 55. `best.sharpe` is 2.7 and
    // the OOS Sharpe is 1.1 — if these are ever conflated the benchmark
    // category collects full marks on a number walk-forward disagreed with.
    const input = qualityInputFromSweep(sweep());
    assert.notEqual(input.walkForwardOosSharpe, input.sharpe);
  });

  it("carries an absent walk-forward through as null, not zero", () => {
    // Zero is a measurement. Null is the absence of one, and only null makes
    // the robustness category say "unmeasured" instead of "measured as bad".
    const input = qualityInputFromSweep(sweep({
      walkForwardOosSharpe: null,
      walkForwardReport: { medianEfficiency: null, overfittingProbability: null },
    }));
    assert.equal(input.medianEfficiency, null);
    assert.equal(input.overfittingProbability, null);
    assert.equal(qualityScore(input).incomplete, true);
  });

  it("falls back to the same-symbol comparison when no benchmark was chosen", () => {
    const input = qualityInputFromSweep(sweep({ benchmark: { sharpe: 0.31, totalReturn: 0.07 } }));
    assert.equal(input.benchmarkSharpe, 0.31);
    assert.equal(input.benchmarkTotalReturn, 0.07);
    // And says so. A category labelled "versus benchmark" that silently means
    // "versus holding the same thing" is read as the stronger claim every time.
    assert.match(input.benchmarkLabel ?? "", /buy-and-hold on BTCUSDT/);
  });

  it("prefers the external benchmark when the run computed one", () => {
    const input = qualityInputFromSweep(sweep({
      benchmark: { sharpe: 0.31, totalReturn: 0.07 },
      benchmarkComparison: { symbol: "SPY", sharpe: 0.88, totalReturn: 0.42, alignedBars: 400 },
    }));
    assert.equal(input.benchmarkSharpe, 0.88);
    assert.equal(input.benchmarkTotalReturn, 0.42);
    assert.equal(input.benchmarkLabel, "SPY");
  });

  it("names the benchmark inside the category detail, not just the input", () => {
    // The detail line is what a reader sees. A correct input feeding a detail
    // that still says "buy-and-hold" would be the same defect one layer down.
    const withSpy = qualityScore(qualityInputFromSweep(sweep({
      benchmarkComparison: { symbol: "SPY", sharpe: 0.5, totalReturn: 0.2, alignedBars: 400 },
    })));
    const detail = withSpy.categories.find((c) => c.id === "benchmark")!.detail;
    assert.match(detail, /SPY/);
    assert.doesNotMatch(detail, /buy-and-hold/);
  });
});

describe("the panel renders the score rather than a second version of it", () => {
  const panel = read("../components/research/QualityScorePanel.tsx");
  const page = read("../app/page.tsx");
  const css = read("../app/globals.css");

  it("is mounted, and above the promotion gate", () => {
    // A score module nothing renders is the defect this closes. Order matters
    // too: the score ranks, the gate vetoes, and side by side they read as two
    // rival verdicts on one run.
    assert.match(page, /import QualityScorePanel/);
    const mount = page.indexOf("<QualityScorePanel data={data} />");
    const gate = page.indexOf("<PromotionPanel");
    assert.ok(mount > 0, "QualityScorePanel is never mounted");
    assert.ok(mount < gate, "the score renders below the gate it is supposed to lead");
  });

  it("uses the exported weights instead of restating them", () => {
    // Six numbers hand-typed into JSX is six numbers that drift from the module
    // the moment a weight is retuned.
    for (const weight of Object.values(QUALITY_WEIGHTS)) {
      assert.doesNotMatch(
        code(panel), new RegExp(`weight[^\\n]*\\b${weight}\\b`),
        `the panel hard-codes the weight ${weight}`,
      );
    }
    assert.match(code(panel), /category\.weight/);
  });

  it("shows each category's weighted contribution, not its raw score", () => {
    // A row reading 92 beside a total of 61 makes a reader distrust the
    // arithmetic rather than the run.
    assert.match(code(panel), /category\.score \* category\.weight\) \/ 100/);
  });

  it("keeps the verdict and its caveats out of any disclosure", () => {
    // This assertion used to forbid `<details>` outright, on the grounds that
    // the hazard of one number is that it travels further than its caveats.
    // The detail-level tiers made that too blunt: Guided collapses the
    // six-category breakdown behind a summary that names it, which is a
    // different thing from hiding it, and `complexity.test.ts` pins that the
    // summary has to say what is inside.
    //
    // What must never be collapsible is narrower and more important — the
    // total, and the verdict sentence that carries the walk-forward warning
    // ("the total is a floor, not a verdict"). A score whose caveat is behind a
    // click is a score that gets screenshotted without it.
    const beforeDisclosure = code(panel).slice(0, code(panel).indexOf("<details"));
    assert.match(beforeDisclosure, /score\.total/);
    assert.match(beforeDisclosure, /score\.verdict/);
    assert.match(code(panel), /score\.categories\.map/);
  });

  it("names the promotion gate as a footnote rather than a rival headline", () => {
    assert.match(code(panel), /gate\.passed/);
    assert.match(code(panel), /promotion criteria met/);
  });

  it("says which benchmark the benchmark category used", () => {
    // "Versus benchmark" reads as "versus the market" to anyone who has met the
    // phrase elsewhere, and today it is buy-and-hold on the same symbol.
    assert.match(code(panel), /buy-and-hold/);
    assert.match(code(panel), /data\.request\.symbol/);
  });

  it("reuses the existing meter grammar instead of declaring a third", () => {
    assert.match(code(panel), /console-meter console-meter--wide/);
  });

  it("gives each bar an accessible reading of its own value", () => {
    // A bare coloured bar is invisible to a screen reader and to anyone who
    // cannot separate the three tones.
    assert.match(code(panel), /aria-label=/);
  });

  it("survives both themes and both column widths", () => {
    const block = css.slice(css.indexOf("/* ── Quality score"));
    assert.deepEqual(block.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], [],
      "hard-coded colours would be a dark-only slab in light mode");
    // The panel appears full-width and inside `.compact-grid-2col`; only its own
    // width can decide whether the breakdown fits two columns.
    assert.match(block, /container-type:\s*inline-size/);
    assert.match(block, /@container/);
  });
});
