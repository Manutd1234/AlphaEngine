import type { Capability, Fundamentals, NewsItem, OhlcvBar, Quote } from "../types";
import { ContractResult, Violation, finite } from "./shared";

// --------------------------------------------------------------------------
// News
// --------------------------------------------------------------------------

/** Older than this a "news" item is an archive result, worth saying so. */
export const NEWS_MAX_AGE_MS = 2 * 365 * 24 * 3_600_000;
/** Vendors round to the minute; beyond this a stamp is from the future. */
export const NEWS_FUTURE_SKEW_MS = 10 * 60_000;

/**
 * Expectations on a normalised news feed.
 *
 * Fatal only for what makes an item unusable or double-counted: an item with
 * no title or an unparseable URL, a duplicated id, a sentiment score outside
 * its own range. An empty feed is a WARNING, not a rejection — a quiet ticker
 * on a quiet day is a legitimate answer, unlike an empty bar series — and the
 * per-item checks are then simply not evaluated.
 */
export function checkNews(
  provider: string,
  items: NewsItem[],
  requestedLimit?: number,
  now = Date.now(),
): ContractResult {
  const violations: Violation[] = [];
  const notEvaluated: string[] = [];

  if (!items.length) {
    return {
      capability: "news",
      provider,
      passed: true,
      violations: [{
        check: "news.non_empty",
        severity: "warn",
        message: "The provider returned no stories for this request.",
      }],
      notEvaluated: [
        "news.items_well_formed", "news.url_https", "news.ids_unique", "news.published_at_parseable",
        "news.not_from_the_future", "news.freshness", "news.sentiment_range", "news.tickers_well_formed",
        "news.length_within_limit",
      ],
    };
  }

  let malformed = 0;
  let insecure = 0;
  let unparseable = 0;
  let future = 0;
  let stale = 0;
  let sentimentOut = 0;
  let emptyTicker = 0;
  const ids = new Set<string>();
  let duplicated = 0;

  for (const item of items) {
    let url: URL | null = null;
    try {
      url = new URL(item.url);
    } catch {
      url = null;
    }
    if (!item.title || !item.title.trim() || !url) malformed++;
    else if (url.protocol !== "https:") insecure++;

    if (ids.has(item.id)) duplicated++;
    ids.add(item.id);

    const at = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
    if (Number.isNaN(at)) unparseable++;
    else {
      if (at > now + NEWS_FUTURE_SKEW_MS) future++;
      if (now - at > NEWS_MAX_AGE_MS) stale++;
    }

    if (item.sentiment !== null && (!finite(item.sentiment) || item.sentiment < -1 || item.sentiment > 1)) {
      sentimentOut++;
    }
    if (item.tickers.some((t) => typeof t !== "string" || !t.trim())) emptyTicker++;
  }

  if (malformed) {
    violations.push({
      check: "news.items_well_formed",
      severity: "fatal",
      message: `${malformed} item(s) have no title or an unparseable URL.`,
      observed: malformed,
    });
  }
  if (insecure) {
    violations.push({
      check: "news.url_https",
      severity: "warn",
      message: `${insecure} item(s) link over plain http.`,
      observed: insecure,
    });
  }
  if (duplicated) {
    // The same headline twice is counted twice by anything that counts.
    violations.push({
      check: "news.ids_unique",
      severity: "fatal",
      message: `${duplicated} duplicated id(s) — a headline would be counted twice.`,
      observed: duplicated,
    });
  }
  if (unparseable) {
    violations.push({
      check: "news.published_at_parseable",
      severity: "warn",
      message: `${unparseable} item(s) carry a publication time that could not be parsed.`,
      observed: unparseable,
    });
    if (unparseable === items.length) notEvaluated.push("news.not_from_the_future", "news.freshness");
  }
  if (future) {
    violations.push({
      check: "news.not_from_the_future",
      severity: "warn",
      message: `${future} item(s) are stamped in the future — check the provider's timezone handling.`,
      observed: future,
    });
  }
  if (stale) {
    violations.push({
      check: "news.freshness",
      severity: "warn",
      message: `${stale} item(s) are older than two years — an archive result, not news.`,
      observed: stale,
    });
  }
  if (sentimentOut) {
    violations.push({
      check: "news.sentiment_range",
      severity: "fatal",
      message: `${sentimentOut} sentiment score(s) fall outside [-1, 1].`,
      observed: sentimentOut,
    });
  }
  if (emptyTicker) {
    // A blank ticker is our mapping of the vendor's field, not the market.
    violations.push({
      check: "news.tickers_well_formed",
      severity: "drift",
      message: `${emptyTicker} item(s) carry an empty ticker — the vendor may have renamed the field.`,
      observed: emptyTicker,
    });
  }
  if (requestedLimit) {
    if (items.length > requestedLimit) {
      violations.push({
        check: "news.length_within_limit",
        severity: "warn",
        message: `${items.length} items returned for a limit of ${requestedLimit}.`,
        observed: items.length,
      });
    }
  } else {
    notEvaluated.push("news.length_within_limit");
  }

  return {
    capability: "news",
    provider,
    passed: !violations.some((v) => v.severity === "fatal"),
    violations,
    notEvaluated,
  };
}
