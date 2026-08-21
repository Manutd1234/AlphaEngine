/**
 * The resting book.
 *
 * A working order and a position in the same instrument appear on the same tab.
 * If the generated resting book quoted a different mark from the generated
 * position book, a reader would see BTCUSDT at two prices a few hundred pixels
 * apart — the exact incoherence the sandbox exists to avoid.
 *
 * The second thing pinned here is that the fixture agrees with the judge that
 * would have produced it. A resting order the real price band would have
 * refused, or one quoted at a price that would have crossed on arrival, is a
 * row demonstrating a gateway that does not exist — and the same generator also
 * has to stay out of the blotter's totals, which reconcile to the cent with the
 * book's attribution table in `sandbox-desk-reconciliation.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SANDBOX_LIMITS, sandboxBlotter, sandboxWorkingOrders } from "../lib/blotter";
import { sandboxBook } from "../lib/portfolio";

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
