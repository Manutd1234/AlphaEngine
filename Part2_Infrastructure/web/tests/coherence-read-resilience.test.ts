/** Coalescing, cancellation and the one-at-a-time warming contract. */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { read, resetCoherenceCache } from "../lib/coherence/read-cache";
import { warmSequentially } from "../lib/coherence/use-section-warming";

afterEach(resetCoherenceCache);

describe("coalesced coherence reads", () => {
  it("keeps shared transport alive until its last subscriber cancels", async () => {
    let starts = 0;
    let transportSignal!: AbortSignal;
    const fetcher = (_url: string, signal: AbortSignal) => {
      starts += 1;
      transportSignal = signal;
      return new Promise<{ data: { value: number } | null; error: string | null }>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })),
          { once: true });
      });
    };
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = read("/shared", fetcher, firstController.signal);
    const second = read("/shared", fetcher, secondController.signal);
    const firstCancelled = assert.rejects(first, { name: "AbortError" });

    firstController.abort();
    await firstCancelled;
    assert.equal(starts, 1, "two subscribers started two transport requests");
    assert.equal(transportSignal.aborted, false, "one subscriber cancelled everybody else's read");

    const secondCancelled = assert.rejects(second, { name: "AbortError" });
    secondController.abort();
    await secondCancelled;
    assert.equal(transportSignal.aborted, true, "an abandoned shared request kept running");
  });
});

describe("section warming", () => {
  it("moves priority URLs first and never overlaps work", async () => {
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const sequence = warmSequentially(
      ["next", "visible", "last"],
      (url) => new Promise<void>((resolve) => {
        started.push(url);
        releases.push(resolve);
      }),
      { priority: ["visible"] },
    );
    await Promise.resolve();
    assert.deepEqual(started, ["visible"]);
    releases.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(started, ["visible", "next"], "the second warm did not await the first");
    releases.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    releases.shift()?.();
    await sequence;
    assert.deepEqual(started, ["visible", "next", "last"]);
  });
});
