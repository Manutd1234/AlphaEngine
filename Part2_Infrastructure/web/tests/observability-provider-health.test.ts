/**
 * Reading a provider's health must not change it.
 *
 * A status endpoint gets polled. If the poll shares the dispatch path's state
 * machine, then merely watching a circuit breaker half-opens it, and the next
 * real request is sent to a provider that was being held out — a failure that
 * arrives as a 200 and a plausible screen. So `breakerSnapshot` reports what
 * `breakerOpen` would decide without performing the transition, and
 * `providerStatus` reads the same record without clearing it.
 *
 * Retirement is where the distinction was got wrong once already. `breakerOpen`
 * runs BEFORE the call, so deleting the record when the cooldown elapsed left
 * nothing to say a circuit had ever been open, `recordSuccess` emitted no
 * closing transition, and every automatically recovered circuit read as open
 * forever in the remediation ledger. The record survives with its count zeroed.
 *
 * The failover route is the same information as a graph, and it has to agree
 * with the code it describes: exactly one node active and it is the first
 * routable one, no active provider at all when the chain is dark rather than an
 * invented one, and a learned licence refusal shown on both the node and the
 * provider row — scoped to the capability that was refused, since the same key
 * still routes everything else.
 *
 * A simulated outage is the operator's own skip, and it carries its own reason
 * so an intentional drill can never be read as a vendor failure. It also cannot
 * outlive the operator: the ttl has a floor and it expires on its own.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activeOutages,
  clearAllOutages,
  simulateOutage,
} from "../lib/observability";
import {
  failoverRoute,
  providerStatus,
} from "../lib/providers/registry";
import {
  BREAKER_COOLDOWN_MS,
  breakerOpen,
  breakerSnapshot,
  dispatch,
  markUnlicensed,
  MemoryStore,
  recordFailure,
  resetBreaker,
} from "../lib/providers/runtime";
import { EMPTY_ENV, fake } from "./helpers/observability-doubles";

// --------------------------------------------------------------------------
// Breaker introspection
// --------------------------------------------------------------------------

describe("reading breaker state does not change it", () => {
  it("breakerSnapshot leaves an elapsed breaker open for the next real caller to probe", () => {
    const s = new MemoryStore();
    s.set("breaker:x", { failures: 3, openedAt: Date.now() - BREAKER_COOLDOWN_MS - 1 }, 60_000);

    const snap = breakerSnapshot("x", s);
    assert.equal(snap.state, "half_open");
    assert.notEqual(s.get("breaker:x"), undefined, "polling status retired the breaker");

    // breakerOpen is the dispatch path and *is* allowed to retire it.
    assert.equal(breakerOpen("x", s), false);

    /**
     * Retired means "no longer holding the provider out", not "erased".
     *
     * This used to assert the record was deleted outright. That delete was the
     * bug: `breakerOpen` runs BEFORE the call, so by the time the probe
     * succeeded there was nothing left to say a circuit had been open, and
     * `recordSuccess` emitted no closing transition. Every automatically
     * recovered circuit then read as still open forever in the remediation
     * ledger. The failure count is still zeroed — a failed probe re-counts from
     * one, exactly as documented — but the record survives to carry that fact.
     */
    assert.equal(breakerSnapshot("x", s).state, "closed", "the breaker still holds the provider out");
    assert.equal(breakerSnapshot("x", s).failures, 0, "the failure count did not reset");
    assert.equal(breakerOpen("x", s), false, "a retired breaker still skips the provider");
  });

  it("carries the failure count toward the trip while still closed", () => {
    const s = new MemoryStore();
    recordFailure("y", s);
    const snap = breakerSnapshot("y", s);
    assert.equal(snap.state, "closed");
    assert.equal(snap.failures, 1);
    assert.equal(snap.threshold, 3);
  });

  it("reset reports whether a circuit was actually holding the provider out", () => {
    const s = new MemoryStore();
    recordFailure("z", s);
    assert.equal(resetBreaker("z", s), false, "a single failure was reported as an open circuit");
    for (let i = 0; i < 3; i++) recordFailure("z", s);
    assert.equal(resetBreaker("z", s), true);
  });
});

// --------------------------------------------------------------------------
// Simulated outages
// --------------------------------------------------------------------------

describe("a simulated outage is visibly deliberate and cannot outlive the operator", () => {
  it("dispatch skips the provider with its own reason, not a borrowed one", async () => {
    clearAllOutages();
    const s = new MemoryStore();
    simulateOutage("primary", 60_000);

    const result = await dispatch(
      [fake("primary"), fake("secondary")],
      (a, ctx) => a.quote!("TEST", "equity", ctx),
      { capability: "quote", cacheKey: "sim-1", store: s, env: EMPTY_ENV },
    );

    assert.equal(result.provenance.provider, "secondary", "failover did not happen");
    assert.equal(result.attempts[0].provider, "primary");
    assert.equal(
      result.attempts[0].reason,
      "simulated_outage",
      "an operator-caused skip was labelled as something else",
    );
    clearAllOutages();
  });

  it("expires on its own", () => {
    clearAllOutages();
    // Below the 10s floor, so the clamp is what is being checked too.
    //
    // MEASURED FROM A CLOCK READ *BEFORE* THE CALL, and that is the whole fix.
    // `simulateOutage` sets `expiresAt = Date.now() + bounded`, so comparing it
    // against a SECOND `Date.now()` taken afterwards asks the two reads to land
    // in the same millisecond: any elapsed tick makes the difference 9,999 and
    // the assertion fails. Green in isolation, red about one run in six under
    // full-suite load, which is the shape of flake that gets a real guard
    // deleted for being noisy. Not weakened — `before` is the earliest instant
    // the call could have read, so the floor is still asserted exactly.
    const before = Date.now();
    const record = simulateOutage("primary", 1_000);
    assert.ok(record.expiresAt - before >= 10_000, "the ttl floor did not apply");
    assert.equal(activeOutages().length, 1);
    clearAllOutages();
    assert.equal(activeOutages().length, 0);
  });
});

// --------------------------------------------------------------------------
// Failover graph
// --------------------------------------------------------------------------

describe("the failover graph agrees with the code it describes", () => {
  it("marks exactly one active node and it is the first routable one", () => {
    const s = new MemoryStore();
    const route = failoverRoute("quote", "crypto", EMPTY_ENV, s);
    assert.ok(route.nodes.length > 1, "expected a ranked chain");

    const active = route.nodes.filter((n) => n.active);
    assert.equal(active.length, 1, "more than one node claimed to be serving");
    assert.equal(active[0].provider, route.activeProvider);
    // With no keys configured only the keyless provider can route.
    assert.equal(route.activeProvider, "binance");
    assert.ok(
      route.nodes.filter((n) => n.provider !== "binance").every((n) => n.state === "not_configured"),
      "an unconfigured provider was reported as routable",
    );
  });

  it("reports no active provider rather than inventing one when the chain is dark", () => {
    const s = new MemoryStore();
    // Fundamentals has no keyless provider, so an empty env leaves it unroutable.
    const route = failoverRoute("fundamentals", "equity", EMPTY_ENV, s);
    assert.equal(route.activeProvider, null);
    assert.ok(route.nodes.every((n) => !n.active));
  });

  it("a learned licence refusal shows on the route node and the provider row", () => {
    const s = new MemoryStore();
    const env = { ...EMPTY_ENV, TIINGO_API_KEY: "k" } as NodeJS.ProcessEnv;
    markUnlicensed("tiingo", "news", 403, "You do not have permission to access the News API", s);
    const news = failoverRoute("news", "equity", env, s);
    const tiingo = news.nodes.find((n) => n.provider === "tiingo")!;
    assert.equal(tiingo.state, "unlicensed");
    assert.match(tiingo.detail, /HTTP 403 on news; learned on this instance, re-probes in \d+ h/);
    assert.equal(tiingo.active, false, "an unlicensed node must not be the one serving");
    // Scoped to the capability: the same key still routes quotes.
    const quote = failoverRoute("quote", "equity", env, s);
    assert.equal(quote.nodes.find((n) => n.provider === "tiingo")!.state, "ready");
    // And the provider row lists what the key was refused.
    const row = providerStatus(env, s).find((r) => r.id === "tiingo")!;
    assert.deepEqual(row.licence.map((b) => [b.capability, b.status]), [["news", 403]]);
    assert.ok(row.licence[0].expiresAt > Date.now());
  });

  it("providerStatus exposes the breaker shape and does not mutate it", () => {
    const s = new MemoryStore();
    for (let i = 0; i < 3; i++) recordFailure("fmp", s);
    const rows = providerStatus(EMPTY_ENV, s);
    const fmp = rows.find((r) => r.id === "fmp")!;
    assert.equal(fmp.breaker.state, "open");
    assert.equal(fmp.circuitOpen, true);
    assert.ok(fmp.breaker.cooldownRemainingMs > 0);
    assert.notEqual(s.get("breaker:fmp"), undefined, "reading status cleared the breaker");
  });
});
