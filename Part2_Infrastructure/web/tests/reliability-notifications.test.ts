/**
 * A chat transport is not the order path.
 *
 * `_telegram_snapshot` folded `last_error` into a "degraded" Telegram status,
 * `build_operations_snapshot` folded that into `platform.status`, and
 * `tradingPosture` read the rollup — so one 502 from Telegram's edge told a
 * trader "Trading path: Degraded". Nothing on the order path had moved: the
 * risk gateway still gated, market data still flowed, orders still routed.
 *
 * The fix could not be "delete the clause". Telegram had no other surface on
 * the web, so removing it from the rollup would have traded a false alarm for
 * a silent failure — and this codebase reports empty and unavailable results
 * rather than hiding them. It gets its own plane instead.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GatewayOpsSnapshot } from "../components/systems/types";
import { deriveReliabilityPosture, isGatewayOpsSnapshot } from "../lib/reliability";
import { NOW, health, platform } from "./helpers/reliability-fixtures";

describe("the notification plane is reported without being mistaken for trading", () => {
  type Telegram = GatewayOpsSnapshot["telegram"];

  const withTelegram = (status: Telegram["status"], extra: Partial<Telegram> = {}) =>
    health({
      platform: platform({
        telegram: { ...platform().telegram, enabled: true, mode: "polling", status, ...extra },
      }),
    });

  const down = () => withTelegram("degraded", { last_error_present: true, uptime_seconds: 42 });

  it("does not let a Telegram outage degrade the trading path", () => {
    // The whole bug, in one assertion.
    const posture = deriveReliabilityPosture(down(), NOW);
    assert.equal(posture.paths.trading.status, "nominal");
    assert.doesNotMatch(posture.paths.trading.reason, /Telegram/i);
  });

  it("reports that outage on its own plane rather than hiding it", () => {
    // Fixing a false alarm by creating a silent failure is not a fix.
    const posture = deriveReliabilityPosture(down(), NOW);
    assert.equal(posture.paths.notifications.status, "degraded");
    assert.match(posture.paths.notifications.reason, /Telegram/);
    assert.equal(posture.overall, "degraded");
    assert.equal(posture.reason, posture.paths.notifications.reason);
  });

  it("says in the same breath that the order path is unaffected", () => {
    assert.match(deriveReliabilityPosture(down(), NOW).paths.notifications.reason, /unaffected/);
  });

  it("names the kind of fault the gateway reports, and never calls a conflict a transport error", () => {
    // 2026-08-23: two gateways on one token took turns being refused with 409
    // Conflict, and this sentence called it a transport error for 13 hours.
    const conflict = deriveReliabilityPosture(withTelegram("degraded", { last_error_present: true, last_error_kind: "conflict" }), NOW);
    assert.equal(conflict.paths.notifications.status, "degraded");
    assert.match(conflict.paths.notifications.reason, /409 Conflict/);
    assert.match(conflict.paths.notifications.reason, /TELEGRAM_MODE=send-only/, "the remedy travels with the diagnosis");
    assert.doesNotMatch(conflict.paths.notifications.reason, /transport/);
    assert.match(conflict.paths.notifications.reason, /unaffected/);

    const transport = deriveReliabilityPosture(withTelegram("degraded", { last_error_present: true, last_error_kind: "transport" }), NOW);
    assert.match(transport.paths.notifications.reason, /transport error/);

    const api = deriveReliabilityPosture(withTelegram("degraded", { last_error_present: true, last_error_kind: "api" }), NOW);
    assert.match(api.paths.notifications.reason, /Telegram refused/);
    assert.doesNotMatch(api.paths.notifications.reason, /transport/);

    // A gateway older than the field: degraded, and honestly unclassified.
    assert.match(down().platform ? deriveReliabilityPosture(down(), NOW).paths.notifications.reason : "", /reports an error on its last call/);
    assert.doesNotMatch(deriveReliabilityPosture(down(), NOW).paths.notifications.reason, /transport/);
  });

  it("accepts the kind at the runtime boundary, and refuses a kind it does not know", () => {
    assert.ok(isGatewayOpsSnapshot(platform({ telegram: { ...platform().telegram, enabled: true, status: "degraded", last_error_present: true, last_error_kind: "conflict" } })));
    assert.ok(isGatewayOpsSnapshot(platform({ telegram: { ...platform().telegram, last_error_kind: null } })));
    assert.ok(!isGatewayOpsSnapshot(platform({ telegram: { ...platform().telegram, last_error_kind: "gremlins" as unknown as "api" } })));
  });

  it("calls an enabled bot that has not finished starting starting, not degraded", () => {
    const posture = deriveReliabilityPosture(withTelegram("starting", { uptime_seconds: 0 }), NOW);
    assert.equal(posture.paths.notifications.status, "unknown");
    assert.match(posture.paths.notifications.reason, /has not finished starting/);
    assert.equal(posture.paths.trading.status, "nominal");
    assert.equal(posture.overall, "nominal");
  });

  it("treats a deployment with no companion as unmeasured, not as a fault", () => {
    // The shipped fixture has Telegram disabled, which is a configuration.
    const posture = deriveReliabilityPosture(health(), NOW);
    assert.equal(posture.paths.notifications.status, "unknown");
    assert.match(posture.paths.notifications.reason, /No Telegram notification companion is enabled/);
    assert.equal(posture.overall, "nominal");
  });

  it("never lets the notification plane outrank a real trading fault", () => {
    const posture = deriveReliabilityPosture(health({
      platform: platform({
        status: "halted",
        risk: { ...platform().risk, status: "halted", kill_switch_active: true },
        telegram: { ...platform().telegram, enabled: true, mode: "polling", status: "degraded", last_error_present: true },
      }),
    }), NOW);
    assert.equal(posture.overall, "halted");
    assert.equal(posture.reason, posture.paths.trading.reason);
    assert.equal(posture.paths.notifications.status, "degraded", "still reported, just outranked");
  });

  it("accepts the new wire state at the runtime boundary", () => {
    // Rejecting the payload would turn a starting bot into an UNKNOWN trading
    // path — the same category error wearing a different hat.
    assert.ok(isGatewayOpsSnapshot(platform({
      telegram: { ...platform().telegram, enabled: true, status: "starting" },
    })));
  });

  it("names the degraded disjunct instead of gesturing at a supporting component", () => {
    const posture = deriveReliabilityPosture(health({
      platform: platform({
        status: "degraded",
        queue: { ...platform().queue, broker_configured: true, backend: "threadpool" },
      }),
    }), NOW);
    assert.equal(posture.paths.trading.status, "degraded");
    assert.match(posture.paths.trading.reason, /broker is configured but the queue is running threadpool/);
    assert.doesNotMatch(posture.paths.trading.reason, /A supporting gateway component/);
  });
});
