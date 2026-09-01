import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { histogramIndexAt } from "@/components/execution/LatencyHistogram";
import { sparklineIndexAt } from "@/components/overview/Sparkline";
import { nextSupplyDepthIndex } from "@/components/data/SupplyDepthBars";
import { nextCiCountIndex } from "@/components/developer/CiCountBars";
import { latencyTrendIndexAt, nextLatencyTrendIndex } from "@/components/systems/LatencyTrend";
import { buildProtectedBaseline } from "../scripts/frontend-content-baseline";
import { globalsCss } from "./globals-css";

const fixture = JSON.parse(readFileSync(
  fileURLToPath(new URL("./fixtures/frontend-content-baseline.json", import.meta.url)),
  "utf8",
));

const source = (relative: string) => readFileSync(
  fileURLToPath(new URL(`../${relative}`, import.meta.url)),
  "utf8",
);

describe("protected desk diagrams are keyboard and pointer instruments", () => {
  it("keeps the signed static-copy baseline byte-for-byte", () => {
    assert.deepEqual(buildProtectedBaseline().signatures, {
      ...fixture.protected,
      ...fixture.protectedNavigationFollowup20260829,
      ...fixture.protectedRequest20260830,
      ...fixture.protectedRuntimeIntegrity20260831,
      ...fixture.protectedFrontendSweep20260831,
      ...fixture.protectedRemediationTrend20260901,
      ...fixture.protectedGatewayReadiness20260901,
      ...fixture.protectedDeveloperContractReview20260901,
      ...fixture.protectedEquityQuoteHealth20260901,
      ...fixture.protectedDataTransportTruth20260901,
      ...fixture.protectedUiGatewaySweep20260902,
    });
  });

  it("maps pointer positions without leaving the measured domain", () => {
    for (const indexAt of [sparklineIndexAt, histogramIndexAt, latencyTrendIndexAt]) {
      assert.equal(indexAt(100, 100, 400, 5), 0);
      assert.equal(indexAt(300, 100, 400, 5), 2);
      assert.equal(indexAt(500, 100, 400, 5), 4);
      assert.equal(indexAt(600, 100, 400, 5), 4);
      assert.equal(indexAt(200, 100, 0, 5), null);
      assert.equal(indexAt(200, 100, 400, 0), null);
      assert.equal(indexAt(Number.NaN, 100, 400, 5), null);
    }
  });

  it("opts Overview into the sparkline cursor without changing Portfolio diagrams", () => {
    const shell = source("components/WorkspaceOverview.tsx");
    const deck = source("components/overview/KpiDeck.tsx");
    const portfolio = source("components/portfolio/OverviewBook.tsx");
    assert.match(shell, /<Sparkline\s+interactive/);
    assert.equal(deck.match(/<Sparkline\s+interactive/g)?.length, 2);
    assert.doesNotMatch(portfolio.match(/<Sparkline[\s\S]*?\/>/)?.[0] ?? "", /interactive/);
  });

  it("moves category focus by row and clamps at both ends", () => {
    for (const nextIndex of [nextSupplyDepthIndex, nextCiCountIndex]) {
      assert.equal(nextIndex(0, 40, 3), 1);
      assert.equal(nextIndex(2, 40, 3), 2);
      assert.equal(nextIndex(2, 38, 3), 1);
      assert.equal(nextIndex(1, 36, 3), 0);
      assert.equal(nextIndex(1, 35, 3), 2);
      assert.equal(nextIndex(1, 27, 3), null);
      assert.equal(nextIndex(99, 38, 3), 1);
      assert.equal(nextIndex(-99, 40, 3), 1);
    }
    assert.equal(nextCiCountIndex(null, 40, 3), 0);
    assert.equal(nextCiCountIndex(null, 38, 3), 2);
  });

  it("links Research and Developer exact-value rows to their figures", () => {
    const research = source("components/research/WalkForwardTimeline.tsx");
    const developer = source("components/developer/DeveloperPipelines.tsx");
    const developerBars = source("components/developer/CiCountBars.tsx");
    const interfaces = source("components/developer/DeveloperInterfaces.tsx");
    const custody = source("components/developer/NumericsCustodyChain.tsx");
    const digest = source("components/developer/NumericsCustodyDigest.tsx");
    const css = source("app/globals/14zze-protected-diagram-instruments.css");
    assert.match(research, /<HotSource>/);
    assert.match(research, /Math\.floor\(hot \/ 2\)/);
    assert.match(research, /data-linked=/);
    assert.match(developer, /from "@\/components\/developer\/CiCountBars"/);
    assert.match(developer, /<CiCountBars/);
    assert.match(developer, /const COUNTED_CI_JOBS = CI_JOBS\.filter\(\(job\) => job\.count !== null\)/);
    assert.match(developer, /COUNTED_CI_JOBS\.map/);
    assert.match(developer, /selectedLabel=\{selectedJob\}/);
    assert.doesNotMatch(developer, /previewJob|activeJob|onPreview=/,
      "transient hover state must not replace the pinned CI selection");
    assert.doesNotMatch(developer, /hotJob/, "selection is label-owned rather than coupled to filtered array indices");
    assert.match(developer, /data-linked=/);
    assert.match(developer, /data-selectable=\{job\.count !== null/);
    assert.match(developer, /className="developer-cp-jobs__select"[\s\S]*?aria-pressed=\{selectedJob === job\.name\}/);
    assert.match(developerBars, /<figcaption className="developer-ci-counts__caption">CI test counts<\/figcaption>/);
    assert.match(developerBars, /data-selected=\{selectedLabel === row\.label/);
    assert.doesNotMatch(developerBars, /onPointerEnter|onPointerLeave|onPreview/,
      "pointer crossings must not mount and unmount the CI reading");
    assert.match(developerBars, /className="developer-ci-counts__reading"/);
    assert.match(developerBars, /<button[\s\S]*?className="category-bars__row"[\s\S]*?aria-pressed=/);
    assert.match(interfaces, /<section className="card developer-cp-schema-card">[\s\S]*?<details className="developer-cp-disclosure disclosure">[\s\S]*?<div className="developer-cp-section-hero__actions">/);
    assert.match(custody, /<CustodyChainTrack chain=\{chain\} label="Numerics custody chain" \/>[\s\S]*?<div className="signal-workflow__detail"/);
    assert.match(digest, /<div style=\{CAPTION_STYLE\}>[\s\S]*?<code className="num" title=\{hex\} style=\{DIGEST_STYLE\}>[\s\S]*?<p className="signal-workflow__source"/);
    assert.match(css, /developer-cp-schema-card:has\(> \.developer-cp-section-hero__actions\)/);
    assert.match(css, /\.developer-cp-section-hero__actions \+ div > \.signal-workflow__detail:last-child \{/,
      "only the final digest detail may become the evidence grid; an opened node detail precedes it");
    assert.match(css, /\.developer-cp-section-hero__actions \+ div > \.signal-workflow__detail:last-child > div > div:first-child \{[\s\S]*?display: contents !important;/);
    assert.doesNotMatch(css, /\.developer-cp-section-hero__actions \+ div > \.signal-workflow__detail \{/,
      "the opened custody-node explanation must retain its normal detail layout");
    assert.match(css, /grid-template-columns: minmax\(0, 18fr\) minmax\(0, 30fr\) minmax\(0, 14fr\) minmax\(0, 38fr\)/);
  });

  it("adds a shared simulation-versus-analytic VaR cursor", () => {
    const risk = source("components/risk/OracleVarTrend.tsx");
    assert.match(risk, /sharedX=/);
    assert.match(risk, /count: shown\.length/);
    assert.match(risk, /o\.var99 === null/);
    assert.match(risk, /o\.clientVar === null/);
    assert.match(risk, /className="oracle-var-ribbon"/);
  });

  it("keeps useful analytical layers without the reviewed oval overlays", () => {
    const overview = source("components/overview/Sparkline.tsx");
    const research = source("components/research/WalkForwardTimeline.tsx");
    const execution = source("components/execution/LatencyHistogram.tsx");
    const portfolio = source("components/portfolio/RiskAdjustedTrend.tsx");
    const data = source("components/data/SupplyDepthBars.tsx");
    const reliability = source("components/systems/LatencyTrend.tsx");
    const developer = source("components/developer/CiCountBars.tsx");

    assert.match(overview, /className="protected-chart-range"/);
    assert.match(research, /className="walkforward-trajectory/);
    assert.match(execution, /className="latency-cdf"/);
    assert.match(portfolio, /export function trendIndexAt/);
    assert.match(portfolio, /className="protected-chart-reading"/);
    assert.doesNotMatch(data, /className="category-topology"/);
    assert.match(reliability, /className="latency-trend__band"/);
    assert.doesNotMatch(developer, /className="category-topology"/);
  });

  it("adds a one-stop keyboard and pointer cursor to Reliability", () => {
    const reliability = source("components/systems/LatencyTrend.tsx");
    assert.match(reliability, /onPointerMove=/);
    assert.match(reliability, /tabIndex=\{0\}/);
    assert.match(reliability, /onFocus=/);
    assert.match(reliability, /onKeyDown=/);
    assert.doesNotMatch(reliability, /onClick/);
    assert.equal(nextLatencyTrendIndex(2, 39, 5), 3);
    assert.equal(nextLatencyTrendIndex(2, 37, 5), 1);
    assert.equal(nextLatencyTrendIndex(2, 36, 5), 0);
    assert.equal(nextLatencyTrendIndex(2, 35, 5), 4);
    assert.equal(nextLatencyTrendIndex(2, 13, 5), null);
    assert.match(reliability, /latest: history\[history\.length - 1\]/);
  });

  it("keeps interaction perceivable without motion or colour alone", () => {
    const css = source("app/globals/14zze-protected-diagram-instruments.css");
    assert.match(css, /:focus-visible/);
    assert.match(css, /\[data-linked="true"\]/);
    assert.doesNotMatch(css, /prefers-reduced-motion: reduce|forced-colors: active/);
    assert.equal((globalsCss.match(/@media \(prefers-reduced-motion: reduce\)/g) ?? []).length, 1);
    assert.equal((globalsCss.match(/@media \(forced-colors: active\)/g) ?? []).length, 1);
    assert.match(globalsCss, /\.protected-chart-reading > circle/);
    assert.match(globalsCss, /\.developer-cp-jobs__row/);
    assert.match(globalsCss, /\.oracle-var-ribbon/);
    assert.match(globalsCss, /\.protected-category-instrument/);
    assert.match(globalsCss, /\.developer-ci-counts__reading\s*\{[^}]*min-height:/s);
    assert.doesNotMatch(globalsCss, /\.category-topology/);
  });
});
