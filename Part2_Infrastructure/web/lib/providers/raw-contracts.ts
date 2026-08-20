/**
 * What a vendor's RAW response has to look like, before anything normalises it.
 *
 * `contracts.ts` validates the normalised shape — `Quote`, `OhlcvBar[]` — which
 * is the shape this app chose. It cannot catch a vendor that changed its own
 * shape, because by the time it runs the adapter has already coerced whatever
 * arrived into something plausible. A field that silently became a string, an
 * array that gained a wrapper, a status code moved into the body: all of those
 * reach the normalised checks as a missing value or a NaN, if they reach them
 * at all.
 *
 * These are hand-written predicates rather than a schema library. `package.json`
 * carries six dependencies and CLAUDE.md's first house rule is that it stays
 * that way; zod or ajv would be a seventh for something a dozen readable
 * functions do.
 *
 * **Two providers, not eight, and the reason is fixtures.** A validator with no
 * corpus is untested code running in the fetch path, so a provider is only
 * covered here once a real response from it is committed under
 * `tests/fixtures/raw/`. Binance and Bybit serve their market endpoints
 * without credentials, so their fixtures can be captured and refreshed by
 * anyone. The other six need an API key, and a body captured with one has to be
 * read by a person for account identifiers before it is committed. Adding them
 * is `scripts/capture-provider-fixtures.mjs` plus a predicate, in that order.
 */

import type { Violation } from "@/lib/providers/contracts";

/** A raw check names the provider and the endpoint, so a violation is findable. */
export interface RawContractResult {
  provider: string;
  capability: string;
  passed: boolean;
  violations: Violation[];
}

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A number the vendor sent as a string — the most common quiet vendor change. */
const numericString = (value: unknown): boolean =>
  typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));

const fail = (
  provider: string, capability: string, violations: Violation[],
): RawContractResult => ({
  provider, capability, passed: violations.length === 0, violations,
});

/**
 * Binance klines: a bare array of 12-element arrays.
 *
 * Positional, which is what makes it worth checking: a reordered or shortened
 * tuple normalises into plausible-looking bars with the wrong fields in them,
 * and nothing downstream can tell.
 */
export function checkBinanceKlinesRaw(body: unknown): RawContractResult {
  const violations: Violation[] = [];
  if (!isArray(body)) {
    violations.push({
      check: "raw.binance.bars.is_array",
      severity: "fatal",
      message: "klines did not arrive as an array",
      observed: typeof body,
    });
    return fail("binance", "bars", violations);
  }
  for (const [index, row] of body.entries()) {
    if (!isArray(row) || row.length < 6) {
      violations.push({
        check: "raw.binance.bars.row_shape",
        severity: "fatal",
        message: `row ${index} is not a kline tuple of at least 6 fields`,
        observed: isArray(row) ? row.length : typeof row,
      });
      break;
    }
    if (typeof row[0] !== "number") {
      violations.push({
        check: "raw.binance.bars.open_time_numeric",
        severity: "fatal",
        message: `row ${index} open time is ${typeof row[0]}, not a number`,
        observed: String(row[0]),
      });
      break;
    }
    // Binance sends OHLCV as decimal STRINGS. If they ever become numbers the
    // parse still works, so this is drift rather than breakage — but it is
    // drift worth seeing before it is a rounding difference nobody can source.
    for (const [offset, name] of [[1, "open"], [2, "high"], [3, "low"], [4, "close"], [5, "volume"]] as const) {
      if (!numericString(row[offset])) {
        violations.push({
          check: "raw.binance.bars.decimal_strings",
          severity: typeof row[offset] === "number" ? "drift" : "fatal",
          message: `row ${index} ${name} is ${typeof row[offset]}, not a decimal string`,
          observed: String(row[offset]),
        });
        break;
      }
    }
    if (violations.length) break;
  }
  return fail("binance", "bars", violations);
}

/** Binance 24h ticker: one object, decimal strings throughout. */
export function checkBinanceTickerRaw(body: unknown): RawContractResult {
  const violations: Violation[] = [];
  if (!isObject(body)) {
    violations.push({
      check: "raw.binance.quote.is_object",
      severity: "fatal",
      message: "the ticker did not arrive as an object",
      observed: typeof body,
    });
    return fail("binance", "quote", violations);
  }
  for (const field of ["symbol", "lastPrice", "highPrice", "lowPrice", "volume", "priceChangePercent"]) {
    if (!(field in body)) {
      violations.push({
        check: "raw.binance.quote.fields_present",
        severity: "fatal",
        message: `the ticker has no ${field}`,
      });
    }
  }
  for (const field of ["lastPrice", "highPrice", "lowPrice", "volume", "priceChangePercent"]) {
    if (field in body && !numericString(body[field])) {
      violations.push({
        check: "raw.binance.quote.decimal_strings",
        severity: "fatal",
        message: `${field} is ${typeof body[field]}, not a decimal string`,
        observed: String(body[field]),
      });
    }
  }
  return fail("binance", "quote", violations);
}

/**
 * Bybit v5: every response is enveloped, and the envelope carries the error.
 *
 * `retCode` is the one that matters. Bybit answers HTTP 200 with a non-zero
 * `retCode` for a refused request, so a client that trusts the status code
 * reads a failure as an empty result — which is the exact "unavailable looks
 * like empty" defect this codebase refuses everywhere else.
 */
export function checkBybitEnvelopeRaw(body: unknown, capability: string): RawContractResult {
  const violations: Violation[] = [];
  if (!isObject(body)) {
    violations.push({
      check: "raw.bybit.envelope.is_object",
      severity: "fatal",
      message: "the response did not arrive as an object",
      observed: typeof body,
    });
    return fail("bybit", capability, violations);
  }
  if (typeof body.retCode !== "number") {
    violations.push({
      check: "raw.bybit.envelope.ret_code",
      severity: "fatal",
      message: "the envelope carries no numeric retCode, so a refusal cannot be told from an empty result",
      observed: String(body.retCode),
    });
  } else if (body.retCode !== 0) {
    violations.push({
      check: "raw.bybit.envelope.ret_code_ok",
      severity: "fatal",
      message: `retCode ${body.retCode}: ${String(body.retMsg ?? "no message")}`,
      observed: body.retCode,
    });
  }
  if (!isObject(body.result)) {
    violations.push({
      check: "raw.bybit.envelope.result_object",
      severity: "fatal",
      message: "the envelope has no result object",
      observed: typeof body.result,
    });
    return fail("bybit", capability, violations);
  }
  const list = (body.result as Record<string, unknown>).list;
  if (!isArray(list)) {
    violations.push({
      check: "raw.bybit.envelope.result_list",
      severity: "fatal",
      message: "result.list is not an array",
      observed: typeof list,
    });
  }
  return fail("bybit", capability, violations);
}

/** Bybit klines: newest-first tuples of decimal strings inside the envelope. */
export function checkBybitKlinesRaw(body: unknown): RawContractResult {
  const envelope = checkBybitEnvelopeRaw(body, "bars");
  if (!envelope.passed) return envelope;

  const violations: Violation[] = [];
  const list = ((body as Record<string, unknown>).result as Record<string, unknown>).list as unknown[];
  for (const [index, row] of list.entries()) {
    if (!isArray(row) || row.length < 6) {
      violations.push({
        check: "raw.bybit.bars.row_shape",
        severity: "fatal",
        message: `row ${index} is not a kline tuple of at least 6 fields`,
        observed: isArray(row) ? row.length : typeof row,
      });
      break;
    }
    if (!row.slice(0, 6).every(numericString)) {
      violations.push({
        check: "raw.bybit.bars.decimal_strings",
        severity: "fatal",
        message: `row ${index} is not six decimal strings`,
        observed: JSON.stringify(row.slice(0, 6)),
      });
      break;
    }
  }
  return fail("bybit", "bars", violations);
}
