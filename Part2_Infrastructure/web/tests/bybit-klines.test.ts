/**
 * The Bybit fast path, and the one defect it could ship silently.
 *
 * Bybit's origin answers ~11.7x nearer than Binance's from the gateway and ~8x
 * nearer from the serverless region, which is why it is tried first. Nothing in
 * that measurement makes the data correct, and the two venues disagree in a way
 * that no type and no HTTP status can catch:
 *
 *     Binance returns klines ASCENDING   (oldest first)
 *     Bybit   returns klines DESCENDING  (newest first)
 *
 * A backtest fed a reversed series does not crash and does not warn. Every
 * indicator reads `bars[i-1]` as "the previous bar", so it produces a complete,
 * well-formed run of every strategy played backwards through history — with a
 * Sharpe, a drawdown, a walk-forward report and a promotion verdict, all of
 * them meaningless. It would look exactly like a working feature.
 *
 * That is the failure class this repository keeps producing — a stale strategy
 * whitelist, a response model dropping fields, a fixture symmetric in the
 * dimension under test — and it is green-while-broken every time. So the
 * ordering gets a test that fails loudly on a raw Bybit page, rather than a
 * comment asking the next reader to remember.
 *
 * Every test here is offline. Live reachability is not this file's business:
 * asserting a venue is up makes the suite fail when the venue has a bad
 * afternoon, which trains people to ignore it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bybitInterval, parseBybitPage } from "@/lib/bybit-klines";
import { CRYPTO_VENUES, loadCryptoBars } from "@/lib/marketdata";
import { ADAPTERS, candidatesFor } from "@/lib/providers/registry";
import { DATA_SOURCES, INTERVALS } from "@/lib/types";

/**
 * A page exactly as Bybit sends it: newest first, seven string fields.
 *
 * Closes are DISTINCT and monotonically decreasing with time so that a reversal
 * is detectable from the values alone. A fixture whose prices were symmetric in
 * time would pass whether or not the code reverses correctly — the exact
 * fixture defect that made `cmf_trend` untestable elsewhere in this suite.
 */
const NEWEST_FIRST: string[][] = [
  ["1786330800000", "65102.9", "65170.8", "64907.3", "65080.1", "172.78", "11239262.60"],
  ["1786327200000", "65199.8", "65223.0", "64902.0", "65102.9", "224.97", "14640862.93"],
  ["1786323600000", "64969.2", "65389.9", "64893.1", "65199.8", "262.25", "17070277.19"],
  ["1786320000000", "64901.0", "65010.0", "64800.0", "64969.2", "180.11", "11700000.00"],
];

describe("Bybit pages arrive newest-first and must not stay that way", () => {
  it("returns bars oldest-first", () => {
    const bars = parseBybitPage(NEWEST_FIRST);
    for (let i = 1; i < bars.length; i++) {
      assert.ok(
        bars[i].t > bars[i - 1].t,
        `bar ${i} (${bars[i].t}) does not follow bar ${i - 1} (${bars[i - 1].t}) in time`,
      );
    }
  });

  it("puts the oldest row first and the newest last, by value not just timestamp", () => {
    const bars = parseBybitPage(NEWEST_FIRST);
    // The venue's oldest row is the last element of the raw page.
    assert.equal(bars[0].t, 1786320000000);
    assert.equal(bars[0].c, 64969.2);
    assert.equal(bars[bars.length - 1].t, 1786330800000);
    assert.equal(bars[bars.length - 1].c, 65080.1);
  });

  it("is correct even if Bybit starts sending ascending pages", () => {
    // Sorted rather than reversed, so the venue flipping its own ordering is a
    // no-op here instead of the same catastrophe in the opposite direction.
    const ascending = [...NEWEST_FIRST].reverse();
    assert.deepEqual(parseBybitPage(ascending), parseBybitPage(NEWEST_FIRST));
  });

  it("reads the same six fields Binance does, in the same order", () => {
    const [oldest] = parseBybitPage(NEWEST_FIRST);
    // Bybit's row is [start, o, h, l, c, v, turnover] — seven fields against
    // Binance's twelve. Only the first six are read, and `turnover` is NOT
    // volume: it is quote-denominated and ~65,000x larger here, so picking the
    // wrong index would inflate every volume-based indicator without failing.
    assert.deepEqual(oldest, {
      t: 1786320000000, o: 64901.0, h: 65010.0, l: 64800.0, c: 64969.2, v: 180.11,
    });
    assert.ok(oldest.h >= oldest.l, "high/low transposed");
    assert.ok(oldest.v < 1000, "volume looks like turnover — wrong column");
  });
});

describe("intervals are translated, never guessed", () => {
  it("maps every interval the application actually offers", () => {
    // The strong form: not "the table has entries" but "every interval a user
    // can select resolves". A picker offering a value the fetcher rejects sends
    // every request for it to the fallback venue, silently and forever.
    for (const interval of INTERVALS) {
      assert.doesNotThrow(
        () => bybitInterval(interval),
        `${interval} is selectable in the UI but Bybit cannot serve it`,
      );
    }
  });

  it("translates rather than passes through", () => {
    // Bybit names intervals in minutes-as-a-number. Passing "1h" through would
    // be rejected by the venue, which is survivable; passing "15m" through and
    // having it interpreted as something else would not be.
    assert.equal(bybitInterval("15m"), "15");
    assert.equal(bybitInterval("1h"), "60");
    assert.equal(bybitInterval("4h"), "240");
    assert.equal(bybitInterval("1d"), "D");
  });

  it("throws on an unknown interval instead of defaulting", () => {
    // The single most valuable assertion in this file. A default here returns a
    // full, plausible, well-formed series at the WRONG timeframe — asking for
    // 1d and receiving 1m is wrong by a factor of 1440 with no warning anywhere.
    // Throwing sends the caller to Binance, which does understand the interval.
    assert.throws(() => bybitInterval("7m"), /does not expose/);
    assert.throws(() => bybitInterval(""), /does not expose/);
  });
});

describe("the venue order is the measured one", () => {
  it("tries Bybit before Binance", () => {
    // The entire point of the change. Asserted on the exported chain rather
    // than inferred from behaviour, so a reordering fails here rather than
    // showing up as an unexplained latency regression months later.
    assert.deepEqual(CRYPTO_VENUES.map((v) => v.source), ["bybit", "binance"]);
  });

  it("keeps Binance in the chain rather than replacing it", () => {
    // Demoted, not removed. Two real venues are what stop one venue's bad
    // afternoon from being served as a synthetic random walk.
    assert.ok(CRYPTO_VENUES.some((v) => v.source === "binance"));
    assert.equal(CRYPTO_VENUES.length, 2);
  });

  it("orders the provider registry the same way it orders the direct path", () => {
    // Two code paths reach crypto bars: `loadBars`'s direct chain and the
    // registry's ranked dispatch. If they disagree about which venue is nearer,
    // one of them is slower for a reason nobody wrote down.
    //
    // Only the head is compared. The registry chain is seven deep because the
    // keyed equity vendors also declare `crypto`; the direct path is the two
    // keyless venues and nothing else. What must agree is which venue leads.
    const chain = candidatesFor("bars", "crypto").map((a) => a.meta.id);
    assert.deepEqual(chain.slice(0, 2), CRYPTO_VENUES.map((v) => v.source));
  });

  it("does not decide the crypto rank by position in the ADAPTERS array", () => {
    // `candidatesFor` sorts by rank, and a tie resolves by array order — so two
    // adapters sharing a rank makes a latency decision depend on an import
    // list. This caught a real one: inserting Bybit at 0 and demoting Binance
    // to 1 tied it with Massive, which was already 1.
    const chain = ADAPTERS
      .filter((a) => a.meta.assets.includes("crypto") && a.meta.capabilities.includes("bars"));
    const ranks = chain.map((a) => a.meta.rank.bars);
    assert.equal(
      new Set(ranks).size, ranks.length,
      `two crypto bars adapters share a rank: ${chain.map((a) => `${a.meta.id}=${a.meta.rank.bars}`).join(", ")}`,
    );
  });

  it("keeps the keyless venues ahead of every keyed vendor", () => {
    // The ordering that matters on a fresh clone. If a keyed vendor outranked
    // the keyless venues, an unconfigured deploy would walk two `not_configured`
    // refusals before reaching a venue that was always going to answer.
    const chain = candidatesFor("bars", "crypto");
    const firstKeyed = chain.findIndex((a) => a.meta.keyEnv !== "");
    const lastKeyless = chain.map((a) => a.meta.keyEnv === "").lastIndexOf(true);
    assert.ok(lastKeyless < firstKeyed, "a keyed vendor is ranked ahead of a keyless venue");
  });
});

describe("the fallback actually falls back", () => {
  // Every symbol the application offers is listed on BOTH venues, so no real
  // request can exercise this path — the chain is injected instead. Without
  // these, the failover would be a promise nobody had checked until the day
  // Bybit went down, and Bybit has gone down before.
  const bar = (t: number) => ({ t, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 });
  const three = [bar(1), bar(2), bar(3)];
  const dead = (label: string, source: string) => ({
    source: source as (typeof DATA_SOURCES)[number],
    label,
    fetch: async () => { throw new Error("HTTP 403"); },
  });
  const alive = (label: string, source: string) => ({
    source: source as (typeof DATA_SOURCES)[number],
    label,
    fetch: async () => three,
  });

  it("uses the second venue when the first declines", async () => {
    const out = await loadCryptoBars("BTCUSDT", "1h", 3, [
      dead("Bybit", "bybit"), alive("Binance", "binance"),
    ]);
    assert.equal(out.source, "binance");
    assert.equal(out.bars.length, 3);
  });

  it("says which venue declined, and why, rather than falling back silently", async () => {
    // A run on Binance is a different measurement from a run on Bybit —
    // different book, different prices. A reader comparing two results has to
    // be able to see that one switched venues.
    const [warning] = (await loadCryptoBars("BTCUSDT", "1h", 3, [
      dead("Bybit", "bybit"), alive("Binance", "binance"),
    ])).warnings;
    assert.ok(warning, "the venue switch produced no warning at all");
    assert.match(warning, /Bybit declined/);
    assert.match(warning, /HTTP 403/);
    assert.match(warning, /Binance served/);
  });

  it("stays silent when the preferred venue answers", async () => {
    // The common case must not carry a warning, or the warning stops being read.
    const out = await loadCryptoBars("BTCUSDT", "1h", 3, [
      alive("Bybit", "bybit"), alive("Binance", "binance"),
    ]);
    assert.equal(out.source, "bybit");
    assert.deepEqual(out.warnings, []);
  });

  it("falls through to synthetic only when every venue declines", async () => {
    const out = await loadCryptoBars("BTCUSDT", "1h", 300, [
      dead("Bybit", "bybit"), dead("Binance", "binance"),
    ]);
    assert.equal(out.source, "synthetic");
    // Both venues named: "data unavailable" is one sentence for two different
    // outages, and a reader needs to know it was not just the primary.
    assert.match(out.warnings[0], /Bybit declined/);
    assert.match(out.warnings[0], /Binance declined/);
    assert.match(out.warnings[0], /the workflow is real, the prices are not/);
  });
});

describe("the source label stays honest", () => {
  it("names bybit as a data source", () => {
    // `dataSource` is rendered verbatim in the run header. A venue that serves
    // bars under a label the union does not carry either fails to compile or
    // renders a name the reader has never seen.
    assert.ok((DATA_SOURCES as readonly string[]).includes("bybit"));
  });

  it("gives every venue in the chain a nameable source", () => {
    for (const venue of CRYPTO_VENUES) {
      assert.ok(
        (DATA_SOURCES as readonly string[]).includes(venue.source),
        `${venue.source} serves bars but is not in DATA_SOURCES`,
      );
    }
  });

  it("keeps both crypto venues keyless", () => {
    // The property that makes a fresh clone useful with no environment set.
    // Adding a keyed venue to this chain would mean an unconfigured deploy
    // silently loses its failover and nobody finds out until the primary fails.
    for (const venue of CRYPTO_VENUES) {
      const adapter = ADAPTERS.find((a) => a.meta.id === venue.source);
      assert.ok(adapter, `${venue.source} is not registered as an adapter`);
      assert.equal(adapter.meta.keyEnv, "", `${venue.source} now requires a key`);
    }
  });
});
