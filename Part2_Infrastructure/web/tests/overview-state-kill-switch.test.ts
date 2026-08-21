/**
 * The kill switch's arming gate: what has to be true before the desk can halt
 * itself, and what the button is allowed to say when it cannot.
 *
 * `killSwitchGate` is a pure function precisely so this can be argued about
 * without a browser. It is the most destructive control in the product and the
 * one most likely to be reached in a hurry, so three properties are pinned:
 *
 *  1. THE TYPED WORD IS THE ARM, and it flips with the state. A halted desk is
 *     resumed by typing RESUME, not by typing HALT again into a button whose
 *     label changed underneath the reader.
 *
 *  2. BLOCKED REASONS ARE ORDERED — gateway, locked, token, arm. A reader who
 *     cannot fire needs the FIRST thing standing in their way, not the last;
 *     telling someone to type HALT when the gateway is unreachable sends them
 *     to type a word that will not help.
 *
 *  3. A REASON IS NEVER INVENTED. `busy` blocks firing and returns no reason,
 *     because the honest answer is "a request is in flight" rather than a
 *     fabricated prerequisite. An unprobed gateway (`null`, not `false`) does
 *     not block either — not knowing is not the same as knowing it is down,
 *     which is the same null-honesty rule the rest of this desk runs on.
 *
 * Siblings, from the same module: `-decision-loop` (the five stages),
 * `-network-latency` (the polled upstream plane), `-decision-plane` (the
 * in-process microsecond plane).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { killSwitchGate } from "../lib/overview-state";

describe("killSwitchGate", () => {
  const base = {
    typed: "",
    halted: false,
    guard: "open-dev" as const,
    token: "",
    gatewayConnected: true,
    busy: false,
  };

  it("the typed word is the arm, with the route's normalisation", () => {
    assert.equal(killSwitchGate({ ...base, typed: " halt " }).armed, true);
    assert.equal(killSwitchGate({ ...base, typed: "HALT" }).canFire, true);
    assert.equal(killSwitchGate({ ...base, typed: "RESUME" }).armed, false);
    assert.ok(killSwitchGate(base).blockedReason?.includes("HALT"));
  });

  it("the word flips to RESUME when already halted", () => {
    const gate = killSwitchGate({ ...base, halted: true, typed: "RESUME" });
    assert.equal(gate.action, "resume");
    assert.equal(gate.confirmWord, "RESUME");
    assert.equal(gate.canFire, true);
    assert.equal(killSwitchGate({ ...base, halted: true, typed: "HALT" }).armed, false);
  });

  it("blocked reasons are ordered: gateway, locked, token, arm", () => {
    assert.ok(killSwitchGate({ ...base, gatewayConnected: false, typed: "HALT" }).blockedReason?.includes("gateway"));
    assert.ok(killSwitchGate({ ...base, guard: "locked", typed: "HALT" }).blockedReason?.includes("disabled"));
    assert.ok(killSwitchGate({ ...base, guard: "token", typed: "HALT" }).blockedReason?.includes("token"));
    assert.equal(killSwitchGate({ ...base, guard: "token", token: "s3cret", typed: "HALT" }).canFire, true);
  });

  it("busy blocks firing without inventing a reason", () => {
    const gate = killSwitchGate({ ...base, typed: "HALT", busy: true });
    assert.equal(gate.armed, true);
    assert.equal(gate.canFire, false);
    assert.equal(gate.blockedReason, null);
  });

  it("an unprobed gateway (null) does not block on connectivity", () => {
    assert.equal(killSwitchGate({ ...base, gatewayConnected: null, typed: "HALT" }).canFire, true);
  });
});
