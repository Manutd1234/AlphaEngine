/**
 * The quota ledger — does background traffic actually stop at the reserve?
 *
 * Nothing here touches the network; the point of the ledger is to decide when
 * nothing should. Free vendor tiers are counted in calls per day or per month,
 * and the desk spends them on two very different things: polling nobody is
 * watching, and a person waiting for an answer. The reserve exists so the
 * second never loses to the first, which means "background" must be fenced out
 * of it while "interactive" may spend it.
 *
 * Two ways this fails quietly. A reserve that background traffic can spend
 * looks fine until the analyst types a symbol and finds the allowance gone. And
 * a window whose expiry slides forward on every increment never resets under
 * constant load — the provider is starved permanently by its own popularity,
 * with a counter that looks entirely reasonable.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryStore, quotaBlock, spendQuota, windowKey } from "../lib/providers/runtime";
import { QUOTE, fake } from "./helpers/provider-doubles";

test("quota: background is fenced out of the reserve, interactive can spend it", () => {
  const s = new MemoryStore();
  const { adapter } = fake("m", () => QUOTE, { calls: 4, window: "day", reserve: 0.5 });

  // Spend down to the reserve boundary (reserve = 2 of 4).
  spendQuota(adapter, s);
  spendQuota(adapter, s);
  assert.equal(quotaBlock(adapter, "background", s), "quota_reserved");
  assert.equal(quotaBlock(adapter, "interactive", s), null);

  // Interactive spends the rest; then even interactive is blocked.
  spendQuota(adapter, s);
  spendQuota(adapter, s);
  assert.equal(quotaBlock(adapter, "interactive", s), "quota_exhausted");
});

test("quota: windows are calendar-aligned, so a month rolls the counter", () => {
  const jan = windowKey("month", Date.UTC(2026, 0, 31, 23, 59));
  const feb = windowKey("month", Date.UTC(2026, 1, 1, 0, 1));
  assert.notEqual(jan, feb);
  const d1 = windowKey("day", Date.UTC(2026, 7, 3, 23, 59));
  const d2 = windowKey("day", Date.UTC(2026, 7, 4, 0, 0));
  assert.notEqual(d1, d2);
});

test("quota: incr does not slide the window forward", () => {
  const s = new MemoryStore();
  // Two increments must share one expiry; a sliding TTL would never reset the
  // counter for a provider under constant load — permanent starvation.
  s.incr("k", 1000);
  const firstExpiry = (s as unknown as { map: Map<string, { expiresAt: number }> }).map.get("k")!.expiresAt;
  s.incr("k", 1000);
  const secondExpiry = (s as unknown as { map: Map<string, { expiresAt: number }> }).map.get("k")!.expiresAt;
  assert.equal(firstExpiry, secondExpiry);
});
