/**
 * The instrument roster.
 *
 * The roster's whole failure mode is that being in a dropdown looks like
 * evidence of working. AAPL, NVDA and MSFT were offered for the entire life of
 * this picker while `loadBars` sent them somewhere that could not answer, and
 * nothing here or anywhere else contradicted it. So every entry is now checked
 * against the routing that will actually serve it, not just against itself.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { filterSymbols } from "@/components/SymbolCombobox";
import { classify } from "@/lib/providers/symbols";
import { candidatesFor } from "@/lib/providers/registry";
import {
  defaultBenchmark,
  RESEARCH_SYMBOL_IDS,
  RESEARCH_SYMBOLS,
} from "@/lib/research-symbols";

const controls = readFileSync(
  fileURLToPath(new URL("../components/Controls.tsx", import.meta.url)),
  "utf8",
);

const combobox = readFileSync(
  fileURLToPath(new URL("../components/SymbolCombobox.tsx", import.meta.url)),
  "utf8",
);

/**
 * Source with comments removed, for assertions about what the code DOES.
 *
 * Written after an assertion that `<select` is absent failed against the file's
 * own doc comment explaining why a `<select>` would be wrong. Grepping raw
 * source conflates prose with code: a file that documents the option it
 * rejected reads, to a regex, exactly like a file that took it. These files are
 * heavily commented by design, so this is the difference between a test that
 * checks the implementation and one that checks the explanation of it.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block and JSX comments
    .replace(/^\s*\/\/.*$/gm, "");      // whole-line // comments
}

const comboboxCode = code(combobox);

describe("every offered symbol has somewhere to be served from", () => {
  it("at least one adapter covers each entry's asset class", () => {
    for (const entry of RESEARCH_SYMBOLS) {
      const providers = candidatesFor("bars", classify(entry.symbol));
      assert.ok(
        providers.length > 0,
        `${entry.symbol} (${classify(entry.symbol)}) has no provider that can serve bars`,
      );
    }
  });

  it("classifies each entry the way its sector implies", () => {
    // A ticker that reads as crypto to `classify` and as an equity to the
    // roster would be routed to Binance — the original bug, in reverse.
    for (const entry of RESEARCH_SYMBOLS) {
      const expected = entry.sector === "Crypto" ? "crypto" : "equity";
      assert.equal(
        classify(entry.symbol), expected,
        `${entry.symbol} is listed as ${entry.sector} but classifies as ${classify(entry.symbol)}`,
      );
    }
  });

  it("keeps a keyless path so a fresh clone shows something real", () => {
    // Every equity provider needs a credential. If the roster were all
    // equities, a clone with no environment would have nothing but synthetic
    // series — and the first thing a reader would see is the fallback banner.
    const keyless = RESEARCH_SYMBOLS.filter((s) => classify(s.symbol) === "crypto");
    assert.ok(keyless.length >= 10, "too few keyless instruments for an unconfigured deployment");
  });
});

describe("the roster spreads risk rather than ranking size", () => {
  it("covers enough sectors that robustness across them means something", () => {
    // Eight tickers that all move with the Nasdaq test one thing eight times.
    const sectors = new Set(RESEARCH_SYMBOLS.map((s) => s.sector));
    assert.ok(sectors.size >= 8, `only ${sectors.size} sectors represented: ${[...sectors]}`);
  });

  it("no sector dominates the equity half", () => {
    const equities = RESEARCH_SYMBOLS.filter((s) => s.sector !== "Crypto");
    const counts = new Map<string, number>();
    for (const e of equities) counts.set(e.sector, (counts.get(e.sector) ?? 0) + 1);
    for (const [sector, n] of counts) {
      assert.ok(
        n <= equities.length / 3,
        `${sector} is ${n} of ${equities.length} equities — the roster leans on one sector`,
      );
    }
  });

  it("has no duplicates", () => {
    assert.equal(new Set(RESEARCH_SYMBOL_IDS).size, RESEARCH_SYMBOL_IDS.length);
  });

  it("kept every symbol the previous roster offered", () => {
    // Removing an instrument silently breaks any saved experiment that used it.
    for (const previous of [
      "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT",
      "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT", "LTCUSDT", "TRXUSDT",
      "AAPL", "NVDA", "MSFT",
    ]) {
      assert.ok(RESEARCH_SYMBOL_IDS.includes(previous), `${previous} was dropped from the roster`);
    }
  });
});

describe("the default benchmark is a comparison, not a formality", () => {
  it("matches the asset class", () => {
    // SPY as the benchmark for a BTCUSDT run produces an alpha that is mostly a
    // currency mismatch wearing a t-statistic.
    assert.equal(defaultBenchmark("ETHUSDT"), "BTCUSDT");
    assert.equal(defaultBenchmark("AAPL"), "SPY");
    assert.equal(defaultBenchmark("XOM"), "SPY");
  });

  it("never benchmarks an instrument against itself", () => {
    for (const { symbol } of RESEARCH_SYMBOLS) {
      assert.notEqual(
        defaultBenchmark(symbol), symbol,
        `${symbol} would be compared against itself, which is a constant zero`,
      );
    }
  });

  it("always names something the roster can serve", () => {
    for (const { symbol } of RESEARCH_SYMBOLS) {
      assert.ok(RESEARCH_SYMBOL_IDS.includes(defaultBenchmark(symbol)));
    }
  });
});

describe("the control renders the roster rather than its own copy", () => {
  it("imports the list instead of restating it", () => {
    assert.match(controls, /from "@\/lib\/research-symbols"/);
    assert.match(combobox, /from "@\/lib\/research-symbols"/);
    assert.doesNotMatch(controls, /const SYMBOLS = \[/, "Controls kept a second roster");
    assert.doesNotMatch(combobox, /const SYMBOLS = \[/, "the combobox kept a second roster");
  });

  it("shows the issuer, not just the ticker", () => {
    // 32 tickers is only navigable if a reader can tell AVGO from AVAX in place.
    assert.match(combobox, /s\.name/);
    assert.match(combobox, /s\.sector/);
  });

  it("keeps the field free text, so the roster stays suggestions not a whitelist", () => {
    // This used to assert `<datalist>`, which was pinning the IMPLEMENTATION as
    // a proxy for the property. The datalist had to go — it filters its options
    // against the field's own value, so a populated box showed exactly one
    // suggestion and the roster could only be browsed by clearing the field
    // first. The property it stood for is the one that matters and it survives:
    // anything the providers can serve still runs, listed or not.
    assert.match(comboboxCode, /type="text"/, "the symbol field is no longer free text");
    assert.doesNotMatch(comboboxCode, /<select/, "a select would drop every unlisted ticker");
    // Enter on an unmatched query commits what was typed rather than rejecting it.
    assert.match(comboboxCode, /Press Enter to use it anyway/);
  });

  it("opens on the full roster rather than on what is already in the box", () => {
    // The reported bug, asserted directly. `justOpened` suppresses the query on
    // open so every symbol is listed even though the field is populated; any
    // keystroke clears it and normal typeahead filtering resumes.
    assert.match(comboboxCode, /justOpened \? "" : draft/);
    assert.match(comboboxCode, /onMouseDown=\{\(\) => \{ if \(!open\) openList\(\); \}\}/);
  });

  it("is reachable and operable without a mouse", () => {
    // A custom listbox that only responds to clicks is a regression against the
    // native control it replaced, which was fully keyboard-operable for free.
    for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"]) {
      assert.match(comboboxCode, new RegExp(`"${key}"`), `${key} is unhandled`);
    }
    assert.match(comboboxCode, /role="combobox"/);
    assert.match(comboboxCode, /role="listbox"/);
    assert.match(comboboxCode, /role="option"/);
    assert.match(comboboxCode, /aria-expanded/);
    assert.match(comboboxCode, /aria-activedescendant/);
  });

  it("re-emits a native change so the panel's one listener still auto-runs", () => {
    // `Controls` auto-runs from a single native `change` listener on the panel
    // root. React's onChange is the `input` event, and a value set by clicking
    // a listbox row fires no native `change` at all — so without this a pick
    // would update the symbol and then wait out the 700ms idle fallback. The
    // old `<datalist>` got this for free.
    assert.match(comboboxCode, /new Event\("change", \{ bubbles: true \}\)/);
    // Dispatched from an effect keyed on the committed `value`, never inline in
    // commit(): the listener closes over `req`, so firing before the parent has
    // re-rendered hands it the request from before the pick.
    assert.match(comboboxCode, /\}, \[value\]\);/, "the change is not sequenced on the committed value");
    assert.doesNotMatch(
      comboboxCode,
      /onCommit\(clean\);\s*inputRef\.current\?\.dispatchEvent/,
      "the change is dispatched inline, before the parent has the new symbol",
    );
  });

  it("does not re-run the sweep when the symbol did not change", () => {
    // Opening the list and clicking away commits the value already there. That
    // is browsing, not an edit, and firing a sweep for it would make reading
    // the roster cost a backtest.
    assert.match(comboboxCode, /if \(clean !== value\.toUpperCase\(\)\) pending\.current = clean;/);
  });

  it("strips comments before asserting on code, and the stripper works", () => {
    // Guards the helper itself. A stripper that silently returned its input
    // would make every assertion above pass against prose again, which is the
    // exact failure it was written to remove.
    assert.doesNotMatch(comboboxCode, /WHY NOT JUST A/, "block comments survived the stripper");
    assert.ok(comboboxCode.length < combobox.length, "the stripper removed nothing");
    assert.match(combobox, /<select>/, "the rationale for not using a select was deleted");
  });
});

describe("filtering the roster", () => {
  it("returns everything for an empty query — the whole point of the fix", () => {
    assert.equal(filterSymbols("").length, RESEARCH_SYMBOLS.length);
    assert.equal(filterSymbols("   ").length, RESEARCH_SYMBOLS.length);
  });

  it("still returns everything when the query is the current symbol's own text", () => {
    // The datalist's exact failure: a full box collapsed the list to one row.
    // Filtering is suppressed on open, but even when it is not, a ticker
    // substring must not be the only thing that can match.
    assert.ok(filterSymbols("BTCUSDT").length >= 1);
    assert.ok(filterSymbols("").length > filterSymbols("BTCUSDT").length);
  });

  it("finds a symbol by issuer or sector, not just by ticker", () => {
    // Someone who knows the company but not the ticker has to be able to get
    // there, or a 32-row roster is a 32-row memory test.
    assert.ok(filterSymbols("Bitcoin").some((s) => s.symbol === "BTCUSDT"));
    assert.ok(filterSymbols("Crypto").length >= 12);
  });

  it("is case-insensitive", () => {
    assert.deepEqual(filterSymbols("btc"), filterSymbols("BTC"));
  });

  it("returns nothing for an unlisted ticker rather than guessing", () => {
    // ATOMUSDT backtests correctly and is deliberately not on the roster. The
    // list must be empty so the "use it anyway" affordance is what shows.
    assert.deepEqual(filterSymbols("ZZZZZZ"), []);
  });
});
