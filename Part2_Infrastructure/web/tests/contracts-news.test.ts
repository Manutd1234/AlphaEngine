/**
 * The news contract — the defects a headline count cannot see.
 *
 * A feed is the easiest payload to believe: it arrives as a list, it renders as
 * a list, and a panel with eight rows in it looks correct whatever those rows
 * say. So the checks here are about the things a count cannot see — the same id
 * twice, so one story is read as two; a sentiment score outside its own range,
 * which quietly widens every average taken from it; an archive-old item beside
 * live ones.
 *
 * Severity carries the argument, as everywhere in this suite. A quiet ticker is
 * an answer, so an empty feed warns rather than failing; an item that is not
 * well formed is a broken record and is fatal.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkNews, CONTRACTED_CAPABILITIES, NEWS_MAX_AGE_MS } from "../lib/providers/contracts";
import type { NewsItem } from "../lib/providers/types";

import { NOW } from "./helpers/contract-fixtures";

describe("news feeds are checked for the defects a headline count cannot see", () => {
  const story = (over: Partial<NewsItem> = {}): NewsItem => ({
    id: "https://news.test/a",
    title: "Issuer reports quarter",
    url: "https://news.test/a",
    source: "Wire",
    publishedAt: new Date(NOW - 3_600_000).toISOString(),
    summary: null,
    tickers: ["AAPL"],
    sentiment: null,
    ...over,
  });

  it("names the four capabilities the façades attach contracts to", () => {
    assert.deepEqual([...CONTRACTED_CAPABILITIES], ["quote", "bars", "news", "fundamentals"]);
  });

  it("passes a clean feed with nothing left unevaluated", () => {
    const r = checkNews("fmp", [story(), story({ id: "b", url: "https://news.test/b" })], 8, NOW);
    assert.equal(r.capability, "news");
    assert.equal(r.passed, true);
    assert.deepEqual(r.violations, []);
    assert.deepEqual(r.notEvaluated, []);
  });

  it("an empty feed is a warning, not a rejection — a quiet ticker is an answer", () => {
    const r = checkNews("fmp", [], 8, NOW);
    assert.equal(r.passed, true);
    assert.deepEqual(r.violations.map((v) => [v.check, v.severity]), [["news.non_empty", "warn"]]);
    assert.ok(r.notEvaluated.includes("news.freshness"), "per-item checks are not evaluated on nothing");
  });

  it("rejects an item with no title or an unparseable URL", () => {
    const r = checkNews("x", [story({ title: " " }), story({ id: "c", url: "not a url" })], undefined, NOW);
    assert.equal(r.passed, false);
    const v = r.violations.find((x) => x.check === "news.items_well_formed")!;
    assert.equal(v.severity, "fatal");
    assert.equal(v.observed, 2);
    assert.ok(r.notEvaluated.includes("news.length_within_limit"), "no limit ⇒ the length check does not run");
  });

  it("rejects a duplicated id — a headline would be counted twice", () => {
    const r = checkNews("x", [story(), story()], 8, NOW);
    assert.equal(r.passed, false);
    assert.ok(r.violations.some((v) => v.check === "news.ids_unique" && v.severity === "fatal"));
  });

  it("rejects a sentiment score outside its own range, and only that", () => {
    const bad = checkNews("alphavantage", [story({ sentiment: 1.4 })], 8, NOW);
    assert.equal(bad.passed, false);
    assert.ok(bad.violations.some((v) => v.check === "news.sentiment_range"));
    const edge = checkNews("alphavantage", [story({ sentiment: -1 }), story({ id: "z", url: "https://news.test/z", sentiment: 1 })], 8, NOW);
    assert.equal(edge.passed, true);
    assert.deepEqual(edge.violations, []);
  });

  it("warns on plain http, future stamps, archive-old items and unparseable times", () => {
    const r = checkNews("x", [
      story({ url: "http://news.test/plain", id: "p" }),
      story({ id: "f", publishedAt: new Date(NOW + 3_600_000).toISOString() }),
      story({ id: "o", publishedAt: new Date(NOW - NEWS_MAX_AGE_MS - 1).toISOString() }),
      story({ id: "u", publishedAt: "yesterday-ish" }),
    ], 8, NOW);
    assert.equal(r.passed, true, "these are warnings; the feed is still served");
    const checks = r.violations.map((v) => `${v.check}:${v.severity}`).sort();
    assert.deepEqual(checks, [
      "news.freshness:warn",
      "news.not_from_the_future:warn",
      "news.published_at_parseable:warn",
      "news.url_https:warn",
    ]);
  });

  it("an empty ticker is drift — our mapping, not the market", () => {
    const r = checkNews("x", [story({ tickers: ["AAPL", ""] })], 8, NOW);
    assert.equal(r.passed, true);
    assert.deepEqual(r.violations.map((v) => [v.check, v.severity]), [["news.tickers_well_formed", "drift"]]);
  });

  it("warns when more items come back than were asked for", () => {
    const items = ["a", "b", "c"].map((id) => story({ id, url: `https://news.test/${id}` }));
    const r = checkNews("x", items, 2, NOW);
    assert.ok(r.violations.some((v) => v.check === "news.length_within_limit" && v.severity === "warn"));
  });
});
