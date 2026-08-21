/**
 * The three primitives every console screen is drawn from.
 *
 * Nothing here touches the network. What is worth pinning is the machinery a
 * console *believes*: a cursor that silently drops a line, a percentile
 * computed over four samples and presented as a p99, an origin tag that
 * conflates a browser line with a server one. Each of those returns HTTP 200
 * and a plausible screen, which is the failure mode an observability surface
 * exists to prevent.
 *
 * The ring's contract is that a gap is *detectable*: it evicts the oldest line
 * and reports which sequence it still holds, so a lagging client can be told it
 * lost lines rather than quietly served a shorter page. Sequences are monotonic
 * for the same reason — two events in one millisecond must not collide.
 *
 * The percentile rules are the honesty doctrine applied to latency. Nearest
 * rank, never interpolation, so the figure is a latency some request actually
 * experienced; an empty window is null rather than 0ms, because an unmeasured
 * provider is not a fast one; and the pool is split so the poll's own gateway
 * hop — sampled twice per poll, and fast — cannot flatten a vendor's tail.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  emit,
  EventRing,
  eventsSince,
  latencyByClass,
  latencyStats,
  percentile,
  recordLatency,
  resetTelemetry,
} from "../lib/observability";

// --------------------------------------------------------------------------
// Event ring
// --------------------------------------------------------------------------

describe("the event cursor never silently loses a line", () => {
  const line = (n: number) => ({
    ts: n, level: "info" as const, source: "T", message: `m${n}`,
    fields: {}, origin: "server" as const,
  });

  it("returns only what the caller has not seen", () => {
    const ring = new EventRing(10);
    for (let i = 0; i < 5; i++) ring.push(line(i));
    const first = ring.since(0);
    assert.equal(first.length, 5);
    assert.equal(ring.since(first[first.length - 1].seq).length, 0, "a caught-up cursor re-read lines");
  });

  it("sequences are monotonic, so two events in one millisecond both survive", () => {
    const ring = new EventRing(10);
    const a = ring.push(line(1_000));
    const b = ring.push(line(1_000));
    assert.notEqual(a.seq, b.seq, "same-millisecond events collided");
    assert.equal(ring.since(a.seq).length, 1);
  });

  it("evicts the oldest and reports it, so a lagging client can detect the gap", () => {
    const ring = new EventRing(3);
    for (let i = 0; i < 6; i++) ring.push(line(i));
    assert.equal(ring.size(), 3);
    assert.equal(ring.oldestSeq(), 4, "oldest retained sequence is wrong");
    // A client sitting on seq 1 has lost 2 and 3; oldest > since + 1 is the test
    // the route performs to say so.
    assert.ok(ring.oldestSeq() > 1 + 1, "the drop would not have been detected");
  });

  it("keeps the NEWEST lines when a limit truncates, not the oldest", () => {
    const ring = new EventRing(50);
    for (let i = 0; i < 20; i++) ring.push(line(i));
    const page = ring.since(0, 5);
    assert.equal(page.length, 5);
    assert.equal(page[page.length - 1].seq, 20, "a lagging client was served a stale page");
  });
});

// --------------------------------------------------------------------------
// Percentiles
// --------------------------------------------------------------------------

describe("percentiles report a latency some request actually experienced", () => {
  it("uses nearest rank, never an interpolated value nobody paid", () => {
    const sorted = [10, 20, 30, 40];
    assert.equal(percentile(sorted, 50), 20);
    assert.equal(percentile(sorted, 95), 40);
    assert.equal(percentile(sorted, 99), 40);
    // Interpolation would answer 25 here, which is not in the sample.
    assert.ok(sorted.includes(percentile(sorted, 50)!), "p50 is not an observed value");
  });

  it("an empty window is null, not zero", () => {
    assert.equal(percentile([], 50), null);
    const stats = latencyStats("never-called-provider");
    assert.equal(stats.n, 0);
    assert.equal(stats.p50, null, "an unmeasured provider reported 0ms");
  });

  it("counts a failed call's latency but reports the error rate separately", () => {
    resetTelemetry({ latency: true });
    recordLatency("px", 10, true);
    recordLatency("px", 20, true);
    recordLatency("px", 8_000, false);
    const stats = latencyStats("px");
    assert.equal(stats.n, 3, "a timeout was excluded from the latency it cost");
    assert.equal(stats.max, 8_000);
    assert.ok(Math.abs(stats.errorRate - 1 / 3) < 1e-9, "error rate is not reported alongside");
    resetTelemetry({ latency: true });
  });

  it("drops samples outside the window so an old outage stops being reported", () => {
    resetTelemetry({ latency: true });
    recordLatency("py", 5_000, false);
    // 16 minutes later the 15-minute window no longer holds it.
    assert.equal(latencyStats("py", Date.now() + 16 * 60_000).n, 0);
    resetTelemetry({ latency: true });
  });

  it("splits the pool so the poll's own gateway hop cannot dominate the vendor tail", () => {
    resetTelemetry({ latency: true });
    // The hop, sampled twice per poll, is fast; one vendor call is slow. The
    // blended p99 would report the vendor as fast; the split must not.
    for (let i = 0; i < 40; i++) recordLatency("plane:gateway", 11, true);
    recordLatency("fmp", 900, true);
    const { gatewayHop, upstream } = latencyByClass();
    assert.equal(gatewayHop.p99, 11, "the hop pool holds only plane:* samples");
    assert.equal(upstream.p99, 900, "the upstream pool holds only vendor/venue samples");
    // A plane sample must not move the upstream figure, and vice versa.
    assert.ok(upstream.n === 1 && gatewayHop.n === 40);
    resetTelemetry({ latency: true });
  });
});

// --------------------------------------------------------------------------
// Emission
// --------------------------------------------------------------------------

describe("events carry the origin they were produced at", () => {
  it("browser and server lines are tagged, never conflated", () => {
    resetTelemetry({ events: true });
    emit({ source: "Console", message: "local" }, "browser");
    emit({ source: "Dispatch", message: "remote" });
    const lines = eventsSince(0);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].origin, "browser");
    assert.equal(lines[1].origin, "server");
    resetTelemetry({ events: true });
  });

  it("an undefined field is dropped rather than serialised as null", () => {
    resetTelemetry({ events: true });
    emit({ source: "T", message: "m", fields: { present: 1, absent: undefined } });
    const [line] = eventsSince(0);
    assert.deepEqual(Object.keys(line.fields), ["present"], "absent and null were collapsed");
    resetTelemetry({ events: true });
  });
});
