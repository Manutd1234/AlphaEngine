/**
 * Which feed answers for which symbol.
 *
 * The defect this closes shipped for the entire life of the symbol picker:
 * AAPL, NVDA and MSFT were selectable, `loadBars` called Binance's klines
 * endpoint for every symbol, and Binance cannot ever answer for an equity. The
 * request failed every time, the fallback fired every time, and every equity
 * backtest this portal has ever run — the Sharpe, the walk-forward, the
 * promotion gate — was computed on a random walk, while four providers capable
 * of serving those tickers sat configured in the registry.
 *
 * The result was labelled `synthetic` and the banner did appear, so this was
 * never data passed off as real. What it was is a symbol picker offering three
 * choices that could not work, and a warning blaming an outage for a routing
 * mistake. Nothing in the suite caught it because every test used a crypto
 * pair. So these are the assertions that would have.
 *
 * Every test here is offline. The equity path is exercised with an EMPTY
 * environment, which means every provider is skipped at the `not_configured`
 * check before any socket is opened — the failure mode a fresh clone actually
 * has, tested without a network or a key.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadBars, syntheticBars } from "@/lib/marketdata";
import { ADAPTERS } from "@/lib/providers/registry";
import { classify } from "@/lib/providers/symbols";
import { DATA_SOURCES } from "@/lib/types";

/** A registry call that cannot reach the network and cannot see a real key. */
const hermetic = { env: {} as NodeJS.ProcessEnv };

describe("the symbol decides the feed", () => {
  it("classifies the three symbols the old code sent to a crypto venue", () => {
    for (const equity of ["AAPL", "NVDA", "MSFT"]) {
      assert.equal(classify(equity), "equity", `${equity} would be routed to Binance again`);
    }
    for (const pair of ["BTCUSDT", "ETHUSDT", "SOLUSDT"]) {
      assert.equal(classify(pair), "crypto");
    }
  });

  it("an equity never reaches Binance, even when every provider is unavailable", async () => {
    // The strong form of the fix. With no keys configured the result must be
    // synthetic — but it must be synthetic because the *equity* providers
    // declined, never because a crypto endpoint was asked a question it cannot
    // answer.
    const out = await loadBars("AAPL", "1d", 300, hermetic);
    assert.equal(out.source, "synthetic");
    assert.doesNotMatch(
      out.warnings.join(" "), /binance/i,
      "an equity request still consulted Binance",
    );
  });
});

describe("a fallback says which door was closed", () => {
  it("names every provider that declined and why", async () => {
    // "Data unavailable" is one sentence for four different problems. A missing
    // key is fixed by adding a key; a spent quota is fixed by waiting; an open
    // breaker is fixed by neither. Collapsing them means none get fixed.
    const [warning] = (await loadBars("MSFT", "1d", 300, hermetic)).warnings;
    assert.ok(warning, "the synthetic fallback produced no warning at all");

    for (const adapter of ADAPTERS.filter((a) => a.meta.capabilities.includes("bars"))) {
      if (adapter.meta.id === "binance") continue; // crypto-only, correctly not asked
      assert.match(
        warning, new RegExp(adapter.meta.id),
        `${adapter.meta.id} could have served this and the warning does not mention it`,
      );
    }
    // The env var is the actionable half: it tells the reader what to set.
    assert.match(warning, /FMP_API_KEY/);
    assert.match(warning, /not_configured/);
  });

  it("still says the prices are not real", async () => {
    // The one sentence that must survive every rewrite of this path.
    const out = await loadBars("NVDA", "1d", 300, hermetic);
    assert.match(out.warnings.join(" "), /the workflow is real, the prices are not/);
  });

  it("returns a usable series rather than an error", async () => {
    // A research portal that 500s when no key is set is a portal nobody can
    // evaluate. The fallback is a demonstration path, and it stays one.
    const out = await loadBars("AAPL", "1d", 300, hermetic);
    assert.equal(out.bars.length, 300);
    assert.ok(out.bars.every((b) => b.c > 0 && b.h >= b.l));
  });

  it("is deterministic, so two runs of the same symbol stay comparable", async () => {
    const a = await loadBars("AAPL", "1d", 300, hermetic);
    const b = syntheticBars("AAPL", "1d", 300);
    assert.deepEqual(a.bars.map((x) => x.c), b.map((x) => x.c));
  });
});

describe("the source label cannot drift from the provider list", () => {
  it("every adapter that can serve bars is a nameable data source", () => {
    // `dataSource` is rendered verbatim in the run header and compared against
    // "synthetic" to raise the banner. A provider whose id is not in the union
    // either fails to compile at the assignment or renders a name the reader
    // has never seen next to a missing banner.
    for (const adapter of ADAPTERS) {
      if (!adapter.meta.capabilities.includes("bars")) continue;
      assert.ok(
        (DATA_SOURCES as readonly string[]).includes(adapter.meta.id),
        `${adapter.meta.id} can serve bars but is not in DATA_SOURCES`,
      );
    }
  });

  it("synthetic is a first-class member, not an absence", () => {
    // The banner keys off this exact string. A fallback that cannot be named
    // is a fallback that renders as an ordinary result.
    assert.ok((DATA_SOURCES as readonly string[]).includes("synthetic"));
  });

  it("does not name providers that cannot serve bars", () => {
    const barsCapable = new Set(
      ADAPTERS.filter((a) => a.meta.capabilities.includes("bars")).map((a) => a.meta.id),
    );
    for (const source of DATA_SOURCES) {
      if (source === "synthetic") continue;
      assert.ok(barsCapable.has(source), `DATA_SOURCES names ${source}, which cannot serve bars`);
    }
  });
});
