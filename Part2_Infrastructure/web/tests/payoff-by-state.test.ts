/**
 * The payoff arithmetic behind `PayoffByState`, checked where it lives.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { legPayoffsInState, money, payoffsByState, toMicros } from "../lib/coherence/payoff-by-state";
import type { CoherenceCertificate } from "../lib/coherence/types";

describe("toMicros", () => {
  it("parses a fee at six decimals and a price at four, exactly", () => {
    assert.equal(toMicros("1.234567"), 1_234_567);
    assert.equal(toMicros("0.0500"), 50_000);
    assert.equal(toMicros("-0.25"), -250_000);
    assert.equal(toMicros("3"), 3_000_000);
  });
  it("refuses what is not a decimal, and null", () => {
    assert.equal(toMicros("abc"), null);
    assert.equal(toMicros(""), null);
    assert.equal(toMicros(null), null);
    assert.equal(toMicros("1.2345678"), null, "seven decimals is not a fee at the account's precision");
  });
});

describe("money", () => {
  it("prints at the exchange's four decimals and dashes a null", () => {
    assert.equal(money(1_234_567), "1.2346");
    assert.equal(money(0), "0.0000");
    assert.equal(money(null), "—");
  });
});

describe("payoffsByState", () => {
  const certificate = { legs: [
    { ticker: "A", label: "A", direction: "buy", price: "0.4000", size: "2.00" },
    { ticker: "B", label: "B", direction: "sell", price: "0.7000", size: "1.00" },
  ] } as unknown as CoherenceCertificate;
  const states = [{ ticker: "A", label: "A wins" }, { ticker: "B", label: "B wins" }, { ticker: "C", label: "C wins" }];

  it("rebuilds the kernel's gross payoff per state at raw prices", () => {
    const { columns, unreadable } = payoffsByState(certificate, states);
    assert.deepEqual(unreadable, []);
    // A wins: buy A pays (1 - 0.4) * 2 = 1.2; sell B pays 0.7 - 0 = 0.7 -> 1.9
    // B wins: buy A pays (0 - 0.4) * 2 = -0.8; sell B pays 0.7 - 1 = -0.3 -> -1.1
    // C wins: -0.8 + 0.7 = -0.1
    assert.deepEqual(columns.map((c) => c.gross), [1_900_000, -1_100_000, -100_000]);
  });
  it("dashes every state an unreadable leg touches, never a zero", () => {
    const broken = { legs: [{ ticker: "A", label: "A", direction: "buy", price: "x", size: "1" }] } as unknown as CoherenceCertificate;
    const { columns, unreadable } = payoffsByState(broken, states);
    assert.deepEqual(unreadable, ["A"]);
    assert.deepEqual(columns.map((c) => c.gross), [null, null, null]);
  });
});

describe("legPayoffsInState", () => {
  it("gives each leg its own payoff in one state, and a null for a leg that cannot be read", () => {
    const certificate = { legs: [
      { ticker: "A", label: "A", direction: "buy", price: "0.4000", size: "2.00" },
      { ticker: "B", label: "B", direction: "sell", price: "x", size: "1.00" },
    ] } as unknown as CoherenceCertificate;
    assert.deepEqual(legPayoffsInState(certificate, { ticker: "A", label: "A wins" }), [
      { label: "A", micros: 1_200_000 },
      { label: "B", micros: null },
    ]);
  });
});
