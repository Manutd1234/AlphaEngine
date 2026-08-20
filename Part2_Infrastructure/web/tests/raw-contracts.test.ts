/**
 * The raw checks, held to real vendor bodies.
 *
 * Every assertion below runs against a response captured verbatim from the
 * vendor and committed under `tests/fixtures/raw/`. That ordering is the whole
 * point: a raw-schema validator with no corpus is untested code in the fetch
 * path, and this repository had zero committed vendor bodies before these.
 *
 * The healthy-body tests matter more than the corrupted ones. A check that
 * fires on a good response is worse than no check — it teaches a reader to
 * ignore the surface it fires on.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkBinanceKlinesRaw,
  checkBinanceTickerRaw,
  checkBybitEnvelopeRaw,
  checkBybitKlinesRaw,
} from "../lib/providers/raw-contracts";

const fixture = (relative: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/raw/${relative}`, import.meta.url)), "utf8")).body;

const binanceBars = fixture("binance/bars.json");
const binanceQuote = fixture("binance/quote.json");
const bybitBars = fixture("bybit/bars.json");
const bybitQuote = fixture("bybit/quote.json");

describe("a healthy vendor response raises nothing", () => {
  it("binance klines", () => {
    const result = checkBinanceKlinesRaw(binanceBars);
    assert.deepEqual(result.violations, [], "a check fired on a body the vendor actually sent");
    assert.equal(result.passed, true);
  });

  it("binance 24h ticker", () => {
    assert.deepEqual(checkBinanceTickerRaw(binanceQuote).violations, []);
  });

  it("bybit klines", () => {
    assert.deepEqual(checkBybitKlinesRaw(bybitBars).violations, []);
  });

  it("bybit tickers", () => {
    assert.deepEqual(checkBybitEnvelopeRaw(bybitQuote, "quote").violations, []);
  });
});

describe("binance klines are positional, and that is what is checked", () => {
  it("a shortened tuple is fatal, not a shorter bar", () => {
    // A reordered or truncated tuple normalises into plausible bars with the
    // wrong fields in them, and nothing downstream can tell.
    const rows = (binanceBars as unknown[][]).map((row) => row.slice(0, 4));
    const result = checkBinanceKlinesRaw(rows);
    assert.equal(result.passed, false);
    assert.equal(result.violations[0].check, "raw.binance.bars.row_shape");
    assert.equal(result.violations[0].severity, "fatal");
  });

  it("an open time that became a string is fatal", () => {
    const rows = (binanceBars as unknown[][]).map((row) => [String(row[0]), ...row.slice(1)]);
    assert.equal(checkBinanceKlinesRaw(rows).violations[0].check, "raw.binance.bars.open_time_numeric");
  });

  it("prices arriving as numbers is DRIFT, not breakage", () => {
    // The parse still works if Binance ever sends numbers, so this must not
    // fail over a provider that is answering correctly.
    const rows = (binanceBars as unknown[][]).map((row) => [row[0], Number(row[1]), ...row.slice(2)]);
    const violation = checkBinanceKlinesRaw(rows).violations[0];
    assert.equal(violation.check, "raw.binance.bars.decimal_strings");
    assert.equal(violation.severity, "drift", "a working provider was treated as broken");
  });

  it("a body that is not an array at all is caught before the loop", () => {
    assert.equal(checkBinanceKlinesRaw({ code: -1121 }).violations[0].check, "raw.binance.bars.is_array");
  });
});

describe("bybit puts its failures in the envelope, not the status code", () => {
  it("a non-zero retCode is fatal even on HTTP 200", () => {
    // Bybit answers 200 with a non-zero retCode for a refused request. A client
    // that trusts the status code reads a refusal as an empty result — the
    // "unavailable looks like empty" defect this codebase refuses everywhere.
    const refused = { retCode: 10001, retMsg: "params error", result: { list: [] } };
    const result = checkBybitEnvelopeRaw(refused, "bars");
    assert.equal(result.passed, false);
    assert.equal(result.violations[0].check, "raw.bybit.envelope.ret_code_ok");
    assert.match(String(result.violations[0].message), /params error/);
  });

  it("a missing retCode is fatal, because then nothing can tell the two apart", () => {
    const result = checkBybitEnvelopeRaw({ result: { list: [] } }, "bars");
    assert.equal(result.violations[0].check, "raw.bybit.envelope.ret_code");
  });

  it("an empty list under retCode 0 is a real answer, not a violation", () => {
    // "The vendor has nothing for this symbol" is a result. Flagging it would
    // put a red mark on a correct response.
    assert.deepEqual(checkBybitEnvelopeRaw({ retCode: 0, result: { list: [] } }, "bars").violations, []);
  });

  it("a kline row that is not decimal strings is fatal", () => {
    const body = JSON.parse(JSON.stringify(bybitBars)) as { result: { list: unknown[][] } };
    body.result.list[0] = ["not-a-number", "1", "2", "3", "4", "5"];
    assert.equal(checkBybitKlinesRaw(body).violations[0].check, "raw.bybit.bars.decimal_strings");
  });
});

describe("the fixtures are what they claim to be", () => {
  it("each carries its provenance", () => {
    for (const name of ["binance/bars", "binance/quote", "bybit/bars", "bybit/quote"]) {
      const raw = JSON.parse(readFileSync(
        fileURLToPath(new URL(`./fixtures/raw/${name}.json`, import.meta.url)), "utf8",
      )) as Record<string, unknown>;
      assert.match(String(raw._captured), /^\d{4}-\d{2}-\d{2}$/, `${name} has no capture date`);
      assert.match(String(raw._url), /^https:\/\//, `${name} does not say where it came from`);
      assert.ok(raw.body !== undefined, `${name} has no body`);
    }
  });

  it("no fixture carries a credential", () => {
    // These two vendors are keyless, which is why they are the two that are
    // captured. If that ever stops being true this catches it before commit.
    for (const name of ["binance/bars", "binance/quote", "bybit/bars", "bybit/quote"]) {
      const text = readFileSync(
        fileURLToPath(new URL(`./fixtures/raw/${name}.json`, import.meta.url)), "utf8",
      );
      assert.doesNotMatch(text, /api[_-]?key|apikey|authorization|bearer|secret/i,
        `${name} may contain a credential`);
    }
  });
});
