/**
 * Test doubles for the provider layer.
 *
 * The provider suites are split by concern — coercion, routing, error taxonomy,
 * quota, breaker, dispatch, SSRF — and several of them need the same fake
 * vendor. It lives here once, because a second copy is how two suites end up
 * asserting against subtly different adapters and neither of them notices.
 *
 * Nothing here touches the network. `fake` counts its calls, because most of
 * what those suites prove is that a provider was NOT contacted: skipped by the
 * quota ledger, by an open circuit, or by a remembered licence refusal.
 */

import { Adapter, ProviderError, Quote } from "../../lib/providers/types";

export const QUOTE: Quote = {
  symbol: "TEST", price: 100, change: 1, changePct: 1, open: 99, high: 101,
  low: 98, prevClose: 99, volume: 1000, currency: "USD",
  asOf: "2026-08-03T00:00:00.000Z", delayed: false,
};

export function fake(
  id: string,
  behave: (calls: number) => Quote,
  quota: Adapter["meta"]["quota"] = { calls: 10, window: "day", reserve: 0.2 },
): { adapter: Adapter; calls: () => number } {
  let calls = 0;
  const adapter: Adapter = {
    meta: {
      id, label: id, docs: "", capabilities: ["quote"], assets: ["equity"],
      keyEnv: "", quota, rank: { quote: 1 }, signup: "",
    },
    quote: async () => {
      calls += 1;
      return behave(calls);
    },
  };
  return { adapter, calls: () => calls };
}

export const failing = (id: string) =>
  fake(id, () => {
    throw new ProviderError(id, "boom", 500, false);
  });

/** An adapter that answers, correctly, that it has nothing — or refuses. */
export const throwing = (id: string, status: number, message = `HTTP ${status}`) =>
  fake(id, () => {
    throw new ProviderError(id, message, status, false);
  });

/** Distinct latency keys per test: the ledger is module-scoped. */
let seq = 0;
export const uid = (base: string) => `${base}-${++seq}`;
