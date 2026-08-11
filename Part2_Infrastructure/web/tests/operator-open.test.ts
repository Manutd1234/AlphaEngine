/**
 * The demo escape hatch from closed-by-default operator actions.
 *
 * `ALPHAENGINE_OPERATOR_OPEN=1` opens every operator surface — order ticket,
 * risk actions, remediation — to anyone who can reach the URL, no token asked.
 * That exists for one situation: a paper-trading assessment whose reviewers
 * must be able to click Send without being handed a credential first. It is
 * survivable because nothing an operator can do is permanent (paper orders
 * behind the gateway's own gates, a reversible kill switch, caches that
 * refill, outages that expire).
 *
 * These tests pin the shape of the hatch, because an escape hatch with fuzzy
 * edges becomes the default: it must open on the exact literal "1" and
 * nothing else, it must not weaken token mode when unset, and the UI must be
 * told a distinct mode so it can say plainly that the door is open.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  authorise,
  guardMode,
  operatorIdentity,
  tokenOverrideAvailable,
  OPERATOR_OPEN_ENV,
  OPERATOR_TOKEN_ENV,
} from "@/lib/operator";
import { operatorBlockedReason } from "@/lib/risk-tiers";

const prod = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

describe("the flag opens production only on the exact literal '1'", () => {
  it("'1' opens", () => {
    assert.equal(guardMode({ ...prod, [OPERATOR_OPEN_ENV]: "1" }), "open-demo");
  });

  it("every other truthy-looking value stays closed", () => {
    // "true", "yes", "on" are what someone reasoning from other ecosystems
    // sets. None of them may open the gate — and neither may "false", which
    // truthiness would treat as open.
    for (const value of ["true", "yes", "on", "false", "0", "2", " ", ""]) {
      assert.notEqual(
        guardMode({ ...prod, [OPERATOR_OPEN_ENV]: value }),
        "open-demo",
        `"${value}" opened the operator gate`,
      );
    }
  });

  it("'1' with surrounding whitespace still opens — env files add newlines", () => {
    assert.equal(guardMode({ ...prod, [OPERATOR_OPEN_ENV]: " 1\n" }), "open-demo");
  });

  it("absent, production stays locked and non-production stays open-dev", () => {
    assert.equal(guardMode(prod), "locked");
    assert.equal(guardMode({ NODE_ENV: "test" } as NodeJS.ProcessEnv), "open-dev");
  });
});

describe("the flag is the more explicit statement of intent", () => {
  it("open beats a configured token", () => {
    // A demo that starts demanding tokens because someone also set one is a
    // confusing demo. Both set → open, deliberately.
    const env = { ...prod, [OPERATOR_OPEN_ENV]: "1", [OPERATOR_TOKEN_ENV]: "secret" };
    assert.equal(guardMode(env), "open-demo");
    assert.equal(authorise(null, env), null);
  });

  it("token mode is untouched when the flag is unset", () => {
    const env = { ...prod, [OPERATOR_TOKEN_ENV]: "secret" };
    assert.equal(guardMode(env), "token");
    assert.notEqual(authorise(null, env), null, "token mode accepted an absent credential");
    assert.equal(authorise("Bearer secret", env), null);
  });
});

describe("open modes admit absence but check any presented credential", () => {
  // The original contract let any header pass in open-demo. That made a typed
  // credential meaningless — an operator overriding the open door needs to
  // know the override was checked. Presence now means authoritative override,
  // the same principle authorisePaperOrder always had.
  it("no header passes through the open door", () => {
    const env = { ...prod, [OPERATOR_OPEN_ENV]: "1", [OPERATOR_TOKEN_ENV]: "secret" };
    assert.equal(authorise(null, env), null);
  });

  it("a valid credential passes as an explicit override", () => {
    const env = { ...prod, [OPERATOR_OPEN_ENV]: "1", [OPERATOR_TOKEN_ENV]: "secret" };
    assert.equal(authorise("Bearer secret", env), null);
  });

  it("a wrong credential is rejected, never downgraded to the open door", () => {
    const env = { ...prod, [OPERATOR_OPEN_ENV]: "1", [OPERATOR_TOKEN_ENV]: "secret" };
    const rejection = authorise("Bearer wrong", env);
    assert.ok(rejection);
    assert.equal(rejection.status, 401);
    assert.equal(rejection.code, "operator_auth_failed");
  });

  it("a credential with no server token to check it against is rejected with the reason", () => {
    const env = { ...prod, [OPERATOR_OPEN_ENV]: "1" };
    const rejection = authorise("Bearer anything", env);
    assert.ok(rejection);
    assert.equal(rejection.status, 401);
    assert.match(rejection.hint!, new RegExp(OPERATOR_TOKEN_ENV));
  });

  it("the override is offered only when it can actually validate", () => {
    assert.equal(
      tokenOverrideAvailable({ ...prod, [OPERATOR_OPEN_ENV]: "1", [OPERATOR_TOKEN_ENV]: "secret" }),
      true,
    );
    assert.equal(tokenOverrideAvailable({ ...prod, [OPERATOR_OPEN_ENV]: "1" }), false);
    assert.equal(tokenOverrideAvailable({ ...prod, [OPERATOR_TOKEN_ENV]: "secret" }), false);
  });

  it("identity names who acted once authorised", () => {
    assert.equal(operatorIdentity(null), "demo");
    assert.equal(operatorIdentity("Bearer secret"), "operator");
  });

  it("locked mode names both ways out", () => {
    const rejection = authorise(null, prod);
    assert.ok(rejection);
    assert.equal(rejection.status, 503);
    assert.match(rejection.hint!, new RegExp(OPERATOR_TOKEN_ENV));
    assert.match(rejection.hint!, new RegExp(OPERATOR_OPEN_ENV));
  });
});

describe("client-side gating follows the server's mode", () => {
  it("open modes do not demand a token the server will never check", () => {
    assert.equal(operatorBlockedReason({ guard: "open-demo" }), null);
    assert.equal(operatorBlockedReason({ guard: "open-dev" }), null);
  });

  it("token mode still demands one, and locked still refuses", () => {
    assert.match(operatorBlockedReason({ guard: "token" })!, /authentication required/i);
    assert.match(operatorBlockedReason({ guard: "locked" })!, /disabled/i);
  });

  it("an unprobed guard fails closed", () => {
    // Before /api/system/health has answered, the UI does not know the mode.
    // Demanding a token then is the strict reading; assuming open is not.
    assert.match(operatorBlockedReason({})!, /authentication required/i);
  });
});
