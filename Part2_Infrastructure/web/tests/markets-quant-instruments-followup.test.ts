import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

const histogram = `${read("../components/coherence/PriceHistogram.tsx")}\n${read("../components/coherence/UniverseOutcomeDistribution.tsx")}`;
const pending = read("../components/coherence/PendingMinutes.tsx");
const distribution = read("../components/coherence/surface/DistributionView.tsx");
const stake = read("../components/coherence/surface/StakeView.tsx");
const stakeInstruments = `${stake}\n${read("../components/coherence/surface/StakeBars.tsx")}`;
const fees = `${read("../components/coherence/FeesPane.tsx")}\n${read("../components/coherence/FeeTotalsBar.tsx")}`;
const ablation = read("../components/coherence/AblationPane.tsx");
const shellMap = read("../components/coherence/ShellTree.tsx");
const shellRoute = read("../components/coherence/ShellRouteFlow.tsx");
const shell = `${shellMap}\n${shellRoute}`;
const shellReadings = read("../components/coherence/ShellReadings.tsx");
const shellReadingsCss = read("../components/coherence/ShellReadings.module.css");
const shellCss = read("../components/coherence/ShellTopology.module.css");
const shellRouteCss = read("../components/coherence/ShellRouteFlow.module.css");
const books = read("../components/coherence/BooksInstruments.tsx");
const settlement = read("../components/coherence/SettlementInstruments.tsx");
const universe = [
  read("../components/coherence/UniverseInstruments.tsx"),
  read("../components/coherence/UniverseLiquidityCabinet.tsx"),
  read("../components/coherence/UniverseOutcomeDistribution.tsx"),
].join("\n");
const universeSection = read("../components/coherence/UniverseSection.tsx");
const marketPicker = read("../components/coherence/MarketPicker.tsx");
const quotesCss = read("../app/globals/14t-quotes-layout.css");
const marketsWorkbenchCss = read("../app/globals/14zza-markets-quant-workbench.css");
const feeReplayCss = read("../components/coherence/FeeReplayInstrument.module.css");
const sectionFrame = read("../components/coherence/SectionFrame.tsx");
const latticeSurvival = read("../components/coherence/surface/LatticeSurvival.tsx");
const latticeCore = read("../components/coherence/surface/LatticeInstruments.tsx");
const lattice = `${latticeSurvival}\n${latticeCore}`;
const latticeCss = read("../components/coherence/surface/LatticeInstruments.module.css");
const latticeMass = latticeCore.slice(
  latticeCore.indexOf("export function LatticeMass"),
  latticeCore.indexOf("export function LatticeMoments"),
);
const latticeMoments = latticeCore.slice(
  latticeCore.indexOf("export function LatticeMoments"),
  latticeCore.indexOf("export function MassReservoir"),
);
const massReservoir = latticeCore.slice(latticeCore.indexOf("export function MassReservoir"));
const stableSelection = read("../components/coherence/use-stable-selection-key.ts");
const instrumentCss = [
  read("../components/coherence/MarketInstruments.module.css"),
  read("../components/coherence/MarketStructures.module.css"),
  read("../components/coherence/BooksInstruments.module.css"),
  read("../components/coherence/SettlementInstruments.module.css"),
  [
    "UniverseInstruments.module.css", "UniverseBasketLayout.module.css", "UniverseWatchlist.module.css",
    "UniverseLiquidity.module.css", "UniverseParity.module.css", "UniverseDistribution.module.css",
    "UniverseFamilyLayout.module.css",
  ].map((file) => read(`../components/coherence/${file}`)).join("\n"),
  latticeCss,
];

describe("targeted Markets views use exact interactive instruments instead of ordinary charts", () => {
  it("removes the three Fee replay guides without removing the explicit axis", () => {
    const graphRule = feeReplayCss.match(/\.replayGraph,\s*\.edgeGraph\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    assert.ok(graphRule, "Ablation and Replay no longer share a bounded graph background");
    assert.match(graphRule, /background:\s*var\(--surface-1\)/);
    assert.doesNotMatch(graphRule, /(?:repeating-)?linear-gradient|(?:25|50|75)%|background-size/,
      "the removed quarter guides returned to the Ablation or Replay background");
    assert.match(feeReplayCss, /\.edgeAxis\s*\{[^}]*border-bottom:\s*1px solid var\(--grid\);/s,
      "Replay lost its explicit scale axis while the background guides were removed");
    assert.match(ablation, /className=\{styles\.edgeAxis\} aria-hidden="true"><span>0<\/span><span>maximum absolute edge<\/span>/,
      "Replay no longer renders the endpoints named by its explicit scale axis");
  });

  it("routes the legacy entry points to the new instruments", () => {
    for (const [name, source, contract] of [
      ["family prices", histogram, /<OutcomePriceConstellation\b/],
      ["pending settlement", pending, /<PendingBoard\b/],
      ["lattice moments", distribution, /<MassReservoir\b/],
    ] as const) {
      assert.match(stripNonCode(source), contract, `${name} does not reach its replacement instrument`);
    }
    assert.match(stake, /className=\{styles\.coinField\}/);
    assert.match(fees, /className=\{styles\.receiptStack\}/);
  });

  it("makes every redesigned family keyboard-operable and gives selection an exact live readout", () => {
    for (const [name, source] of [
      ["fees", fees], ["fee ablation", ablation], ["shell", shell], ["books", books],
      ["settlement", settlement], ["universe", universe], ["lattice", lattice], ["stake", stakeInstruments],
    ] as const) {
      assert.match(source, /<button\b/, `${name} has no keyboard-operable control`);
      assert.match(source, /aria-(?:pressed|selected)=/, `${name} does not expose selected state`);
      assert.match(source, /<output\b[^>]*aria-live="polite"/, `${name} has no live exact-value inspector`);
      assert.doesNotMatch(source, /<output\b(?=[^>]*aria-live="polite")(?![^>]*aria-atomic="true")[^>]*>/,
        `${name} announces only a fragment of its changed exact-value inspector`);
    }
  });

  it("gives dense selection instruments one roving tab stop with spatial arrow navigation", () => {
    for (const [name, source] of [
      ["fee ablation", ablation], ["books", books], ["settlement", settlement],
      ["universe", universe], ["lattice", lattice], ["stake", stakeInstruments],
    ] as const) {
      assert.match(source, /useRovingListbox/, `${name} does not use the shared roving selection contract`);
      assert.match(source, /role="listbox"/, `${name} has no listbox owner for its options`);
    }

    assert.match(stableSelection, /tabIndex:\s*selected === key \? 0 : -1/);
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]) {
      assert.match(stableSelection, new RegExp(`key === "${key}"`), `${key} is missing from listbox navigation`);
    }
    assert.equal((books.match(/role="listbox"/g) ?? []).length, 1,
      "the two book rails must share one owner so global option indices stay correct");
    assert.match(stake, /className=\{styles\.coinField\} role="listbox"/,
      "the twenty bankroll tokens regressed to twenty independent tab stops");
  });

  it("keeps Shell exact-path selection and collateral routes semantically aligned", () => {
    assert.match(shellMap, /const browsePath = exactStage === "shard" \? `\/shards\/\$\{activeShard\}` : "\/shards"/);
    assert.match(shellMap, /onBrowse\(browsePath, "ls"\)/);
    assert.match(shellMap, /function StageArrow[\s\S]*?<svg[\s\S]*?<line[\s\S]*?<path/,
      "the staged namespace has no explicit pointer connector");
    assert.match(shellMap, /className=\{styles\.branchFork\}[\s\S]*?className=\{styles\.branchGrid\}/,
      "the event-to-native/computed fan-out is not one connected flow");
    assert.doesNotMatch(stripNonCode(shellMap), /topologyPath|<shard>|<series>|<event>|<market>/,
      "a placeholder address can still become a runnable Shell command");
    assert.match(shellCss, /@media \(max-width: 980px\)[\s\S]*?\.stageArrow svg\s*\{[^}]*transform:\s*rotate\(90deg\);/,
      "phone-width namespace stages lose their pointer connectors");
    assert.match(shellRoute, /const crossShard = route === "cross" && Boolean\(secondShard\)/);
    assert.match(shellRoute, /const sameActive = Boolean\(activeShard\) && !crossShard/,
      "the same-shard route cannot become active before a live shard exists");
    assert.match(shellRoute, /className=\{styles\.branchNode\}[^>]*data-outcome="connected"[^>]*data-active=\{sameActive \|\| undefined\}/,
      "the same-shard branch must remain visible and expose its active state");
    assert.match(shellRoute, /className=\{styles\.branchNode\}[^>]*data-outcome="split"[^>]*data-active=\{crossActive \|\| undefined\}/,
      "the cross-shard branch must remain visible and expose its active state");
    assert.match(shellRoute, /className=\{styles\.canvas\}[\s\S]*?role="img"[\s\S]*?tabIndex=\{0\}/);
    assert.match(shellRouteCss, /\.canvas\s*\{[^}]*overflow-x:\s*auto;[^}]*overscroll-behavior-inline:\s*contain;/s);
    assert.match(shellRouteCss, /\.canvas svg\s*\{[^}]*min-inline-size:\s*62rem;[^}]*block-size:\s*auto;/s);
    assert.match(shellRouteCss, /@media \(max-width: 720px\)[\s\S]*?\.canvas\s*\{\s*display:\s*none;\s*\}[\s\S]*?\.mobileFlow\s*\{[^}]*display:\s*grid;/,
      "the desktop route canvas has no compact phone-width activity flow");
    assert.match(shellRouteCss, /\.instrument\s*\{[^}]*border:\s*1px solid var\(--border\);/s);
  });

  it("scopes Shell announcements and keeps its reading matrix inside responsive cards", () => {
    assert.match(shell, /<div className=\{styles\.commandTrace\}>/,
      "the visible command trace should not duplicate the scoped selection announcement");
    assert.match(shell, /<div className=\{styles\.readout\}>/,
      "the visible topology detail should remain visible without becoming a second live region");
    assert.doesNotMatch(shell, /className=\{styles\.(?:commandTrace|readout)\}[^>]*aria-live/,
      "Shell path and file selection is announced by more than one visible surface");
    assert.match(shell, /<output className="sr-only" aria-live="polite" aria-atomic="true">[\s\S]*?\{command\}/,
      "Shell has no concise path/file selection announcement");
    assert.equal((shell.match(/aria-live="polite"/g) ?? []).length, 2,
      "Shell should expose one path/file status and one independently controlled route status");
    assert.match(shellReadings, /<div className=\{styles\.flow\} aria-label="How a derived file reaches a reading">/);
    assert.match(shellReadings, /<table className="coh-table">[\s\S]*?<th scope="col">Reading<\/th>[\s\S]*?<th scope="col">What it reads<\/th>/);
    assert.match(shellReadingsCss, /\.groups\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/s);
    assert.match(shellReadingsCss, /\.groups > \*\s*\{[^}]*min-inline-size:\s*0;/s);
    assert.match(shellReadingsCss, /\.tableWrap\s*\{[^}]*inline-size:\s*100%;[^}]*max-inline-size:\s*100%;[^}]*margin:\s*0;[^}]*overflow:\s*hidden;/s);
    assert.match(shellReadingsCss, /\.group \.tableWrap :is\(th, td\)\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;/s);
    assert.match(shellReadingsCss, /\.group \.tableWrap code\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);
    assert.match(shellReadingsCss, /@media \(max-width: 1100px\)[\s\S]*?\.groups\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/);
  });

  it("bounds Survival shocks to probabilities and keys local scenarios to the selected quote", () => {
    assert.match(latticeSurvival, /JSON\.stringify\(\[probe\.ticker, probe\.strike\]\)/);
    assert.match(latticeSurvival, /useState<\{ key: string \| null; pp: number \}>/);
    assert.match(latticeSurvival, /const chooseProbe = \(key: string\) => \{[\s\S]*?if \(key !== selectedKey\) setShockScenario\(\{ key, pp: 0 \}\);/,
      "a quote scenario must reset only when the effective quote selection changes");
    assert.match(latticeSurvival, /const shockMin = active\.survivalCc == null[\s\S]*?Math\.ceil\(-active\.survivalCc \/ 100\)/);
    assert.match(latticeSurvival, /const shockMax = active\.survivalCc == null[\s\S]*?DOLLAR_CC - active\.survivalCc/);
    assert.match(latticeSurvival, /min=\{shockMin\} max=\{shockMax\}/);
    assert.match(latticeSurvival, /key=\{probeKeys\[index\]\}/);
    assert.doesNotMatch(latticeSurvival, /key=\{`\$\{probe\.ticker\}-\$\{index\}`\}/);
  });

  it("gives Universe visible axes and draggable inspection controls", () => {
    for (const label of [
      "X axis: Whole-family price",
      "Y axis: Watched family",
      "X axis: YES ask price band",
      "Y axis: Open-interest share",
      "X axis: YES ask price",
      "Y axis: Outcomes",
    ]) {
      assert.ok(universe.includes(label), `${label} is not printed on its axis`);
    }
    assert.ok((universe.match(/type="range"/g) ?? []).length >= 3,
      "each Universe diagram must expose a draggable range inspector");
  });

  it("keeps the Position map ceiling clear of the caption border", () => {
    assert.match(
      instrumentCss[4],
      /\.bandChartShell\s*\{[^}]*padding-block-start:\s*var\(--space-2\);/s,
    );
  });

  it("links every watchlist row to its matching dollar test from the row that owns it", () => {
    assert.match(universe, /aria-controls=\{`dollar-test-row-\$\{event\.event_ticker\}`\}/);
    assert.match(universe, /id=\{`dollar-test-row-\$\{row\.ticker\}`\}/);
    assert.match(universe, /Linked to the matching Dollar Test row/);
    assert.match(universe, /className=\{styles\.rowConnector\} aria-hidden="true"/);
    assert.match(instrumentCss[4], /\.rowConnector\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset-block-start:\s*50%;/);
    assert.match(instrumentCss[4], /@container \(max-width:\s*80rem\)[\s\S]*?\.rowConnector\s*\{\s*display:\s*none;/,
      "row arrows must disappear before independent panel wrapping can misalign them");
    assert.match(instrumentCss[4], /@media \(max-width:\s*1100px\)[\s\S]*?\.rowConnector\s*\{\s*display:\s*none;/,
      "desktop row arrows must disappear when the two panels stack");
  });

  it("makes the basket comparison one framed matrix instead of nested rounded row cards", () => {
    const css = instrumentCss[4];
    assert.match(css, /\.basketWorkbench\s*\{[\s\S]*?overflow:\s*clip;[\s\S]*?border:\s*1px solid[\s\S]*?border-radius:\s*var\(--radius-card\);/,
      "the watchlist and dollar test no longer share one clipped outer frame");
    for (const panel of ["watchlistPanel", "parityPanel"]) {
      assert.match(css, new RegExp(`\\.${panel}\\s*\\{[\\s\\S]*?border:\\s*0;[\\s\\S]*?border-radius:\\s*0;`),
        `${panel} brought an independent nested card border back`);
    }
    for (const row of ["familyRow", "parityRow"]) {
      assert.match(css, new RegExp(`\\.${row}\\s*\\{[\\s\\S]*?border-radius:\\s*0;`),
        `${row} is rounded like a standalone card instead of reading as a matrix row`);
    }
    assert.match(css, /\.priceTrack em\s*\{[\s\S]*?background:\s*var\(--parity-row-fill\);/,
      "the missing-data explanation can be struck through by its own guide");
  });

  it("keeps Universe navigation concise, fills its canvas, and keeps sliders visually continuous", () => {
    for (const label of ["Basket pricing", "Positions", "Families"]) {
      assert.ok(universeSection.includes(label), `${label} is missing from the view navigation`);
    }
    assert.doesNotMatch(universeSection, /VIEW_DESCRIPTIONS|viewDescriptions=/,
      "Universe navigation regressed to a second line of descriptive copy");
    assert.match(sectionFrame, /optionDescription=\{\(value\) => viewDescriptions\?\.\[value\]\}/);
    assert.match(instrumentCss[4], /quant-view-switcher\[data-option-count="3"\][\s\S]*?flex:\s*1 1 100%/,
      "the three Universe tabs no longer fill their control row");
    assert.match(instrumentCss[4], /@media \(min-width:\s*1101px\)[\s\S]*?:has\(\.coh-section__subject\)[\s\S]*?flex-basis:\s*auto;[\s\S]*?width:\s*auto;/,
      "the wide Universe picker still forces the three-tab switcher onto a separate row");
    assert.match(instrumentCss[4], /\.universeScope :global\(\.coh-section__controls\)\s*\{[\s\S]*?grid-template-columns:\s*minmax\(18rem, 1fr\) auto;/,
      "the wide Universe controls no longer reserve one aligned subject column");
    assert.match(instrumentCss[4], /@media \(max-width:\s*1100px\)[\s\S]*?\.coh-section__controls\)[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/,
      "Universe controls do not intentionally stack before they collide");
    assert.match(instrumentCss[4], /@media \(max-width:\s*620px\)[\s\S]*?\.coh-family__control\)[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;/,
      "the Universe family picker is not full-width on a phone");
    assert.doesNotMatch(instrumentCss[4], /quant-view-switcher__description/,
      "Universe-only styling still reserves space for a second navigation line");
    assert.doesNotMatch(instrumentCss[4], /max-width:\s*92rem/,
      "a Universe view regressed to centred side gutters instead of using the canvas");
    assert.match(instrumentCss[4], /\.positionWorkbench\s*\{[\s\S]*?max-width:\s*none;[\s\S]*?margin-inline:\s*0;/,
      "Positions does not explicitly release its centred desktop width cap");
    assert.match(instrumentCss[4], /\.familyCard\s*\{[\s\S]*?max-width:\s*none;[\s\S]*?margin-inline:\s*0;/,
      "Families does not explicitly release its centred desktop width cap");
    for (const panel of ["liquidityPanel", "distributionPanel"]) {
      assert.match(instrumentCss[4], new RegExp(`\\.${panel}\\s*\\{[\\s\\S]*?inline-size:\\s*100%;[\\s\\S]*?max-inline-size:\\s*none;`),
        `${panel} no longer fills its view wrapper`);
    }
    assert.doesNotMatch(universe, /Lowest ask|Highest ask/, "the compact watchlist repeats redundant extrema");
    assert.match(instrumentCss[4], /input\[type="range"\]::-(?:webkit-slider-runnable-track|moz-range-track)/);
    assert.match(instrumentCss[4], /--slider-fill/);
  });

  it("keeps the other purpose-built instruments off generic chart primitives", () => {
    for (const [name, source] of [
      ["books", books], ["settlement", settlement], ["universe", universe],
    ] as const) {
      assert.doesNotMatch(stripNonCode(source), /<Plot\b|<svg\b|BarChart|LineChart/, `${name} fell back to a standard chart primitive`);
    }
    for (const phrase of ["Counterfactual switchboard", "Filesystem lens", "Bankroll vault", "Decision chamber"]) {
      assert.ok([fees, ablation, shell, stakeInstruments].some((source) => source.includes(phrase)), `${phrase} is missing`);
    }
  });

  it("keeps the Books market picker aligned, viewport-bounded, and exposed as one listbox", () => {
    assert.match(marketPicker, /aria-haspopup="listbox"/);
    assert.match(marketPicker, /aria-expanded=\{open\}/);
    assert.match(marketPicker, /aria-controls=\{open \? listId : undefined\}/);
    assert.match(marketPicker, /role="combobox"[\s\S]*?aria-autocomplete="list"[\s\S]*?aria-expanded="true"/);
    assert.match(marketPicker, /<ul id=\{listId\}[\s\S]*?role="listbox"/);
    assert.match(marketPicker, /role="option"[\s\S]*?aria-selected=/);
    assert.match(marketPicker, /<\/ul>\s*\{!shown\.length \? \(/,
      "zero filter matches remove the owned listbox instead of leaving an empty list and explanation");

    assert.match(quotesCss, /\.coh-market__control\s*\{[^}]*flex:\s*1 1 18rem;[^}]*width:\s*clamp\(18rem, 24vw, 28rem\);[^}]*max-width:\s*100%;/s);
    assert.match(quotesCss, /\.coh-market__button\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-height:\s*var\(--control-h\);/s);
    assert.match(quotesCss, /\.coh-market__panel\s*\{[^}]*right:\s*0;[^}]*width:\s*min\(28\.75rem, calc\(100vw[^}]*max-height:\s*calc\(100dvh/s);
    assert.match(quotesCss, /@media \(max-width:\s*900px\)[\s\S]*?\.coh-books \.coh-section__controls[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/);
    assert.match(quotesCss, /@media \(max-width:\s*620px\)[\s\S]*?\.coh-market__panel[\s\S]*?right:\s*auto;[\s\S]*?left:\s*0;/);
    assert.match(marketsWorkbenchCss, /\[data-market-section\]:has\(:is\([\s\S]*?aria-expanded="true"\]\)[\s\S]*?overflow:\s*visible;/,
      "an expanded family or market panel is still clipped by its section card");
  });

  it("turns Lattice Mass into an inspectable histogram, cumulative line, and local transfer simulation", () => {
    assert.match(stripNonCode(latticeMass), /<svg\b[\s\S]*?<rect\b[\s\S]*?<polyline\b/,
      "Mass does not draw interval bars and a cumulative line");
    assert.match(latticeMass, /className=\{styles\.massPlot\} role="img" tabIndex=\{0\} aria-label=\{`Histogram of/);
    assert.match(latticeMass, /className=\{styles\.massScrubber\} role="listbox"/);
    assert.match(latticeMass, /role="option" aria-selected=/);
    assert.match(latticeMass, /useRovingListbox\(binKeys\)/);
    assert.match(latticeMass, /aria-label="Local adjacent-mass transfer simulator"/);
    assert.match(latticeMass, /<input type="range" min=\{0\} max=\{maxShiftCc\} step=\{1\}/);
    assert.match(latticeMass, /<button type="button" onClick=\{\(\) => setShiftCc\(0\)\} disabled=\{!movedCc\}>Reset<\/button>/);
    assert.match(latticeMass, /<div className=\{styles\.readout\}>/);
    assert.doesNotMatch(latticeMass, /<output className=\{styles\.readout\}/,
      "each mass-slider step should not reannounce the complete visible inspector");
    assert.match(latticeMass, /<output className="sr-only" aria-live="polite" aria-atomic="true">[\s\S]*?Local what-if for \{active\.label\}:[\s\S]*?No mass moved\./,
      "the mass simulator has no concise changed-value announcement");
    assert.match(latticeMass, /Preserves total mass and never changes the recorded book\./);
    assert.match(latticeMass, /const cumulativeTotal = totalCc != null && totalCc > 0 \? totalCc : null/,
      "a cumulative share must only be drawn against a positive readable total");
    assert.match(latticeMass, /const visibleShare = Math\.max\(0, Math\.min\(1, share\)\)/,
      "an inconsistent cumulative share must be safely contained on its zero-to-one axis");
    assert.match(latticeMass, /JSON\.stringify\(\[bin\.label, bin\.low, bin\.high\]\)/,
      "mass scenarios must follow interval identity rather than a polling order index");
    assert.match(latticeMass, /const chooseBin = \(key: string\) => \{[\s\S]*?if \(key !== selectedKey\) setShiftScenario\(\{ key, cc: 0 \}\);/,
      "a mass scenario must reset only when the effective interval selection changes");
    assert.match(latticeMass, /const status = surface\.negative_bins\.length[\s\S]*?: isLadder \? "monotone" : "non-negative"/,
      "named and bucket families must not be labelled monotone without a threshold ladder");
    assert.match(latticeMass, /\{cumulativePoints \? <>[\s\S]*?<polyline[\s\S]*?: <text[\s\S]*?>cumulative unavailable/);
    for (const phrase of ["Negative bars extend below zero", "measured zero", "unreadable"]) {
      assert.ok(latticeMass.includes(phrase), `Mass no longer distinguishes ${phrase.toLowerCase()}`);
    }
  });

  it("turns Lattice Moments into a responsive profile with mean, sigma, and a deterministic tail simulation", () => {
    const drawing = stripNonCode(latticeMoments);
    assert.match(drawing, /<svg\b[\s\S]*?<rect\b[\s\S]*?<polygon\b[\s\S]*?<polyline\b[\s\S]*?<line\b/,
      "Moments lost its profile, area, sigma band, or mean line");
    assert.match(latticeMoments, /className=\{styles\.liveProfile\}/);
    assert.match(latticeMoments, /className=\{styles\.scenarioProfile\}/);
    assert.match(latticeMoments, /className=\{styles\.meanLine\}/);
    assert.match(latticeMoments, /className=\{styles\.sigmaBand\}/);
    assert.match(latticeMoments, /className=\{styles\.momentPlot\} role="img" tabIndex=\{0\}/);
    assert.match(latticeMoments, /className=\{styles\.momentTabs\} role="listbox"/);
    assert.match(latticeMoments, /useRovingListbox\(keys\)/);
    assert.match(latticeMoments, /aria-label="Local tail-transfer simulator"/);
    assert.match(latticeMoments, /<input type="range" min=\{-25\} max=\{25\} step=\{1\}/);
    assert.match(latticeMoments, /<button type="button" onClick=\{\(\) => setTilt\(0\)\} disabled=\{!tilt\}>Reset<\/button>/);
    assert.match(latticeMoments, /const scenarioValues = \[mean, sd, skew, kurt\]/);
    assert.match(latticeMoments, /JSON\.stringify\(\[bin\.label, bin\.representative\]\)/);
    assert.match(latticeMoments, /const transferReading = tilt === 0[\s\S]*?moved === 0[\s\S]*?less than one centicent/);
    assert.match(latticeMoments, /named \? "Named outcomes do not define a numeric profile"/);
    assert.match(latticeMoments, /<div className=\{styles\.momentReadout\}>/);
    assert.doesNotMatch(latticeMoments, /<output className=\{styles\.momentReadout\}/,
      "each moment-slider step should not reannounce formulas and recorded context");
    assert.match(latticeMoments, /<output className="sr-only" aria-live="polite" aria-atomic="true">[\s\S]*?\{active\.term\} local what-if:[\s\S]*?\{transferReading\}/,
      "the moments simulator has no concise changed-value announcement");
    assert.match(latticeMoments, /Recorded exact/);
    assert.match(latticeMoments, /Unbounded tails have no midpoint and receive no invented width/);
    assert.match(distribution, /<PmfChart key=\{surface\.event_ticker\}/,
      "a local mass transfer leaks into the next selected family");
    assert.match(distribution, /key=\{`shape:\$\{surface\.event_ticker\}`\}/,
      "a local moment scenario leaks into the next selected family");
  });

  it("keeps missing tail readings out of the bounded-interior moment support", () => {
    assert.match(massReservoir, /if \(surface\.engine === "named"\)[\s\S]*?Named outcomes have no ordered numeric axis[\s\S]*?No support interval is invented/,
      "the named-outcome view must explain why numeric moment support is not applicable");
    assert.match(massReservoir, /const hasLowTail = surface\.bins\.some\(\(bin\) => bin\.low == null && bin\.high != null\)/);
    assert.match(massReservoir, /const lowCc = hasLowTail \? toCenticents\(surface\.tail_mass_low\) : 0/);
    assert.match(massReservoir, /const boundedBins = surface\.bins\.filter\(\(bin\) => bin\.representative != null\)/);
    assert.match(massReservoir, /const interiorCc = sumPrices\(boundedBins\.map\(\(bin\) => bin\.mass\)\)/);
    assert.match(massReservoir, /"No open tails; quoted mass lives on bounded support"/);
    assert.match(massReservoir, /role="listbox" aria-label="Inspect a mass chamber"/);
    assert.match(massReservoir, /useRovingListbox\(chamberKeys, "interior"\)/);
    assert.match(massReservoir, /structurally zero/);
    assert.match(massReservoir, /unavailable, not zero/);
    assert.match(latticeCss, /\.reservoirReadout\s*\{[^}]*grid-template-columns:\s*minmax\(10rem, \.8fr\) minmax\(0, 2\.2fr\);/s);
  });

  it("does not invent transport or market values in the browser", () => {
    for (const source of [histogram, pending, distribution, stake, fees, ablation, shell, books, settlement, universe, lattice]) {
      assert.doesNotMatch(source, /Math\.random|Date\.now|setInterval|fetch\(/);
    }
    assert.match(histogram, /unquoted_reason/);
    assert.match(`${pending}\n${settlement}`, /spread == null/);
    assert.match(lattice, /value == null/);
    assert.match(stake, /worst_case_wealth/);
    assert.match(fees, /total\?\.notional/);
  });

  it("keeps the instrument shells responsive and palette-token driven", () => {
    for (const css of instrumentCss) {
      assert.match(css, /var\(--(?:series|surface|border|text|grid)/);
      assert.match(css, /@media \(max-width:/);
      assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\brgba?\s*\(/i);
      assert.doesNotMatch(css, /border-radius:\s*999px/);
      assert.match(css, /:focus-visible/, "an interactive Markets instrument has no visible keyboard focus");
      assert.match(css, /overflow-wrap:\s*anywhere/,
        "an instrument header cannot wrap an exact long label inside its bounded shell");
      assert.doesNotMatch(css, /text-overflow:\s*ellipsis/,
        "an exact Markets label is silently shortened instead of wrapping");
    }
    assert.match(instrumentCss[4], /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/,
      "the four universe basket facts no longer align to equal columns");
    assert.match(instrumentCss[1], /\.outcomeToken span\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*normal/s);
    assert.match(instrumentCss[5], /\.massTile small\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*normal/s);
    assert.match(latticeCss, /\.massPlot, \.momentPlot\s*\{[^}]*overflow-x:\s*auto/s);
    assert.match(latticeCss, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(latticeCss, /@media \(forced-colors: active\)/);
  });
});
