import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("Markets and Proofs share one exact-value inspection contract", () => {
  const pair = read("components/coherence/QuantInspectionPair.tsx");

  it("coordinates plot marks and semantic rows without multiplying plot tab stops", () => {
    assert.match(pair, /<HotSource>/);
    assert.match(pair, /useHot\(\)/);
    assert.match(pair, /data-quant-row/);
    assert.match(pair, /ArrowDown/);
    assert.match(pair, /ArrowUp/);
    assert.match(pair, /Home/);
    assert.match(pair, /End/);
    assert.match(pair, /aria-live="polite"/);
    assert.match(pair, /TableRow/);
    assert.match(pair, /tabIndex=\{hot === null \? \(index === 0 \? 0 : -1\) : hot === index \? 0 : -1\}/);
    assert.doesNotMatch(pair, /tabIndex=\{0\}/);
  });

  it("keeps exact basket and certificate values reachable beside their figures", () => {
    const basket = read("components/coherence/BasketOverview.tsx");
    const prices = read("components/coherence/LadderPrices.tsx");
    assert.match(basket, /QuantInspectionPair/);
    assert.match(basket, /QuantInspectionReadout/);
    assert.match(basket, /QuantInspectionRow/);
    assert.match(basket, /<Table\b/);
    assert.match(basket, /not mutually exclusive/);
    assert.match(basket, /not priced/);
    assert.match(basket, /scrollLabel=\{exactBasketLabel\}/);

    // Certificate prices use one compact bid/ask curve with the shared
    // keyboard/pointer inspector, while the exact ledger remains permanently
    // reachable behind a labelled disclosure.
    assert.match(prices, /<Plot\b/);
    assert.match(prices, /sharedX=\{\(width\) => \(\{/);
    assert.match(prices, /pin: true/);
    assert.match(prices, /const bidPath = linePath/);
    assert.match(prices, /const askPath = linePath/);
    assert.match(prices, /<details className=\{`quant-inspection__table/);
    assert.match(prices, /<summary>\{`Exact quote ledger, \$\{rows\.length\} rows`\}<\/summary>/);
    assert.match(prices, /<Table\b/);
    assert.match(prices, /row\.market\.yes_bid \?\? "Unquoted"/);
    assert.match(prices, /row\.market\.yes_ask \?\? "Unquoted"/);
    assert.match(prices, /row\.market\.open_interest \?\? "Not reported"/);
    assert.match(prices, /row\.market\.spread \?\? "Not measurable"/);
    assert.match(prices, /scrollLabel=\{exactLegLabel\}/);
    assert.doesNotMatch(prices, /row\.market\.(?:yes_bid|yes_ask|open_interest|spread) \?\? 0\b/,
      "an absent quote or size is coerced to zero");
  });

  it("keeps exact ladder depth reachable behind a collapsed ledger", () => {
    const books = read("components/coherence/BooksInstruments.tsx");
    assert.match(books, /<details className=\{styles\.ledger\}>/);
    assert.match(books, /Exact working ledger — \{ordered\.length\} levels/);
    assert.match(books, /role="region" tabIndex=\{0\}/);
    assert.match(books, /<tbody>\{ordered\.map\(\(row\) =>/);
    assert.match(books, /fromCenticents\(row\.nativePrice\)/);
    assert.match(books, /fromCenticents\(row\.yesPrice\)/);
    assert.match(books, /contractsLabel\(row\.size\)/);
    assert.match(books, /contractsLabel\(row\.depth\)/);
    assert.match(books, /At level/);
    assert.match(books, /At or better/);
  });

  it("draws parity as exact route rails, a local simulator, and live depth histogram", () => {
    const identity = read("components/coherence/BookIdentityLab.tsx");
    const model = read("lib/coherence/book-instrument-model.ts");
    const css = read("components/coherence/BookIdentityLab.module.css");
    assert.match(identity, /bookIdentityScenario\(yesAsk, noAsk, identityOnePlusSpread, shockSide, shockPp \* 100\)/);
    assert.match(model, /const quoteTotal = yesAsk == null \|\| noAsk == null \? null : yesAsk \+ noAsk/);
    assert.match(model, /const difference = quoteTotal == null \|\| referenceTotal == null \? null : quoteTotal - referenceTotal/);
    assert.match(model, /const state: IdentityScenarioState = difference == null/);
    for (const label of ["Identity matched", "Above reference", "Below reference", "Needs both sides"]) {
      assert.match(identity, new RegExp(label));
    }
    assert.match(identity, /<RouteLane label="Ask pair"/);
    assert.match(identity, /<RouteLane label="Payout \+ spread"/);
    assert.match(identity, /<input type="range" min=\{minShockPp\} max=\{maxShockPp\}/);
    assert.match(identity, /const depth = useMemo\(\(\) => mirrorBookLevels\(yesBids, noBids\)\.ordered, \[yesBids, noBids\]\)/);
    assert.match(identity, /className=\{styles\.depthPlot\} role="listbox"/);
    assert.match(identity, /role="option" aria-selected=\{selectedLevel === level\.key\}/);
    assert.match(identity, /<output className=\{styles\.inspector\} aria-live="polite" aria-atomic="true">/);
    assert.match(css, /\.routeTrack > i\s*\{[^}]*flex:\s*0 0 var\(--term-width\)/s);
    assert.match(css, /\.depthPlot > button\s*\{[^}]*height:\s*max\(/s);
    assert.match(css, /\.routeMap\s*\{[\s\S]*?var\(--surface-1\);\s*\}/);
    assert.match(css, /\.simulator\s*\{[^}]*background:\s*var\(--surface-2\);/s);
    assert.match(css, /\.depthPanel\s*\{[^}]*background:\s*var\(--surface-1\);/s);
    assert.match(css, /\.routeTerms button\s*\{[^}]*background:\s*var\(--surface-1\);/s);
    assert.doesNotMatch(identity, /wheel|orbit/i);
    assert.doesNotMatch(css, /conic-gradient|border-radius:\s*50%/);
  });

  it("makes only opted-in wide table scrollports keyboard reachable", () => {
    const table = read("components/ui/table.tsx");
    assert.match(table, /scrollLabel\?: string/);
    assert.match(table, /role=\{scrollLabel \? "region" : undefined\}/);
    assert.match(table, /tabIndex=\{scrollLabel \? 0 : undefined\}/);
    assert.match(table, /aria-label=\{scrollLabel\}/);
  });
});

describe("second-generation workbench styling preserves non-colour state", () => {
  const inspection = read("app/globals/14zzc-quant-inspection.css");
  const lessons = read("app/globals/14zzba-proofs-lessons.css");
  const evidence = read("app/globals/14z-engine-evidence.css");

  it("uses shape, weight, and focus in both desks", () => {
    assert.match(inspection, /\.markets-plane/);
    assert.match(inspection, /\.proofs-plane/);
    assert.match(inspection, /\.quant-inspection/);
    assert.match(inspection, /\.is-hot/);
    assert.match(inspection, /outline/);
    assert.match(inspection, /:focus-visible/);
    assert.doesNotMatch(inspection, /#[\da-f]{3,8}\b|\brgba?\s*\(/i);
  });

  it("keeps every complete lesson detail scrollable and long evidence paths wrappable", () => {
    const containment = read("app/globals/14zzh-interface-density.css");
    assert.match(lessons, /min-height:\s*0/);
    assert.match(lessons, /\.proofs-plane \.coh-lesson-sheet \{[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*visible;/,
      "the lesson body competes with the enclosing Sheet as a nested scroll owner");
    assert.match(containment, /\[data-slot="sheet-content"\][\s\S]*?max-height: calc\(100dvh[\s\S]*?overflow-y: auto;/,
      "the enclosing Sheet no longer owns bounded vertical scrolling");
    assert.match(lessons, /overflow-wrap:\s*anywhere/);
  });

  it("does not paint a third evidence tile when a static view has only two facts", () => {
    assert.match(
      evidence,
      /\.coh-evidence__grid:not\(:has\(\.coh-evidence__transport\)\)\s*\{\s*grid-template-columns:\s*1\.35fr 1fr;/,
    );
  });
});
