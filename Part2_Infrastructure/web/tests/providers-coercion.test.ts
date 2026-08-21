/**
 * The coercion funnel — every vendor spelling of "missing" becomes null.
 *
 * Nothing here touches the network. Vendors disagree about how to say they have
 * no value: "None", "-", "N/A", the empty string, a NaN that survived a
 * division, an object where a number was promised. The funnel's whole job is to
 * turn all of them into null and never into 0, because a zero price or a zero
 * percent change is a plausible answer from the wrong place — the expensive
 * kind of bug, since nothing crashes and the number renders.
 *
 * The timestamp cases are the same argument in another currency. An epoch read
 * in the wrong unit lands in 1970, and a bare date read as local midnight
 * shifts an entire series by the operator's offset; both still render.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { iso, num, pctChange, str } from "../lib/providers/parse";

test("num: vendor missing-value spellings become null, never NaN or 0", () => {
  for (const v of ["None", "", "-", "N/A", "null", undefined, null, {}, []]) {
    assert.equal(num(v), null, `num(${JSON.stringify(v)})`);
  }
  assert.equal(num("1,234.5"), 1234.5); // thousands separator in vendor JSON
  assert.equal(num("1.23%"), 1.23);     // Alpha Vantage percent string
  assert.equal(num(NaN), null);
  assert.equal(num(Infinity), null);
});

test("iso: epoch seconds vs ms boundary, AV compact stamps, bare dates as UTC", () => {
  // Epoch seconds and ms for the same instant resolve identically.
  assert.equal(iso(1717200000), iso(1717200000000));
  // Alpha Vantage's 20240102T120000 — new Date() would give Invalid Date.
  assert.equal(iso("20240102T120000"), "2024-01-02T12:00:00.000Z");
  // A bare date is midnight UTC, not local — mixing shifts a series by the offset.
  assert.equal(iso("2024-01-02"), "2024-01-02T00:00:00.000Z");
  assert.equal(iso("garbage"), null);
});

test("pctChange guards the zero denominator", () => {
  assert.equal(pctChange(100, 0), null); // halted placeholder row, not −∞
  assert.ok(Math.abs((pctChange(110, 100) ?? 0) - 10) < 1e-9);
  assert.equal(pctChange(null, 100), null);
});

test("str treats sentinel strings as absent", () => {
  assert.equal(str("None"), null);
  assert.equal(str("  AAPL  "), "AAPL");
});
