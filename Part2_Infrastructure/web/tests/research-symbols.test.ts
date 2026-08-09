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
    assert.doesNotMatch(controls, /const SYMBOLS = \[/, "Controls kept a second roster");
  });

  it("shows the issuer, not just the ticker", () => {
    // 30 tickers is only navigable if a reader can tell AVGO from AVAX in place.
    assert.match(controls, /s\.name/);
    assert.match(controls, /s\.sector/);
  });

  it("stays a datalist, so the field is still free text", () => {
    // The roster is a set of suggestions known to work, never a whitelist —
    // anything the providers can serve should still run.
    assert.match(controls, /<datalist id="research-symbols">/);
    assert.match(controls, /list="research-symbols"/);
  });
});
