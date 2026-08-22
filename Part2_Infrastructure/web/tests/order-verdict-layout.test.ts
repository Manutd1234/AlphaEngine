/**
 * The pre-trade check vector is readable, aligned, and loses nothing.
 *
 * WHAT WAS REPORTED, AND WHAT IT MEASURED. A $25k BUY was simulated from the
 * Trade subtab in both directions — one acceptance, one rejection — and the
 * twelve-gate block underneath the verdict was the least legible thing on the
 * screen. `.cockpit-checks` laid the gates out as
 * `repeat(auto-fill, minmax(230px, 1fr))`, so:
 *
 *   - `symbol_whitelist BTCUSDT in the live L2 universe or backed by a trusted
 *     paper-equity quote` — 88 characters — wrapped over seven lines inside a
 *     230px track while the cell beside it held `kill_switch disengaged`;
 *   - the taller row pushed its neighbour, and `duplicate_order
 *     client_order_id=` was drawn over `rate_limit 1.0/s observed`. On the
 *     rejected screenshot that overlap landed on the word `rate_limit`, which
 *     was the reason for the rejection.
 *
 * So this suite pins the three things that must now hold: the vector renders
 * as a table (cells cannot overlap and a column is as wide as its content),
 * the detail is split on the comparison the GATEWAY already wrote rather than
 * on anything invented here, and no gate name, figure or limit is truncated
 * out of existence in the process.
 *
 * Both directions are exercised against the real judge — `createSandboxDesk`
 * is the gateway's gate logic, so an accepted $25k order and a rate-limited
 * burst produce the same two check vectors the screenshots showed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readGate, blockingGates } from "@/components/execution/OrderVerdict";
import { SANDBOX_LIMITS, createSandboxDesk } from "../lib/blotter";
import { sandboxBook } from "../lib/portfolio";
import { read } from "./helpers/cockpit-sources";

const verdict = read("components/execution/OrderVerdict.tsx");
/**
 * Selector text only. This file argues its case in comments that quote the
 * selectors they are arguing about, and a scan that counted those quotations
 * would agree with the prose instead of with the cascade.
 */
const density = read("app/globals/14d-density-execution.css").replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The exact strings the two judges write, copied from their `add(...)` calls:
 * `modules/risk_proxy/decision.py` for the live gateway and
 * `lib/blotter/sandbox-desk.ts` for the browser. A paraphrase here would test
 * the splitter against prose no gate ever emits.
 */
const LIVE_WHITELIST =
  "BTCUSDT in the live L2 universe or backed by a trusted paper-equity quote";

describe("a gate detail is split on the comparison the gateway itself wrote", () => {
  it("reads observed against limit for every gate that states one", () => {
    for (const [detail, observed, limit] of [
      // The four "vs" gates, live and sandbox alike.
      ["$25,000 vs $500,000 cap", "$25,000", "$500,000 cap"],
      ["$190,000 projected vs $150,000", "$190,000 projected", "$150,000"],
      ["$525,000 projected vs $2,000,000", "$525,000 projected", "$2,000,000"],
      ["3 resting vs 25 cap", "3 resting", "25 cap"],
      ["1.0/s observed vs 5.0/s", "1.0/s observed", "5.0/s"],
      // `daily_drawdown` writes its comparison with "used of", not "vs".
      ["0.00% used of 5.00%", "0.00%", "5.00%"],
    ] as const) {
      const reading = readGate(detail);
      assert.equal(reading.observed, observed, `observed side of ${JSON.stringify(detail)}`);
      assert.equal(reading.limit, limit, `limit side of ${JSON.stringify(detail)}`);
      assert.equal(reading.prose, null, "a comparison is not also prose");
    }
  });

  it("leaves a statement as a statement, at full length", () => {
    for (const detail of [
      LIVE_WHITELIST,
      "disengaged",
      "BTCUSDT halt status",
      "client_order_id=exp-7f2a-1755859200000-0",
      "mark=77130.57",
      "quantity or notional required",
      "12.4bps from mark 77,130.57",
      // The one " of " that is NOT a limit: the second figure is the order,
      // and the venue names would end up under a column headed Limit.
      "only $12,000 of $25,000 routable across BINANCE+OKX",
      // The live gateway's rate_limit detail carries no threshold at all.
      "1.0/s observed",
    ]) {
      const reading = readGate(detail);
      assert.equal(reading.prose, detail, `${JSON.stringify(detail)} must survive whole`);
      assert.equal(reading.observed, null);
      assert.equal(reading.limit, null);
    }
  });

  it("keeps every word of the detail, so no figure or unit is dropped", () => {
    // The split may only consume the separator. Anything else — a rounded
    // figure, a "cap", a venue — is a measured fact the panel would be
    // deleting rather than laying out.
    for (const detail of [
      "$25,000 vs $500,000 cap",
      "0.00% used of 5.00%",
      "1.0/s observed vs 5.0/s",
      LIVE_WHITELIST,
      "only $12,000 of $25,000 routable across BINANCE+OKX",
    ]) {
      const reading = readGate(detail);
      const rendered = [reading.observed, reading.limit, reading.prose]
        .filter((part): part is string => part !== null)
        .join(" ");
      const dropped = detail
        .split(/\s+/)
        .filter((word) => word !== "vs" && word !== "used" && word !== "of")
        .filter((word) => !rendered.split(/\s+/).includes(word));
      assert.deepEqual(dropped, [], `${JSON.stringify(detail)} lost ${dropped.join(", ")}`);
    }
  });

  it("says nothing rather than inventing a reading for a detail that is absent", () => {
    for (const empty of [null, undefined, "", "   "]) {
      assert.deepEqual(readGate(empty), { observed: null, limit: null, prose: null });
    }
  });
});

describe("the refusing gate is named, not left to be found", () => {
  it("takes the gateway's own list when it sent one", () => {
    assert.deepEqual(
      blockingGates({ accepted: false, rejected_by: ["rate_limit"], checks: [] }),
      ["rate_limit"],
    );
  });

  it("falls back to the failed checks when the list is absent", () => {
    assert.deepEqual(
      blockingGates({
        accepted: false,
        checks: [
          { name: "kill_switch", passed: true, detail: "disengaged" },
          { name: "max_order_notional", passed: false, detail: "$500,000 vs $50,000 cap" },
        ],
      }),
      ["max_order_notional"],
    );
  });

  it("names nothing when nothing refused", () => {
    assert.deepEqual(blockingGates({ accepted: true, rejected_by: [], checks: [] }), []);
  });
});

describe("both verdicts the report screenshotted, through the real judge", () => {
  it("ACCEPTED: a $25k buy renders twelve gates, every one of them readable", () => {
    const desk = createSandboxDesk(sandboxBook());
    const decision = desk.judge({ symbol: "BTCUSDT", side: "BUY", notional: 25_000 }, 0);
    assert.equal(decision.accepted, true);
    assert.deepEqual(blockingGates(decision), [], "an acceptance names no gate");
    const checks = decision.checks ?? [];
    assert.ok(checks.length >= 10, `only ${checks.length} gates came back`);
    for (const check of checks) {
      const reading = readGate(check.detail);
      // Every gate lands in one of the two shapes the table draws. A reading
      // that is neither would render as the dash-and-reason cell, which is
      // correct but means the judge stopped writing details.
      const comparison = reading.observed !== null && reading.limit !== null;
      assert.ok(
        comparison || reading.prose !== null,
        `${check.name} produced no readable cell from ${JSON.stringify(check.detail)}`,
      );
    }
  });

  it("REJECTED: the burst names rate_limit and keeps both sides of the figure", () => {
    const desk = createSandboxDesk(sandboxBook());
    const verdicts = Array.from({ length: 12 }, (_, i) =>
      desk.judge({ symbol: "BTCUSDT", side: "BUY", notional: 1_000 }, 500 + i));
    const refused = verdicts[verdicts.length - 1];
    assert.equal(refused.accepted, false);
    assert.ok(blockingGates(refused).includes("rate_limit"), "the headline gate is rate_limit");
    const gate = (refused.checks ?? []).find((check) => check.name === "rate_limit");
    assert.ok(gate && !gate.passed, "the vector carries the failing gate");
    const reading = readGate(gate!.detail);
    assert.ok(reading.observed?.includes("/s"), "the observed rate keeps its unit");
    assert.ok(
      reading.limit?.includes(String(SANDBOX_LIMITS.maxOrdersPerSec)),
      `the limit column must carry the ${SANDBOX_LIMITS.maxOrdersPerSec}/s bucket size`,
    );
  });

  it("the longest detail in either vector is rendered whole", () => {
    // 88 characters, the string that wrapped over seven lines in a 230px grid
    // track. It is prose, it is not shortened, and no ellipsis stands in for it.
    const reading = readGate(LIVE_WHITELIST);
    assert.equal(reading.prose, LIVE_WHITELIST);
    assert.equal(reading.prose?.length, LIVE_WHITELIST.length);
  });
});

describe("the vector is drawn as a table, inside its own scroller", () => {
  it("renders a table and not a grid of list items", () => {
    assert.match(verdict, /<table className="cockpit-gates"/);
    assert.doesNotMatch(verdict, /<ol className="cockpit-checks"/,
      "the flex-in-a-grid layout is what collided; it must not come back");
  });

  it("scrolls inside a keyboard-reachable wrapper rather than moving the page", () => {
    assert.match(verdict, /<div className="table-wrap" tabIndex=\{0\}>/,
      "wide content scrolls in .table-wrap, and a keyboard must be able to reach that scroll");
  });

  it("the gate name is the row's header and is never wrapped or clipped", () => {
    assert.match(verdict, /<th scope="row">\{check\.name\}<\/th>/);
    assert.match(density, /\.cockpit-gates tbody th\[scope="row"\][^}]*white-space: nowrap/);
    assert.doesNotMatch(verdict, /text-overflow|slice\(0,|…"/,
      "no gate name or limit may be truncated into an ellipsis");
  });

  it("figures compare across one column rule: observed right, limit left", () => {
    assert.match(density, /\.cockpit-gates__limit \{\s*text-align: left;/);
    // The mono face and tabular-nums come from the base `table` rule, which is
    // the whole reason this is a table — restating them here would be a second
    // source of truth for the same alignment.
    assert.doesNotMatch(density, /\.cockpit-gates \{[^}]*font-family/);
  });

  it("a statement spans the measurement columns and wraps inside its own cell", () => {
    assert.match(verdict, /className="cockpit-gates__prose" colSpan=\{2\}/);
    assert.match(density, /\.cockpit-gates__prose \{[^}]*white-space: normal/);
    assert.match(density, /\.cockpit-gates__prose \{[^}]*overflow-wrap: anywhere/);
  });

  it("leaves the blotter's own copy of the check list alone", () => {
    // `.cockpit-checks` is shared with OrderBlotter's expanded detail row,
    // where two short columns of a settled order's gates are the right shape.
    // Restyling it here would have changed a second panel nobody reported.
    assert.doesNotMatch(density, /\.cockpit-checks[^_]/);
    assert.match(read("components/execution/OrderBlotter.tsx"), /className="cockpit-checks"/);
  });
});

describe("the verdict says which gate refused, and in what unit it decided", () => {
  it("puts the blocking gate in the headline beside the word REJECTED", () => {
    assert.match(verdict, /blockingGates\(latest\)/);
    assert.match(verdict, /cockpit-verdict__gate[\s\S]{0,80}blocked by \{blocked\.join/);
  });

  it("states pass and fail in words as well as in mark and colour", () => {
    assert.match(verdict, /\{check\.passed \? "PASS" : "FAIL"\}/);
    assert.match(verdict, /cockpit-gates__mark" aria-hidden>\{check\.passed \? "✓" : "✗"\}/);
    // Colour is the third carrier, never the only one.
    assert.match(density, /tr\.is-fail th\[scope="row"\] \{[^}]*box-shadow: inset 2px 0 0/);
  });

  it("keeps the decision plane in microseconds and never coerces a null", () => {
    // The decision is µs, the compiled core is ns, the network is ms. The wire
    // unit here is ms and formatDuration picks the rung; nothing converts one
    // plane into another, and a missing latency prints nothing at all.
    assert.match(verdict, /formatDuration\(v, "ms"\)/);
    assert.match(verdict, /latest\.latency_ms != null/);
    assert.doesNotMatch(verdict, /\?\?\s*0\b/, "a nullable measurement must never fall back to zero");
  });

  it("keeps every measured figure on the fill line", () => {
    for (const fragment of [
      /Filled \{fmt\(latest\.fill\.quantity, 6\)\}/,
      /usd\(latest\.fill\.price, 2\)/,
      /\{latest\.fill\.venue\}/,
      /slippage \{fmt\(latest\.fill\.slippage_bps, 1\)\} bps/,
      /fee \{usd\(latest\.fill\.fee_usd, 2\)\}/,
    ]) {
      assert.match(verdict, fragment, `the fill line lost ${fragment}`);
    }
  });

  it("reports an absent check vector instead of rendering the headline alone", () => {
    assert.match(verdict, /arrived without a check vector/);
    assert.match(verdict, /— no detail recorded for this gate/);
  });
});
