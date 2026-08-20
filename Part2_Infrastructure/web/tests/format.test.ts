import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { constraintLabel, formatDuration, trackRecordNote } from "../lib/format";
import { BARS_PER_YEAR } from "../lib/types";

describe("trackRecordNote", () => {
  it("met case reports the requirement as satisfied", () => {
    const out = trackRecordNote(1240, 2000, "4h");
    assert.equal(out.met, true);
    assert.ok(out.note.startsWith("met — "));
    assert.ok(out.note.includes("1,240"));
    assert.ok(out.note.includes("2,000"));
    // 1240 bars of 4h ≈ 0.57 yr → months formatting.
    assert.ok(Math.abs(1240 / BARS_PER_YEAR["4h"] - 0.566) < 0.01);
    assert.ok(out.value.includes("mo"));
  });

  it("deficit case reports both counts and is not met", () => {
    const out = trackRecordNote(6766, 2000, "4h");
    assert.equal(out.met, false);
    assert.ok(!out.note.startsWith("met"));
    assert.ok(out.note.includes("6,766"));
    assert.ok(out.note.includes("2,000"));
    // 6766 / 2190 ≈ 3.1 yr.
    assert.equal(out.value, "~3.1 yr");
  });

  it("null means no finite record proves the edge", () => {
    const out = trackRecordNote(null, 2000, "4h");
    assert.equal(out.value, "—");
    assert.equal(out.met, null);
    assert.ok(out.note.includes("no finite record"));
  });

  it("unknown intervals fall back to bar counts", () => {
    const out = trackRecordNote(500, 100, "3h");
    assert.equal(out.value, "500 bars");
    assert.equal(out.met, false);
  });
});

describe("formatDuration", () => {
  // The formatter joins number and unit with U+00A0 so a cell never splits them.
  const d = (n: string, unit: string) => `${n}\u00A0${unit}`;

  it("null, undefined, NaN and negatives dash — never a zero from an absence", () => {
    for (const absent of [null, undefined, Number.NaN, -1]) {
      assert.equal(formatDuration(absent), "—");
    }
  });

  it("picks the unit by magnitude", () => {
    assert.equal(formatDuration(0), d("0", "ns"));
    assert.equal(formatDuration(420), d("420", "ns"));
    assert.equal(formatDuration(999), d("999", "ns"));
    assert.equal(formatDuration(1000), d("1.00", "µs"));
    assert.equal(formatDuration(18_400), d("18.4", "µs"));
    assert.equal(formatDuration(61_600), d("61.6", "µs"));
    assert.equal(formatDuration(420_000), d("420", "µs"));
    assert.equal(formatDuration(1_000_000), d("1.00", "ms"));
    assert.equal(formatDuration(23_400_000), d("23.4", "ms"));
    assert.equal(formatDuration(888_000_000), d("888", "ms"));
    assert.equal(formatDuration(1_200_000_000), d("1.20", "s"));
  });

  it("rounds up across a unit boundary rather than printing 1000", () => {
    assert.equal(formatDuration(999_600), d("1.00", "ms"));
    assert.equal(formatDuration(999.5), d("1.00", "µs"));
    assert.equal(formatDuration(9_995), d("10.0", "µs"));
    assert.equal(formatDuration(99_950), d("100", "µs"));
  });

  it("converts from the wire's ms and the gateway's µs", () => {
    assert.equal(formatDuration(0.21, "ms"), d("210", "µs"));
    assert.equal(formatDuration(80, "us"), d("80.0", "µs"));
    assert.equal(formatDuration(24, "ms"), d("24.0", "ms"));
    assert.equal(formatDuration(1200, "ms"), d("1.20", "s"));
  });

  it("uses U+00B5 MICRO SIGN, never Greek mu", () => {
    assert.equal(formatDuration(18_400), "18.4\u00A0\u00B5s");
    assert.doesNotMatch(formatDuration(18_400), /\u03BC/);
  });

  it("never emits '1000' at any ticker intermediate", () => {
    for (let ns = 1; ns < 2e9; ns *= 1.07) {
      const out = formatDuration(ns);
      assert.doesNotMatch(out, /\b1000\b/, `${ns} rendered as ${out}`);
    }
  });
});

describe("constraintLabel", () => {
  it("speaks the gateway's qualified symbol constraint as a label", () => {
    // The screenshotted defect: the KPI card read "symbol:AVGO" verbatim.
    assert.equal(constraintLabel("symbol:AVGO"), "Symbol: AVGO");
    assert.equal(constraintLabel("symbol:BTCUSDT"), "Symbol: BTCUSDT");
  });

  it("capitalises bare kinds and speaks their underscores as spaces", () => {
    // Every kind the gateway or the sandbox book actually emits.
    assert.equal(constraintLabel("gross_exposure"), "Gross exposure");
    assert.equal(constraintLabel("daily_drawdown"), "Daily drawdown");
    assert.equal(constraintLabel("symbol_exposure"), "Symbol exposure");
  });

  it("renders a kind it has never seen rather than dashing the fact", () => {
    assert.equal(constraintLabel("leverage"), "Leverage");
    assert.equal(constraintLabel("per_order:ORD-1"), "Per order: ORD-1");
  });

  it("keeps the identifier after the colon verbatim — it is the fact", () => {
    assert.equal(constraintLabel("symbol:brk.b"), "Symbol: brk.b");
  });

  it("an absence is a dash, never an empty label", () => {
    assert.equal(constraintLabel(null), "—");
    assert.equal(constraintLabel(undefined), "—");
    assert.equal(constraintLabel(""), "—");
    assert.equal(constraintLabel("   "), "—");
  });
});
