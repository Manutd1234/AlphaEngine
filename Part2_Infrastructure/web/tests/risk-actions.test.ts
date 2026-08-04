/**
 * The write path to the risk gateway.
 *
 * This is the only route in the app that can halt a desk or close a book, so
 * what is pinned here is not the happy path — it is every reason the route
 * should *refuse*. A regression that opens one of these is not a broken feature,
 * it is a one-request kill switch on a public URL.
 *
 * Nothing here touches the network. The route's own module is not imported
 * either: it reads `process.env` at call time and would need a live gateway to
 * exercise. What is asserted instead is the contract the route is built on —
 * the operator gate it shares with the systems console, and the source-level
 * invariants that a future edit would have to break deliberately.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { authorise, guardMode } from "../lib/operator";

const source = readFileSync(
  fileURLToPath(new URL("../app/api/gateway/risk/route.ts", import.meta.url)),
  "utf8",
);

// --------------------------------------------------------------------------
// The gate
// --------------------------------------------------------------------------

describe("reading a book must not imply being able to flatten it", () => {
  it("production without an operator token refuses outright", () => {
    const env = {
      NODE_ENV: "production",
      // A gateway credential alone is deliberately NOT enough. It says this
      // deployment may talk to that gateway, not that this request may change
      // anything.
      ALPHAENGINE_GATEWAY_URL: "https://gateway.example.com",
      ALPHAENGINE_GATEWAY_TOKEN: "a-real-gateway-token",
    } as NodeJS.ProcessEnv;

    assert.equal(guardMode(env), "locked");
    const rejection = authorise(null, env)!;
    assert.equal(rejection.status, 503);
    assert.match(rejection.hint!, /ALPHAENGINE_OPERATOR_TOKEN/);
  });

  it("a wrong operator token is rejected without echoing it", () => {
    const env = {
      NODE_ENV: "production",
      ALPHAENGINE_OPERATOR_TOKEN: "correct-operator-token",
    } as NodeJS.ProcessEnv;
    const rejection = authorise("Bearer wrong-guess", env)!;
    assert.equal(rejection.status, 401);
    assert.ok(!JSON.stringify(rejection).includes("wrong-guess"));
  });

  it("the route applies the gate before it reads the body", () => {
    // Order matters: parsing first would let an unauthorised caller probe for
    // validation differences between actions.
    const gateAt = source.indexOf("authorise(request.headers");
    const bodyAt = source.indexOf("await request.json()");
    assert.ok(gateAt > -1 && bodyAt > -1, "both steps must exist");
    assert.ok(gateAt < bodyAt, "the operator gate must run before the body is read");
  });
});

// --------------------------------------------------------------------------
// Confirmation
// --------------------------------------------------------------------------

describe("a destructive action needs a typed word, not a flag", () => {
  it("requires the literal action name rather than a boolean", () => {
    // `confirm: true` set by the same UI that fired the request is not a
    // confirmation, and a captured request body would replay it.
    assert.match(source, /CONFIRM_WORD/, "a confirmation vocabulary must exist");
    assert.match(source, /halt: "HALT"/);
    assert.match(source, /flatten: "FLATTEN"/);
    assert.ok(
      !/confirm\s*===\s*true/.test(source),
      "a boolean confirm flag would defeat the purpose",
    );
  });

  it("answers 428 rather than 400 when the confirmation is missing", () => {
    // 428 Precondition Required says "do this first"; 400 says "you are wrong",
    // and a client cannot tell a missing confirmation from a malformed body.
    assert.match(source, /confirmation_required/);
    assert.match(source, /status: 428/);
  });
});

// --------------------------------------------------------------------------
// Flatten
// --------------------------------------------------------------------------

describe("flatten is composed from endpoints that exist", () => {
  it("never calls the flatten endpoint the gateway does not have", () => {
    // A hand-off card in this repo pointed at POST /api/orders/flatten, which
    // is not a route on the gateway and would have 404ed for anyone who ran it.
    // Matched as a quoted path — the route's own comment names it precisely to
    // explain why it is absent, and prose is not a call site.
    assert.ok(
      !/["'`]\/api\/orders\/flatten["'`]/.test(source),
      "the gateway exposes no flatten endpoint — compose it from /api/orders",
    );
    assert.match(source, /"\/api\/portfolio"/, "flatten must read the authoritative book first");
    assert.match(source, /"\/api\/orders"/, "flatten must submit through the risk-gated order route");
  });

  it("submits closing orders sequentially, never in parallel", () => {
    // The gateway's exposure accounting is stateful. Concurrent submissions
    // would all be gated against the same stale book, so a flatten that should
    // partly reject could be fully accepted.
    assert.match(source, /for \(const position of positions\)/, "must loop, not map");
    assert.ok(
      !/Promise\.all\([^)]*positions/.test(source),
      "positions must not be flattened concurrently",
    );
  });

  it("relays the gateway's own decision for every order", () => {
    // A rejection here is the pre-trade gates doing their job. Swallowing it
    // would make a partially-filled flatten look complete.
    assert.match(source, /decision: result\.body/);
    assert.match(source, /accepted: result\.ok/);
  });

  it("skips positions that are already flat", () => {
    assert.match(source, /p\.side !== "FLAT"/);
  });
});

// --------------------------------------------------------------------------
// Credential handling
// --------------------------------------------------------------------------

describe("the gateway credential never leaves the server", () => {
  it("reads the token at call time and sends the gateway's own header", () => {
    assert.match(source, /process\.env\.ALPHAENGINE_GATEWAY_TOKEN\?\.trim\(\)/);
    // The gateway authenticates with X-AlphaEngine-Token. A bearer header is
    // silently ignored by it, which fails open-looking and closed in fact.
    assert.match(source, /"X-AlphaEngine-Token"/);
    assert.ok(!/NEXT_PUBLIC_ALPHAENGINE/.test(source), "the token must never be public");
  });

  it("reclassifies a gateway auth failure instead of proxying its status", () => {
    // A 401 from the gateway is not a 401 from us — a browser seeing one would
    // prompt for entirely the wrong credential.
    assert.match(source, /gateway_auth_failed/);
    assert.match(source, /status: authFailed \? 502/);
  });

  it("refuses when no gateway is configured rather than acting on nothing", () => {
    assert.match(source, /gateway_not_configured/);
  });
});
