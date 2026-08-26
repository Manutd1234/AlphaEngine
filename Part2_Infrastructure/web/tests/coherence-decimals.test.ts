/**
 * The one decimal, the one count and the one span — unit-tested, because every
 * number a reader meets on the engine tabs now passes through here.
 *
 * The two behaviours the merged `decimalLabel` carries were each right in the
 * file that had them and wrong to be separate: padding (a column of
 * twenty-eight-place statistics lines up) and the cut mark (a four-place print
 * of one of them is not the whole). Both are pinned; so is the dash on
 * everything that is not a decimal, which is what stops "we do not know" from
 * printing as a number.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countLabel, decimalLabel, probLabel, secondsLabel, statValue, toUnit, truncateDecimal, unitOf,
} from "../lib/coherence/decimals";

describe("decimalLabel pads to the places asked for and says when a digit was cut", () => {
  it("cuts a long statistic and marks the cut", () => {
    assert.equal(decimalLabel("1.599804675577615631316479364", 4), "1.5998…");
    assert.equal(decimalLabel("0.00010533", 4), "0.0001…");
  });
  it("pads a short wire decimal so the column lines up, with no mark", () => {
    assert.equal(decimalLabel("0.05", 4), "0.0500");
    assert.equal(decimalLabel("1", 2), "1.00");
  });
  it("cuts trailing zeros without a mark — nothing was lost", () => {
    assert.equal(decimalLabel("0.0500", 2), "0.05");
    assert.equal(decimalLabel("0.100000", 4), "0.1000");
  });
  it("keeps the sign as sent and never invents one", () => {
    assert.equal(decimalLabel("-0.0210", 4), "-0.0210");
    assert.equal(decimalLabel("0.0210", 4), "0.0210");
  });
  it("is a dash on null, empty, a bare minus, or words", () => {
    for (const raw of [null, undefined, "", "-", "abc", "1e-9"]) assert.equal(decimalLabel(raw as never, 4), "—");
  });
  it("truncateDecimal is the same cut without the print", () => {
    assert.equal(truncateDecimal("0.123456", 4), "0.1234");
    assert.equal(truncateDecimal(".5", 2), "0.50");
    assert.equal(truncateDecimal("7", 0), "7");
    assert.equal(truncateDecimal("x", 2), null);
  });
});

describe("the geometry readers are floats and say so by their names", () => {
  it("statValue reads a plain decimal and refuses anything else", () => {
    assert.equal(statValue("0.25"), 0.25);
    assert.equal(statValue(" .5 "), 0.5);
    assert.equal(statValue("1e3"), null);
    assert.equal(statValue(null), null);
  });
  it("unitOf goes through the centicent tick", () => {
    assert.equal(unitOf("0.4700"), 0.47);
    assert.equal(unitOf("0.47001"), 0.47);
    assert.equal(unitOf(null), null);
  });
  it("toUnit keeps six places of a product the wire never rounded", () => {
    assert.equal(toUnit("0.1234567890"), 0.123456);
    assert.equal(toUnit("-0.5"), -0.5);
    assert.equal(toUnit(""), null);
  });
  it("probLabel is exact when the wire is exact and marked ≈ when it is not", () => {
    assert.equal(probLabel("0.4700"), "0.4700");
    assert.equal(probLabel("0.123456789"), "≈0.1235");
    assert.equal(probLabel(null), "—");
  });
});

describe("countLabel groups digits and never rounds", () => {
  it("prints a count, grouped", () => {
    assert.equal(countLabel(0), "0");
    assert.equal(countLabel(641674), "641,674");
    assert.equal(countLabel(1234567.28), "1,234,567.28");
  });
  it("is a dash on null and on a non-number", () => {
    assert.equal(countLabel(null), "—");
    assert.equal(countLabel(undefined), "—");
    assert.equal(countLabel(Number.NaN), "—");
  });
});

describe("secondsLabel picks the two units that describe the span", () => {
  it("walks the ladder", () => {
    assert.equal(secondsLabel(0), "0s");
    assert.equal(secondsLabel(59), "59s");
    assert.equal(secondsLabel(60), "1m 0s");
    assert.equal(secondsLabel(200), "3m 20s");
    assert.equal(secondsLabel(3600), "1h 0m");
    assert.equal(secondsLabel(7800), "2h 10m");
    assert.equal(secondsLabel(90000), "1d 1h");
  });
  it("is a dash on null, and floors a fraction rather than rounding it up", () => {
    assert.equal(secondsLabel(null), "—");
    assert.equal(secondsLabel(59.9), "59s");
  });
});
