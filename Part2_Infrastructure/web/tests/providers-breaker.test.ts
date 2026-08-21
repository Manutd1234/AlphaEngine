/**
 * The circuit breaker — a dead provider gets skipped, and gets another chance.
 *
 * Nothing here touches the network. Three consecutive real failures open the
 * circuit; after the cooldown one probe is allowed through, and what happens to
 * that probe has to be OBSERVABLE, because the remediation ledger is built from
 * the events these functions emit rather than from their return values.
 *
 * That is the asymmetry worth guarding. A recovery that closes silently reads
 * as a circuit still open forever — a desk that never heals itself. A "closed"
 * event emitted when nothing was open invents a recovery that never happened.
 * Both end the same way: the operator stops believing the surface, and then the
 * one real outage looks like more of the same noise.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { eventCursor, eventsSince } from "../lib/observability";
import { MemoryStore, breakerOpen, recordFailure, recordSuccess } from "../lib/providers/runtime";

test("breaker: opens after 3 consecutive failures, not before", () => {
  const s = new MemoryStore();
  recordFailure("x", s);
  recordFailure("x", s);
  assert.equal(breakerOpen("x", s), false);
  recordFailure("x", s);
  assert.equal(breakerOpen("x", s), true);
});

/**
 * An automatic recovery has to be OBSERVABLE, or the remediation ledger reports
 * every self-healed circuit as still open forever.
 *
 * The dispatch order is the trap: `breakerOpen` is the gate and runs BEFORE the
 * call, so by the time `recordSuccess` runs, the gate has already retired the
 * breaker record. When that retirement was a delete, the success saw nothing to
 * close and emitted nothing — and the only `state: "closed"` line the system
 * ever produced came from an operator pressing the button. A reliability
 * surface built on that reads as a desk that never recovers on its own.
 */
test("breaker: a probe that succeeds after the cooldown emits its own closure", () => {
  const s = new MemoryStore();
  const id = `auto-recovery-${Math.random().toString(36).slice(2, 8)}`;
  const before = eventCursor().latest;

  // A circuit that tripped just over a cooldown ago.
  s.set(`breaker:${id}`, { failures: 3, openedAt: Date.now() - 61_000 }, 240_000);

  assert.equal(breakerOpen(id, s), false, "the cooldown elapsed, so the probe is allowed through");
  recordSuccess(id, s);

  const states = eventsSince(before, 200)
    .filter((e) => e.source === "Breaker" && e.fields.provider === id)
    .map((e) => e.fields.state);
  assert.deepEqual(states, ["half_open", "closed"], "the automatic recovery was silent");
});

test("breaker: a probe that fails re-counts from one and claims no recovery", () => {
  const s = new MemoryStore();
  const id = `failed-probe-${Math.random().toString(36).slice(2, 8)}`;
  const before = eventCursor().latest;

  s.set(`breaker:${id}`, { failures: 3, openedAt: Date.now() - 61_000 }, 240_000);
  breakerOpen(id, s);
  recordFailure(id, s);

  // One failure after a probe is one failure, not a re-trip: the documented
  // behaviour is that re-opening takes three fresh consecutive failures.
  assert.equal(breakerOpen(id, s), false, "a single failed probe re-opened the circuit");

  // And a success now must NOT claim to have closed anything — nothing was open.
  recordSuccess(id, s);
  const closures = eventsSince(before, 200)
    .filter((e) => e.source === "Breaker" && e.fields.provider === id && e.fields.state === "closed");
  assert.equal(closures.length, 0, "a recovery was invented from a circuit that was not open");
});
