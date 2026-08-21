/**
 * The gateway credential never leaves the server, and neither route lets it.
 *
 * Two halves of one boundary, kept together because either alone would let the
 * other rot. `lib/gateway` decides what a server-side call carries — the token
 * header, an http-only base URL, and a named 503 when a deployment was never
 * configured. The two route handlers are what actually make those calls, and
 * they are the only place the credential could leak to the browser bundle.
 *
 * The route halves are asserted against source. The route modules read
 * `process.env` at call time and would need a live gateway to exercise, so what
 * is pinned is the contract a future edit would have to break deliberately —
 * the same approach `risk-actions.test.ts` takes.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gatewayBase, gatewayHeaders, notConfigured } from "../lib/gateway";
import { read } from "./helpers/cockpit-sources";

const ordersRoute = read("app/api/gateway/orders/route.ts");
const auditRoute = read("app/api/gateway/audit/route.ts");

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
