/**
 * The book the desk demonstrates on, and the one word it is summed up in.
 *
 * Two guards that meet at the same object. The first is that the sandbox book
 * is arithmetically coherent — gross is the sum of its notionals, shares sum to
 * one, leverage follows from equity, and each position's total P&L is its two
 * halves added up. A demonstration book whose own numbers disagree teaches the
 * reader to distrust the panel rather than the fixture, and it must carry the
 * sandbox flag the UI banners on so nobody mistakes it for a live position.
 *
 * The second is the headline status chip, where a shipped bug lived: the chip
 * took the *name* of the binding constraint from one place and its *number*
 * from another, so it could read "ELEVATED — symbol exposure at 72%" while the
 * constraint it named sat at 90%. Right name, wrong number, one severity band
 * too low. A chip that can name one constraint and size another is worse than
 * no chip, because it is read at a glance and believed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bookStatus, sandboxBook } from "../lib/portfolio";
import { close } from "./helpers/risk-series";

describe("the sandbox book is coherent and unmistakably flagged", () => {
  const book = sandboxBook();

  it("carries the sandbox flag the UI banners on", () => {
    assert.equal(book.sandbox, true);
    assert.equal(book.gateway?.authoritative, false);
  });

  it("is deterministic — the same book every call", () => {
    assert.deepEqual(sandboxBook(), sandboxBook());
  });

  it("its own arithmetic agrees", () => {
    const gross = book.exposure.positions.reduce((acc, p) => acc + p.notional, 0);
    close(book.exposure.gross, gross, 1e-6, "gross is the sum of notionals");
    close(
      book.exposure.positions.reduce((acc, p) => acc + p.share_of_gross, 0),
      1,
      1e-9,
      "shares sum to 1",
    );
    close(book.exposure.leverage, gross / book.equity.current, 1e-9, "leverage");
    close(
      book.equity.daily_pnl,
      book.equity.current - book.equity.start_of_day,
      1e-6,
      "day P&L",
    );
    for (const p of book.exposure.positions) {
      close(p.total_pnl, p.unrealized_pnl + p.realized_pnl, 1e-6, `${p.symbol} total P&L`);
    }
  });

  it("carries a short, so the risk decomposition has a hedge to show", () => {
    assert.ok(
      book.exposure.positions.some((p) => p.side === "SHORT"),
      "an all-long sandbox cannot demonstrate negative risk contribution",
    );
    assert.ok(book.exposure.net < book.exposure.gross, "net must be below gross with a short present");
  });

  it("names a binding constraint that is actually the tightest", () => {
    const [, utilisation] = book.risk_budget.binding_constraint;
    assert.ok(
      utilisation >= book.risk_budget.gross_exposure.utilisation - 1e-9,
      "the binding constraint must be at least as tight as gross exposure",
    );
  });
});

// --------------------------------------------------------------------------
// Headline status
// --------------------------------------------------------------------------

describe("the status chip cannot name one constraint and size another", () => {
  const book = () => sandboxBook();

  const withBinding = (name: string, utilisation: number) => {
    const b = book();
    b.risk_budget.binding_constraint = [name, utilisation];
    return b;
  };

  it("takes its number from the constraint it names", () => {
    // The shipped bug: the name came from `binding_constraint` and the number
    // from max(gross, drawdown). With symbol exposure at 90% and gross at 72%
    // the chip read "ELEVATED — symbol exposure at 72%" — right name, wrong
    // number, one severity band too low.
    const status = bookStatus(withBinding("symbol_exposure", 0.9));
    assert.equal(status.constraint, "symbol_exposure");
    assert.ok(status.utilisation >= 0.9, `utilisation ignored the binder: ${status.utilisation}`);
    assert.equal(status.level, "critical");
    assert.match(status.detail, /90%/, `detail must quote the binder's own number: ${status.detail}`);
  });

  it("never reports a utilisation below the binding constraint's", () => {
    for (const u of [0.05, 0.4, 0.71, 0.89, 0.9, 1.4]) {
      const status = bookStatus(withBinding("symbol_exposure", u));
      assert.ok(
        status.utilisation >= u,
        `binder at ${u} but status reported ${status.utilisation}`,
      );
    }
  });

  it("still escalates on a headroom the gateway did not name", () => {
    // A gateway that under-reports its own binder must not be able to talk the
    // chip down below what the structured headrooms already show.
    const b = withBinding("symbol_exposure", 0.1);
    b.risk_budget.gross_exposure.utilisation = 0.95;
    assert.equal(bookStatus(b).level, "critical");
  });

  it("a halt outranks every utilisation band", () => {
    const b = withBinding("symbol_exposure", 0.01);
    b.trading_halted = true;
    const status = bookStatus(b);
    assert.equal(status.level, "halted");
    assert.match(status.detail, /kill switch/);
  });

  it("bands are inclusive at their boundaries", () => {
    // The other headrooms have to be flattened to isolate the band edges: the
    // sandbox book's gross sits at 71.7%, so a 0.69 binder correctly still
    // reports "elevated" — which is the previous assertion's whole point.
    const only = (utilisation: number) => {
      const b = withBinding("x", utilisation);
      b.risk_budget.gross_exposure.utilisation = 0;
      b.risk_budget.daily_drawdown.utilisation = 0;
      return bookStatus(b).level;
    };
    assert.equal(only(0.9), "critical", "0.9 is inside critical");
    assert.equal(only(0.7), "elevated", "0.7 is inside elevated");
    assert.equal(only(0.69), "normal");
    assert.equal(only(0.899), "elevated", "just under 0.9 must not read critical");
  });
});
