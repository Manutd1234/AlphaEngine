/**
 * Three views over the blotter, and the gap that made one of them necessary.
 *
 * `rejected` keys off `!accepted`, which EXCLUDES a CANCELLED or EXPIRED order —
 * one the gate accepted and that then never filled. So the question "why is
 * there no fill" had no expressible answer: refusals were one filter and
 * cancellations were in none of them. `unfilled` closes that, and the tests
 * below pin it as the exact complement of `accepted` rather than as a third
 * overlapping bucket.
 *
 * Search is pinned to string fields on purpose. A numeric match would let
 * "500000" hit a fee, an order id and a timestamp, and a filter that quietly
 * means something other than what it says is worse than no filter at all.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  UNTAGGED,
  filterBlotterRows,
  filterWorkingOrders,
  rejectGateTags,
  sandboxBlotter,
  sandboxWorkingOrders,
  type BlotterRow,
} from "../lib/blotter";
import { WORKING_ORDER_CSV_COLUMNS, workingOrdersToCsv } from "../lib/export-csv";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const row = (over: Partial<BlotterRow> = {}): BlotterRow => ({
  ts: "2026-01-01T00:00:00Z", orderId: "ORD-1", clientOrderId: null, strategy: "ma_cross",
  symbol: "BTCUSDT", side: "BUY", orderType: "MARKET", quantity: 1, notional: 100_000,
  accepted: true, rejectedBy: [], reason: null, latencyMs: 0.2, fillPrice: 100,
  feeUsd: 60, slippageBps: 4, venue: "BINANCE", source: "gateway",
  status: "FILLED", timeInForce: "IOC", checks: [], ...over,
});

const opts = (over: Partial<Parameters<typeof filterBlotterRows>[1]> = {}) => ({
  status: "all" as const, focusSymbol: "BTCUSDT", strategy: null, ...over,
});

describe("filled and unfilled partition the window exactly", () => {
  const rows = sandboxBlotter();

  it("are complements, and together account for every row", () => {
    const filled = filterBlotterRows(rows, opts({ status: "accepted" }));
    const unfilled = filterBlotterRows(rows, opts({ status: "unfilled" }));
    assert.equal(filled.length + unfilled.length, rows.length);
    const ids = new Set(filled.map((r) => r.orderId));
    assert.ok(unfilled.every((r) => !ids.has(r.orderId)), "the two views overlap");
  });

  it("catches the cancelled order that `rejected` misses", () => {
    /**
     * The exact gap this view exists to close: accepted by the gate, never
     * filled. It is not a refusal, so `rejected` does not see it, and it is not
     * a fill, so the desk had no view that showed it at all.
     */
    const cancelled = row({ status: "CANCELLED", accepted: true, fillPrice: null });
    const rows = [row(), cancelled];
    assert.equal(filterBlotterRows(rows, opts({ status: "rejected" })).length, 0);
    const unfilled = filterBlotterRows(rows, opts({ status: "unfilled" }));
    assert.equal(unfilled.length, 1);
    assert.equal(unfilled[0].status, "CANCELLED");
  });

  it("keeps expired orders out of the fill count too", () => {
    const rows = [row({ status: "EXPIRED", accepted: true })];
    assert.equal(filterBlotterRows(rows, opts({ status: "accepted" })).length, 0);
    assert.equal(filterBlotterRows(rows, opts({ status: "unfilled" })).length, 1);
  });
});

describe("search matches what a reader can see, and nothing else", () => {
  const rows = [
    row({ orderId: "ORD-AAA", symbol: "BTCUSDT", strategy: "ma_cross", venue: "BINANCE" }),
    row({ orderId: "ORD-BBB", symbol: "ETHUSDT", strategy: "donchian", venue: "BYBIT",
          status: "REJECTED", accepted: false, rejectedBy: ["max_order_notional"] }),
  ];

  it("matches id, symbol, strategy, venue and gate name, case-insensitively", () => {
    for (const [needle, expected] of [
      ["ord-aaa", 1], ["ethusdt", 1], ["donchian", 1], ["binance", 1], ["max_order", 1],
    ] as const) {
      assert.equal(filterBlotterRows(rows, opts({ query: needle })).length, expected, needle);
    }
  });

  it("treats an empty or whitespace query as the identity", () => {
    assert.equal(filterBlotterRows(rows, opts({ query: "" })).length, 2);
    assert.equal(filterBlotterRows(rows, opts({ query: "   " })).length, 2);
  });

  it("returns nothing for a miss rather than everything", () => {
    // The failure mode where a filter silently disables itself is worse than an
    // empty table, because it looks like data.
    assert.equal(filterBlotterRows(rows, opts({ query: "nonesuch" })).length, 0);
  });

  it("does not match numeric fields", () => {
    // Documented behaviour, pinned so it stays deliberate: notional 100000 is
    // present on both rows and must not be searchable.
    assert.equal(filterBlotterRows(rows, opts({ query: "100000" })).length, 0);
  });

  it("composes with status, strategy and gate", () => {
    assert.equal(
      filterBlotterRows(rows, opts({ status: "unfilled", query: "eth" })).length, 1);
    assert.equal(
      filterBlotterRows(rows, opts({ status: "accepted", query: "eth" })).length, 0);
    assert.equal(
      filterBlotterRows(rows, opts({ gate: "max_order_notional" })).length, 1);
    assert.equal(
      filterBlotterRows(rows, opts({ gate: "max_order_notional", query: "btc" })).length, 0);
  });

  it("still honours the untagged sentinel", () => {
    const mixed = [row({ strategy: null }), row({ strategy: "ma_cross" })];
    assert.equal(filterBlotterRows(mixed, opts({ strategy: UNTAGGED })).length, 1);
  });
});

describe("gate codes come from the rows, not from a list", () => {
  it("counts each gate and ranks the most frequent first", () => {
    const tags = rejectGateTags(sandboxBlotter());
    assert.ok(tags.length > 0);
    assert.ok(tags[0].count >= tags[tags.length - 1].count, "not sorted by frequency");
    for (const tag of tags) assert.ok(tag.gate.length > 0);
  });

  it("returns nothing when nothing was refused", () => {
    assert.deepEqual(rejectGateTags([row()]), []);
  });
});

describe("the resting book's exports live in the same disclosure as the blotter's", () => {
  /**
   * The Activity toolbar swaps components when the view seg flips: Fills and
   * Cancelled render OrderBlotter, Active renders WorkingOrders. Before this
   * pass the flip also swapped the export affordance — a count-labelled
   * RowMenu with CSV+JSON on two views, a bare "Export CSV" button with no
   * count and no JSON on the third. Same action, two presentations, one
   * seg-click apart.
   */
  const orders = read("../components/portfolio/WorkingOrders.tsx")
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

  it("uses one shared RowMenu, named with the count it is about to write", () => {
    assert.equal((orders.match(/<RowMenu/g) ?? []).length, 1);
    const label = /<RowMenu label=\{([\s\S]*?)\}>/.exec(orders);
    assert.ok(label, "the RowMenu has no label expression");
    assert.match(label[1], /rows on screen/);
    assert.match(label[1], /visible\.length/);
  });

  it("offers both formats, neither left behind in the toolbar", () => {
    assert.equal((orders.match(/Export CSV/g) ?? []).length, 1);
    assert.equal((orders.match(/Export JSON/g) ?? []).length, 1);
    assert.equal((orders.match(/role="menuitem"/g) ?? []).length, 2);
    assert.equal((orders.match(/disabled=\{!visible\.length\}/g) ?? []).length, 2);
  });
});

describe("the resting book keeps its own shape", () => {
  it("searches the fields a resting order actually has", () => {
    const resting = sandboxWorkingOrders();
    assert.equal(filterWorkingOrders(resting, "").length, resting.length);
    const symbol = resting[0].symbol.slice(0, 3).toLowerCase();
    assert.ok(filterWorkingOrders(resting, symbol).length >= 1);
    assert.equal(filterWorkingOrders(resting, "zzzz").length, 0);
  });

  it("exports through its own header, leaving the pinned 18 untouched", () => {
    // CRLF: the exporter follows RFC 4180, as its own header comment says.
    const csv = workingOrdersToCsv(sandboxWorkingOrders());
    const lines = csv.trim().split("\r\n");
    assert.equal(lines[0], WORKING_ORDER_CSV_COLUMNS.join(","));
    assert.equal(lines.length, sandboxWorkingOrders().length + 1);
    // The blotter's own header is a separate contract and must not have moved.
    assert.match(read("../lib/export-csv.ts"), /BLOTTER_CSV_COLUMNS = \[/);
  });

  it("writes an absent distance as empty, never as zero", () => {
    // Null and 0 are different claims about how far a resting order sits from
    // the mark, and only one of them is a measurement.
    const [first] = sandboxWorkingOrders();
    const csv = workingOrdersToCsv([{ ...first, distanceBps: null, markPrice: null }]);
    const cells = csv.trim().split("\r\n")[1].split(",");
    const markAt = WORKING_ORDER_CSV_COLUMNS.indexOf("mark_price");
    const distanceAt = WORKING_ORDER_CSV_COLUMNS.indexOf("distance_bps");
    assert.equal(cells[markAt], "", "mark_price exported a value it does not have");
    assert.equal(cells[distanceAt], "", "distance_bps exported a value it does not have");
  });
});
