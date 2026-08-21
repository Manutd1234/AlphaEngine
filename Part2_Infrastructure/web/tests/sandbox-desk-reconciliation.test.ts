/**
 * The generated desk is deterministic, and it agrees with itself.
 *
 * A PM reading attribution on one tab and a trader reading execution quality on
 * another are looking at the same generated desk. Two generated desks that
 * disagree are worse than either: the reader cannot tell which surface to trust
 * and has no third source to break the tie. So the blotter's rows must
 * reconcile with the sandbox book's attribution table exactly — per sleeve, the
 * same order counts, fill counts, total notional and total fees — and the
 * session block must derive its costs from the rows behind it rather than
 * restating a figure of its own.
 *
 * Determinism is the precondition for all of it. Two calls that returned
 * different desks would make every reconciliation above a coin toss, and would
 * make the server render and the hydrate disagree on screen.
 *
 * The gate vector the judge runs is pinned separately, in
 * `sandbox-desk-gates.test.ts`; the resting book's agreement with the position
 * book is in `sandbox-desk-working-orders.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SANDBOX_LIMITS,
  createSandboxDesk,
  sandboxBlotter,
  sandboxRiskEvents,
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
