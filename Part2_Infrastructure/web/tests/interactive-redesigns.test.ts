import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DOLLAR_CC, sumPrices } from "../lib/coherence/fixed-point";
import { read, stripNonCode } from "./helpers/workspace-sources";

const basketCover = read("../components/coherence/BasketWhatIf.tsx");
const basketTerminal = read("../components/coherence/BasketScenarioTerminal.tsx");
const basketStore = read("../components/coherence/use-basket-scenario.ts");
const portfolio = read("../components/coherence/PortfolioPane.tsx");
const basketNull = read("../components/coherence/BasketNullInstrument.tsx");
const fees = `${read("../components/coherence/FeesPane.tsx")}\n${read("../components/coherence/FeeTotalsBar.tsx")}`;
const feesSection = read("../components/coherence/FeesSection.tsx");
const surfacePane = read("../components/coherence/SurfacePane.tsx");
const distribution = read("../components/coherence/surface/DistributionView.tsx");
const survival = read("../components/coherence/surface/LatticeSurvival.tsx");
const latticeCss = read("../components/coherence/surface/LatticeInstruments.module.css");
const shellPane = read("../components/coherence/ShellPane.tsx");
const shellMap = read("../components/coherence/ShellTree.tsx");
const shellBrowser = read("../components/coherence/ShellBrowser.tsx");
const shellBrowserCss = read("../components/coherence/ShellBrowser.module.css");
const shellRoute = read("../components/coherence/ShellRouteFlow.tsx");
const readings = read("../components/coherence/ShellReadings.tsx");

describe("Basket views share one truthful paper scenario", () => {
  it("persists scenario quotes by family and honours each market grid", () => {
    assert.match(basketStore, /const scenarios = new Map<string, StoredScenario>\(\)/);
    assert.match(basketStore, /event\.event_ticker/);
    assert.match(basketStore, /remembered\.tickers\.every/);
    assert.match(basketStore, /toCenticents\(market\.yes_ask\)/);
    assert.match(basketCover, /useBasketScenario\(event\)/);
    assert.match(basketCover, /toCenticents\(event\.markets\[index\]\.price_grid\)/);
    assert.match(basketCover, /sumPrices\(live\.map\(String\)\)/);
    assert.match(basketCover, /totalCc < DOLLAR_CC/);
    assert.doesNotMatch(stripNonCode(basketCover), /Math\.round\(value \* 100\)|min=\{1\} max=\{99\}/);
    assert.equal(sumPrices(["0.0001", "0.9007", "0.0992"]), DOLLAR_CC,
      "a binary-float boundary must remain exactly one dollar");
  });

  it("replaces the zero-leg Basket and Size posters with live instruments", () => {
    assert.match(portfolio, /<BasketScenarioTerminal\b/);
    assert.match(portfolio, /return <BasketNullInstrument variant="size" certificate=\{certificate\} event=\{chosen\} \/>/);
    assert.doesNotMatch(portfolio, /<LegSizes\b/,
      "Basket Size reuses the Coherence Test size curve instead of owning a distinct instrument");
    assert.match(basketNull, /Family activity[\s\S]*Certificate legs[\s\S]*Comparable legs[\s\S]*Capacity context/);
    assert.match(basketNull, /const markets = event\?\.markets/,
      "the capacity gate is not derived from the selected family's activity payload");
    assert.match(basketNull, /open_interest[\s\S]*volume[\s\S]*liquidity/,
      "the capacity gate omits one of the live activity fields");
    assert.match(basketTerminal, /cumulative cost by outcome/);
    assert.match(basketTerminal, /Paper prices persist across Cover, Basket, and Size/);
    assert.match(basketTerminal, /Fees and executable depth are excluded/);
    assert.match(basketTerminal, /No missing quote is coerced to a zero-dollar leg/);
    assert.doesNotMatch(stripNonCode(basketTerminal), /if \(!event\.mutually_exclusive \|\| !count\) return null/);
    assert.match(basketTerminal, /Scenario withheld/);
    assert.match(portfolio, /<details[\s\S]*<BasketNullInstrument variant="basket"/);
  });
});

describe("Markets worked examples are operated, not decorative", () => {
  it("prices editable fee inputs and replays cumulative fill components", () => {
    assert.match(fees, /<form className=\{styles\.feeScenario\}/);
    for (const label of ["Price", "Contracts", "Fills", "Run scenario"]) assert.ok(fees.includes(label));
    assert.equal((fees.match(/<input required type="number"/g) ?? []).length, 3);
    assert.match(fees, /function cumulativeFills/);
    assert.match(fees, /seriesPath\(points, selected, peak\)/);
    assert.match(fees, /className=\{styles\.feeSelectedPoint\}/);
    assert.match(fees, /const activeFillValue = activeFill/);
    assert.match(fees, /current == null \|\| amount == null \? null : current \+ amount/);
    assert.doesNotMatch(fees, /toAmount\(fill\.[^)]+\) \?\? 0/);
    assert.match(fees, /Next replay step/);
    assert.doesNotMatch(fees, /className=\{styles\.replayButton\}[\s\S]{0,120}aria-pressed/);
    assert.doesNotMatch(stripNonCode(fees), /setInterval|Math\.random|Date\.now/);
  });

  it("backs Shell Namespace and Routing with one live root read and explicit empty semantics", () => {
    assert.match(shellPane, /shellRoute\("\/", "ls"\)[\s\S]*active && \(view === "layout" \|\| view === "route"\)/);
    assert.match(shellPane, /topologyTape/);
    assert.match(shellPane, /topology\.data\?\.state === "available" \? topology\.data\.entries\.length : null/);
    assert.match(shellMap, /root\?\.entries/);
    assert.match(shellMap, /rootUnavailable \? "unavailable" : rootAvailable \? "live"/);
    assert.match(shellMap, /if \(mark == null\) \{[\s\S]*?connected = false/);
    assert.match(shellMap, /<circle key=\{mark\.index\}/);
    assert.match(shellMap, /Browser-observed feed/);
    assert.match(shellMap, /onBrowse\(activeShard \? `\/shards\/\$\{activeShard\}` : "\/"\)/);
    assert.match(shellMap, /emptyKind: "always"[\s\S]*emptyKind: "family"|emptyKind: "family"[\s\S]*emptyKind: "always"/);
    assert.match(readings, /return file\.emptyKind/);
    assert.doesNotMatch(stripNonCode(readings), /in this read\)\) return|silent\.trim/);
  });
});

describe("the requested Markets layouts stay separated and bounded", () => {
  it("keeps the Survival caveat inset and splits shape from moment support", () => {
    assert.match(surfacePane, /\["moments", "Moment shape"\][\s\S]*\["support", "Moment support"\]/);
    assert.match(distribution, /if \(view === "moments"\)[\s\S]*?<MomentsShape[\s\S]*?if \(view === "support"\)[\s\S]*?<MassReservoir/);
    assert.match(survival, /className=\{`\$\{styles\.samplingNote\} coh-figure__missing`\}/);
    assert.match(latticeCss, /\.samplingNote\s*\{[^}]*margin:\s*var\(--space-3\);[^}]*padding:\s*var\(--space-3\);[^}]*border:\s*1px solid/s);
  });

  it("removes the standalone fee KPI and gives Shell three distinct tools", () => {
    assert.doesNotMatch(stripNonCode(feesSection), /Fee as a share of notional|kpis=|kpiSource=/);
    assert.match(shellPane, /\["layout", "Namespace"\][\s\S]*\["route", "Routing"\][\s\S]*\["tree", "Browse"\]/);
    assert.match(shellPane, /<ShellTree[\s\S]*?<ShellRouteFlow[\s\S]*?<ShellBrowser/);
    assert.match(shellRoute, /Same[\s\S]*shard\?[\s\S]*CONNECTED[\s\S]*ISOLATED/);
    assert.match(shellBrowser, /<nav aria-label="Path hierarchy">[\s\S]*?<ul>[\s\S]*?<li>/);
    assert.match(shellBrowser, /FileText[\s\S]*FolderOpen/);
    assert.doesNotMatch(shellBrowser, /<main\b/);
    assert.match(shellBrowserCss, /\.fileTable\s*\{[^}]*max-height:\s*34rem;[^}]*overflow:\s*auto;/s);
  });

  it("turns an unavailable Shell listing into one retryable state instead of an empty directory and chart", () => {
    assert.match(shellPane, /onRetry=\{browserRead\.refresh\}/);
    assert.match(shellBrowser, /const directoryUnavailable = data\?\.state === "unavailable"[\s\S]*?data\.command === "ls"[\s\S]*?mode === "ls"/);
    assert.match(shellBrowser, /directoryUnavailable \? \([\s\S]*?role="status"[\s\S]*?Retry directory/);
    assert.match(shellBrowser, /directoryUnavailable \? \([\s\S]*?\) : mode === "cat" \? \([\s\S]*?<FileReading/,
      "unavailable file reads must retain their file-specific preview instead of becoming directory outages");
    assert.match(shellBrowser, /READ_OK\.has\(data\.state\) && measuredPolls >= 2 \? \([\s\S]*?<LiveTape/);
    assert.match(shellBrowserCss, /\.recovery\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto;[^}]*border:/s);
    assert.match(shellBrowserCss, /@media \(max-width: 620px\)[\s\S]*?\.recovery\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\);/);
  });
});
