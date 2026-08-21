/**
 * Raw-body predicates for the six keyed providers.
 *
 * Binance and Bybit live in `raw-contracts.ts` beside the shared helpers,
 * because their bodies are committed as fixtures and their checks were
 * calibrated against real captures. These six are not, and that difference is
 * the whole reason this file has its own header.
 *
 * ── What these are calibrated against, and what they are not ────────────────
 * `scripts/capture-provider-fixtures.mjs` needs a live key per provider to
 * record a body, and every key in this project's deployment is marked
 * Sensitive in Vercel — which makes it write-only, so no machine that can run
 * the capture can read the credential.
 *
 * Three of the six have since been captured without one — Alpha Vantage
 * through the vendor's published `apikey=demo`, Firecrawl through an anonymous
 * scrape, OpenBB because it is our own service and needs no credential — and
 * are out of `warn`. FMP, Tiingo and Massive have only their REFUSAL captured,
 * so their healthy shape is still a guess and stays at `warn`.
 *
 * So these predicates are written from the shape the ADAPTER in this repo
 * already depends on: `alphavantage.ts:32` reads `Note`/`Information`/`Error
 * Message`, `massive.ts:35` reads `status`, `openbb.ts:51` reads `ok`,
 * `firecrawl.ts:111` reads `success`, `fmp.ts:65` indexes `rows[0]`,
 * `tiingo.ts:147` reads `priceData`. Every check below asserts something the
 * normaliser beside it would otherwise assume silently.
 *
 * That is a weaker footing than a captured body and it is stated rather than
 * glossed: these are severity `warn` by default, NOT `fatal`. A raw check that
 * fires on a healthy response is worse than no check at all, and until a real
 * body has been through them the honest severity is one that reports without
 * failing anything over. `RAW_CALIBRATED` below records which providers have
 * earned `fatal`, and `tests/raw-contracts-rest-calibration.test.ts` asserts the uncalibrated
 * ones cannot reach it.
 */

import type { Violation } from "@/lib/providers/contracts";
import { fail, isArray, isObject, numericString, type RawContractResult } from "@/lib/providers/raw-contracts";

/**
 * Providers whose predicates have been run against a committed real body.
 *
 * Only these may raise a `fatal` raw violation. The rest report `warn`, which
 * reaches the ledger and the inspector without tripping failover on a shape
 * nobody has actually seen.
 *
 * ── A fixture is a CAPABILITY's body, and this set is per provider ──────────
 * That gap is not cosmetic. Alpha Vantage has a captured quote and a captured
 * daily series, and the same membership promoted its `fundamentals` and `news`
 * predicates to `fatal` against bodies nobody had ever seen — where `OVERVIEW`
 * and `NEWS_SENTIMENT` carry no series key at all, so a healthy answer from a
 * valid key was rejected and the chain failed over. Each predicate below now
 * asserts a shape only for the capabilities it has been held to, and answers
 * the rest with the checks that hold for every endpoint the vendor serves.
 * Widening this set is not the safe operation it looks like.
 */
export const RAW_CALIBRATED: ReadonlySet<string> = new Set([
  // Keyless public market endpoints.
  "binance", "bybit",
  // Alpha Vantage publishes `apikey=demo`, which returns a genuine body for a
  // fixed symbol — the vendor's own credential, not this deployment's.
  "alphavantage",
  // Firecrawl serves an anonymous scrape, so a healthy body needs no key.
  "firecrawl",
  // OpenBB is not a vendor: it is this project's own stateless service, which
  // calls YFinance with `credentials=None` and skips bearer auth when
  // OPENBB_API_TOKEN is empty — so it needs no secret to run and none to
  // capture. `tests/fixtures/raw/openbb/quote.json` is what promotes it.
  "openbb",
]);

/** `warn` unless the provider's checks have been calibrated against a capture. */
export const rawSeverity = (provider: string): Violation["severity"] =>
  RAW_CALIBRATED.has(provider) ? "fatal" : "warn";

const note = (provider: string, check: string, message: string, observed?: string): Violation => ({
  check: `raw.${provider}.${check}`,
  severity: rawSeverity(provider),
  message,
  ...(observed === undefined ? {} : { observed: observed.slice(0, 120) }),
});

/**
 * Alpha Vantage answers a quota refusal with HTTP 200 and prose.
 *
 * `{"Note": "Thank you for using Alpha Vantage! Our standard API call
 * frequency is 5 calls per minute…"}` is a 200 with no data in it. The adapter
 * already throws on it; this check exists so the *ledger* records that the
 * body was an advisory rather than a series, which is the difference between
 * "the provider is rate limiting us" and "the provider returned nothing".
 */
export function checkAlphaVantageRaw(body: unknown, capability: string): RawContractResult {
  const violations: Violation[] = [];
  if (!isObject(body)) {
    violations.push(note("alphavantage", "envelope", "expected a JSON object"));
    return fail("alphavantage", capability, violations);
  }
  for (const key of ["Note", "Information", "Error Message"]) {
    const value = body[key];
    if (typeof value === "string" && value.trim() !== "") {
      violations.push(note("alphavantage", "advisory", `${key} in place of data`, value));
      return fail("alphavantage", capability, violations);
    }
  }
  // The series contract describes the PRICE endpoints, and only those. The
  // same vendor, the same envelope and the same key answers `OVERVIEW` with a
  // flat row of `Symbol`/`Name`/`Sector` and `NEWS_SENTIMENT` with
  // `{items, feed: [...]}` — neither carries a series key, and neither ever
  // will. Demanding one of them rejected a healthy body at `fatal`, which
  // failed the provider, counted a breaker failure and moved the chain on:
  // exactly the "the key is fine and the provider is broken" case.
  //
  // The two committed fixtures are a quote and a daily series. Those are the
  // capabilities this predicate has been held to, so those are the ones it
  // asserts a shape for.
  if (capability !== "quote" && capability !== "bars") {
    const feed = body["feed"];
    if (feed !== undefined && !isArray(feed)) {
      violations.push(note("alphavantage", "feed-type", "feed is present and not an array"));
    }
    return fail("alphavantage", capability, violations);
  }
  const seriesKey = Object.keys(body).find((k) => k.startsWith("Time Series") || k === "Global Quote");
  if (!seriesKey) {
    violations.push(note(
      "alphavantage", "series-missing",
      "no 'Time Series …' or 'Global Quote' key",
      Object.keys(body).join(","),
    ));
    return fail("alphavantage", capability, violations);
  }
  const series = body[seriesKey];
  if (!isObject(series)) {
    violations.push(note("alphavantage", "series-shape", `${seriesKey} is not an object`));
    return fail("alphavantage", capability, violations);
  }
  // The numbered field names ("1. open", "01. symbol") are the format's most
  // breakable part: they are positional labels inside string keys, and a
  // renamed one normalises to undefined rather than raising.
  //
  // The two endpoints nest differently, which the committed fixtures are what
  // revealed. "Time Series (Daily)" maps a DATE to a row of numbered fields;
  // "Global Quote" carries the numbered fields directly. The first version of
  // this check looked one level down unconditionally, so on a quote it landed
  // on the symbol string, failed `isObject`, and skipped silently — a gap that
  // reads as a pass.
  const row = seriesKey === "Global Quote" ? series : Object.values(series)[0];
  // A non-empty row, because an EMPTY one is the vendor's honest "no such
  // symbol" (`{"Global Quote": {}}`) rather than a renamed field set, and the
  // adapter already answers that with a 404.
  if (row !== undefined && isObject(row) && Object.keys(row).length > 0) {
    const numbered = Object.keys(row).filter((k) => /^\d+\.\s/.test(k));
    if (numbered.length === 0) {
      violations.push(note(
        "alphavantage", "numbered-fields",
        "row fields are not the numbered '1. open' form",
        Object.keys(row).join(","),
      ));
    }
  }
  return fail("alphavantage", capability, violations);
}

/** Massive: `{status, results: [...]}`, where `status` carries the refusal. */
export function checkMassiveRaw(body: unknown, capability: string): RawContractResult {
  const violations: Violation[] = [];
  if (!isObject(body)) {
    violations.push(note("massive", "envelope", "expected a JSON object"));
    return fail("massive", capability, violations);
  }
  const status = body["status"];
  if (status !== undefined && typeof status !== "string") {
    violations.push(note("massive", "status-type", "status is not a string"));
  }
  if (status === "NOT_AUTHORIZED" || status === "ERROR") {
    // Not a shape violation — the vendor declining. Recorded so the ledger can
    // tell a refusal from an empty result, which the normaliser cannot.
    violations.push(note("massive", "declined", `status=${String(status)}`, String(body["error"] ?? body["message"] ?? "")));
    return fail("massive", capability, violations);
  }
  const results = body["results"];
  if (results !== undefined) {
    // Massive answers `results` with a LIST for aggregates and news and with a
    // single OBJECT for `/v3/reference/tickers/{t}` — which is why
    // `massive.ts:170` reads it with `obj()` there and `arr()` everywhere
    // else. Requiring an array unconditionally fired on every healthy
    // reference row, so each fundamentals lookup quarantined a good payload
    // and wrote a warning against a provider that had done nothing wrong.
    const wantsList = capability !== "fundamentals";
    if (wantsList && !isArray(results)) {
      violations.push(note("massive", "results-type", "results is present and not an array"));
    } else if (!wantsList && !isObject(results)) {
      violations.push(note("massive", "results-type", "results is present and not an object"));
    }
  }
  return fail("massive", capability, violations);
}

/**
 * OpenBB service: `{ok: boolean, data: …}` — our own service, so the envelope
 * is ours and a change in it is a change we made to ourselves.
 *
 * `ok` carries everything, because the status line carries nothing: the service
 * answers a downstream outage with HTTP **200** and `{ok:false, error}`, so a
 * rate limit, a delisted symbol and a working call are the same status code.
 * Kept that way deliberately — the argument, and the list of everything that
 * must therefore read `ok`, are in `OpenBB_Service/README.md`. This is the
 * reader of last resort: `ok-missing` fires at the gate and fails the contract
 * even though the adapter beside it would have carried on.
 *
 * Calibrated against `tests/fixtures/raw/openbb/quote.json` and against live
 * bodies from all four routes, which is what earns it `fatal`: quote and
 * fundamentals send `data` as an object, bars and news as an array, and none
 * of the four omits it.
 */
export function checkOpenBBRaw(body: unknown, capability: string): RawContractResult {
  const violations: Violation[] = [];
  if (!isObject(body)) {
    violations.push(note("openbb", "envelope", "expected a JSON object"));
    return fail("openbb", capability, violations);
  }
  if (typeof body["ok"] !== "boolean") {
    violations.push(note("openbb", "ok-missing", "no boolean `ok` in the service envelope"));
    return fail("openbb", capability, violations);
  }
  if (body["ok"] === false) {
    // Not a shape violation — the service declining on a 200, the same way
    // Massive's `status` and Bybit's `retCode` do. On the live dispatch path
    // `openbb.ts`'s `assertOk` throws before this reaches the ledger, and that
    // is correct: it has the richer signal there (`no_data` versus `failed`,
    // read off the message). Recorded anyway, because `checkRawBody` is the
    // entry point the inspector and the tests read, and a predicate silent on
    // the only body this service sends when something is wrong would describe
    // half its envelope.
    const error = body["error"];
    violations.push(note(
      "openbb", "declined", "ok:false on HTTP 200",
      typeof error === "string" ? error : "",
    ));
    if (typeof error !== "string") {
      violations.push(note("openbb", "error-missing", "ok:false with no error string"));
    }
    return fail("openbb", capability, violations);
  }
  const data = body["data"];
  if (!isObject(data) && !isArray(data)) {
    violations.push(note(
      "openbb", "data-missing", "ok:true with no data object or array",
      Object.keys(body).join(","),
    ));
  }
  return fail("openbb", capability, violations);
}

/** The text fields `toDocument` reads; one of them is what makes a row usable. */
const readable = (node: Record<string, unknown>): boolean =>
  ["markdown", "content", "description"].some((k) => typeof node[k] === "string");

/** Firecrawl: `{success: boolean, data: {...}}`. */
export function checkFirecrawlRaw(body: unknown, capability: string): RawContractResult {
  const violations: Violation[] = [];
  if (!isObject(body)) {
    violations.push(note("firecrawl", "envelope", "expected a JSON object"));
    return fail("firecrawl", capability, violations);
  }
  if (typeof body["success"] !== "boolean") {
    violations.push(note("firecrawl", "success-missing", "no boolean `success`"));
  }
  if (body["success"] === true) {
    const data = body["data"];
    if (!isObject(data) && !isArray(data)) {
      violations.push(note("firecrawl", "data-shape", "success:true with no data object or array"));
    } else if (isObject(data) && !readable(data)) {
      // A scrape returns the document directly under `data`; a v2 search
      // groups its rows by source (`data.web`), where v1 returned a flat
      // array. `firecrawl.ts:117` reads both, so this must too — checking the
      // CONTAINER for markdown reported "no readable content" against a search
      // body that carried a document in every row.
      const grouped = Object.values(data).find(isArray);
      if (grouped === undefined) {
        violations.push(note(
          "firecrawl", "content-missing",
          "no markdown, content or description on the scrape",
          Object.keys(data).join(","),
        ));
      } else if (grouped.length > 0 && !(isObject(grouped[0]) && readable(grouped[0]))) {
        // An empty group is an answer — no results — and not a broken shape.
        violations.push(note(
          "firecrawl", "content-missing",
          "no markdown, content or description on the first result",
          isObject(grouped[0]) ? Object.keys(grouped[0]).join(",") : typeof grouped[0],
        ));
      }
    }
  }
  return fail("firecrawl", capability, violations);
}

/** FMP: a bare array of row objects. An object here means an error envelope. */
export function checkFmpRaw(body: unknown, capability: string): RawContractResult {
  const violations: Violation[] = [];
  if (isObject(body)) {
    const message = body["Error Message"] ?? body["error"] ?? body["message"];
    violations.push(note(
      "fmp", "error-envelope",
      "an object where an array of rows was expected",
      typeof message === "string" ? message : Object.keys(body).join(","),
    ));
    return fail("fmp", capability, violations);
  }
  if (!isArray(body)) {
    violations.push(note("fmp", "envelope", "expected an array of rows"));
    return fail("fmp", capability, violations);
  }
  if (body.length > 0 && !isObject(body[0])) {
    violations.push(note("fmp", "row-shape", "rows are not objects"));
  }
  return fail("fmp", capability, violations);
}

/**
 * Tiingo: an array, whose row shape differs by endpoint.
 *
 * Crypto rows carry `priceData`, IEX rows carry `topOfBookData` or a flat
 * `last`. Both are indexed positionally by the adapter (`rows[0]`), so an
 * empty array normalises to undefined fields rather than raising.
 */
export function checkTiingoRaw(body: unknown, capability: string): RawContractResult {
  const violations: Violation[] = [];
  if (isObject(body)) {
    const detail = body["detail"] ?? body["error"];
    violations.push(note(
      "tiingo", "error-envelope",
      "an object where an array was expected",
      typeof detail === "string" ? detail : Object.keys(body).join(","),
    ));
    return fail("tiingo", capability, violations);
  }
  if (!isArray(body)) {
    violations.push(note("tiingo", "envelope", "expected an array"));
    return fail("tiingo", capability, violations);
  }
  if (body.length === 0) return fail("tiingo", capability, violations);
  const first = body[0];
  if (!isObject(first)) {
    violations.push(note("tiingo", "row-shape", "rows are not objects"));
    return fail("tiingo", capability, violations);
  }
  if (capability === "news") {
    // A news row is not a price row. `/tiingo/news` answers
    // `{id, title, url, description, publishedDate, source, tickers}`, so
    // demanding `priceData` on it fired on every healthy story list. What the
    // adapter actually depends on is `url` and `title`: `tiingo.ts:202` drops
    // any row missing either, so a rename empties the feed silently instead of
    // raising, which is the failure worth a check here.
    if (typeof first["url"] !== "string" || typeof first["title"] !== "string") {
      violations.push(note(
        "tiingo", "news-fields",
        "no url and title on the first story",
        Object.keys(first).join(","),
      ));
    }
    return fail("tiingo", capability, violations);
  }
  const known = ["priceData", "topOfBookData", "last", "close", "tngoLast"];
  if (!known.some((k) => k in first)) {
    violations.push(note(
      "tiingo", "row-fields",
      "no priceData, topOfBookData or price field on the first row",
      Object.keys(first).join(","),
    ));
  }
  const prices = first["priceData"];
  if (prices !== undefined && !isArray(prices)) {
    violations.push(note("tiingo", "pricedata-type", "priceData is present and not an array"));
  }
  if (isArray(prices) && prices.length > 0 && isObject(prices[0])) {
    const row = prices[0];
    for (const field of ["open", "high", "low", "close"]) {
      const value = row[field];
      if (value !== undefined && typeof value !== "number" && !numericString(value)) {
        violations.push(note("tiingo", `${field}-type`, `${field} is neither a number nor a numeric string`));
      }
    }
  }
  return fail("tiingo", capability, violations);
}
