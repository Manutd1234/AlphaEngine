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
 *     find them counting different things.
 *
 * Nothing here touches the network; the gateway shapes are fixtures.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  UNTAGGED,
  filterBlotterRows,
  sandboxBlotter,
  strategyTags,
  summarise,
  toBlotterRow,
  toRiskEvent,
} from "../lib/blotter";
import { gatewayBase, gatewayHeaders, notConfigured } from "../lib/gateway";

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

// --------------------------------------------------------------------------
// The server-side boundary
// --------------------------------------------------------------------------

describe("the gateway credential never leaves the server", () => {
  it("attaches the frozen header only when a token is configured", () => {
    const withToken = gatewayHeaders({ NODE_ENV: "test", ALPHAENGINE_GATEWAY_TOKEN: "s3cret" } as NodeJS.ProcessEnv);
    assert.equal(withToken["X-AlphaEngine-Token"], "s3cret");
    // No token configured must mean no header at all, not an empty one: an
    // empty credential reads as "authenticated as nobody" to some proxies.
    assert.ok(!("X-AlphaEngine-Token" in gatewayHeaders({ NODE_ENV: "test" } as NodeJS.ProcessEnv)));
  });

  it("refuses a non-http gateway URL", () => {
    assert.equal(gatewayBase({ NODE_ENV: "test", ALPHAENGINE_GATEWAY_URL: "file:///etc/passwd" } as NodeJS.ProcessEnv), null);
    assert.equal(gatewayBase({ NODE_ENV: "test", ALPHAENGINE_GATEWAY_URL: "not a url" } as NodeJS.ProcessEnv), null);
    assert.equal(
      gatewayBase({ NODE_ENV: "test", ALPHAENGINE_GATEWAY_URL: "https://gw.example.com/ignored/path" } as NodeJS.ProcessEnv)?.href,
      "https://gw.example.com/",
    );
  });

  it("falls back to localhost in development but never in production", () => {
    assert.ok(gatewayBase({ NODE_ENV: "development" } as NodeJS.ProcessEnv));
    // A deployed app silently pointing at its own localhost would report
    // "unreachable" when the truth is "never configured".
    assert.equal(gatewayBase({ NODE_ENV: "production" } as NodeJS.ProcessEnv), null);
  });

  it("names the variables an operator has to set", () => {
    const failure = notConfigured("the blotter");
    assert.equal(failure.status, 503);
    assert.match(failure.hint ?? "", /ALPHAENGINE_GATEWAY_URL/);
    assert.match(failure.hint ?? "", /ALPHAENGINE_GATEWAY_TOKEN/);
  });
});

// --------------------------------------------------------------------------
// Route-level invariants
//
// The route modules read process.env at call time and would need a live
// gateway to exercise, so what is asserted is the contract a future edit would
// have to break deliberately — the same approach risk-actions.test.ts takes.
// --------------------------------------------------------------------------

const ordersRoute = readFileSync(
  fileURLToPath(new URL("../app/api/gateway/orders/route.ts", import.meta.url)),
  "utf8",
);
const auditRoute = readFileSync(
  fileURLToPath(new URL("../app/api/gateway/audit/route.ts", import.meta.url)),
  "utf8",
);
const orderTicket = readFileSync(
  fileURLToPath(new URL("../components/execution/OrderTicket.tsx", import.meta.url)),
  "utf8",
);
const cockpit = readFileSync(
  fileURLToPath(new URL("../components/execution/ExecutionCockpit.tsx", import.meta.url)),
  "utf8",
);
const liveMarket = readFileSync(
  fileURLToPath(new URL("../components/LiveMarket.tsx", import.meta.url)),
  "utf8",
);
const pnlStrip = readFileSync(
  fileURLToPath(new URL("../components/execution/PnlStrip.tsx", import.meta.url)),
  "utf8",
);
const page = readFileSync(
  fileURLToPath(new URL("../app/dashboard/page.tsx", import.meta.url)),
  "utf8",
);

describe("token-guarded order entry has an in-context recovery path", () => {
  it("keeps the operator credential in shared memory and exposes no storage path", () => {
    assert.match(orderTicket, /type="password"/);
    assert.match(orderTicket, /onOperatorTokenChange/);
    assert.match(orderTicket, /Held in memory for this tab only/);
    assert.doesNotMatch(orderTicket, /localStorage|sessionStorage|document\.cookie/);
  });

  it("wires the same credential state used by Reliability into Execution", () => {
    assert.match(cockpit, /onOperatorTokenChange=\{onOperatorTokenChange\}/);
    assert.match(page, /onOperatorTokenChange=\{systems\.setToken\}/);
    assert.match(page, /operatorGuard=\{systems\.guard\}/);
  });

  it("uses the deployment credential by default and keeps pasted tokens strict overrides", () => {
    assert.match(page, /paperOrderDefaultAvailable=\{systems\.paperOrderDefaultAvailable\}/);
    assert.match(cockpit, /paperOrderDefaultAvailable=\{paperOrderDefaultAvailable\}/);
    assert.match(orderTicket, /!paperOrderDefaultAvailable[\s\S]*?!operatorToken\?\.trim\(\)/);
    assert.match(orderTicket, /Credential override \(optional\)/);
    assert.match(orderTicket, /Using the deployment credential/);
    assert.match(orderTicket, /operatorHeaders\(operatorToken\)/);
  });
});

describe("the execution strategy is an editable order intent", () => {
  it("does not disappear when Research becomes stale", () => {
    assert.match(page, /useState<Strategy>\(DEFAULT_REQUEST\.strategy\)/);
    assert.match(page, /strategy=\{executionStrategy\}/);
    assert.doesNotMatch(page, /researchStrategy=\{activeResult/);
  });

  it("lets promotion seed the sleeve and the ticket override it", () => {
    assert.match(page, /setExecutionStrategy\(data\.request\.strategy\)/);
    assert.match(page, /onStrategyChange=\{setExecutionStrategy\}/);
    assert.match(orderTicket, /value=\{strategy\}/);
    assert.match(orderTicket, /id="execution-strategy"/);
    assert.match(orderTicket, /aria-describedby="execution-strategy-help"/);
    assert.match(orderTicket, /onStrategyChange\(event\.target\.value as Strategy\)/);
  });

  it("always stamps the selected sleeve on the submitted order", () => {
    assert.match(orderTicket, /const order = \{[\s\S]*?strategy,[\s\S]*?\};/);
    assert.match(orderTicket, /STRATEGY_GROUPS\.map/);
  });
});

describe("a settled live order invalidates the shared Portfolio and Risk book", () => {
  it("starts with a fillable notional instead of tripping the per-order cap", () => {
    assert.match(page, /const \[notional, setNotional\] = useState\(25_000\)/);
    assert.doesNotMatch(page, /const \[notional, setNotional\] = useState\(100_000\)/);
  });

  it("reports every collected decision, including a fill before a later burst failure", () => {
    assert.match(orderTicket, /finally \{[\s\S]*?if \(collected\.length\)/);
    assert.doesNotMatch(orderTicket, /collected\.length && !failed/);
    assert.match(orderTicket, /hasFill: collected\.some\(\(decision\) => decision\.accepted && decision\.fill != null\)/);
  });

  it("keeps sandbox local and refreshes both live snapshot owners", () => {
    assert.match(cockpit, /if \(result\.source !== "live"\) return/);
    assert.match(cockpit, /void refresh\(\)/);
    assert.match(cockpit, /onOrderSettled\?\.\(result\)/);
    assert.match(page, /void book\.refresh\(true\)/);
    assert.match(page, /onOrderSettled=\{refreshBookAfterOrder\}/);
  });

  it("surfaces the selected sleeve's audited activity in both destination tabs", () => {
    assert.match(page, /row\.strategy === executionStrategy/);
    assert.match(page, /STRATEGY_LABELS\[executionStrategy\]/);
    assert.equal((page.match(/label: "Execution sleeve"/g) ?? []).length, 2);
    assert.match(page, /aggregate book risk below/);
  });
});

describe("execution spends vertical space only where the active task needs it", () => {
  it("keeps the full watchlist on market-analysis sections and compacts Trade", () => {
    assert.match(liveMarket, /section === "liquidity" \|\| section === "routing"/);
    assert.match(liveMarket, /section === "trade"[\s\S]*?compactMarketContext/);
    assert.match(liveMarket, /className="execution-market-strip"/);
    assert.match(liveMarket, /\{marketContext\}/);
  });

  it("shows a compact book strip on Trade without repeating it on healthy analysis sections", () => {
    assert.match(cockpit, /section === "trade" \|\| mode === "outage"/);
    assert.match(cockpit, /compact=\{section === "trade"\}/);
    assert.match(pnlStrip, /cockpit-strip--compact/);
    assert.match(pnlStrip, /!compact \? \(/);
  });
});

describe("order submission stays behind the operator gate", () => {
  it("authorises before doing anything else", () => {
    assert.match(ordersRoute, /authorisePaperOrder\(request\.headers\.get\("authorization"\)\)/);
    // Compare against the call site, not the import line.
    const gateAt = ordersRoute.indexOf("authorisePaperOrder(request.headers");
    const submitAt = ordersRoute.indexOf("await callGateway");
    assert.ok(gateAt > 0 && submitAt > 0 && gateAt < submitAt, "the gate must come before the submission");
  });

  it("rejects bad input instead of coercing it", () => {
    // Coercing an unparseable notional into a default would mean the trader's
    // screen and the audit log disagree about what was asked for.
    for (const code of ["invalid_symbol", "invalid_side", "invalid_notional", "invalid_order_type"]) {
      assert.match(ordersRoute, new RegExp(code));
    }
  });

  it("never exposes the gateway credential name to the browser bundle", () => {
    assert.ok(!/NEXT_PUBLIC_ALPHAENGINE/.test(ordersRoute));
    assert.ok(!/NEXT_PUBLIC_ALPHAENGINE/.test(auditRoute));
  });
});

describe("the audit window is read-only", () => {
  it("exports no mutating handler", () => {
    assert.match(auditRoute, /export async function GET/);
    assert.ok(!/export async function (POST|PUT|DELETE|PATCH)/.test(auditRoute));
  });

  it("clamps the requested limit rather than trusting it", () => {
    assert.match(auditRoute, /Math\.min\(Math\.max\(/);
  });
});
