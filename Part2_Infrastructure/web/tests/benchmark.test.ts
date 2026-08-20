/**
 * Comparison against an external instrument.
 *
 * Two things are being defended here, and they are not the arithmetic — the
 * regression is `regress()`, which `quant.test.ts` already covers.
 *
 * The first is the JOIN. Two vendors rarely stamp the same bar with the same
 * epoch, so the failure mode is an empty or near-empty intersection producing a
 * beta that looks measured and is not. The second is the ROUTE'S WHITELIST,
 * which is here because the benchmark work is what surfaced it: the sanitiser
 * carried a hand-written set of three strategies while the engines had grown to
 * twenty-six, silently coercing the other twenty-three to `ma_cross` on the way
 * in.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { bucketKey, compareToBenchmark, MIN_ALIGNED_BARS } from "@/lib/benchmark";
import { STRATEGY_LABELS, type Bar, type SeriesPoint } from "@/lib/types";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const DAY = 864e5;

/**
 * Deterministic bar returns with real variation.
 *
 * The first draft of these fixtures used a constant per-bar return, and every
 * comparison came back null — correctly. A constant regressor has zero variance,
 * so the design matrix is singular and `regress` refuses rather than inventing a
 * coefficient. That is the behaviour a degenerate feature set should have, so it
 * is now asserted below on purpose instead of being tripped over.
 */
function wiggle(n: number, drift: number, amplitude = 0.01): number[] {
  return Array.from({ length: n }, (_, i) => drift + Math.sin(i * 1.7) * amplitude);
}

/** A strategy equity curve compounding the given per-bar returns. */
function seriesFrom(returns: number[], startMs = 0, stepMs = DAY): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  let equity = 1;
  for (let i = 0; i <= returns.length; i++) {
    out.push({
      t: startMs + i * stepMs,
      close: 100, fast: null, slow: null, position: 1,
      equity, buyHold: 1, drawdown: 0,
    });
    if (i < returns.length) equity *= 1 + returns[i];
  }
  return out;
}

function barsFrom(returns: number[], startMs = 0, stepMs = DAY): Bar[] {
  const out: Bar[] = [];
  let price = 100;
  for (let i = 0; i <= returns.length; i++) {
    out.push({ t: startMs + i * stepMs, o: price, h: price, l: price, c: price, v: 1e6 });
    if (i < returns.length) price *= 1 + returns[i];
  }
  return out;
}

const series = (n: number, drift: number, startMs = 0, stepMs = DAY) =>
  seriesFrom(wiggle(n, drift), startMs, stepMs);
const bars = (n: number, drift: number, startMs = 0, stepMs = DAY) =>
  barsFrom(wiggle(n, drift), startMs, stepMs);

describe("the join is the part that goes wrong", () => {
  it("aligns a vendor that stamps midnight with one that stamps mid-session", () => {
    // The real case: FMP dates a daily bar 00:00:00Z, another vendor stamps the
    // session open. Joining on raw epochs finds nothing in common; both fall in
    // the same day bucket.
    const strategy = series(120, 0.001, 0);
    const benchmark = bars(120, 0.001, 13 * 36e5); // 13:00 the same days
    const out = compareToBenchmark(strategy, benchmark, "1d", "SPY");
    assert.ok(out, "a half-day stamp offset emptied the intersection");
    assert.ok(out.alignedBars > 100, `only ${out.alignedBars} bars aligned`);
  });

  it("refuses to report on too few aligned bars rather than reporting a number", () => {
    // A beta on twenty overlapping bars is a number, and printing it beside a
    // t-statistic makes it look like a measurement.
    const out = compareToBenchmark(series(120, 0.001), bars(20, 0.001), "1d", "SPY");
    assert.equal(out, null);
  });

  it("returns null when nothing lines up at all", () => {
    // Two years apart. The important property is null rather than a fit on the
    // handful of coincidences a looser join would manufacture.
    const out = compareToBenchmark(series(300, 0.001, 0), bars(300, 0.001, 900 * DAY), "1d", "SPY");
    assert.equal(out, null);
  });

  it("never spans a gap in the benchmark", () => {
    // A missing benchmark bar must drop that return, not join across it and
    // report a two-day move as a one-day one — which inflates the benchmark's
    // volatility and deflates the strategy's beta.
    //
    // Each hole costs exactly two returns: the one ending at the missing bar
    // and the one starting from it. A join that spanned gaps would lose one.
    const strategy = series(200, 0.001);
    const complete = bars(200, 0.002);
    const holed = complete.filter((_, i) => i % 7 !== 3);
    const holes = complete.length - holed.length;

    const dense = compareToBenchmark(strategy, complete, "1d", "SPY")!;
    const sparse = compareToBenchmark(strategy, holed, "1d", "SPY")!;
    const lost = dense.alignedBars - sparse.alignedBars;
    assert.ok(
      lost >= holes * 2 - 2,
      `${holes} holes cost only ${lost} returns — the join is spanning them`,
    );
  });

  it("buckets by the interval, not by a fixed day", () => {
    assert.equal(bucketKey(0, "1d"), bucketKey(86_399_999, "1d"));
    assert.notEqual(bucketKey(0, "1h"), bucketKey(36e5, "1h"));
  });

  it("reports how many bars it used, because a small number is a warning", () => {
    const out = compareToBenchmark(series(150, 0.001), bars(150, 0.001), "1d", "SPY")!;
    assert.ok(out.alignedBars >= MIN_ALIGNED_BARS);
    assert.ok(out.alignedBars <= 150);
  });
});

describe("the statistics say what they claim to", () => {
  const benchmarkReturns = wiggle(300, 0.0007);

  it("a strategy that IS the benchmark has beta 1 and no alpha", () => {
    const out = compareToBenchmark(
      seriesFrom(benchmarkReturns), barsFrom(benchmarkReturns), "1d", "SPY",
    )!;
    assert.ok(Math.abs(out.beta - 1) < 1e-6, `beta ${out.beta}`);
    assert.ok(Math.abs(out.alphaAnnualised) < 1e-6, `alpha ${out.alphaAnnualised}`);
    assert.ok(Math.abs(out.correlation - 1) < 1e-6);
    assert.ok(out.trackingError < 1e-9, "identical series should not track apart");
  });

  it("twice the benchmark's moves reads as beta 2, not as alpha", () => {
    // The distinction the whole panel exists for: leverage is not skill, and a
    // measure that cannot separate them will call every levered run alpha.
    const out = compareToBenchmark(
      seriesFrom(benchmarkReturns.map((r) => 2 * r)), barsFrom(benchmarkReturns), "1d", "SPY",
    )!;
    assert.ok(Math.abs(out.beta - 2) < 1e-3, `beta ${out.beta}`);
    assert.ok(Math.abs(out.alphaAnnualised) < 1e-6, `alpha ${out.alphaAnnualised} should be ~0`);
  });

  it("a constant drag against the same moves reads as negative alpha", () => {
    const out = compareToBenchmark(
      seriesFrom(benchmarkReturns.map((r) => r - 0.0005)), barsFrom(benchmarkReturns), "1d", "SPY",
    )!;
    assert.ok(Math.abs(out.beta - 1) < 1e-3, `beta ${out.beta}`);
    assert.ok(out.alphaAnnualised < -0.05, `alpha ${out.alphaAnnualised} should be clearly negative`);
    assert.ok(out.trackingError < 1e-6, "a constant drag is not tracking error");
  });

  it("reports the benchmark's own drawdown, not the strategy's", () => {
    // The strategy here rises; the benchmark falls hard. A panel showing the
    // strategy's drawdown under the benchmark's name would be reassuring and
    // wrong.
    const out = compareToBenchmark(series(300, 0.001), bars(300, -0.004), "1d", "SPY")!;
    assert.ok(out.maxDrawdown < -0.4, `benchmark drawdown ${out.maxDrawdown}`);
    assert.ok(out.totalReturn < -0.4, `benchmark return ${out.totalReturn}`);
  });

  it("leaves the information ratio undefined rather than dividing by zero", () => {
    const out = compareToBenchmark(
      seriesFrom(benchmarkReturns), barsFrom(benchmarkReturns), "1d", "SPY",
    )!;
    assert.equal(out.informationRatio, null);
  });

  it("fails closed on a benchmark that never moves", () => {
    // A constant regressor has zero variance and a singular design matrix.
    // `regress` returns null rather than a coefficient, and this must survive as
    // "no comparison" rather than a beta of 0 presented as a measurement.
    const flat = new Array(300).fill(0);
    assert.equal(compareToBenchmark(series(300, 0.001), barsFrom(flat), "1d", "SPY"), null);
  });
});

describe("the panel keeps the four absent cases apart", () => {
  const panel = read("../components/research/BenchmarkPanel.tsx");
  // Attribution is its own component since page.tsx was split; the mount
  // assertion follows it rather than scanning a shell that never had it.
  const attribution = read("../components/research/AttributionSection.tsx");

  it("is mounted in the attribution section", () => {
    assert.match(attribution, /import BenchmarkPanel/);
    assert.match(attribution, /<BenchmarkPanel/);
  });

  it("says which benchmark was requested when the comparison is missing", () => {
    // "No comparison available" for both "you did not pick one" and "the one
    // you picked would not load" is one sentence for two different actions.
    // The branch is named rather than inlined now, so this follows the name.
    assert.match(panel, /const failed = Boolean\(requested\)/);
    assert.match(panel, /\{failed\s*$/m, "the empty copy stopped branching on which case it is in");
    assert.match(panel, /\$\{requested\} was requested/);
    assert.match(panel, /No benchmark selected/);
  });

  it("names alignment as a possible cause rather than implying a missing feature", () => {
    assert.match(panel, /timestamps lined up|empty intersection/);
  });

  it("does not present an insignificant alpha as a finding", () => {
    assert.match(panel, /not distinguishable from zero/);
    assert.match(panel, /alphaPValue/);
  });

  it("keeps the OLS caveat with the number it qualifies", () => {
    assert.match(panel, /Newey/);
  });

  it("dashes the two measurements it cannot make instead of zeroing them", () => {
    // The card is headed by alpha and beta, so an empty state that shows
    // neither leaves the reader to guess whether they were measured. They are
    // rendered as the same dash every withheld figure in this codebase uses —
    // via `fmt(null)`, so the dash cannot drift from the rest of the app — with
    // the cause beside them. A 0.00 here would be an invented exposure.
    const empty = panel.slice(panel.indexOf("if (!comparison)"), panel.indexOf("const alphaSignificant"));
    assert.equal((empty.match(/fmt\(null\)/g) ?? []).length, 2,
      "the empty state stopped dashing alpha and beta");
    assert.doesNotMatch(empty, /\?\?\s*0/, "a withheld benchmark figure is being coerced to zero");
    // The dash's reason claims only what it knows: which of the two failures
    // occurred is the paragraph's job, and it names both.
    assert.match(empty, /No comparable series for \$\{requested\}\./);
    assert.match(empty, /No benchmark is selected\./);
  });

  it("states which absent case it is in the heading as well as the prose", () => {
    // The two cases carry different next actions, so they are distinguishable
    // at a glance rather than only in the middle of a paragraph.
    const empty = panel.slice(panel.indexOf("if (!comparison)"), panel.indexOf("const alphaSignificant"));
    assert.match(empty, /section-note/);
    assert.match(empty, /did not compare/);
    assert.match(empty, /none selected/);
  });
});

describe("the sanitiser accepts every strategy the engines implement", () => {
  const route = read("../app/api/backtest/route.ts");

  it("derives the whitelist instead of listing it again", () => {
    // The bug: a hand-written set of three that stayed three while the engines
    // grew to twenty-six, silently coercing twenty-three of them to `ma_cross`.
    // Invisible because the coercion is by design — a stale whitelist looks
    // exactly like a client sending nonsense.
    assert.match(route, /new Set\(Object\.keys\(STRATEGY_LABELS\)\)/);
    assert.doesNotMatch(
      route, /new Set\(\["ma_cross"/,
      "the route is back to a hand-written strategy list",
    );
  });

  it("has more than three strategies to accept", () => {
    // Guards the derivation itself: if `STRATEGY_LABELS` were ever emptied or
    // renamed, the set above would be silently empty and every request would
    // coerce to the default again.
    assert.ok(Object.keys(STRATEGY_LABELS).length >= 26);
  });

  it("treats a benchmark equal to the traded symbol as no benchmark", () => {
    // A regression of a series on itself has beta 1, R² 1 and alpha 0 — a
    // perfectly well-formed way of saying nothing.
    assert.match(route, /candidate === symbol/);
  });
});

/**
 * The empty state reaches a control. The control has to be there.
 *
 * It used to say "No benchmark selected. Choose one in the controls…" and stop,
 * which is a cross-reference nothing in the suite checked resolves — delete the
 * select from Controls.tsx and every test stayed green while the sentence
 * became a direction to a place that does not exist. Same failure mode as the
 * stale tour label and the "Open Data Ops" mismatch.
 *
 * The sentence is now a button that focuses the real select, so the reference
 * is an id rather than a description, and these tests hold that id from both
 * ends. A duplicate select rendered inside the card would resolve the same
 * prose complaint and is the thing being guarded against: it would own no part
 * of the request and would drift from the control that does.
 */
describe("the benchmark empty state reaches a control that exists", () => {
  const controls = read("../components/Controls.tsx");
  const panel = read("../components/research/BenchmarkPanel.tsx");

  it("the panel jumps at the control by id rather than describing where it is", () => {
    assert.match(panel, /const BENCHMARK_CONTROL_ID = "benchmark"/,
      "the panel no longer names the control it jumps at");
    assert.match(panel, /getElementById\(BENCHMARK_CONTROL_ID\)/,
      "the empty state stopped reaching the benchmark control");
    assert.match(panel, /Choose a benchmark →/);
  });

  it("the id it jumps at is the id the control carries", () => {
    const id = /const BENCHMARK_CONTROL_ID = "([^"]+)"/.exec(panel)?.[1];
    assert.ok(id, "the panel's control id is unreadable");
    assert.match(controls, new RegExp(`<select\\s+id="${id}"`),
      `Controls.tsx has no select with id="${id}" for the panel to focus`);
  });

  it("renders no benchmark control of its own", () => {
    // A second select would drift from `req.benchmarkSymbol`, which this
    // component does not own and cannot write. Comments stripped: the doc
    // comment on the id names the `<select>` it points at.
    const rendered = panel.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    assert.doesNotMatch(rendered, /<select/,
      "the panel grew its own benchmark control beside the one that owns the request");
  });

  it("says so when the jump cannot land instead of appearing to do nothing", () => {
    // The setup panel collapses under a width breakpoint and the select is
    // display:none there — in the DOM, unfocusable, and focus() a silent no-op.
    assert.match(panel, /document\.activeElement === control/,
      "the panel assumes focus landed rather than checking");
    assert.match(controls, /Hide setup" : "Edit setup"/,
      "the collapsed-rail hint names a toggle Controls.tsx no longer renders");
    assert.match(panel, /Open Edit setup in the research rail/);
  });

  it("does not animate the jump for a reader who asked it not to", () => {
    assert.match(panel, /prefers-reduced-motion: reduce/);
    assert.match(panel, /behavior: reduced \? "auto" : "smooth"/);
  });

  it("the controls carry a labelled benchmark selector", () => {
    assert.match(controls, /<label className="field" htmlFor="benchmark">/,
      "the benchmark control lost its label, or its id changed");
    assert.match(controls, /<select\s+id="benchmark"/,
      "the benchmark control is no longer a select with id=\"benchmark\"");
  });

  it("it is reachable — no tier gate, no disabled state", () => {
    const select = controls.slice(controls.indexOf('id="benchmark"'));
    const end = select.indexOf("</select>");
    assert.ok(end > 0, "the benchmark select is unterminated");
    assert.doesNotMatch(select.slice(0, end), /disabled/,
      "the benchmark control can be disabled, so the empty state can be a dead end");
    assert.doesNotMatch(controls, /useComplexity|atLeast/,
      "the setup panel started gating on the detail tier; the benchmark may become unreachable");
  });

  it("offers None as a real choice, not an absent default", () => {
    // types.ts: "its absence is not a default … rather than quietly
    // substituting one". The option has to exist for that to be a choice.
    assert.match(controls, /<option value="">None/);
  });
});

/**
 * The empty state names the other question. It must not answer it twice.
 *
 * The same-symbol buy-and-hold figures ARE available on this screen, and the
 * tempting fix for an empty card is to reprint them in it. Two reasons not to,
 * both already law here: `interaction.test.ts` keeps those figures in the stat
 * row paired with the strategy's own return and Sharpe, which is where a reader
 * compares them; and a same-symbol number printed inside a card headed "versus
 * benchmark" is the substitution `lib/types.ts` refuses in the sentence that
 * makes "None" a real choice. So the card states the distinction and points at
 * where the timing answer already is — and that pointer is checked, like the
 * control pointer above, rather than trusted.
 */
describe("the empty state distinguishes the two questions without answering both", () => {
  const panel = read("../components/research/BenchmarkPanel.tsx");
  // The stat row the card points at is Research ▸ Summary's own component.
  const page = read("../components/research/ResearchSummary.tsx");

  it("prints no same-symbol figure of its own", () => {
    assert.doesNotMatch(panel, /benchmark\.totalReturn|benchmark\.sharpe|buyHold/,
      "the benchmark card is printing the same-symbol comparison the stat row pairs properly");
  });

  it("names the timing question and the position question as different questions", () => {
    assert.match(panel, /<em>timing<\/em>/);
    assert.match(panel, /<em>position<\/em>/);
  });

  it("the stat row it points at still carries buy & hold beside the strategy's own", () => {
    // The pointer resolves or it is prose. Both notes live on the Summary
    // section's metric row; either one being renamed makes the sentence a lie.
    assert.match(page, /note=\{`buy & hold \$\{fmt\(displayedResult\.benchmark\.sharpe, 2\)\}`\}/,
      "the Summary Sharpe tile no longer carries the buy & hold note the panel names");
    assert.match(page, /note=\{`buy & hold \$\{signedPct\(displayedResult\.benchmark\.totalReturn\)\}`\}/,
      "the Summary return tile no longer carries the buy & hold note the panel names");
  });
});
