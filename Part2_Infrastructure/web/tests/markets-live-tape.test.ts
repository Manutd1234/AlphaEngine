/**
 * The in-browser tape: what it records, what it refuses, and what it forgets.
 *
 * WHY THIS SUITE CAN ASSERT MORE THAN MOST ON THIS DESK. Almost every guard
 * here reads component source and matches text, because `npm test` has no DOM
 * (CLAUDE.md, fact 6). `lib/coherence/use-live-series.ts` is different: the
 * store underneath the hook is plain functions over a Map, so its three
 * load-bearing behaviours can be RUN rather than read. They are worth running,
 * because each one is invisible until it has been wrong for a while:
 *
 *  1. A repeat timestamp is dropped. Sections re-render on things that are not
 *     polls — a view switch, a picker, the head's clock ticking once a second —
 *     and the hook records during render. Without this the tape would take a
 *     point per render and draw a dense flat line at the current value, which
 *     looks exactly like a measurement of stability.
 *  2. A null is APPENDED, never skipped. A poll that answered nothing is a hole
 *     in the record; dropping it would close the gap and draw the two readings
 *     either side as consecutive, which is the defect `GappedSparkline` was
 *     written for in the first place.
 *  3. The ring forgets from the FRONT. A desk left open overnight must cost
 *     what one opened a minute ago costs.
 *
 * The figure itself is still derived, not observed — that `LiveTape` draws a
 * break at a null is a property of `linePath`, which `chart-kit` owns and its
 * own callers rely on.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  LIVE_SERIES_CAP,
  readLive,
  recordLive,
  resetLiveSeries,
} from "../lib/coherence/use-live-series";
import { read } from "./helpers/workspace-sources";

beforeEach(() => resetLiveSeries());

describe("the tape records one point per poll and not one per render", () => {
  it("drops a repeat of the same moment", () => {
    recordLive("k", 1_000, 0.5);
    recordLive("k", 1_000, 0.5);
    recordLive("k", 1_000, 0.9);
    assert.equal(readLive("k").length, 1, "a re-render appended a second point for one poll");
    assert.equal(readLive("k")[0].value, 0.5, "the repeat overwrote the poll's own reading");
  });

  it("drops a moment older than the newest it holds", () => {
    // Not merely equal-to. Two sections share one URL through `read-cache`, so
    // a slow render can arrive carrying an earlier `updatedAt` than the tape
    // already has — appending it would put the series out of order and the
    // line would double back on itself.
    recordLive("k", 2_000, 1);
    recordLive("k", 1_000, 9);
    assert.deepEqual(readLive("k").map((p) => p.at), [2_000]);
  });

  it("ignores a poll with no moment at all", () => {
    recordLive("k", null, 1);
    recordLive("k", undefined, 1);
    assert.equal(readLive("k").length, 0);
  });
});

describe("absence is recorded, never skipped", () => {
  it("keeps a null between two readings", () => {
    recordLive("k", 1, 0.4);
    recordLive("k", 2, null);
    recordLive("k", 3, 0.6);
    assert.deepEqual(readLive("k").map((p) => p.value), [0.4, null, 0.6],
      "a failed poll was dropped, so the two readings either side now read as consecutive");
  });
});

describe("one series per key, and the key carries the subject", () => {
  it("keeps two subjects apart", () => {
    recordLive("books:A:bid", 1, 0.1);
    recordLive("books:B:bid", 1, 0.9);
    assert.deepEqual(readLive("books:A:bid").map((p) => p.value), [0.1]);
    assert.deepEqual(readLive("books:B:bid").map((p) => p.value), [0.9]);
  });

  it("and every caller builds a key that names one", () => {
    // The property that makes the isolation above worth anything. A call site
    // keying on the section alone would weld two families' readings into one
    // line and draw the reader's own pick as a move in the market.
    const sites: Array<[string, string]> = [
      ["UniverseSection", "components/coherence/UniverseSection.tsx"],
      ["BooksSection", "components/coherence/BooksSection.tsx"],
      ["SurfacePane", "components/coherence/SurfacePane.tsx"],
      ["StakePane", "components/coherence/StakePane.tsx"],
      ["FeesSection", "components/coherence/FeesSection.tsx"],
    ];
    for (const [name, path] of sites) {
      const source = read(`../${path}`);
      const call = /useLiveSeries\(\s*`([^`]+)`/.exec(source);
      assert.ok(call, `${name} mounts a tape without a template-literal key`);
      assert.match(call[1], /\$\{/, `${name} keys its tape on a constant, so two subjects would share one series`);
    }
  });
});

describe("the ring forgets from the front", () => {
  it("never grows past the cap", () => {
    for (let i = 1; i <= LIVE_SERIES_CAP + 40; i += 1) recordLive("k", i, i);
    const held = readLive("k");
    assert.equal(held.length, LIVE_SERIES_CAP);
    assert.equal(held[held.length - 1].value, LIVE_SERIES_CAP + 40, "the newest reading was the one dropped");
    assert.equal(held[0].value, 41, "the oldest readings were not the ones dropped");
  });
});

describe("the figure says what its axis means", () => {
  it("every caption is scoped to this browser's own session", () => {
    // The one claim on this figure a reader cannot check for themselves, and
    // the one that would make it a lie: an x-axis that appears to mean "the
    // last hour" and means "the four minutes you have been here".
    const tape = read("../components/coherence/LiveTape.tsx");
    assert.match(tape, /since this tab opened/,
      "the scope left the caption, so the tape now reads as recorded history");
    // The span is interpolated, so the literal "reads over" never appears —
    // pin the expression that builds it rather than a sentence the ternary
    // only ever assembles at runtime.
    assert.match(tape, /over \$\{span\}/,
      "the caption no longer says how long the tape actually covers");
    assert.match(tape, /points\.length === 1 \? "read" : "reads"/,
      "the caption stopped counting the reads it is drawn from");
  });

  it("and it refuses to draw a line through one reading", () => {
    // A single point on a time axis reads as a flat line at that value — a
    // measurement of stability nobody made.
    assert.match(read("../components/coherence/LiveTape.tsx"), /measured\.length < 2/);
  });
});
