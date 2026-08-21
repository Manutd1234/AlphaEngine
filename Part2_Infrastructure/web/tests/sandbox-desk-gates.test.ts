/**
 * The sandbox judge is the gateway's logic, not an imitation of its interface.
 *
 * A sandbox that accepted and rejected orders by rules of its own would be
 * theatre: it would teach a reviewer a risk system that does not exist, and it
 * would do so most convincingly at exactly the moments the real gateway had
 * changed. So gate names, evaluation order and thresholds are pinned here
 * against the values in `modules/risk_proxy.py` and `config.py`. If the
 * gateway's defaults move, these tests fail — that is the point.
 *
 * Two vectors are pinned, not one. A MARKET order runs twelve gates; a LIMIT
 * order runs the same twelve with `price_band` and `working_book` inserted
 * where risk_proxy.py has them, and it may rest instead of filling. A bid below
 * the offer that filled anyway would teach the opposite of what was built.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SANDBOX_LIMITS, createSandboxDesk } from "../lib/blotter";
import { sandboxBook } from "../lib/portfolio";

describe("the judge replays the gateway's gates, not an approximation of them", () => {
  // Thresholds pinned to config.py defaults. A drift here means the sandbox
  // demonstrates a risk system that no longer exists.
  it("order-level thresholds match the gateway's config.py defaults", () => {
    // Book-level caps (symbol concentration, gross exposure) are deliberately
    // absent: the judge reads those off the book's own declared limits, the
    // way the live gateway reads its own settings. Pinning the paper gateway's
    // $150k/$500k here would replay a $1M book's caps against a $10M book.
    assert.equal(SANDBOX_LIMITS.maxOrderNotionalUsd, 50_000);
    assert.equal(SANDBOX_LIMITS.maxOrdersPerSec, 5);
    assert.equal(SANDBOX_LIMITS.maxDailyDrawdownPct, 0.05);
    assert.equal(SANDBOX_LIMITS.reduceOnlyThreshold, 0.8);
    assert.equal(SANDBOX_LIMITS.maxEstSlippageBps, 75);
    assert.equal(SANDBOX_LIMITS.maxPriceDeviationBps, 500);
  });

  it("a valid $25k order passes every gate and fills with the 6bps taker fee", () => {
    const desk = createSandboxDesk(sandboxBook());
    const decision = desk.judge({ symbol: "BTCUSDT", side: "BUY", notional: 25_000 }, 0);
    assert.equal(decision.accepted, true);
    assert.ok(decision.checks && decision.checks.every((c) => c.passed), "all gates pass");
    assert.ok(decision.fill, "an accepted order fills");
    assert.ok(Math.abs(decision.fill!.fee_usd - 25_000 * 0.0006) < 1e-9, "6 bps taker fee");
    assert.match(decision.reason ?? "", /sandbox|no order was sent/i, "the verdict says it is generated");
  });

  it("the fat-finger preset is rejected by max_order_notional, by name", () => {
    const desk = createSandboxDesk(sandboxBook());
    const decision = desk.judge({ symbol: "BTCUSDT", side: "BUY", notional: 500_000 }, 0);
    assert.equal(decision.accepted, false);
    assert.ok(decision.rejected_by?.includes("max_order_notional"));
    const gate = decision.checks?.find((c) => c.name === "max_order_notional");
    assert.ok(gate && !gate.passed, "the check vector shows the failing gate");
    assert.equal(decision.fill, null, "a rejected order must not fill");
  });

  it("a 12-order burst trips the token bucket exactly where the gateway would", () => {
    const desk = createSandboxDesk(sandboxBook());
    const verdicts = Array.from({ length: 12 }, (_, i) =>
      desk.judge({ symbol: "BTCUSDT", side: "BUY", notional: 1_000 }, 500 + i));
    const accepted = verdicts.filter((v) => v.accepted).length;
    assert.equal(accepted, SANDBOX_LIMITS.maxOrdersPerSec, "5/s bucket, 12 asks, 5 through");
    for (const v of verdicts.slice(SANDBOX_LIMITS.maxOrdersPerSec)) {
      assert.ok(v.rejected_by?.includes("rate_limit"));
    }
  });

  it("the bucket refills after the window, like a bucket and unlike a counter", () => {
    const desk = createSandboxDesk(sandboxBook());
    for (let i = 0; i < 5; i += 1) desk.judge({ symbol: "BTCUSDT", side: "BUY", notional: 1_000 }, 1_000 + i);
    const later = desk.judge({ symbol: "BTCUSDT", side: "BUY", notional: 1_000 }, 3_000);
    assert.equal(later.accepted, true, "a full second later the bucket has drained");
  });

  it("a duplicate client_order_id is refused the second time only", () => {
    const desk = createSandboxDesk(sandboxBook());
    const first = desk.judge({ symbol: "BTCUSDT", side: "BUY", notional: 1_000, clientOrderId: "EXP-1" }, 0);
    const second = desk.judge({ symbol: "BTCUSDT", side: "BUY", notional: 1_000, clientOrderId: "EXP-1" }, 2_000);
    assert.equal(first.accepted, true);
    assert.equal(second.accepted, false);
    assert.ok(second.rejected_by?.includes("duplicate_order"));
  });

  it("an unlisted instrument fails the whitelist gate", () => {
    const desk = createSandboxDesk(sandboxBook());
    const decision = desk.judge({ symbol: "PEPEUSDT", side: "BUY", notional: 1_000 }, 0);
    assert.equal(decision.accepted, false);
    assert.ok(decision.rejected_by?.includes("symbol_whitelist"));
  });

  it("a newly listed DOGE order has a deterministic mark and passes the sandbox gates", () => {
    const desk = createSandboxDesk(sandboxBook());
    const decision = desk.judge({ symbol: "DOGEUSDT", side: "BUY", notional: 1_000 }, 0);
    assert.equal(decision.accepted, true, `rejected by ${decision.rejected_by}`);
    assert.ok(decision.fill && decision.fill.price > 0, "the expanded pair has a sandbox mark");
  });

  it("projected exposure gates read the caps the book declares, seeing the held position", () => {
    // A crafted book with $20k of symbol headroom: a $30k add trips PROJECTED
    // concentration while staying under the $50k per-order cap — the gate has
    // to see the held position, not just the order, to catch it.
    const book = sandboxBook();
    const tight = {
      ...book,
      exposure: {
        ...book.exposure,
        positions: [{
          ...book.exposure.positions[0],
          notional: 3_980_000,
          symbol_limit: { used: 3_980_000, remaining: 20_000 },
        }],
      },
    };
    const desk = createSandboxDesk(tight);
    const decision = desk.judge(
      { symbol: tight.exposure.positions[0].symbol, side: "BUY", notional: 30_000 },
      0,
    );
    assert.equal(decision.accepted, false);
    assert.ok(decision.rejected_by?.includes("symbol_concentration"),
      `expected symbol_concentration, got ${decision.rejected_by}`);
    // And the untouched sandbox book accepts the same $30k: its declared
    // headroom is $400k, and a cap misread from the wrong scale would refuse it.
    const roomy = createSandboxDesk(sandboxBook())
      .judge({ symbol: book.exposure.positions[0].symbol, side: "BUY", notional: 30_000 }, 0);
    assert.equal(roomy.accepted, true, `roomy book rejected by ${roomy.rejected_by}`);
  });

  it("gate order follows risk_proxy.py: kill switch first, liquidity last", () => {
    const desk = createSandboxDesk(sandboxBook());
    const names = desk.judge({ symbol: "BTCUSDT", side: "BUY", notional: 25_000 }, 0)
      .checks!.map((c) => c.name);
    assert.equal(names[0], "kill_switch");
    assert.equal(names[names.length - 1], "est_slippage");
    const expectedOrder = [
      "kill_switch", "symbol_halt", "symbol_whitelist", "duplicate_order", "rate_limit",
      "price_available", "order_sized", "max_order_notional", "symbol_concentration",
      "gross_exposure", "daily_drawdown", "est_slippage",
    ];
    assert.deepEqual(names, expectedOrder);
  });

  it("a LIMIT order inside the band runs the gateway's own gate vector", () => {
    // BTCUSDT sandbox mark is 67,412.5; a price ~15bps away is well in-band.
    const desk = createSandboxDesk(sandboxBook());
    const decision = desk.judge(
      { symbol: "BTCUSDT", side: "BUY", notional: 25_000, orderType: "LIMIT", limitPrice: 67_310 },
      0,
    );
    assert.equal(decision.accepted, true, `rejected by ${decision.rejected_by}`);
    const names = decision.checks!.map((c) => c.name);
    // The MARKET vector with the two LIMIT-only gates inserted where
    // risk_proxy.py has them: price_band after gross_exposure, then the
    // resting-book ceiling, then daily_drawdown.
    assert.deepEqual(names, [
      "kill_switch", "symbol_halt", "symbol_whitelist", "duplicate_order", "rate_limit",
      "price_available", "order_sized", "max_order_notional", "symbol_concentration",
      "gross_exposure", "price_band", "working_book", "daily_drawdown", "est_slippage",
    ]);
  });

  it("a bid below the offer rests instead of filling", () => {
    // The assertion that changed when the gateway learned to rest an order. This
    // used to claim a fill: 67,310 is below the 67,412.5 mark, so nobody is
    // showing that price and there is nothing to cross. A sandbox that filled it
    // anyway would teach a reviewer the opposite of what was built.
    const desk = createSandboxDesk(sandboxBook());
    const decision = desk.judge(
      { symbol: "BTCUSDT", side: "BUY", notional: 25_000, orderType: "LIMIT", limitPrice: 67_310 },
      0,
    );
    assert.equal(decision.accepted, true, "resting is an acceptance, not a rejection");
    assert.equal(decision.status, "WORKING");
    assert.equal(decision.fill, null, "nobody has met this price yet");
    assert.match(decision.reason!, /resting/);
  });

  it("a bid through the offer crosses the spread and fills", () => {
    const desk = createSandboxDesk(sandboxBook());
    const decision = desk.judge(
      { symbol: "BTCUSDT", side: "BUY", notional: 25_000, orderType: "LIMIT", limitPrice: 67_500 },
      0,
    );
    assert.equal(decision.status, "FILLED");
    assert.ok(decision.fill);
    // Quantity is sized at the limit price, the gateway's reference price.
    assert.ok(Math.abs(decision.fill!.quantity - 25_000 / 67_500) < 1e-12);
  });

  it("an offer below the bid crosses on the sell side too", () => {
    const desk = createSandboxDesk(sandboxBook());
    const resting = desk.judge(
      { symbol: "BTCUSDT", side: "SELL", notional: 25_000, orderType: "LIMIT", limitPrice: 67_500 },
      0,
    );
    assert.equal(resting.status, "WORKING", "asking above the bid has to wait");

    const crossing = desk.judge(
      { symbol: "BTCUSDT", side: "SELL", notional: 25_000, orderType: "LIMIT", limitPrice: 67_300 },
      0,
    );
    assert.equal(crossing.status, "FILLED");
  });

  it("a MARKET order is never sent down the resting path", () => {
    const desk = createSandboxDesk(sandboxBook());
    const decision = desk.judge(
      { symbol: "BTCUSDT", side: "BUY", notional: 25_000, orderType: "MARKET", limitPrice: null },
      0,
    );
    assert.equal(decision.status, "FILLED");
    assert.ok(decision.fill);
    // The resting-book gate is LIMIT-only, so it must not appear here.
    assert.ok(!decision.checks!.some((c) => c.name === "working_book"));
  });

  it("a LIMIT order 600bps off the mark is rejected by price_band", () => {
    const desk = createSandboxDesk(sandboxBook());
    const decision = desk.judge(
      { symbol: "BTCUSDT", side: "BUY", notional: 25_000, orderType: "LIMIT", limitPrice: 67_412.5 * 1.06 },
      0,
    );
    assert.equal(decision.accepted, false);
    assert.ok(decision.rejected_by?.includes("price_band"), `got ${decision.rejected_by}`);
    assert.equal(decision.fill, null);
  });

  it("a MARKET order never sees the price_band gate", () => {
    const desk = createSandboxDesk(sandboxBook());
    const names = desk.judge({ symbol: "BTCUSDT", side: "BUY", notional: 25_000 }, 0)
      .checks!.map((c) => c.name);
    assert.ok(!names.includes("price_band"));
  });
});
