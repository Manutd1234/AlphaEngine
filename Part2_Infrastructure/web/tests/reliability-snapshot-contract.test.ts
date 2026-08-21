/**
 * What the gateway said, and whether we are entitled to believe it.
 *
 * Everything the reliability surface concludes is downstream of two questions
 * asked at the runtime boundary: is this payload the shape we compiled against,
 * and is it recent enough to mean anything. Both are answered here, before any
 * posture is derived from them.
 *
 * The pair is deliberately independent. A snapshot can arrive over a healthy
 * transport and still be minutes old, and a transport can be unreachable
 * without the last snapshot having been wrong — so `gatewaySourceFreshness`
 * classifies age separately from reachability rather than folding the two into
 * one word. Folding them is how a gateway that stopped publishing gets painted
 * with the colour of the socket that is still open.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gatewaySourceFreshness, isGatewayOpsSnapshot } from "../lib/reliability";
import { NOW, platform } from "./helpers/reliability-fixtures";

describe("gateway operations snapshot contract", () => {
  it("accepts schema v1 and rejects silent contract drift", () => {
    assert.equal(isGatewayOpsSnapshot(platform()), true);
    assert.equal(isGatewayOpsSnapshot({ ...platform(), schema_version: 2 }), false);
    assert.equal(isGatewayOpsSnapshot({ ...platform(), queue: { ...platform().queue, workers: "two" } }), false);
    assert.equal(isGatewayOpsSnapshot({ ...platform(), observed_at: "yesterday-ish" }), false);
  });

  it("classifies age independently from transport reachability", () => {
    assert.equal(gatewaySourceFreshness(platform(), undefined, NOW).state, "fresh");
    assert.equal(gatewaySourceFreshness(
      platform({ observed_at: new Date(NOW - 16_000).toISOString() }),
      undefined,
      NOW,
    ).state, "stale");
    assert.equal(gatewaySourceFreshness(undefined, {
      code: "gateway_not_configured",
      error: "not configured",
    }, NOW).state, "not_configured");
    assert.equal(gatewaySourceFreshness(undefined, {
      code: "gateway_timeout",
      error: "timed out",
    }, NOW).state, "unreachable");
  });
});
