/**
 * The adapter and the environment every observability suite dispatches against.
 *
 * `observability-cache-store.test.ts` was split by concern, and two of the successors —
 * `observability-cache-store` and `observability-provider-health` — call
 * `dispatch` against a fake provider. They have to dispatch against the *same*
 * one: a suite with its own quietly different adapter would still go green
 * while it stopped exercising the runtime the other suite describes.
 *
 * `EMPTY_ENV` is deliberately empty rather than a copy of `process.env`. Half
 * the routing assertions in this tree read "with no keys configured only the
 * keyless provider can route", and that sentence is only true of an env nobody
 * has quietly added a key to.
 *
 * NOT the same double as `provider-doubles.ts`, and the two must not be merged
 * on the strength of the shared name. That `fake` carries a real quota
 * (`{ calls: 10, … }`) because the provider suites are about the quota fence
 * itself; this one carries `quota: null` so the fence never intervenes in an
 * observability assertion. Folding them together would leave these suites
 * silently measuring a fenced dispatch instead of the one they describe.
 */

import { Adapter, Quote } from "../../lib/providers/types";

export const QUOTE: Quote = {
  symbol: "TEST", price: 100, change: 1, changePct: 1, open: 99, high: 101,
  low: 98, prevClose: 99, volume: 1000, currency: "USD",
  asOf: "2026-08-03T00:00:00.000Z", delayed: false,
};

export function fake(id: string): Adapter {
  return {
    meta: {
      id, label: id, docs: "", capabilities: ["quote"], assets: ["equity"],
      keyEnv: "", quota: null, rank: { quote: 1 }, signup: "",
    },
    quote: async () => QUOTE,
  };
}

export const EMPTY_ENV = {} as NodeJS.ProcessEnv;
