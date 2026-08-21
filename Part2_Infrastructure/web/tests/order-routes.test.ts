/**
 * The order-lifecycle proxy routes.
 *
 * Three same-origin routes sit between the workspace and the gateway's resting
 * book: one read (`/api/gateway/orders/working`) and two writes
 * (`/api/gateway/orders/{id}/cancel`, `.../replace`). None of them is imported
 * here. They read `process.env` at call time and would need a live gateway to
 * exercise, so what is pinned is the contract a future edit would have to break
 * deliberately — the same approach `cockpit-blotter-data.test.ts` and `risk-actions.test.ts`
 * take for the routes they cover.
 *
 * This lives in its own file rather than appended to `cockpit-blotter-data.test.ts` on
 * purpose. That file locates the order route's gate by *string offset* into the
 * source, which is a measurement that a stray edit above the call site can
 * silently invert. Growing that pattern across five routes in one file would
 * multiply a fragile assertion; a sibling file keeps each measurement next to
 * the source it measures.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

function routeSource(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../app/api/gateway/${path}`, import.meta.url)), "utf8");
}

const workingRoute = routeSource("orders/working/route.ts");
const cancelRoute = routeSource("orders/[id]/cancel/route.ts");
const replaceRoute = routeSource("orders/[id]/replace/route.ts");

const MUTATING = [
  { name: "cancel", source: cancelRoute },
  { name: "replace", source: replaceRoute },
];

const ALL = [
  { name: "working", source: workingRoute },
  ...MUTATING,
];

// --------------------------------------------------------------------------
// The read
// --------------------------------------------------------------------------

describe("the working-order window is read-only", () => {
  it("exports no mutating handler", () => {
    assert.match(workingRoute, /export async function GET/);
    assert.ok(
      !/export async function (POST|PUT|DELETE|PATCH)/.test(workingRoute),
      "a write path here would be a second, ungated way to reshape the book",
    );
  });

  it("does not gate a read behind the operator token", () => {
    // Reads are not operator-gated anywhere in this app — `gateway/audit` is the
    // precedent. Gating this one would show a trader an empty resting book on a
    // deployment without the token, which is worse than anything it prevents.
    assert.ok(!/authorise\(/.test(workingRoute));
  });

  it("rejects a malformed symbol instead of widening it to the whole book", () => {
    // Silently dropping a bad filter is how someone reads the desk's resting
    // orders while believing they are reading one instrument's.
    assert.match(workingRoute, /invalid_symbol/);
  });
});

// --------------------------------------------------------------------------
// The writes
// --------------------------------------------------------------------------

describe("cancel and replace stay behind the operator gate", () => {
  for (const { name, source } of MUTATING) {
    it(`${name} authorises before it reaches the gateway`, () => {
      assert.match(source, /authorise\(request\.headers\.get\("authorization"\)\)/);
      // Compare against the call site, not the import line.
      const gateAt = source.indexOf("authorise(request.headers");
      const callAt = source.indexOf("await callGateway");
      assert.ok(gateAt > 0, `${name} must call the gate`);
      assert.ok(callAt > 0, `${name} must reach the gateway through the shared boundary`);
      assert.ok(gateAt < callAt, `${name}: the gate must come before the relay`);
    });

    it(`${name} names every blocker when the guard is locked`, () => {
      // A caller told to set the operator token, who then discovers a missing
      // gateway URL behind it, was answered twice for one question.
      assert.match(source, /guardMode\(\) === "locked"/);
      assert.match(source, /blockers/);
    });

    it(`${name} relays a vanished order as a 404, not an outage`, () => {
      // The order stopped resting between the book being read and the button
      // being pressed. That is the most ordinary race in order handling, and
      // the shared boundary's blanket 502 would send the trader hunting an
      // outage that does not exist.
      assert.match(source, /upstreamStatus === 404/);
      assert.match(source, /order_not_resting/);
      assert.match(source, /status: 404/);
    });
  }

  it("replace rejects bad input instead of coercing it", () => {
    for (const code of ["invalid_quantity", "invalid_notional", "invalid_limit_price", "ambiguous_size"]) {
      assert.match(replaceRoute, new RegExp(code));
    }
    // A replace that changes nothing still retires the working order and loses
    // queue priority, so an empty body is a rejection rather than a no-op.
    assert.match(replaceRoute, /no_change_requested/);
  });

  it("replace relays a gated rejection as a result, not an error", () => {
    // The decision vector is the only thing that says WHICH limit bound. An
    // error status would push it into the client's error path, where this app
    // renders a banner instead of the evidence.
    assert.match(replaceRoute, /\{ ok: true, replaced: orderId, requested: patch, decision: result\.data \}/);
  });

  it("cancel demands no typed-confirmation ritual", () => {
    // That ceremony suits a desk-wide kill. On an action a trader repeats, and
    // one that only ever reduces exposure, a confirmation is a dialog people
    // learn to dismiss without reading.
    assert.ok(!/confirmation_required/.test(cancelRoute));
    assert.ok(!/CONFIRM_WORD/.test(cancelRoute));
  });
});

// --------------------------------------------------------------------------
// Shared invariants
// --------------------------------------------------------------------------

describe("every order-lifecycle route", () => {
  for (const { name, source } of ALL) {
    it(`${name} never caches an answer about live book state`, () => {
      assert.match(source, /"Cache-Control": "no-store"/);
    });

    it(`${name} carries no credential of its own`, () => {
      // The gateway and operator tokens are read from the process environment by
      // `lib/gateway` and `lib/operator`. A NEXT_PUBLIC_ read would ship the
      // credential's value to the browser bundle; a literal would ship it to git.
      assert.ok(!/NEXT_PUBLIC_/.test(source), `${name} must not read a NEXT_PUBLIC_ credential`);
      assert.ok(
        !/(Bearer\s+[A-Za-z0-9._\-]{8,}|X-AlphaEngine-Token"?\s*:\s*")/.test(source),
        `${name} must not hardcode a token`,
      );
      // Tokens are only ever named, never valued, in a route.
      assert.ok(!/ALPHAENGINE_(GATEWAY|OPERATOR)_TOKEN\s*=/.test(source));
    });

    it(`${name} runs on the node runtime and is never statically rendered`, () => {
      // The edge runtime has no `node:crypto`, which `authorise` needs for its
      // constant-time compare; a statically rendered route would answer with a
      // book frozen at build time.
      assert.match(source, /export const runtime = "nodejs"/);
      assert.match(source, /export const dynamic = "force-dynamic"/);
    });
  }
});
