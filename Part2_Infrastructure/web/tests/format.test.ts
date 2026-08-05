import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { trackRecordNote } from "../lib/format";
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
