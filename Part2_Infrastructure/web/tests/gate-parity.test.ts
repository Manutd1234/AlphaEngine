/**
 * The TypeScript mirror runs the same gate battery, in the same order, as the
 * Python reference.
 *
 * `tools/make_gate_fixture.py` recorded the gateway's decision for twenty
 * scenarios (`fixtures/gate-parity.json`); `tests/test_gate_parity.py` asserts
 * the live Python reproduces them. This is the other half: the browser's
 * `judge()` in `lib/blotter.ts` is a second implementation of the same
 * seventeen gates, and it must not silently reorder, drop, or add one.
 *
 * What this asserts and what it deliberately does not. The fixture's gate NAMES
 * and ORDER are a cross-language contract — a subsequence of the seventeen, in
 * evaluation order — and both languages are held to it. The observed/limit
 * NUMBERS are not asserted here: the sandbox has no ladder (its slippage is a
 * synthesised function of size, seeded by a PRNG), reads its caps off the book
 * rather than settings, and has no paper-equity or per-venue routing, so those
 * scenarios are structurally inexpressible in it and pretending otherwise would
 * be a looser test wearing a stricter name. The gateway's own numbers are
 * pinned in Python; here we pin that the mirror walks the same gates.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createSandboxDesk, type SandboxOrder } from "../lib/blotter";
import { sandboxBook } from "../lib/portfolio";

const GATE_ORDER = [
  "kill_switch", "symbol_halt", "symbol_whitelist", "paper_execution_model",
  "reference_freshness", "duplicate_order", "rate_limit", "price_available",
  "order_sized", "max_order_notional", "symbol_concentration", "gross_exposure",
  "price_band", "working_book", "daily_drawdown", "reduce_only", "est_slippage",
] as const;

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/gate-parity.json", import.meta.url)), "utf8"),
) as {
  version: number;
  scenarios: Record<string, {
    expected: { accepted: boolean; rejected_by: string[]; checks: Array<{ name: string }> };
  }>;
};

describe("the gate fixture is a cross-language contract", () => {
  it("names only real gates, always in evaluation order", () => {
    assert.equal(fixture.version, 1);
    assert.equal(Object.keys(fixture.scenarios).length, 20);
    for (const [name, scenario] of Object.entries(fixture.scenarios)) {
      const names = scenario.expected.checks.map((c) => c.name);
      const ranks = names.map((n) => GATE_ORDER.indexOf(n as (typeof GATE_ORDER)[number]));
      assert.ok(ranks.every((r) => r >= 0), `${name} names a gate the mirror does not know`);
      assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `${name} checks are out of gate order`);
      assert.equal(
        scenario.expected.accepted,
        scenario.expected.rejected_by.length === 0,
        `${name} disagrees with itself about acceptance`,
      );
    }
  });
});

describe("the sandbox judge walks the reference's gates", () => {
  // The gate NAME order the mirror produces for the two structurally-shared
  // shapes must be a subsequence of the reference order, and must match the
  // fixture's own happy-path vector — proving the mirror neither reorders nor
  // drops a gate relative to the Python it claims to follow.
  const firstSymbol = sandboxBook().exposure.positions[0]?.symbol ?? "BTCUSDT";

  const runOne = (order: SandboxOrder) =>
    (createSandboxDesk(sandboxBook()).judge(order).checks ?? []).map((c) => c.name);

  it("a happy MARKET order runs the same gate vector Python recorded", () => {
    const symbol = firstSymbol;
    const names = runOne({ symbol, side: "BUY", notional: 1000, orderType: "MARKET" });
    const ranks = names.map((n) => GATE_ORDER.indexOf(n as (typeof GATE_ORDER)[number]));
    assert.ok(ranks.every((r) => r >= 0) && ranks.every((r, i) => i === 0 || r > ranks[i - 1]));
    // The fixture's happy_market names the crypto MARKET subsequence; the mirror
    // must run exactly the gates that can appear on that path.
    const scenario = fixture.scenarios.happy_market;
    assert.ok(scenario, "the fixture must carry a happy_market scenario");
    assert.deepEqual(names, scenario.expected.checks.map((c) => c.name));
  });

  it("a resting LIMIT order inserts price_band and working_book, in order", () => {
    const names = runOne({ symbol: firstSymbol, side: "BUY", notional: 1000, orderType: "LIMIT", limitPrice: 1 });
    assert.ok(names.includes("price_band"));
    assert.ok(names.includes("working_book"));
    assert.ok(names.indexOf("price_band") < names.indexOf("working_book"));
    assert.ok(names.indexOf("working_book") < names.indexOf("daily_drawdown"));
  });
});
