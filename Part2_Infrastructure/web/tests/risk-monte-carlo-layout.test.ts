import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readSource } from "./helpers/source-files";

const histogram = readSource("components/risk/McHistogram.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
const distribution = readSource("components/risk/MonteCarloDistribution.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
const css = readSource("app/globals/14zzj-layout-review-followup.css").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the terminal Monte Carlo comparison is one bounded analytical pair", () => {
  it("gives the histogram one DOM root while retaining its figure and exact scale", () => {
    assert.match(histogram, /<div className="mc-histogram">[\s\S]*?<Figure[\s\S]*?<Plot/);
    assert.match(histogram, /className="[^"]*\bmc-histogram__scale\b[^"]*"/);
    for (const reading of ["Worst outcome", "Break-even", "Best outcome", "mcUsd(lo)", "<dd>$0</dd>", "mcUsd(hi)"]) {
      assert.ok(histogram.includes(reading), `${reading} disappeared from the exact scale`);
    }
    const figure = histogram.slice(histogram.indexOf("<Figure"), histogram.indexOf("</Figure>"));
    assert.match(figure, /<dl className="[^"]*\bmc-histogram__scale\b[^"]*"/,
      "the exact range escaped the histogram box again");
  });

  it("keeps exactly the histogram and tail gauge as the comparison's children", () => {
    const pair = distribution.match(/<div className="mc-distribution-figures">([\s\S]*?)<\/div>/)?.[1] ?? "";
    assert.equal((pair.match(/<McHistogram\b/g) ?? []).length, 1);
    assert.equal((pair.match(/<McTailGauge\b/g) ?? []).length, 1);
    assert.equal((pair.match(/<Mc(?:Histogram|TailGauge)\b/g) ?? []).length, 2);
  });

  it("uses the shared quantitative Plot without adding a chart runtime", () => {
    assert.match(histogram, /import Figure, \{ Plot \}/);
    assert.match(histogram, /<Plot height=/);
    assert.doesNotMatch(histogram, /recharts|chart\.js|highcharts/i);
  });

  it("lays the pair side by side only when it fits and bounds both children", () => {
    assert.match(css, /\.mc-histogram__scale\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    assert.match(css, /\.mc-histogram__scale\s*\{[^}]*border:\s*1px solid var\(--grid\)/);
    assert.match(css, /\.mc-histogram__scale > div:nth-child\(2\)\s*\{[^}]*text-align:\s*center/);
    assert.match(
      css,
      /#risk-subpanel-montecarlo \.mc-distribution-figures \+ \.stability-tiles\s*\{[^}]*margin-block-start:\s*var\(--space-3\)/s,
      "the outcome tiles touch the distribution figure borders again",
    );
  });

  it("does not move simulation ownership into either figure", () => {
    assert.doesNotMatch(histogram, /Worker|useMcDistribution|useEffect|postMessage/);
    assert.equal((distribution.match(/useMcDistribution\(/g) ?? []).length, 1);
  });
});
