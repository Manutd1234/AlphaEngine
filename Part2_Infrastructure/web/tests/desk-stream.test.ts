/**
 * The live desk stream, and the honesty rules it has to keep.
 *
 * A stream is allowed to drop. That is not the failure — the failure is a panel
 * that keeps showing the last number it received as though the feed were still
 * live. Every assertion here exists to stop that specific outcome, so most of
 * them are about what the code says when it is NOT working.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const hook = readFileSync(fileURLToPath(new URL("../lib/use-desk-stream.ts", import.meta.url)), "utf8");
const proxy = readFileSync(
  fileURLToPath(new URL("../app/api/stream/desk/route.ts", import.meta.url)), "utf8");
const gateway = readFileSync(
  fileURLToPath(new URL("../../main.py", import.meta.url)), "utf8");

/** Comment-free view: this file quotes the very constructs it forbids. */
const code = (source: string) =>
  source
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("#");
    })
    .join("\n");

describe("the stream never replaces the poll as the source of record", () => {
  it("says so where the next reader will look", () => {
    // Load-bearing, not decorative. A stream that drops while reconnecting
    // cannot back anything that must be complete, and the next person to wire
    // a panel to this hook needs to meet that sentence before they do.
    assert.match(hook, /does not replace the poll/i);
  });

  it("every non-live state tells the reader the numbers are polled", () => {
    // The states exist to be rendered. If `unavailable` read like `live`, the
    // panel would present stale equity as current — the one outcome this
    // module is built to prevent.
    for (const state of ["unconfigured", "connecting", "unavailable"]) {
      // The whole string literal. Stopping at the first `;` truncated it
      // mid-sentence, because the sentence contains one.
      const clause = new RegExp(`case "${state}":\\s*return\\s*"[^"]*"`, "m");
      const matched = clause.exec(hook)?.[0] ?? "";
      assert.match(
        matched, /poll/i,
        `describeDeskStream("${state}") does not tell the reader the numbers are polled`,
      );
    }
  });
});

describe("a dropped connection degrades honestly", () => {
  it("keeps the last payload rather than blanking a recovering panel", () => {
    const handler = /const onError = \(\) => \{[\s\S]*?\};/.exec(hook)?.[0] ?? "";
    assert.ok(handler, "the error handler is gone");
    assert.doesNotMatch(handler, /data:\s*null/, "an error blanks the data a reconnect is about to restore");
    assert.match(handler, /unavailable/);
  });

  it("does not close the source on error — EventSource has its own backoff", () => {
    const handler = /const onError = \(\) => \{[\s\S]*?\};/.exec(hook)?.[0] ?? "";
    assert.doesNotMatch(
      handler, /\.close\(\)/,
      "closing on error disables the browser's own reconnection and the feed never returns",
    );
  });

  it("a malformed frame does not tear down a working connection", () => {
    const handler = /const onRisk = [\s\S]*?\n    \};/.exec(hook)?.[0] ?? "";
    assert.match(handler, /catch\s*\{[\s\S]*?return/, "a bad JSON frame is not contained");
  });
});

describe("sequence gaps are reported rather than smoothed over", () => {
  it("tracks the expected next sequence and flags a jump", () => {
    assert.match(hook, /expectedSeq/);
    assert.match(hook, /missed/);
  });

  it("does not flag the very first event as a gap", () => {
    // The gateway's counter starts wherever it starts; a client joining a
    // running desk legitimately sees a high first sequence. Flagging that would
    // make every fresh page load claim it had lost data.
    assert.match(
      code(hook), /expectedSeq\.current > 0 && seq > expectedSeq\.current/,
      "the first-event guard is missing — every page load would report a gap",
    );
  });

  it("the proxy forwards Last-Event-ID so a reconnect can resume", () => {
    assert.match(code(proxy), /last-event-id/i);
    assert.match(code(proxy), /Last-Event-ID/);
  });
});

describe("the proxy exists for a reason it states, and pipes without re-framing", () => {
  it("returns a typed 503 rather than an empty stream when unconfigured", () => {
    // An EventSource that connects and receives nothing looks exactly like a
    // healthy quiet desk. The panel would sit on stale numbers claiming live.
    assert.match(code(proxy), /status:\s*503/);
    assert.match(code(proxy), /unconfigured/);
  });

  it("passes the upstream body straight through", () => {
    // Parsing and re-serialising would break Last-Event-ID resumption and add a
    // second place the framing can be wrong.
    assert.match(code(proxy), /new Response\(response\.body/);
  });

  it("disables proxy buffering on both hops", () => {
    // Without this an intermediary holds the whole stream and delivers it at
    // close, which is a slow poll wearing a stream's content type.
    assert.match(code(proxy), /X-Accel-Buffering/);
    assert.match(code(gateway), /X-Accel-Buffering/);
  });

  it("keeps the bearer token server-side", () => {
    assert.match(code(proxy), /Authorization.*Bearer/);
    assert.doesNotMatch(hook, /Bearer|token/i, "the client hook must never carry a gateway credential");
  });
});

describe("the gateway emits on change, not on a timer", () => {
  it("skips a tick whose payload is identical to the last", () => {
    // An idle desk costing a full state payload every second is a poll with
    // extra steps, and it is the reason to prefer a stream in the first place.
    assert.match(code(gateway), /if body != last_body/);
  });

  it("heartbeats as an SSE comment so clients discard it silently", () => {
    assert.match(code(gateway), /: ping/);
  });

  it("ticks at the mark-to-market cadence, not faster", () => {
    // Polling the state faster than the book is re-marked cannot produce a
    // newer number; it can only re-send the same one.
    assert.match(code(gateway), /settings\.risk_monitor_interval_s/);
  });
});
