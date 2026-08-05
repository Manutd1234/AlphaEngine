/**
 * CSV escaping is the kind of thing that looks right until a reject reason
 * contains a comma and a spreadsheet silently gains a column. These pin the
 * RFC-4180 rules and the column contract the blotter table implies.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BLOTTER_CSV_COLUMNS, blotterToCsv, toCsv } from "../lib/export-csv";
import { sandboxBlotter, type BlotterRow } from "../lib/blotter";

describe("toCsv", () => {
  it("quotes only what needs quoting, and doubles inner quotes", () => {
    const csv = toCsv(["a", "b"], [["plain", 'has "quotes"'], ["has,comma", "has\nnewline"]]);
    const lines = csv.split("\r\n");
    assert.equal(lines[0], "a,b");
    assert.equal(lines[1], 'plain,"has ""quotes"""');
    assert.ok(lines[2].startsWith('"has,comma","has'));
  });

  it("writes absent values as empty cells, never a placeholder", () => {
    const csv = toCsv(["a", "b", "c"], [[null, undefined, 0]]);
    assert.equal(csv.split("\r\n")[1], ",,0");
  });

  it("keeps full numeric precision — display rounding is the table's job", () => {
    const csv = toCsv(["v"], [[0.123456789012]]);
    assert.ok(csv.includes("0.123456789012"));
  });

  it("preserves surrounding whitespace and joins rows with CRLF", () => {
    const csv = toCsv(["a"], [["  padded  "], ["x"]]);
    assert.equal(csv, "a\r\n  padded  \r\nx");
    assert.ok(!csv.endsWith("\r\n"), "no trailing newline");
  });

  it("handles CRLF inside a cell without breaking the row", () => {
    const csv = toCsv(["a", "b"], [["line1\r\nline2", "next"]]);
    assert.ok(csv.includes('"line1\r\nline2"'));
  });
});

describe("blotterToCsv", () => {
  const rows = sandboxBlotter(Date.parse("2026-08-04T12:00:00Z"));

  it("pins the column contract", () => {
    assert.equal(
      blotterToCsv(rows).split("\r\n")[0],
      "ts,symbol,side,notional,venue,fill_price,slippage_bps,latency_ms,verdict,strategy,"
      + "order_id,client_order_id,rejected_by,reason,fee_usd,quantity,order_type,source",
    );
    assert.equal(BLOTTER_CSV_COLUMNS.length, 18);
  });

  it("emits one line per row plus the header", () => {
    const csv = blotterToCsv(rows);
    assert.equal(csv.split("\r\n").length, rows.length + 1);
  });

  it("quotes a multi-gate rejection so the commas stay inside one cell", () => {
    const row: BlotterRow = {
      ...rows[0],
      accepted: false,
      rejectedBy: ["max_order_notional", "gross_exposure"],
      reason: "rejected by max_order_notional, gross_exposure",
    };
    const line = blotterToCsv([row]).split("\r\n")[1];
    assert.ok(line.includes('"max_order_notional,gross_exposure"'));
    assert.ok(line.includes("rejected"), "verdict column reads rejected");
  });

  it("a filled row reads as filled and carries its measurements", () => {
    const filled = rows.find((r) => r.accepted)!;
    const line = blotterToCsv([filled]).split("\r\n")[1];
    assert.ok(line.includes("filled"));
    assert.ok(line.includes(filled.symbol));
  });
});
