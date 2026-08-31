/**
 * The Books ladder is one keyboard instrument over two native bid rails.
 *
 * `LadderChart` remains the public entry point used by `BooksPane`, but the
 * drawing and inspection contract now belongs to `BookLadderConsole`. The
 * console deliberately is not a Plot: every quoted level is an exact button,
 * both rails share one roving listbox, and the full ledger stays available
 * behind a disclosure.
 *
 * Depth is a model fact rather than a drawing-side calculation. Native YES
 * bids accumulate from the highest price down; native NO bids are mirrored
 * onto the YES-offer axis and accumulate from the lowest implied offer up.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextListboxIndex } from "../components/coherence/use-stable-selection-key";
import {
  bookIdentityScenario,
  contractsLabel,
  mirrorBookLevels,
  scenarioBookLevels,
  sweepBook,
} from "../lib/coherence/book-instrument-model";
import { read, stripNonCode } from "./helpers/workspace-sources";

const ladder = read("../components/coherence/LadderChart.tsx");
const pane = read("../components/coherence/BooksPane.tsx");
const instrument = read("../components/coherence/BooksInstruments.tsx");
const instrumentCss = read("../components/coherence/BooksInstruments.module.css");
const model = read("../lib/coherence/book-instrument-model.ts");
const selection = read("../components/coherence/use-stable-selection-key.ts");

describe("the legacy ladder entry point delegates to the mirror-book console", () => {
  it("passes the observed native rails and presentation contract through", () => {
    assert.match(ladder, /import \{ BookLadderConsole \} from "\.\/BooksInstruments"/);
    assert.match(stripNonCode(ladder), /<BookLadderConsole\b/);
    for (const prop of ["yesBids", "noBids", "depth", "caption", "unquotedReason"]) {
      assert.match(ladder, new RegExp(`${prop}=\\{${prop}\\}`), `${prop} is not passed to the console`);
    }
    assert.doesNotMatch(stripNonCode(ladder), /<Plot\b|<svg\b|useMeasuredWidth|sharedX=/,
      "the adapter started drawing a second ladder instead of delegating");
    assert.doesNotMatch(stripNonCode(ladder), /yesAsks=\{/,
      "an inferred ask rail is passed as if the venue observed it; the console mirrors native NO bids");
  });
});

describe("both rails form one roving keyboard instrument", () => {
  it("keeps the canvas neutral and reserves side colour for meaningful states", () => {
    assert.match(instrumentCss, /\.instrument\s*\{[^}]*background:\s*var\(--surface-1\);/s);
    assert.match(instrumentCss, /\.ladderStage\s*\{[^}]*background:\s*var\(--surface-2\);/s);
    assert.match(instrumentCss, /\.railLevels\s*\{[^}]*background:\s*var\(--surface-1\);/s);
    assert.match(instrumentCss, /\.level\[aria-selected="true"\][^}]*background:\s*var\(--state-info-bg\);/s);
    assert.match(instrumentCss, /\.rail\[data-side="no"\] \.level\[aria-selected="true"\][^}]*background:\s*var\(--state-critical-bg\);/s);
  });

  it("owns both YES and NO options with a single listbox", () => {
    assert.equal((instrument.match(/role="listbox"/g) ?? []).length, 1,
      "two listboxes make one cross-rail arrow walk impossible");
    assert.match(
      instrument,
      /<div className=\{styles\.railListbox\} role="listbox"[\s\S]*?<LevelRail side="yes"[\s\S]*?<LevelRail side="no"/,
    );
    assert.match(instrument, /<section className=\{styles\.rail\}[\s\S]{0,160}role="group"/);
    assert.match(instrument, /<\/div>\s*<div className=\{styles\.mirrorCore\}/,
      "the explanatory mirror core sits outside the listbox's option ownership");
    assert.match(instrument, /role="option"/);
    assert.match(instrument, /useRovingListbox\(keys, yes\[0\]\?\.key \?\? no\[0\]\?\.key\)/);
    assert.match(instrument, /optionProps\(row\.key, offset \+ index\)/,
      "the second rail does not continue the first rail's option indices");
  });

  it("resets the roving selection when the selected market changes", () => {
    assert.match(pane, /<LadderChart\s+key=\{book\.ticker\}/);
  });

  it("keeps the venue depth scope attached to the ladder instead of a trailing KPI tile", () => {
    assert.match(pane, /<LadderChart[\s\S]*?depth=\{book\.depth\}/);
    assert.doesNotMatch(stripNonCode(pane), /<KpiRow\b/,
      "depth moved back below the exact ledger as a detached KPI tile");
    assert.match(instrument, /scope=\{\{ label: "Depth read", value: depthScopeLabel\(depth\) \}\}/);
    assert.match(instrument, /if \(depth === "full"\) return "full ladder"/);
    assert.match(instrument, /if \(depth === "top_of_book"\) return "top of book"/);
  });

  it("keeps one tab stop and supports both spatial axes plus Home and End", () => {
    assert.match(selection, /tabIndex:\s*selected === key \? 0 : -1/);
    assert.deepEqual(
      ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home", "End"].map((key) =>
        nextListboxIndex(2, key, 5)),
      [1, 1, 3, 3, 0, 4],
    );
    assert.equal(nextListboxIndex(0, "ArrowLeft", 5), 0, "the walk wraps at the first visible level");
    assert.equal(nextListboxIndex(4, "ArrowDown", 5), 4, "the walk wraps at the last visible level");
    assert.equal(nextListboxIndex(2, "Enter", 5), null, "an unrelated key changes the selection");
    assert.equal(nextListboxIndex(0, "ArrowRight", 0), null, "an empty book exposes a phantom option");
    assert.match(selection, /closest<HTMLElement>\('\[role="listbox"\]'\)/);
    assert.match(selection, /querySelectorAll<HTMLButtonElement>\('\[role="option"\]'\)\[next\]\?\.focus\(\)/);
  });

  it("announces the selected level without turning an absent side into zero", () => {
    assert.match(instrument, /<output className=\{styles\.readout\}[^>]*aria-live="polite" aria-atomic="true">/);
    assert.match(instrument, /active\.side\.toUpperCase\(\)/);
    assert.match(instrument, /active\.nativePrice/);
    assert.match(instrument, /active\.yesPrice/);
    assert.match(instrument, /active\.size/);
    assert.match(instrument, /active\.depth/);
    assert.match(instrument, /bestBid == null \? "—"/);
    assert.match(instrument, /bestOffer == null \? "—"/);
    assert.match(instrument, /spread == null \? "One-sided"/);
    assert.doesNotMatch(stripNonCode(instrument), /best(?:Bid|Offer)\s*\?\?\s*0|spread\s*\?\?\s*0/);
  });
});

describe("cumulative depth belongs to the shared book model", () => {
  it("accumulates native YES high-to-low and mirrored NO low-to-high", () => {
    const levels = mirrorBookLevels(
      [
        { price: "0.1000", size: "2" },
        { price: "0.3000", size: "4" },
        { price: "0.2000", size: "3" },
      ],
      [
        { price: "0.1000", size: "2" },
        { price: "0.3000", size: "4" },
        { price: "0.2000", size: "3" },
      ],
    );

    assert.deepEqual(levels.yes.map(({ nativePrice, yesPrice, size, depth }) =>
      [nativePrice, yesPrice, size, depth]), [
      [3_000, 3_000, 4, 4],
      [2_000, 2_000, 3, 7],
      [1_000, 1_000, 2, 9],
    ]);
    assert.deepEqual(levels.no.map(({ nativePrice, yesPrice, size, depth }) =>
      [nativePrice, yesPrice, size, depth]), [
      [3_000, 7_000, 4, 4],
      [2_000, 8_000, 3, 7],
      [1_000, 9_000, 2, 9],
    ]);
    assert.deepEqual(levels.ordered.map(({ side }) => side), ["yes", "yes", "yes", "no", "no", "no"]);
  });

  it("turns a level through the complement and rebuilds depth on its destination rail", () => {
    const live = mirrorBookLevels(
      [{ price: "0.3000", size: "4" }, { price: "0.2000", size: "3" }],
      [{ price: "0.1000", size: "2" }],
    );
    const moved = scenarioBookLevels(live.ordered, { "yes:3000": "no" });
    const flipped = moved.no.find((level) => level.key === "yes:3000");
    assert.deepEqual(
      flipped && [flipped.side, flipped.nativePrice, flipped.yesPrice, flipped.originSide],
      ["no", 7_000, 3_000, "yes"],
    );
    assert.equal(moved.yes[0].depth, 3);
    assert.equal(flipped?.depth, 4);
  });

  it("is imported by the instrument instead of being re-derived in the component", () => {
    assert.match(instrument, /mirrorBookLevels,[\s\S]*?from "@\/lib\/coherence\/book-instrument-model"/);
    assert.match(instrument, /const live = mirrorBookLevels\(yesBids, noBids\)/);
    assert.match(instrument, /scenarioBookLevels\(live\.ordered, sideByKey\)/);
    assert.match(model, /withDepth\(parsed\(yesBids, "yes"\), "from-high"\)/);
    assert.match(model, /withDepth\(parsed\(noBids, "no"\), "from-low"\)/);
    assert.doesNotMatch(stripNonCode(instrument), /function (?:depthBy|withDepth)\b/);
  });

  it("prints a stable contract count rather than a float tail or padded precision", () => {
    assert.equal(contractsLabel(66_887.90000000001), "66887.9");
    assert.equal(contractsLabel(12), "12");
    assert.doesNotMatch(stripNonCode(model), /\.toFixed\(/);
    assert.match(instrument, /contractsLabel\(row\.depth\)/);
    assert.match(instrument, /contractsLabel\(active\.depth\)/);
  });

  it("keeps every exact level in a collapsed, keyboard-scrollable ledger", () => {
    assert.match(instrument, /<details className=\{styles\.ledger\}>/);
    assert.match(instrument, /<summary>Exact working ledger — \{ordered\.length\} levels<\/summary>/);
    assert.match(instrument, /<div role="region" tabIndex=\{0\} aria-label=\{`Exact level ledger,/);
    assert.match(instrument, /<tbody>\{ordered\.map\(\(row\) =>/);
    for (const heading of ["Side", "Native", "YES axis", "At level", "At or better"]) {
      assert.match(instrument, new RegExp(`<th[^>]*scope="col"[^>]*>${heading}</th>`));
    }
    assert.match(instrument, /<th scope="row">\{row\.side\.toUpperCase\(\)\}<\/th>/);
  });
});

describe("the ladder exposes a local market-impact simulation", () => {
  it("walks the executable rail in queue order and reports partial fills honestly", () => {
    const queue = [
      { key: "no:2500", yesPrice: 7_500, size: 2 },
      { key: "no:2000", yesPrice: 8_000, size: 3 },
    ];

    assert.deepEqual(sweepBook(queue, 4), {
      requested: 4,
      filled: 4,
      unfilled: 0,
      levelsReached: 2,
      consumedKeys: ["no:2500", "no:2000"],
      vwap: 7_750,
      worstPrice: 8_000,
    });
    assert.deepEqual(sweepBook(queue, 7), {
      requested: 7,
      filled: 5,
      unfilled: 2,
      levelsReached: 2,
      consumedKeys: ["no:2500", "no:2000"],
      vwap: 7_800,
      worstPrice: 8_000,
    });
    assert.equal(sweepBook([
      { key: "no:2499", yesPrice: 7_501, size: 1 },
      { key: "no:2000", yesPrice: 8_000, size: 2 },
    ], 3).vwap, 7_833, "VWAP is truncated to the displayed tick rather than rounded up");
  });

  it("labels the range control and announces exact fill, impact, and remainder values", () => {
    assert.match(instrument, /<section className=\{styles\.sweepPanel\}[^>]*aria-label="YES market-order sweep simulation">/);
    assert.match(instrument, /<input type="range"[\s\S]*?aria-valuetext=\{`\$\{contractsLabel\(sweepQuantity\)\} contracts;/);
    assert.match(instrument, /<output className=\{styles\.sweepReadout\} aria-live="polite" aria-atomic="true">/);
    for (const label of ["Filled", "VWAP / worst", "Levels / unfilled"]) {
      assert.ok(instrument.includes(`<small>${label}</small>`), `${label} is missing from the sweep readout`);
    }
    assert.match(instrument, /Changes are local; the recorded book is untouched\./);
    assert.match(instrument, /sweepBook\(sweepQueue, sweepQuantity\)/);
  });
});

describe("the identity lab keeps quote shocks exact and local", () => {
  it("moves only the selected ask and compares it with the recorded reference", () => {
    assert.deepEqual(bookIdentityScenario("0.4300", "0.5900", "1.0200", "yes", 100), {
      yesAsk: 4_400,
      noAsk: 5_900,
      quoteTotal: 10_300,
      referenceTotal: 10_200,
      difference: 100,
      appliedShock: 100,
      state: "above",
    });
    assert.equal(bookIdentityScenario("0.4300", "0.5900", "1.0200", "yes", 0).state, "matched");
  });

  it("clamps the local ask to the contract domain and preserves unknown sides", () => {
    assert.equal(bookIdentityScenario("0.9900", "0.0100", "1.0000", "yes", 5_000).yesAsk, 10_000);
    assert.equal(bookIdentityScenario("0.0100", "0.9900", "1.0000", "yes", -5_000).yesAsk, 0);
    assert.deepEqual(bookIdentityScenario(null, "0.0100", null, "yes", 500), {
      yesAsk: null,
      noAsk: 100,
      quoteTotal: null,
      referenceTotal: null,
      difference: null,
      appliedShock: 0,
      state: "incomplete",
    });
  });
});
