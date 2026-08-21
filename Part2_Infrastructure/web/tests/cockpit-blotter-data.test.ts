/**
 * The execution cockpit's data layer.
 *
 * The panels render whatever these functions return, so what is pinned here is
 * the parsing and the arithmetic — not the markup. Two properties matter most:
 *
 *  1. A gateway row that is malformed, truncated or from an older schema must
 *     degrade to "—" rather than crash a trading screen or, worse, render a
 *     fabricated zero. A slippage of 0 and a slippage nobody measured are
 *     different facts.
 *  2. The summary must describe exactly the rows the blotter shows. A trader
 *     comparing the headline fill rate against the table below it should never
 *     find them counting different things — which is also why the filters that
 *     decide which rows are on screen are pinned here rather than apart from
 *     the summary that describes them.
 *
 * Nothing here touches the network; the gateway shapes are fixtures. The two
 * rows below are the whole vocabulary: one accepted and filled, one rejected by
 * two gates with every post-trade field left null.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  UNTAGGED,
  filterBlotterRows,
  sandboxBlotter,
  strategyTags,
  summarise,
  toBlotterRow,
  toRiskEvent,
} from "../lib/blotter";

const acceptedRow = {
  ts: "2026-08-05T09:15:00",
  order_id: "ORD-1",
  client_order_id: "EXP-004-1",
  strategy: "ma_cross",
  symbol: "BTCUSDT",
  side: "BUY",
  order_type: "MARKET",
  quantity: 0.37,
  notional: 25_000,
  accepted: true,
  rejected_by: null,
  reason: "accepted",
  latency_ms: 0.21,
  fill_price: 67_500.25,
  fill_qty: 0.37,
  fee_usd: 10,
  slippage_bps: 1.4,
  venue: "BINANCE",
  checks_json: JSON.stringify([
    { name: "kill_switch", passed: true, detail: null },
    { name: "max_order_notional", passed: true, detail: "25000 <= 50000" },
  ]),
  source: "web:token",
};

const rejectedRow = {
  ...acceptedRow,
  order_id: "ORD-2",
  client_order_id: null,
  notional: 500_000,
  accepted: false,
  rejected_by: "max_order_notional,gross_exposure",
  reason: "notional 500000 exceeds the 50000 per-order cap",
  fill_price: null,
  fill_qty: null,
  fee_usd: null,
  slippage_bps: null,
  venue: null,
  checks_json: JSON.stringify([
    { name: "kill_switch", passed: true },
    { name: "max_order_notional", passed: false, detail: "500000 > 50000" },
  ]),
};

// --------------------------------------------------------------------------
// Parsing gateway rows
// --------------------------------------------------------------------------

describe("blotter rows survive whatever the gateway sends", () => {
  it("keeps the check vector so a rejection explains itself", () => {
    const row = toBlotterRow(rejectedRow);
    assert.ok(row);
    assert.equal(row.accepted, false);
    // Every gate that fired, not just the first — the audit log joins them.
    assert.deepEqual(row.rejectedBy, ["max_order_notional", "gross_exposure"]);
    const failed = row.checks.filter((c) => !c.passed);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].detail, "500000 > 50000");
  });

  it("leaves unmeasured fields null instead of inventing zeros", () => {
    const row = toBlotterRow(rejectedRow);
    assert.ok(row);
    // A rejected order never reached a venue, so it has no fill, no fee and no
    // slippage. Rendering those as 0 would put a free, perfect execution in the
    // trader's cost average.
    assert.equal(row.slippageBps, null);
    assert.equal(row.feeUsd, null);
    assert.equal(row.fillPrice, null);
    assert.equal(row.venue, null);
  });

  it("drops rows with no symbol or timestamp rather than rendering blanks", () => {
    assert.equal(toBlotterRow({ ...acceptedRow, symbol: null }), null);
    assert.equal(toBlotterRow({ ...acceptedRow, ts: "" }), null);
    assert.equal(toBlotterRow(null), null);
    assert.equal(toBlotterRow("not a row"), null);
  });

  it("keeps the outcome when the check vector will not parse", () => {
    // An older row, or a truncated JSON column, must not take the whole row
    // down: the accept/reject decision is still true and still auditable.
    const row = toBlotterRow({ ...acceptedRow, checks_json: "{not json" });
    assert.ok(row);
    assert.equal(row.accepted, true);
    assert.deepEqual(row.checks, []);
  });

  it("parses risk events and defaults an absent severity to info", () => {
    const event = toRiskEvent({
      ts: "2026-08-05T09:20:00",
      event: "kill_switch_engaged",
      severity: null,
      actor: "circuit-breaker",
      symbol: null,
      detail: "drawdown 5.1% >= 5.0%",
    });
    assert.ok(event);
    assert.equal(event.severity, "info");
    assert.equal(event.actor, "circuit-breaker");
    assert.equal(toRiskEvent({ ts: "2026-08-05T09:20:00" }), null);
  });
});

// --------------------------------------------------------------------------
// Execution summary
// --------------------------------------------------------------------------

describe("execution quality describes exactly the rows on screen", () => {
  const rows = [acceptedRow, rejectedRow, { ...acceptedRow, order_id: "ORD-3", slippage_bps: 6.2, fee_usd: 12 }]
    .map(toBlotterRow)
    .filter((r): r is NonNullable<typeof r> => r !== null);

  it("counts fills and rejections against the same window", () => {
    const summary = summarise(rows);
    assert.equal(summary.orders, 3);
    assert.equal(summary.accepted, 2);
    assert.equal(summary.rejected, 1);
    assert.equal(summary.fillRate, 2 / 3);
  });

  it("averages slippage over fills only", () => {
    const summary = summarise(rows);
    // The rejected order has no execution to have slipped, so including it —
    // as a zero — would flatter the average.
    assert.equal(summary.avgSlippageBps, (1.4 + 6.2) / 2);
    assert.equal(summary.worstSlippageBps, 6.2);
    assert.equal(summary.totalFees, 22);
  });

  it("names the gate doing the blocking", () => {
    const summary = summarise(rows);
    // Ties are possible here (both gates fired once); what must hold is that a
    // gate that fired is named, with its true count.
    assert.ok(summary.topRejectReason);
    assert.equal(summary.topRejectReason.count, 1);
    assert.ok(["max_order_notional", "gross_exposure"].includes(summary.topRejectReason.gate));
  });

  it("reports tail latency, not just the mean", () => {
    const slow = { ...acceptedRow, order_id: "SLOW", latency_ms: 40 };
    const summary = summarise([...rows, toBlotterRow(slow)!]);
    assert.ok(summary.p99LatencyMs !== null && summary.p50LatencyMs !== null);
    // The one slow decision must reach p99 while leaving the median alone —
    // that gap is the entire reason for measuring the tail.
    assert.equal(summary.p99LatencyMs, 40);
    assert.ok(summary.p50LatencyMs < 1);
  });

  it("says nothing rather than zero when there is nothing to measure", () => {
    const empty = summarise([]);
    assert.equal(empty.orders, 0);
    assert.equal(empty.fillRate, null);
    assert.equal(empty.avgSlippageBps, null);
    assert.equal(empty.p50LatencyMs, null);
    assert.equal(empty.p90LatencyMs, null);
    assert.equal(empty.topRejectReason, null);
  });

  it("p90 sits between the median and the tail", () => {
    const ten = Array.from({ length: 10 }, (_, i) =>
      toBlotterRow({ ...acceptedRow, order_id: `L${i}`, latency_ms: i + 1 })!);
    const summary = summarise(ten);
    // Nearest-rank over 1..10: p50 = 5th, p90 = 9th, p99 = 10th.
    assert.equal(summary.p50LatencyMs, 5);
    assert.equal(summary.p90LatencyMs, 9);
    assert.equal(summary.p99LatencyMs, 10);
  });
});

describe("blotter views", () => {
  const rows = sandboxBlotter(Date.parse("2026-08-04T12:00:00Z"));

  it("status and strategy filters combine", () => {
    const all = filterBlotterRows(rows, { status: "all", focusSymbol: "BTCUSDT", strategy: null });
    assert.equal(all.length, rows.length, "a null strategy is a no-op");

    const fills = filterBlotterRows(rows, { status: "accepted", focusSymbol: "BTCUSDT", strategy: null });
    assert.ok(fills.every((r) => r.accepted));

    const both = filterBlotterRows(rows, { status: "accepted", focusSymbol: "BTCUSDT", strategy: "ma_cross" });
    assert.ok(both.every((r) => r.accepted && r.strategy === "ma_cross"));
    assert.ok(both.length < fills.length, "the strategy filter narrows further");
  });

  it("the untagged sentinel matches rows with no strategy", () => {
    const tagged = { ...rows[0], strategy: "ma_cross" };
    const bare = { ...rows[1], strategy: null };
    const out = filterBlotterRows([tagged, bare], { status: "all", focusSymbol: "X", strategy: UNTAGGED });
    assert.deepEqual(out, [bare]);
  });

  it("strategy tags are derived from the rows, with counts", () => {
    // The sandbox sleeves, exactly as sandboxBook attributes them.
    assert.deepEqual(strategyTags(rows), [
      { tag: "donchian", count: 26 },
      { tag: "ma_cross", count: 48 },
      { tag: "rsi_reversion", count: 12 },
    ]);
    const withBare = strategyTags([...rows, { ...rows[0], strategy: null }]);
    assert.deepEqual(withBare[withBare.length - 1], { tag: UNTAGGED, count: 1 });
  });
});
