/**
 * The amber gateway card has to name what is wrong with it.
 *
 * `platform.status` collapses three unrelated conditions into one word, and the
 * console rendered that word beside the gateway's FRESHNESS string — so a
 * degraded card read "Gateway 1.0.0; Gateway operations snapshot is current.",
 * naming the one thing that was demonstrably fine. These assert the mapping
 * back to a cause, in the same order `operations.py:374-386` evaluates it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { degradedCause } from "../lib/dependency-graph";

type Platform = Parameters<typeof degradedCause>[0];

const nominal = {
  market_data: { status: "nominal" },
  risk: { status: "normal" },
  telegram: { status: "running" },
  queue: { broker_configured: false, backend: "in-process" },
} as unknown as Platform;

const withPatch = (patch: Record<string, unknown>) =>
  ({ ...(nominal as object), ...patch }) as unknown as Platform;

describe("the degraded gateway names its cause", () => {
  it("returns null when nothing is firing", () => {
    assert.equal(degradedCause(nominal), null);
  });

  it("names a degraded or disabled market-data feed", () => {
    assert.match(String(degradedCause(withPatch({ market_data: { status: "degraded" } }))), /market data/);
    assert.match(String(degradedCause(withPatch({ market_data: { status: "disabled" } }))), /disabled/);
  });

  it("names reduce-only risk", () => {
    assert.match(String(degradedCause(withPatch({ risk: { status: "reduce_only" } }))), /reduce-only/);
  });

  it("no longer treats the Telegram bot as a platform cause at all", () => {
    // It used to be the fourth disjunct, which is how a chat-transport blip
    // reached the TRADING verdict and told a desk its order path was degraded.
    // Telegram is a notification companion: the risk gateway still gates,
    // market data still flows and orders still route without it. It reports on
    // its own plane now (`notificationsPosture` in lib/reliability.ts), so it
    // must never reappear as a cause of the platform rollup here.
    assert.equal(degradedCause(withPatch({ telegram: { status: "degraded" } })), null);
  });

  it("names a configured broker that is not running celery", () => {
    const cause = degradedCause(withPatch({ queue: { broker_configured: true, backend: "in-process" } }));
    assert.match(String(cause), /broker is configured/);
  });

  it("evaluates the disjuncts in the order the gateway does", () => {
    // Mirrored logic, so drift is the risk. If the Python order changes and
    // this does not, the console names the wrong cause on a doubly-degraded
    // deployment and reads as confidently as ever.
    const python = readFileSync(new URL("../../modules/operations.py", import.meta.url), "utf8");
    const start = python.indexOf("elif (");
    const block = python.slice(start, python.indexOf('status = "degraded"', start));
    assert.ok(
      !block.includes("telegram"),
      "Telegram is back in the platform rollup — the category error this suite exists to stop",
    );
    const order = ["market_data.status", "risk.status", "queue_state.broker_configured"];
    let cursor = -1;
    for (const term of order) {
      const at = block.indexOf(term);
      assert.ok(at > cursor, `${term} is not where this file assumes it is in operations.py`);
      cursor = at;
    }
  });
});
