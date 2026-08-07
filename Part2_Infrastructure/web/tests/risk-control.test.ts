import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  RISK_CONFIRM_WORD,
  buildRiskRequest,
  classifyRiskResponse,
  confirmArms,
  operatorHeaders,
} from "../lib/risk-control";

describe("buildRiskRequest", () => {
  it("attaches the operator credential iff a token is present", () => {
    const withToken = buildRiskRequest({ action: "halt", confirm: "HALT", operatorToken: "s3cret" });
    assert.equal(withToken.headers.Authorization, "Bearer s3cret");
    const noToken = buildRiskRequest({ action: "halt", confirm: "HALT" });
    assert.ok(!("Authorization" in noToken.headers));
    const blankToken = buildRiskRequest({ action: "halt", confirm: "HALT", operatorToken: "   " });
    assert.ok(!("Authorization" in blankToken.headers));
  });

  it("passes the typed confirmation through verbatim — the server judges it", () => {
    const shaped = buildRiskRequest({ action: "halt", confirm: " halt " });
    assert.equal(JSON.parse(shaped.body).confirm, " halt ");
  });

  it("drops absent optional fields instead of sending undefined", () => {
    const body = JSON.parse(buildRiskRequest({ action: "resume", confirm: "RESUME" }).body);
    assert.deepEqual(Object.keys(body).sort(), ["action", "confirm"]);
    const full = JSON.parse(
      buildRiskRequest({ action: "halt", confirm: "HALT", reason: " drawdown ", symbol: "ETHUSDT" }).body,
    );
    assert.equal(full.reason, "drawdown");
    assert.equal(full.symbol, "ETHUSDT");
  });
});

describe("operatorHeaders", () => {
  it("attaches the credential iff a token is present", () => {
    assert.equal(operatorHeaders("s3cret").Authorization, "Bearer s3cret");
    assert.ok(!("Authorization" in operatorHeaders()));
    assert.ok(!("Authorization" in operatorHeaders("")));
    assert.ok(!("Authorization" in operatorHeaders("   ")));
    assert.equal(operatorHeaders()["Content-Type"], "application/json");
  });
});

describe("confirmArms", () => {
  it("mirrors the route's normalisation for every action", () => {
    assert.equal(confirmArms(" halt ", "halt"), true);
    assert.equal(confirmArms("RESUME", "resume"), true);
    assert.equal(confirmArms("flatten", "flatten"), true);
    assert.equal(confirmArms("HALT", "resume"), false);
    assert.equal(confirmArms("", "halt"), false);
    assert.equal(Object.keys(RISK_CONFIRM_WORD).length, 4);
  });
});

describe("classifyRiskResponse", () => {
  it("maps the route's status contract to typed outcomes", () => {
    assert.equal(classifyRiskResponse(200, { ok: true, summary: "done" }).code, "ok");
    assert.equal(classifyRiskResponse(428, { code: "confirmation_required" }).code, "needs_confirmation");
    assert.equal(classifyRiskResponse(401, { code: "operator_auth_failed" }).code, "unauthorised");
    assert.equal(
      classifyRiskResponse(503, { code: "operator_actions_disabled" }).code,
      "locked",
    );
    assert.equal(
      classifyRiskResponse(503, { code: "gateway_not_configured" }).code,
      "gateway_missing",
    );
    assert.equal(classifyRiskResponse(502, { code: "gateway_auth_failed", error: "x", hint: "check token" }).code, "gateway_failed");
    assert.equal(classifyRiskResponse(504, { code: "gateway_unreachable" }).code, "gateway_failed");
    assert.equal(classifyRiskResponse(400, { code: "invalid_action" }).code, "invalid");
  });

  it("surfaces the route's own words when present", () => {
    const ok = classifyRiskResponse(200, { summary: "Kill switch engaged across the book." });
    assert.ok(ok.message.includes("Kill switch engaged"));
    const failed = classifyRiskResponse(502, { error: "The risk gateway refused the halt (HTTP 500).", hint: "check it" });
    assert.ok(failed.message.includes("refused the halt"));
    assert.ok(failed.message.includes("check it"));
  });

  it("tolerates bodies that are not objects", () => {
    assert.equal(classifyRiskResponse(502, null).code, "gateway_failed");
    assert.equal(classifyRiskResponse(200, null).ok, true);
  });
});

describe("source invariants", () => {
  const source = readFileSync(
    join(import.meta.dirname, "..", "components/portfolio/ExecutionHandoff.tsx"),
    "utf8",
  );

  it("ExecutionHandoff routes through lib/risk-control and carries the operator token", () => {
    // Pins the 401 fix: the component must never rebuild its own unauthenticated fetch.
    assert.ok(source.includes("@/lib/risk-control"), "ExecutionHandoff must import lib/risk-control");
    assert.ok(source.includes("operatorToken"), "ExecutionHandoff must accept the operator token");
  });
});
