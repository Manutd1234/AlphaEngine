/**
 * Execution spends vertical space only where the active task needs it.
 *
 * The market context strip and the book strip are both worth their height on
 * the sections that are about reading the market — Liquidity and Routing — and
 * both are a tax on Trade, where the task is entering an order and the screen
 * below the fold is the order ticket. So the same components render compact
 * there, rather than being duplicated per section or dropped entirely.
 *
 * The exception is the one that matters: the book strip comes back at full size
 * on an outage, because a degraded feed is exactly when a trader needs to see
 * what the desk still knows.
 *
 * Asserted against source. A render test would have to reproduce the section
 * routing to observe this, and what is actually being pinned is the condition —
 * which is a property of the code.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read } from "./helpers/cockpit-sources";

const cockpit = read("components/execution/ExecutionCockpit.tsx");
const liveMarket = read("components/LiveMarket.tsx");
const pnlStrip = read("components/execution/PnlStrip.tsx");

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
