/**
 * The sandbox desk holds two promises, and both must be enforceable or the
 * whole thing is theatre.
 *
 * First: it is deterministic and internally consistent. The blotter's rows must
 * reconcile with the sandbox book's attribution table exactly — per sleeve, the
 * same order counts, fill counts, total notional and total fees — because a PM
 * reading attribution on one tab and a trader reading execution quality on
 * another are looking at the same generated desk, and two generated desks that
 * disagree are worse than either.
 *
 * Second: the judge is the gateway's logic, not an imitation of its interface.
 * Gate names, evaluation order and thresholds are pinned here against the
 * values in `modules/risk_proxy.py` and `config.py`. If the gateway's defaults
 * change, these tests fail, and that is the point — a sandbox judging by stale
 * thresholds would demonstrate a risk system that no longer exists.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SANDBOX_LIMITS,
  createSandboxDesk,
  sandboxBlotter,
  sandboxRiskEvents,
  sandboxWorkingOrders,
  summarise,
} from "../lib/blotter";
import { sandboxBook } from "../lib/portfolio";

describe("the sandbox desk is deterministic", () => {
  it("two blotters are the same blotter", () => {
    assert.deepEqual(sandboxBlotter(), sandboxBlotter());
  });

  it("two event streams are the same stream", () => {
    assert.deepEqual(sandboxRiskEvents(), sandboxRiskEvents());
  });

  it("two judges given the same session produce the same verdicts", () => {
    const a = createSandboxDesk(sandboxBook());
    const b = createSandboxDesk(sandboxBook());
    const order = { symbol: "BTCUSDT", side: "BUY" as const, notional: 25_000 };
    assert.deepEqual(a.judge(order, 1_000), b.judge(order, 1_000));
  });
});

describe("the blotter reconciles with the book's attribution, sleeve by sleeve", () => {
  const rows = sandboxBlotter();
  const attribution = sandboxBook().attribution.by_strategy ?? [];

  it("covers exactly the attribution's sleeves", () => {
    assert.deepEqual(
      [...new Set(rows.map((r) => r.strategy))].sort(),
      attribution.map((s) => s.strategy).sort(),
    );
  });

  for (const sleeve of attribution) {
    it(`${sleeve.strategy}: counts, notional and fees match to the cent`, () => {
      const mine = rows.filter((r) => r.strategy === sleeve.strategy);
      const fills = mine.filter((r) => r.accepted);
      assert.equal(mine.length, sleeve.orders, "order count");
      assert.equal(fills.length, sleeve.filled, "fill count");
      assert.equal(
        fills.reduce((sum, r) => sum + (r.notional ?? 0), 0),
        sleeve.notional,
        "filled notional",
      );
      assert.equal(
        Math.round(fills.reduce((sum, r) => sum + (r.feeUsd ?? 0), 0) * 100) / 100,
        sleeve.fees,
        "fees",
      );
    });
  }

  it("every rejected row is plausible against the gates it did NOT trip", () => {
    for (const row of rows.filter((r) => !r.accepted)) {
      assert.equal(row.rejectedBy.length, 1, "sandbox rejections name one gate");
      if (row.rejectedBy[0] !== "max_order_notional") {
        // A $60k order "rejected by rate_limit" would in truth have tripped
        // the $50k cap first; a reviewer reading gates carefully would see it.
        assert.ok(
          (row.notional ?? 0) <= SANDBOX_LIMITS.maxOrderNotionalUsd,
          `${row.orderId} rejected by ${row.rejectedBy[0]} but its notional also breaks the order cap`,
        );
      }
      assert.equal(row.fillPrice, null, "a rejection has no fill");
      assert.equal(row.feeUsd, null, "a rejection pays no fee");
    }
  });

  it("summarise() over the sandbox rows produces a coherent quality panel", () => {
    const summary = summarise(rows);
    assert.equal(summary.orders, attribution.reduce((n, s) => n + s.orders, 0));
    assert.equal(summary.accepted, attribution.reduce((n, s) => n + s.filled, 0));
    assert.ok(summary.fillRate !== null && summary.fillRate > 0.8, "the sandbox desk mostly fills");
    assert.ok(summary.topRejectReason, "some gate rejected something");
  });
});

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


// --------------------------------------------------------------------------
// The resting book
//
// A working order and a position in the same instrument appear on the same tab.
// If the generated resting book quoted a different mark from the generated
// position book, a reader would see BTCUSDT at two prices a few hundred pixels
// apart — the exact incoherence the sandbox exists to avoid.
// --------------------------------------------------------------------------

describe("the generated resting book agrees with the generated position book", () => {
  const orders = sandboxWorkingOrders();
  const book = sandboxBook();
  const marks = new Map(book.exposure.positions.map((p) => [p.symbol, p.mark_price]));

  it("is deterministic", () => {
    assert.deepEqual(sandboxWorkingOrders(), sandboxWorkingOrders());
  });

  it("quotes every order against the book's own mark", () => {
    for (const order of orders) {
      const mark = marks.get(order.symbol);
      assert.ok(mark, `${order.symbol} rests but is not in the book`);
      assert.equal(
        order.markPrice, mark,
        `${order.symbol} rests against ${order.markPrice} but the book marks it at ${mark}`,
      );
    }
  });

  it("states a distance that matches the two prices it sits between", () => {
    for (const order of orders) {
      const expected = ((order.limitPrice - order.markPrice!) / order.markPrice!) * 1e4;
      assert.ok(
        Math.abs(order.distanceBps! - expected) < 0.01,
        `${order.symbol}: ${order.distanceBps} vs ${expected}`,
      );
    }
  });

  it("rests every order inside the gateway's own price band", () => {
    // An order the real gate would have refused has no business appearing as one
    // it accepted.
    for (const order of orders) {
      assert.ok(
        Math.abs(order.distanceBps!) <= SANDBOX_LIMITS.maxPriceDeviationBps,
        `${order.symbol} is ${order.distanceBps}bps out, past the ${SANDBOX_LIMITS.maxPriceDeviationBps}bps band`,
      );
    }
  });

  it("never quotes a resting order at a price that would have filled", () => {
    // A BUY above the mark and a SELL below it are marketable: they would have
    // crossed on arrival rather than rested, so seeing one here would mean the
    // fixture disagrees with the judge that produced it.
    for (const order of orders) {
      if (order.side === "BUY") assert.ok(order.limitPrice < order.markPrice!, order.symbol);
      else assert.ok(order.limitPrice > order.markPrice!, order.symbol);
    }
  });

  it("gives only DAY orders an expiry", () => {
    for (const order of orders) {
      if (order.timeInForce === "DAY") assert.ok(order.expiresAt, `${order.orderId} has no boundary`);
      // A far-future date on a GTC order would read as an expiry it does not have.
      else assert.equal(order.expiresAt, null, `${order.orderId} claims an expiry it does not have`);
    }
  });

  it("stays out of the blotter's totals", () => {
    // sandboxBlotter's per-sleeve counts reconcile to the cent with the book's
    // attribution table. A resting order has no fill and no fee, so leaking one
    // into those rows would break a reconciliation two other tests depend on.
    const ids = new Set(sandboxBlotter().map((row) => row.orderId));
    for (const order of orders) {
      assert.ok(!ids.has(order.orderId), `${order.orderId} appears in both generators`);
    }
  });
});

describe("the generated session block reconciles with the rows behind it", () => {
  const book = sandboxBook();
  const session = book.attribution.session!;

  it("derives its costs from the blotter rather than restating them", () => {
    const fills = sandboxBlotter().filter((row) => row.status === "FILLED");
    const fees = fills.reduce((acc, row) => acc + (row.feeUsd ?? 0), 0);
    assert.ok(Math.abs(session.fees! - fees) < 0.01, `${session.fees} vs ${fees}`);
    assert.equal(session.fills, fills.length);
  });

  it("carries a market leg that is supplied, not measured", () => {
    // Attributing part of a generated P&L to a real market move would be a
    // fabricated attribution, and it would make the panel disagree between
    // server render and hydrate.
    assert.equal(session.basis, "generated");
    assert.ok(typeof session.market_pnl === "number");
    assert.ok(typeof session.reference_return === "number");
  });

  it("has no unmeasured fills, so the cost leg is exact rather than a bound", () => {
    assert.equal(session.fills_without_slippage, 0);
  });

  it("sums its sleeve P&L to the book's own realised figure", () => {
    const sleeves = book.attribution.by_strategy
      .reduce((acc, row) => acc + (row.realized_pnl ?? 0), 0);
    assert.ok(
      Math.abs(sleeves - book.equity.realized_pnl) < 0.01,
      `sleeves sum to ${sleeves} but the book reports ${book.equity.realized_pnl}`,
    );
  });
});
